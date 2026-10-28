/**
 * Codex provider (docs/todo/19 §8.2 codex rollout format; plan 20 stage 1).
 * Discovery: recursive walk of the sessions root ($CODEX_HOME on Windows,
 * ~/.codex inside WSL — the host's CODEX_HOME does not describe the WSL side);
 * each file's head (first 64KB) is read to find session_meta.cwd and filtered
 * by exact project-path identity in the source's own namespace. Head decisions
 * are cached by file identity so a warm scan is stat-only. All IO goes through
 * the routed data source.
 */
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { AGENT_HISTORY_LIMITS, type AgentHistoryProjectContext, type AgentHistorySession } from '../../../../../shared/types/agentHistory'
import type { AgentHistoryDataSource } from '../../datasource/types'
import { joinLogicPath, listJsonlSessionFiles } from '../../file-discovery'
import { createParseCache } from '../../parse-cache'
import { identityForNamespace, normalizePosixPath, normalizeWindowsPath, realpathNormalized } from '../../path-normalizer'
import { createSessionKey } from '../../session-identity'
import { createResumableAccumulator, hashBuffer, type ResumableBaseline, splitCompleteLines } from '../shared/incremental-parser'
import { createSessionAccumulator, parseJsonLine, readJsonlLines } from '../shared/jsonl-parser'
import { readSessionMessagePage } from '../../fulltext/extract'
import { AgentHistoryFileError, type AgentHistoryProvider, type DiscoverResult, type ParseSessionOptions, type SessionCandidate } from '../types'

export const CODEX_PARSER_VERSION = 3

const HEAD_READ_BYTES = 64 * 1024
const TITLE_MAX_LENGTH = 120

interface CodexRow {
  timestamp?: string
  type?: string
  payload?: {
    type?: string
    id?: unknown
    cwd?: unknown
    model?: unknown
    role?: unknown
    git?: { branch?: unknown } | null
    content?: Array<{ type?: string; text?: unknown }>
  }
}

interface CodexSessionIndexRow {
  id?: unknown
  thread_name?: unknown
}

/** Wrapped so a cached "no session_meta" decision (cwd: null) is distinct from a cache miss. */
interface HeadDecision {
  cwd: string | null
}

