/**
 * CodeBuddy provider (docs/todo/19 §8.2 codebuddy format — NOT claude-compatible; plan 20 stage 1).
 * Discovery: bucket dir under ~/.codebuddy/projects, lowercase + single-dash
 * encoding. Parsing: type='message' rows with epoch-ms timestamps; type='summary'
 * rows are a title source when present. All IO goes through the routed data source.
 */
import { AGENT_HISTORY_LIMITS, type AgentHistoryProjectContext, type AgentHistorySession } from '../../../../../shared/types/agentHistory'
import type { AgentHistoryDataSource } from '../../datasource/types'
import { type DiscoveryListing, joinLogicPath, listJsonlSessionFiles } from '../../file-discovery'
import { encodeCodebuddyBucketName, identityForNamespace } from '../../path-normalizer'
import { createSessionKey } from '../../session-identity'
import { createResumableAccumulator, hashBuffer, type ResumableBaseline, splitCompleteLines } from '../shared/incremental-parser'
import { createSessionAccumulator, parseJsonLine, readJsonlLines } from '../shared/jsonl-parser'
import { readSessionMessagePage } from '../../fulltext/extract'
import { appendConfiguredAgentHistoryAttachments } from './attachments'
import { AgentHistoryFileError, type AgentHistoryProvider, type DiscoverResult, type ParseSessionOptions, type SessionCandidate } from '../types'

export const CODEBUDDY_PARSER_VERSION = 2

const TITLE_MAX_LENGTH = 120

interface CodebuddyRow {
  type?: string
  timestamp?: number
  role?: string
  sessionId?: string
  cwd?: string
  summary?: unknown
  title?: unknown
  content?: Array<{ type?: string; text?: unknown }>
}

export function createCodebuddyAgentHistoryProvider(deps: { getHomeDir: () => string }): AgentHistoryProvider {
  return {
    id: 'codebuddy',
    // Stage 0/6: resume verified against the real CLI (--resume / -r / resume).
    capabilities: { preview: true, fullTranscript: true, incrementalRead: true, nativeResume: true },
    parserVersion: CODEBUDDY_PARSER_VERSION,
    readMessages: (candidate, dataSource, before, limit) => readSessionMessagePage(dataSource, 'codebuddy', candidate.filePath, before, limit),

    async discover(context: AgentHistoryProjectContext, dataSource: AgentHistoryDataSource, signal?: AbortSignal): Promise<DiscoverResult> {
      const base = await resolveHomeBase(dataSource, deps.getHomeDir)
      const projectsRoot = joinLogicPath(base, '.codebuddy', 'projects')
      if (!(await dataSource.stat(projectsRoot, signal))) {
        throw new AgentHistoryFileError('SOURCE_UNAVAILABLE', 'codebuddy projects root not found')
      }
      // WSL projects encode the cwd as seen inside the distro, not the UNC path.
      const bucketDir = joinLogicPath(projectsRoot, encodeCodebuddyBucketName(context.posixPath ?? context.nativePath))
      const listing: DiscoveryListing = await listJsonlSessionFiles(dataSource, bucketDir, {
        maxFiles: AGENT_HISTORY_LIMITS.maxCandidateFiles,
        signal,
      })
      return { candidates: listing.files.map(toCandidate), truncated: listing.truncated }
    },

    async getRootDir(context: AgentHistoryProjectContext, dataSource: AgentHistoryDataSource): Promise<string | null> {
      if (dataSource.homeDir) {
        const home = await dataSource.homeDir()
        return home === null ? null : home + '/.codebuddy/projects'
      }
      return deps.getHomeDir() + '/.codebuddy/projects'
    },

    async parseIncremental(candidate: SessionCandidate, dataSource: AgentHistoryDataSource, baseline: ResumableBaseline, options?: ParseSessionOptions) {
      return parseIncrementalCodebuddy(candidate, dataSource, baseline, options)
    },

    async parseSession(candidate: SessionCandidate, dataSource: AgentHistoryDataSource, options?: ParseSessionOptions): Promise<AgentHistorySession> {
      const accumulator = createSessionAccumulator({
        previewMessageCount: AGENT_HISTORY_LIMITS.previewMessageCount,
        previewTextMaxLength: AGENT_HISTORY_LIMITS.previewTextMaxLength,
      })
      let sessionId: string | null = null
      let cwd: string | null = null
      let summaryTitle: string | null = null
      let firstUserText: string | null = null

      for await (const line of readJsonlLines(dataSource, candidate.filePath, options?.signal)) {
        const row = parseJsonLine<CodebuddyRow>(line)
        if (!row || typeof row.type !== 'string') continue
        if (row.type === 'message') {
          const role = row.role === 'assistant' ? 'assistant' : 'user'
          const text = appendConfiguredAgentHistoryAttachments(row) + extractText(row)
          accumulator.touch(row.timestamp)
          if (text) {
            accumulator.addMessage({ role, text, timestamp: row.timestamp })
            if (role === 'user' && firstUserText === null) firstUserText = text
          }
          if (typeof row.sessionId === 'string' && row.sessionId) sessionId = row.sessionId
          if (typeof row.cwd === 'string' && row.cwd) cwd = row.cwd
        } else if (row.type === 'summary' && summaryTitle === null) {
          const value = typeof row.summary === 'string' ? row.summary : typeof row.title === 'string' ? row.title : null
          if (value && value.trim()) summaryTitle = value.trim()
        }
        // Other row types (file-history-snapshot, …) are skipped by whitelist.
      }

      const summary = accumulator.summary()
      const title = summaryTitle ?? (firstUserText ? truncateTitle(firstUserText) : null)
      return {
        sessionKey: createSessionKey({ agent: 'codebuddy', namespaceId: dataSource.namespaceId, filePath: identityForNamespace(dataSource.namespaceId, candidate.filePath), nativeSessionId: sessionId }),
        agent: 'codebuddy',
        updatedAt: summary.updatedAt ?? new Date(candidate.mtimeMs).toISOString(),
        sessionId,
        title,
        cwd,
        branch: null,
        model: null,
        createdAt: summary.createdAt,
        messageCount: summary.messageCount,
        previewMessages: summary.previewMessages,
        source: {
          filePath: candidate.filePath,
          mtimeMs: candidate.mtimeMs,
          sizeBytes: candidate.sizeBytes,
          parserVersion: CODEBUDDY_PARSER_VERSION,
        },
      }
    },
  }
}

