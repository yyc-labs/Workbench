/**
 * Full-text extraction for the FTS pipeline (plan 20 stage 5).
 *
 * The index text is capped per session with a head+tail policy (first 64KB
 * keeps early context, last 192KB keeps the recent conversation). Truncation
 * is reported so search coverage can disclose it. Privacy rules from the plan:
 * text is indexed only after the same length/dedup discipline as previews;
 * message text never reaches logs or issue details.
 */

import type { AgentHistoryAgent } from '../../../../shared/types/agentHistory'
import type { AgentHistoryDataSource } from '../datasource/types'
import { readJsonlLines, parseJsonLine } from '../providers/shared/jsonl-parser'
import { appendConfiguredAgentHistoryAttachments } from '../providers/codebuddy/attachments'

export interface IndexedMessage {
  role: string
  text: string
}

export interface ExtractResult {
  messages: IndexedMessage[]
  truncated: boolean
}

export async function readSessionMessagePage(dataSource: AgentHistoryDataSource, agent: AgentHistoryAgent, filePath: string, before: number, limit: number): Promise<{ messages: { role: 'user' | 'assistant' | 'system'; text: string; timestamp: string | null }[]; total: number }> {
  const getMessage = (line: string) => {
    const row = parseJsonLine<RowLike>(line)
    if (!row || (agent === 'codex' && row.payload?.role !== 'user' && row.payload?.role !== 'assistant' && row.payload?.role !== 'developer')) return null
    const parsed = extractRowMessage(agent, row)
    const attachments = agent === 'codebuddy' ? appendConfiguredAgentHistoryAttachments(row) : ''
    if (!parsed?.text && !attachments) return null
    if (agent === 'codex' && parsed?.role === 'user' && (parsed.text.startsWith('<user_instructions>') || parsed.text.startsWith('<environment_context>') || parsed.text.startsWith('<ENVIRONMENT_CONTEXT>'))) return null
    const timestamp = typeof row.timestamp === 'number' ? new Date(row.timestamp).toISOString() : typeof row.timestamp === 'string' ? row.timestamp : null
    const role: 'user' | 'assistant' | 'system' = agent === 'codex' && row.payload?.role === 'developer' ? 'system' : ((parsed?.role ?? 'user') as 'user' | 'assistant')
    const text = attachments + (parsed?.text ?? '')
    return { role, text, timestamp }
  }
  let total = 0
  for await (const line of readJsonlLines(dataSource, filePath)) if (getMessage(line)) total += 1
  const end = Math.max(0, Math.min(before, total))
  const start = Math.max(0, end - limit)
  const messages: { role: 'user' | 'assistant' | 'system'; text: string; timestamp: string | null }[] = []
  let index = 0
  for await (const line of readJsonlLines(dataSource, filePath)) {
    if (index >= end) break
    const message = getMessage(line)
    if (message) {
      if (index >= start) messages.push(message)
      index += 1
    }
  }
  return { messages, total }
}

const INDEX_HEAD_BYTES = 64 * 1024
const INDEX_TAIL_BYTES = 192 * 1024
export const INDEX_TOTAL_MAX_BYTES = INDEX_HEAD_BYTES + INDEX_TAIL_BYTES

interface RowLike {
  type?: unknown
  role?: unknown
  timestamp?: unknown
  isSidechain?: unknown
  message?: { role?: unknown; content?: unknown }
  payload?: { type?: unknown; role?: unknown; content?: unknown }
  content?: unknown
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => {
      const type = (block as { type?: unknown } | null)?.type
      return type === 'text' || type === 'input_text' || type === 'output_text'
    })
    .map((block) => String((block as { text?: unknown }).text ?? ''))
    .join('\n')
    .trim()
}

function roleOf(value: unknown): string {
  return value === 'assistant' ? 'assistant' : 'user'
}

/** Row → message for the three known rollout formats (mirrors each provider's parser whitelist). */
export function extractRowMessage(agent: AgentHistoryAgent, row: RowLike): IndexedMessage | null {
  if (agent === 'claude') {
    if (row.type !== 'user' && row.type !== 'assistant') return null
    if (row.type === 'user' && row.isSidechain === true) return null
    const content = row.message?.content
    if (typeof content === 'string') return { role: roleOf(row.message?.role), text: content.trim() }
    const text = textFromContent(content)
    if (!text) return null
    return { role: roleOf(row.message?.role), text }
  }
  if (agent === 'codebuddy') {
    if (row.type !== 'message') return null
    const text = textFromContent(row.content)
    if (!text) return null
    return { role: roleOf(row.role), text }
  }
  // codex
  if (row.type !== 'response_item' || row.payload?.type !== 'message') return null
  const text = textFromContent(row.payload?.content)
  if (!text) return null
  return { role: roleOf(row.payload?.role), text }
}

/**
 * Extract index text for one session file. Reads via the data source, applies
 * the head+tail cap, and splits byte-exact so multi-byte characters are safe.
 */
export async function extractSessionText(dataSource: AgentHistoryDataSource, agent: AgentHistoryAgent, filePath: string, sizeBytes: number, signal?: AbortSignal): Promise<ExtractResult> {
  const truncated = sizeBytes > INDEX_TOTAL_MAX_BYTES
  let head: Buffer = Buffer.alloc(0)
  let tail: Buffer = Buffer.alloc(0)
  if (truncated) {
    head = Buffer.from(await dataSource.readRange(filePath, 0, INDEX_HEAD_BYTES, signal))
    tail = Buffer.from(await dataSource.readRange(filePath, Math.max(0, sizeBytes - INDEX_TAIL_BYTES), INDEX_TAIL_BYTES, signal))
  } else {
    head = Buffer.from(await dataSource.readRange(filePath, 0, sizeBytes, signal))
  }
  const messages: IndexedMessage[] = []
  const consume = (buf: Buffer) => {
    let start = 0
    let idx = buf.indexOf(0x0a)
    const feed = (line: string) => {
      if (!line.trim()) return
      try {
        const row = JSON.parse(line) as RowLike
        const message = extractRowMessage(agent, row)
        if (message && message.text) messages.push(message)
      } catch {
        // Malformed rows are skipped (same discipline as the parsers).
      }
    }
    while (idx !== -1) {
      feed(buf.toString('utf8', start, idx))
      start = idx + 1
      idx = buf.indexOf(0x0a, start)
    }
    // Snapshot extraction consumes to EOF: a final line without a trailing
    // NEWLINE is a complete row here (unlike incremental resumption, where the
    // committed-boundary rule exists to avoid half-written rows).
    if (start < buf.length) feed(buf.toString('utf8', start, buf.length))
  }
  consume(head)
  if (truncated) consume(tail)
  return { messages, truncated }
}