export function createCodexAgentHistoryProvider(deps: { getCodexHome: () => string }): AgentHistoryProvider & { dispose(): void } {
  const headCache = createParseCache<HeadDecision>()
  const titleIndexCache = new Map<string, Promise<Map<string, string>>>()
  const stateTitleCache = new Map<string, Promise<Map<string, string>>>()

  const readIndexedTitle = async (dataSource: AgentHistoryDataSource, sessionId: string, signal?: AbortSignal): Promise<string | null> => {
    const home = dataSource.homeDir ? await dataSource.homeDir(signal) : deps.getCodexHome()
    if (!home) return null
    const indexPath = dataSource.homeDir ? joinLogicPath(home, '.codex', 'session_index.jsonl') : joinLogicPath(home, 'session_index.jsonl')
    if (!indexPath) return null
    let index = titleIndexCache.get(indexPath)
    if (!index) {
      index = (async () => {
        const titles = new Map<string, string>()
        try {
          for await (const line of readJsonlLines(dataSource, indexPath, signal)) {
            const entry = parseJsonLine<CodexSessionIndexRow>(line)
            if (typeof entry?.id === 'string' && typeof entry.thread_name === 'string' && entry.thread_name.trim()) titles.set(entry.id, entry.thread_name.trim())
          }
        } catch {
          // The index is optional; message text remains a fallback title.
        }
        return titles
      })()
      titleIndexCache.set(indexPath, index)
    }
    const indexedTitle = (await index).get(sessionId)
    if (indexedTitle) return indexedTitle

    let stateTitles = stateTitleCache.get(home)
    if (!stateTitles) {
      const pendingTitles: Promise<Map<string, string>> = Promise.resolve().then(() => {
        const titles = new Map<string, string>()
        let db: DatabaseSync | null = null
        try {
          db = new DatabaseSync(joinLogicPath(home, 'state_5.sqlite'), { readOnly: true })
          db.exec('PRAGMA busy_timeout = 1000')
          for (const row of db.prepare('SELECT id, title FROM threads').all() as { id?: unknown; title?: unknown }[]) {
            if (typeof row.id === 'string' && typeof row.title === 'string' && row.title.trim()) titles.set(row.id, row.title.trim())
          }
        } catch {
          // Codex state is optional; session_index and the first prompt remain fallbacks.
        } finally {
          db?.close()
        }
        return titles
      })
      stateTitles = pendingTitles
      stateTitleCache.set(home, pendingTitles)
    }
    return (await stateTitles).get(sessionId) ?? null
  }

  return {
    id: 'codex',
    // Stage 0/6: resume verified against the real CLI (--resume / -r / resume).
    capabilities: { preview: true, fullTranscript: true, incrementalRead: true, nativeResume: true },
    parserVersion: CODEX_PARSER_VERSION,
    readMessages: (candidate, dataSource, before, limit) => readSessionMessagePage(dataSource, 'codex', candidate.filePath, before, limit),

    async discover(context: AgentHistoryProjectContext, dataSource: AgentHistoryDataSource, signal?: AbortSignal): Promise<DiscoverResult> {
      const isWsl = context.executionEnvironment === 'wsl'
      let sessionsRoot: string
      if (isWsl) {
        const home = dataSource.homeDir ? await dataSource.homeDir(signal) : null
        if (home === null) throw new AgentHistoryFileError('SOURCE_UNAVAILABLE', 'codex sessions root not found: wsl home unresolvable')
        sessionsRoot = joinLogicPath(home, '.codex', 'sessions')
      } else {
        sessionsRoot = join(deps.getCodexHome(), 'sessions')
      }
      const listing = await listJsonlSessionFiles(dataSource, sessionsRoot, {
        maxFiles: AGENT_HISTORY_LIMITS.maxCandidateFiles,
        recursive: true,
        signal,
      })
      // Identity is compared in the source's own namespace: posix cwd inside WSL, win32 on the host.
      const projectIdentity = isWsl ? normalizePosixPath(context.posixPath ?? context.nativePath) : (realpathNormalized(context.nativePath) ?? normalizeWindowsPath(context.nativePath))
      const candidates: SessionCandidate[] = []
      for (const file of listing.files) {
        const metaCwd = await readSessionCwdIdentity(dataSource, file, headCache)
        if (metaCwd !== null && metaCwd === projectIdentity) {
          candidates.push({ agent: 'codex', filePath: file.filePath, mtimeMs: file.mtimeMs, sizeBytes: file.sizeBytes })
        }
      }
      return { candidates, truncated: listing.truncated }
    },

    async getRootDir(context: AgentHistoryProjectContext, dataSource: AgentHistoryDataSource): Promise<string | null> {
      if (context.executionEnvironment === 'wsl') {
        if (!dataSource.homeDir) return null
        const home = await dataSource.homeDir()
        return home === null ? null : home + '/.codex/sessions'
      }
      return join(deps.getCodexHome(), 'sessions')
    },

    async parseIncremental(candidate: SessionCandidate, dataSource: AgentHistoryDataSource, baseline: ResumableBaseline, options?: ParseSessionOptions) {
      return parseIncrementalCodex(candidate, dataSource, baseline, options)
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
      let firstUserText: string | null = null
      let indexedTitle: string | null = null

      for await (const line of readJsonlLines(dataSource, candidate.filePath, options?.signal)) {
        const row = parseJsonLine<CodexRow>(line)
        if (!row || typeof row.type !== 'string') continue
        const payload = row.payload
        if (row.type === 'session_meta') {
          // First session_meta wins (continuations/compaction may append more).
          if (sessionId === null) {
            if (typeof payload?.id === 'string' && payload.id) sessionId = payload.id
            if (typeof payload?.cwd === 'string' && payload.cwd) cwd = payload.cwd
            const gitBranch = payload?.git?.branch
            if (typeof gitBranch === 'string' && gitBranch) branch = gitBranch
          }
          accumulator.touch(row.timestamp)
        } else if (row.type === 'turn_context') {
          if (typeof payload?.model === 'string' && payload.model) model = payload.model
          if (typeof payload?.cwd === 'string' && payload.cwd) cwd = payload.cwd
          accumulator.touch(row.timestamp)
        } else if (row.type === 'response_item' && payload?.type === 'message') {
          if (payload.role !== 'assistant' && payload.role !== 'user' && payload.role !== 'developer') continue
          const role = payload.role === 'developer' ? 'system' : payload.role
          const text = extractMessageText(payload)
          accumulator.touch(row.timestamp)
          // Codex user turns embed environment/instruction wrappers; not real prompts.
          if (text && !(role === 'user' && isSyntheticUserText(text))) {
            accumulator.addMessage({ role, text, timestamp: row.timestamp })
            if (role === 'user' && firstUserText === null) firstUserText = text
          }
        }
        // event_msg and other response_item payload types are not consumed in v1.
      }

      if (sessionId) {
        try {
          indexedTitle = await readIndexedTitle(dataSource, sessionId, options?.signal)
        } catch {
          // The index is optional; keep the first real user message as fallback.
        }
      }

      const summary = accumulator.summary()
      return {
        sessionKey: createSessionKey({ agent: 'codex', namespaceId: dataSource.namespaceId, filePath: identityForNamespace(dataSource.namespaceId, candidate.filePath), nativeSessionId: sessionId }),
        agent: 'codex',
        updatedAt: summary.updatedAt ?? new Date(candidate.mtimeMs).toISOString(),
        sessionId,
        title: indexedTitle ?? (firstUserText ? truncateTitle(firstUserText) : null),
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
          parserVersion: CODEX_PARSER_VERSION,
        },
      }
    },

    dispose() {
      headCache.clear()
      titleIndexCache.clear()
      stateTitleCache.clear()
    },
  }
}

