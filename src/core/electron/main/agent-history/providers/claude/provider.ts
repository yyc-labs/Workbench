/**
 * Claude Code provider (docs/todo/19 §8.2 claude format; plan 20 stage 1).
 * Discovery: bucket dir under ~/.claude/projects whose name encodes the cwd
 * (non-alphanumeric → '-', case preserved; WSL projects encode the posix cwd).
 * Parsing: standard Claude Code JSONL with type=user/assistant rows; every
 * other row type is skipped. All IO goes through the routed data source.
 */
import { AGENT_HISTORY_LIMITS, type AgentHistoryProjectContext, type AgentHistorySession } from '../../../../../shared/types/agentHistory'
import type { AgentHistoryDataSource } from '../../datasource/types'
import { type DiscoveryListing, joinLogicPath, listJsonlSessionFiles } from '../../file-discovery'
import { encodeClaudeBucketName, identityForNamespace } from '../../path-normalizer'
import { createSessionKey } from '../../session-identity'
import { createResumableAccumulator, hashBuffer, type ResumableBaseline, splitCompleteLines } from '../shared/incremental-parser'
import { createSessionAccumulator, parseJsonLine, readJsonlLines } from '../shared/jsonl-parser'
import { readSessionMessagePage } from '../../fulltext/extract'
import { AgentHistoryFileError, type AgentHistoryProvider, type DiscoverResult, type ParseSessionOptions, type SessionCandidate } from '../types'

export const CLAUDE_PARSER_VERSION = 1

const TITLE_MAX_LENGTH = 120

interface ClaudeRow {
  type?: string
  timestamp?: string
  cwd?: string
  gitBranch?: string
  sessionId?: string
  isSidechain?: boolean
  isMeta?: boolean
  message?: {
    role?: string
    model?: string
    content?: string | Array<{ type?: string; text?: string }>
  }
}

export function createClaudeAgentHistoryProvider(deps: { getHomeDir: () => string }): AgentHistoryProvider {
  return {
    id: 'claude',
    // Stage 0/6: resume verified against the real CLI (--resume / -r / resume).
    capabilities: { preview: true, fullTranscript: true, incrementalRead: true, nativeResume: true },
    parserVersion: CLAUDE_PARSER_VERSION,
    readMessages: (candidate, dataSource, before, limit) => readSessionMessagePage(dataSource, 'claude', candidate.filePath, before, limit),

    async discover(context: AgentHistoryProjectContext, dataSource: AgentHistoryDataSource, signal?: AbortSignal): Promise<DiscoverResult> {
      const base = await resolveHomeBase(dataSource, deps.getHomeDir)
      const projectsRoot = joinLogicPath(base, '.claude', 'projects')
      if (!(await dataSource.stat(projectsRoot, signal))) {
        throw new AgentHistoryFileError('SOURCE_UNAVAILABLE', 'claude projects root not found')
      }
      // WSL projects encode the cwd as seen inside the distro, not the UNC path.
      const bucketDir = joinLogicPath(projectsRoot, encodeClaudeBucketName(context.posixPath ?? context.nativePath))
      // Recursive: real corpora nest subdirectories inside a bucket (observed in
      // stage 0/1 on both sides — e.g. an archived "windows/" subdir with plain
      // session JSONL). Windows buckets without nesting behave identically.
      const listing: DiscoveryListing = await listJsonlSessionFiles(dataSource, bucketDir, {
        maxFiles: AGENT_HISTORY_LIMITS.maxCandidateFiles,
        recursive: true,
        signal,
      })
      return { candidates: listing.files.map(toCandidate), truncated: listing.truncated }
    },

    async getRootDir(context: AgentHistoryProjectContext, dataSource: AgentHistoryDataSource): Promise<string | null> {
      if (dataSource.homeDir) {
        const home = await dataSource.homeDir()
        return home === null ? null : home + '/.claude/projects'
      }
      return deps.getHomeDir() + '/.claude/projects'
    },

    async parseIncremental(candidate: SessionCandidate, dataSource: AgentHistoryDataSource, baseline: ResumableBaseline, options?: ParseSessionOptions) {
      return parseIncrementalClaude(candidate, dataSource, baseline, options)
    },

    async parseSession(candidate: SessionCandidate, dataSource: AgentHistoryDataSource, options?: ParseSessionOptions): Promise<AgentHistorySession> {
      const accumulator = createSessionAccumulator({
        previewMessageCount: AGENT_HISTORY_LIMITS.previewMessageCount,
        previewTextMaxLength: AGENT_HISTORY_LIMITS.previewTextMaxLength,
      })
      let sessionId: string | null = null
      let cwd: string | null = null
      let branch: string | null = null
      let model: string | null = null
      let title: string | null = null

      for await (const line of readJsonlLines(dataSource, candidate.filePath, options?.signal)) {
        const row = parseJsonLine<ClaudeRow>(line)
        if (!row || typeof row.type !== 'string') continue
        if (row.type === 'user') {
          if (row.isSidechain === true) continue
          const text = extractUserText(row)
          accumulator.touch(row.timestamp)
          if (text) {
            accumulator.addMessage({ role: 'user', text, timestamp: row.timestamp })
            if (title === null) title = text.length > TITLE_MAX_LENGTH ? `${text.slice(0, TITLE_MAX_LENGTH)}…` : text
          }
        } else if (row.type === 'assistant') {
          const text = extractAssistantText(row)
          accumulator.touch(row.timestamp)
          if (text) accumulator.addMessage({ role: 'assistant', text, timestamp: row.timestamp })
          if (typeof row.message?.model === 'string' && row.message.model) model = row.message.model
          if (typeof row.cwd === 'string' && row.cwd) cwd = row.cwd
          if (typeof row.gitBranch === 'string' && row.gitBranch) branch = row.gitBranch
          if (typeof row.sessionId === 'string' && row.sessionId) sessionId = row.sessionId
        }
        // Other row types (summary, file-history-snapshot, …) are skipped by whitelist.
      }

      const summary = accumulator.summary()
      return {
        sessionKey: createSessionKey({ agent: 'claude', namespaceId: dataSource.namespaceId, filePath: identityForNamespace(dataSource.namespaceId, candidate.filePath), nativeSessionId: sessionId }),
        agent: 'claude',
        updatedAt: summary.updatedAt ?? new Date(candidate.mtimeMs).toISOString(),
        sessionId,
        title,
        cwd,
        branch,
        model,
        createdAt: summary.createdAt,
        messageCount: summary.messageCount,
        previewMessages: summary.previewMessages,
        source: {
          filePath: candidate.filePath,
          mtimeMs: candidate.mtimeMs,
          sizeBytes: candidate.sizeBytes,
          parserVersion: CLAUDE_PARSER_VERSION,
        },
      }
    },
  }
}

