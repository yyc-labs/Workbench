/**
 * Shared JSONL parsing core for bucket-layout providers (claude, codebuddy).
 * Streaming line reader + a message/timestamp accumulator. Line *classification*
 * stays in each provider — the two formats are deliberately not assumed equal
 * (docs/todo/19 §8.2 field mappings).
 */
import { createInterface } from 'node:readline'
import type { Readable } from 'node:stream'
import type { AgentHistoryPreviewMessage } from '../../../../../shared/types/agentHistory'
import type { AgentHistoryDataSource } from '../../datasource/types'

export interface JsonlParseLimits {
  previewMessageCount: number
  previewTextMaxLength: number
}

export interface ParsedTimestamps {
  createdAt: string | null
  updatedAt: string | null
}

export interface AccumulatedSummary extends ParsedTimestamps {
  messageCount: number
  previewMessages: AgentHistoryPreviewMessage[]
}

export interface SessionAccumulator {
  /** Record activity time from any consumed row. Accepts epoch-ms numbers or ISO strings. */
  touch(timestamp: string | number | null | undefined): void
  addMessage(message: { role: 'user' | 'assistant' | 'system'; text: string; timestamp: string | number | null | undefined }): void
  summary(): AccumulatedSummary
}

/** Normalize epoch-ms or ISO input into a UTC ISO string; null when invalid. */
export function toIsoTimestamp(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

export function createSessionAccumulator(limits: JsonlParseLimits): SessionAccumulator {
  let minMs: number | null = null
  let maxMs: number | null = null
  let messageCount = 0
  const preview: AgentHistoryPreviewMessage[] = []

  const toMs = (value: string | number | null | undefined): number | null => {
    const date = typeof value === 'number' ? new Date(value) : value ? new Date(value) : null
    return date && Number.isFinite(date.getTime()) ? date.getTime() : null
  }

  return {
    touch(timestamp) {
      const ms = toMs(timestamp)
      if (ms === null) return
      if (minMs === null || ms < minMs) minMs = ms
      if (maxMs === null || ms > maxMs) maxMs = ms
    },
    addMessage(message) {
      const text = message.text.trim()
      if (!text) return
      messageCount += 1
      preview.push({
        role: message.role,
        text: text.length > limits.previewTextMaxLength ? `${text.slice(0, limits.previewTextMaxLength)}…` : text,
        timestamp: toIsoTimestamp(message.timestamp),
      })
      if (preview.length > limits.previewMessageCount) preview.shift()
    },
    summary() {
      return {
        createdAt: minMs !== null ? new Date(minMs).toISOString() : null,
        updatedAt: maxMs !== null ? new Date(maxMs).toISOString() : null,
        messageCount,
        previewMessages: preview,
      }
    },
  }
}

/** Stream a JSONL file line by line via the data source; malformed lines are surfaced raw and skipped by callers. */
export async function* readJsonlLines(dataSource: AgentHistoryDataSource, filePath: string, signal?: AbortSignal): AsyncGenerator<string> {
  const stream: Readable = await dataSource.openRead(filePath, signal)
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      if (signal?.aborted) return
      yield line
    }
  } finally {
    rl.close()
    stream.destroy()
  }
}

/** Safe JSON parse for a single JSONL line; null on any failure (truncated tail, garbage). */
export function parseJsonLine<T = Record<string, unknown>>(line: string): T | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as T
  } catch {
    return null
  }
}