/** Cached head read: session cwd identity, or null when absent/unreadable. */
async function readSessionCwdIdentity(dataSource: AgentHistoryDataSource, file: { filePath: string; mtimeMs: number; sizeBytes: number }, cache: ReturnType<typeof createParseCache<HeadDecision>>): Promise<string | null> {
  const cached = cache.get(file.filePath, { mtimeMs: file.mtimeMs, sizeBytes: file.sizeBytes }, CODEX_PARSER_VERSION)
  if (cached) return cached.cwd
  let identity: string | null = null
  try {
    identity = await readHeadSessionCwd(dataSource, file.filePath)
  } catch {
    identity = null
  }
  cache.set(file.filePath, { mtimeMs: file.mtimeMs, sizeBytes: file.sizeBytes }, CODEX_PARSER_VERSION, { cwd: identity })
  return identity
}

async function readHeadSessionCwd(dataSource: AgentHistoryDataSource, filePath: string): Promise<string | null> {
  const headBuf = await dataSource.readRange(filePath, 0, HEAD_READ_BYTES)
  const head = headBuf.toString('utf8')
  for (const line of head.split('\n')) {
    const row = parseJsonLine<CodexRow>(line)
    if (row?.type === 'session_meta' && typeof row.payload?.cwd === 'string' && row.payload.cwd) {
      // Normalize in the namespace the meta.cwd was written in (posix inside WSL).
      return dataSource.namespaceId.startsWith('wsl:') ? normalizePosixPath(row.payload.cwd) : normalizeWindowsPath(row.payload.cwd)
    }
  }
  return null
}

function extractMessageText(payload: NonNullable<CodexRow['payload']>): string {
  if (!Array.isArray(payload.content)) return ''
  return payload.content
    .filter((block) => (block?.type === 'input_text' || block?.type === 'output_text') && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n')
    .trim()
}

function isSyntheticUserText(text: string): boolean {
  return text.startsWith('<user_instructions>') || text.startsWith('<environment_context>') || text.startsWith('<ENVIRONMENT_CONTEXT>')
}

function truncateTitle(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  return trimmed.length > TITLE_MAX_LENGTH ? `${trimmed.slice(0, TITLE_MAX_LENGTH)}…` : trimmed
}

/**
 * Verified incremental continuation for codex rollout JSONL. Derived-field
 * rules match the full parse: the first session_meta already lives in the
 * baseline (id/branch), model/cwd re-apply last-value-wins from new
 * turn_context rows.
 */
async function parseIncrementalCodex(candidate: SessionCandidate, dataSource: AgentHistoryDataSource, baseline: ResumableBaseline, options?: ParseSessionOptions) {
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
    let model = baseline.session.model
    for (const line of lines) {
      const row = parseJsonLine<CodexRow>(line)
      if (!row || typeof row.type !== 'string') continue
      const payload = row.payload
      if (row.type === 'turn_context') {
        if (typeof payload?.model === 'string' && payload.model) model = payload.model
        if (typeof payload?.cwd === 'string' && payload.cwd) cwd = payload.cwd
        accumulator.touch(row.timestamp)
      } else if (row.type === 'response_item' && payload?.type === 'message') {
        if (payload.role !== 'assistant' && payload.role !== 'user' && payload.role !== 'developer') continue
        const role = payload.role === 'developer' ? 'system' : payload.role
        const text = extractMessageText(payload)
        accumulator.touch(row.timestamp)
        if (text && !(role === 'user' && isSyntheticUserText(text))) {
          accumulator.addMessage({ role, text, timestamp: row.timestamp })
        }
      }
      // Continuation session_meta rows: identity already lives in the baseline.
    }

    const newOffset = baseline.byteOffset + consumedBytes
    const newPrefix = Buffer.concat([committed, tail.subarray(0, consumedBytes)])
    const summary = accumulator.summary()
    const session: AgentHistorySession = {
      sessionKey: baseline.session.sessionKey,
      agent: 'codex',
      updatedAt: summary.updatedAt ?? new Date(candidate.mtimeMs).toISOString(),
      sessionId: baseline.session.sessionId,
      title: baseline.session.title,
      cwd,
      branch: baseline.session.branch,
      model,
      createdAt: summary.createdAt,
      messageCount: summary.messageCount,
      previewMessages: summary.previewMessages,
      source: {
        filePath: candidate.filePath,
        mtimeMs: candidate.mtimeMs,
        sizeBytes: candidate.sizeBytes,
        parserVersion: CODEX_PARSER_VERSION,
        byteOffset: newOffset,
      },
    }
    return { session, byteOffset: newOffset, prefixHash: hashBuffer(newPrefix) }
  } catch {
    return null
  }
}