/** WSL sources resolve the distro default-user home; local falls back to the injected Windows home. */
async function resolveHomeBase(dataSource: AgentHistoryDataSource, fallbackGetHomeDir: () => string): Promise<string> {
  if (dataSource.homeDir) {
    const home = await dataSource.homeDir()
    if (home === null) throw new AgentHistoryFileError('SOURCE_UNAVAILABLE', 'codebuddy projects root not found: wsl home unresolvable')
    return home
  }
  return fallbackGetHomeDir()
}

function toCandidate(file: { filePath: string; mtimeMs: number; sizeBytes: number }): SessionCandidate {
  return { agent: 'codebuddy', filePath: file.filePath, mtimeMs: file.mtimeMs, sizeBytes: file.sizeBytes }
}

function extractText(row: CodebuddyRow): string {
  if (!Array.isArray(row.content)) return ''
  return row.content
    .filter((block) => (block?.type === 'input_text' || block?.type === 'output_text') && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n')
    .trim()
}

function truncateTitle(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  return trimmed.length > TITLE_MAX_LENGTH ? `${trimmed.slice(0, TITLE_MAX_LENGTH)}…` : trimmed
}

/**
 * Verified incremental continuation for codebuddy JSONL. Derived-field rules
 * match the full parse: title keeps the baseline (summary/first-prompt already
 * consumed); cwd/sessionId re-apply last-value-wins on new rows.
 */
async function parseIncrementalCodebuddy(candidate: SessionCandidate, dataSource: AgentHistoryDataSource, baseline: ResumableBaseline, options?: ParseSessionOptions) {
  try {
    if (candidate.sizeBytes < baseline.byteOffset || baseline.byteOffset <= 0) return null
    const committed = await dataSource.readRange(candidate.filePath, 0, baseline.byteOffset, options?.signal)
    if (hashBuffer(committed) !== baseline.prefixHash) return null
    if (committed[committed.length - 1] !== 0x0a) return null
    const tail = await dataSource.readRange(candidate.filePath, baseline.byteOffset, candidate.sizeBytes - baseline.byteOffset, options?.signal)
    const { lines, consumedBytes } = splitCompleteLines(tail)

    const accumulator = createResumableAccumulator(baseline.session, {
      previewMessageCount: AGENT_HISTORY_LIMITS.previewMessageCount,
      previewTextMaxLength: AGENT_HISTORY_LIMITS.previewTextMaxLength,
    })
    let cwd = baseline.session.cwd
    let sessionId = baseline.session.sessionId
    for (const line of lines) {
      const row = parseJsonLine<CodebuddyRow>(line)
      if (!row || typeof row.type !== 'string') continue
      if (row.type === 'message') {
        const role = row.role === 'assistant' ? 'assistant' : 'user'
        const text = extractText(row)
        accumulator.touch(row.timestamp)
        if (text) accumulator.addMessage({ role, text, timestamp: row.timestamp })
        if (typeof row.sessionId === 'string' && row.sessionId) sessionId = row.sessionId
        if (typeof row.cwd === 'string' && row.cwd) cwd = row.cwd
      }
      // summary rows only matter when the baseline has no title; keep baseline otherwise.
    }

    const newOffset = baseline.byteOffset + consumedBytes
    const newPrefix = Buffer.concat([committed, tail.subarray(0, consumedBytes)])
    const summary = accumulator.summary()
    const session: AgentHistorySession = {
      sessionKey: baseline.session.sessionKey,
      agent: 'codebuddy',
      updatedAt: summary.updatedAt ?? new Date(candidate.mtimeMs).toISOString(),
      sessionId,
      title: baseline.session.title,
      cwd,
      branch: baseline.session.branch,
      model: baseline.session.model,
      createdAt: summary.createdAt,
      messageCount: summary.messageCount,
      previewMessages: summary.previewMessages,
      source: {
        filePath: candidate.filePath,
        mtimeMs: candidate.mtimeMs,
        sizeBytes: candidate.sizeBytes,
        parserVersion: CODEBUDDY_PARSER_VERSION,
        byteOffset: newOffset,
      },
    }
    return { session, byteOffset: newOffset, prefixHash: hashBuffer(newPrefix) }
  } catch {
    return null
  }
}