/** WSL sources resolve the distro default-user home; local falls back to the injected Windows home. */
async function resolveHomeBase(dataSource: AgentHistoryDataSource, fallbackGetHomeDir: () => string): Promise<string> {
  if (dataSource.homeDir) {
    const home = await dataSource.homeDir()
    if (home === null) throw new AgentHistoryFileError('SOURCE_UNAVAILABLE', 'claude projects root not found: wsl home unresolvable')
    return home
  }
  return fallbackGetHomeDir()
}

function toCandidate(file: { filePath: string; mtimeMs: number; sizeBytes: number }): SessionCandidate {
  return { agent: 'claude', filePath: file.filePath, mtimeMs: file.mtimeMs, sizeBytes: file.sizeBytes }
}

function extractUserText(row: ClaudeRow): string {
  const content = row.message?.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n')
    .trim()
}

function extractAssistantText(row: ClaudeRow): string {
  const content = row.message?.content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n')
    .trim()
}

/**
 * Verified incremental continuation for claude JSONL. Correctness guards (D8):
 * shrunk file / offset not on a record boundary / committed-prefix hash
 * mismatch → null (full re-parse). Derived fields follow full-parse rules:
 * title keeps the baseline (first user prompt already consumed), while
 * cwd/branch/model/sessionId re-apply last-value-wins on new rows.
 */
async function parseIncrementalClaude(candidate: SessionCandidate, dataSource: AgentHistoryDataSource, baseline: ResumableBaseline, options?: ParseSessionOptions) {
  try {
    if (candidate.sizeBytes < baseline.byteOffset || baseline.byteOffset <= 0) return null
    const committed = await dataSource.readRange(candidate.filePath, 0, baseline.byteOffset, options?.signal)
    if (hashBuffer(committed) !== baseline.prefixHash) return null
    if (committed[committed.length - 1] !== 0x0a) return null // offset not on a record boundary
    const tail = await dataSource.readRange(candidate.filePath, baseline.byteOffset, candidate.sizeBytes - baseline.byteOffset, options?.signal)
    const { lines, consumedBytes } = splitCompleteLines(tail)

    const accumulator = createResumableAccumulator(baseline.session, {
      previewMessageCount: AGENT_HISTORY_LIMITS.previewMessageCount,
      previewTextMaxLength: AGENT_HISTORY_LIMITS.previewTextMaxLength,
    })
    let cwd = baseline.session.cwd
    let branch = baseline.session.branch
    let model = baseline.session.model
    let sessionId = baseline.session.sessionId
    for (const line of lines) {
      const row = parseJsonLine<ClaudeRow>(line)
      if (!row || typeof row.type !== 'string') continue
      if (row.type === 'user') {
        if (row.isSidechain === true) continue
        accumulator.touch(row.timestamp)
        const text = extractUserText(row)
        if (text) accumulator.addMessage({ role: 'user', text, timestamp: row.timestamp })
      } else if (row.type === 'assistant') {
        accumulator.touch(row.timestamp)
        const text = extractAssistantText(row)
        if (text) accumulator.addMessage({ role: 'assistant', text, timestamp: row.timestamp })
        if (typeof row.message?.model === 'string' && row.message.model) model = row.message.model
        if (typeof row.cwd === 'string' && row.cwd) cwd = row.cwd
        if (typeof row.gitBranch === 'string' && row.gitBranch) branch = row.gitBranch
        if (typeof row.sessionId === 'string' && row.sessionId) sessionId = row.sessionId
      }
    }

    const newOffset = baseline.byteOffset + consumedBytes
    // New committed prefix = old committed bytes + consumed tail bytes.
    const newPrefix = Buffer.concat([committed, tail.subarray(0, consumedBytes)])
    const summary = accumulator.summary()
    const session: AgentHistorySession = {
      sessionKey: baseline.session.sessionKey,
      agent: 'claude',
      updatedAt: summary.updatedAt ?? new Date(candidate.mtimeMs).toISOString(),
      sessionId,
      title: baseline.session.title,
      cwd,
      branch,
      model,
      createdAt: summary.createdAt,
      messageCount: summary.messageCount,
      previewMessages: summary.previewMessages,
      source: {
        filePath: candidate.filePath,
        mtimeMs: candidate.mtimeMs,
        sizeBytes: candidate.sizeBytes,
        parserVersion: CLAUDE_PARSER_VERSION,
        byteOffset: newOffset,
      },
    }
    return { session, byteOffset: newOffset, prefixHash: hashBuffer(newPrefix) }
  } catch {
    return null
  }
}
