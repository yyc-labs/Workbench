/**
 * Scan orchestration for agent history (docs/todo/19 §2.1 pagination contract).
 *
 * - Full-scan snapshot per project with a snapshotId; cursor pagination reads
 *   the frozen snapshot so pages never overlap or skip mid-scan.
 * - Caps: maxCandidateFiles / totalSessionLimit set isPartial + RESULT_TRUNCATED.
 * - Same-project concurrent requests merge into one in-flight scan; a scan can
 *   be cancelled via cancelScan (aborted parses stop starting new work).
 * - resolveSessionPath validates that a sessionKey belongs to the project via
 *   the last-scan index — sessionKey is NOT an authorization token.
 */
import { randomBytes } from 'node:crypto'
import { detectProjectEnvironment } from '../../../shared/projectEnvironment'
import { projectIdFromPath } from '../../../shared/rules'
import type { AppConfig, SavedProject } from '../../../shared/types'
import {
  AGENT_HISTORY_AGENTS,
  AGENT_HISTORY_LIMITS,
  type AgentHistoryAgent,
  type AgentHistoryExecutionEnvironment,
  type AgentHistoryIssue,
  type AgentHistoryIssueCode,
  type AgentHistoryListArgs,
  type AgentHistoryListResult,
  type AgentHistoryMessagesArgs,
  type AgentHistoryMessagesResult,
  type AgentHistoryProjectContext,
  type AgentHistoryProviderRef,
  type AgentHistoryResolveSessionPathResult,
  type AgentHistorySession,
  toSessionView,
} from '../../../shared/types/agentHistory'
import type { AgentHistoryCache, SessionCacheRow } from './cache/db'
import type { AgentHistoryDataSourceRegistry } from './datasource/registry'
import { createParseCache } from './parse-cache'
import { normalizeWindowsPath } from './path-normalizer'
import type { AgentHistoryProviderRegistry } from './provider-registry'
import { hashFileByChunks } from './providers/shared/incremental-parser'
import type { AgentHistoryFileError, SessionCandidate } from './providers/types'

export type AgentHistoryLoadConfig = () => AppConfig

export interface AgentHistoryScanService {
  listSessions(args: AgentHistoryListArgs): Promise<AgentHistoryListResult>
  readMessages(args: AgentHistoryMessagesArgs): Promise<AgentHistoryMessagesResult>
  resolveSessionPath(projectId: string, sessionKey: string): AgentHistoryResolveSessionPathResult
  cancelScan(projectId: string): void
  /** Stage 4: watcher verification hook — invalidate the TTL snapshot, rescan, persist; returns the fresh session count. */
  refresh(projectId: string): Promise<number>
}

interface ScanSnapshot {
  snapshotId: string
  createdAt: number
  sessions: AgentHistorySession[]
  issues: AgentHistoryIssue[]
  isPartial: boolean
  scannedAt: string
}

interface CursorPayload {
  snapshotId: string
  offset: number
}

interface DiscoveredCandidate extends SessionCandidate {
  providerIndex: number
}

export function createAgentHistoryScanService(deps: { loadConfig: AgentHistoryLoadConfig; registry: AgentHistoryProviderRegistry; dataSourceRegistry: AgentHistoryDataSourceRegistry; cache?: AgentHistoryCache | null }): AgentHistoryScanService {
  const { loadConfig, registry, dataSourceRegistry, cache } = deps
  const parseCache = createParseCache<AgentHistorySession>()
  const snapshots = new Map<string, ScanSnapshot>()
  const pathIndex = new Map<string, Map<string, string>>()
  const inFlight = new Map<string, Promise<ScanSnapshot>>()
  const controllers = new Map<string, AbortController>()

  function buildContext(projectId: string): { context: AgentHistoryProjectContext; project: SavedProject } {
    const project = loadConfig().projects.find((candidate) => projectIdFromPath(candidate.path) === projectId)
    if (!project) throw new Error(`Unknown project: ${projectId}`)
    const executionEnvironment = resolveExecutionEnvironment(project.path)
    const wslInfo = executionEnvironment === 'wsl' ? extractWslInfo(project.path) : {}
    const sshInfo = executionEnvironment === 'ssh' ? extractSshInfo(project.path) : null
    return {
      project,
      context: {
        projectId,
        nativePath: project.path,
        executionEnvironment,
        wslDistro: wslInfo.distro,
        posixPath: wslInfo.posixPath,
        sshHost: sshInfo?.host,
        sshPort: sshInfo?.port,
        sshUser: sshInfo?.user,
      },
    }
  }

  async function runScan(context: AgentHistoryProjectContext): Promise<ScanSnapshot> {
    const signal = controllers.get(context.projectId)?.signal
    const projectIdForCache = context.projectId
    const issues: AgentHistoryIssue[] = []
    let isPartial = false

    const providers = registry.all()
    const dataSource = dataSourceRegistry.getFor(context)
    const discoverResults = await Promise.all(
      providers.map(async (provider, providerIndex) => {
        try {
          const result = await provider.discover(context, dataSource, signal)
          return { result, providerIndex }
        } catch (error) {
          recordIssue(issues, provider.id, issueCodeFromError(error), error)
          return { result: { candidates: [], truncated: false }, providerIndex }
        }
      }),
    )

    const candidates: DiscoveredCandidate[] = discoverResults.flatMap((entry) => entry.result.candidates.map((candidate) => ({ ...candidate, providerIndex: entry.providerIndex })))
    if (discoverResults.some((entry) => entry.result.truncated) || candidates.length > AGENT_HISTORY_LIMITS.maxCandidateFiles) {
      isPartial = true
    }
    const budgeted = candidates.slice(0, AGENT_HISTORY_LIMITS.maxCandidateFiles)

    const sessions: AgentHistorySession[] = []
    const anchorsBySessionKey = new Map<string, { byteOffset: number; prefixHash: string }>()
    const queue = [...budgeted]
    const workerCount = Math.min(AGENT_HISTORY_LIMITS.parseConcurrency, queue.length)
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (queue.length > 0) {
          if (signal?.aborted) return
          if (sessions.length >= AGENT_HISTORY_LIMITS.totalSessionLimit) {
            isPartial = true
            return
          }
          const candidate = queue.shift()
          if (!candidate) return
          const provider = providers[candidate.providerIndex]
          try {
            if (candidate.sizeBytes > AGENT_HISTORY_LIMITS.maxFileReadBytes) {
              recordIssue(issues, provider.id, 'FILE_TOO_LARGE', `${candidate.filePath} exceeds read cap`)
              continue
            }
            const cacheKey = `${provider.id}:${normalizeWindowsPath(candidate.filePath)}`
            const stat = { mtimeMs: candidate.mtimeMs, sizeBytes: candidate.sizeBytes }
            let session = parseCache.get(cacheKey, stat, provider.parserVersion)
            let incrementalAnchors: { byteOffset: number; prefixHash: string } | null = null
            if (!session && cache) {
              // Stage 3 three-tier path: hot stat row → verified incremental tail → full parse.
              const cachedRow = cache.getByPath(projectIdForCache, candidate.filePath)
              if (cachedRow && cachedRow.parserVersion === provider.parserVersion) {
                if (cachedRow.sizeBytes === candidate.sizeBytes && cachedRow.mtimeMs === candidate.mtimeMs) {
                  const view = JSON.parse(cachedRow.dataJson)
                  session = { ...view, source: { filePath: cachedRow.filePath, mtimeMs: cachedRow.mtimeMs, sizeBytes: cachedRow.sizeBytes, parserVersion: cachedRow.parserVersion } }
                } else if (candidate.sizeBytes > cachedRow.sizeBytes && cachedRow.byteOffset !== null && cachedRow.byteOffset > 0 && cachedRow.prefixHash !== null && provider.parseIncremental) {
                  const resumed = await provider.parseIncremental(
                    candidate,
                    dataSource,
                    {
                      session: { ...JSON.parse(cachedRow.dataJson), source: { filePath: cachedRow.filePath, mtimeMs: cachedRow.mtimeMs, sizeBytes: cachedRow.sizeBytes, parserVersion: cachedRow.parserVersion } },
                      byteOffset: cachedRow.byteOffset,
                      prefixHash: cachedRow.prefixHash,
                    },
                    { signal },
                  )
                  if (resumed) {
                    session = resumed.session
                    incrementalAnchors = { byteOffset: resumed.byteOffset, prefixHash: resumed.prefixHash }
                    anchorsBySessionKey.set(session.sessionKey, incrementalAnchors)
                  }
                }
                // Any mismatch → null → full parse below (correctness fallback, D8).
              }
            }
            if (!session) {
              session = await provider.parseSession(candidate, dataSource, { signal })
              parseCache.set(cacheKey, stat, provider.parserVersion, session)
              // Full parse commits at EOF; the committed-prefix hash enables stage 3 resumption.
              const fullHash = await hashFileByChunks(dataSource, candidate.filePath, candidate.sizeBytes, signal)
              if (fullHash !== null) {
                anchorsBySessionKey.set(session.sessionKey, { byteOffset: candidate.sizeBytes, prefixHash: fullHash })
              }
            }
            if (session.sessionKey && session.agent && session.updatedAt && !sessions.some((existing) => existing.sessionKey === session.sessionKey)) {
              sessions.push(session)
            }
          } catch (error) {
            recordIssue(issues, provider.id, issueCodeFromError(error), error)
          }
        }
      }),
    )
    if (isPartial) {
      for (const agent of AGENT_HISTORY_AGENTS) issues.push({ agent, code: 'RESULT_TRUNCATED' })
    }

    sessions.sort(compareSessions)
    if (cache) persistToCache(cache, context.projectId, sessions, isPartial, anchorsBySessionKey)
    const snapshot: ScanSnapshot = {
      snapshotId: createSnapshotId(),
      createdAt: Date.now(),
      sessions,
      issues: dedupeIssues(issues),
      isPartial,
      scannedAt: new Date().toISOString(),
    }
    const index = new Map<string, string>()
    for (const session of sessions) index.set(session.sessionKey, session.source.filePath)
    pathIndex.set(context.projectId, index)
    snapshots.set(context.projectId, snapshot)
    return snapshot
  }

  /** D9: serve the persisted list immediately and refresh in the background. */
  function serveCachedPage(projectId: string, args: AgentHistoryListArgs & { limit: number }): AgentHistoryListResult {
    if (!cache) throw new Error('cache unavailable')
    const rows = cache.listByProject(projectId)
    const filtered = args.agent ? rows.filter((row) => row.providerId === args.agent) : rows
    const offset = args.cursor ? decodeCachedCursorOffset(args.cursor) : 0
    const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0
    const page = filtered.slice(safeOffset, safeOffset + args.limit)
    const hasMore = safeOffset + args.limit < filtered.length
    const scannedAt = filtered.length > 0 ? filtered[0].scannedAt : new Date(0).toISOString()
    return {
      sessions: page.map((row) => JSON.parse(row.dataJson)),
      issues: [],
      hasMore,
      nextCursor: hasMore ? encodeCachedCursor(safeOffset + args.limit) : null,
      isPartial: false,
      scannedAt,
      cacheHit: true,
    }
  }

  function startTrackedScan(context: AgentHistoryProjectContext): Promise<ScanSnapshot> {
    controllers.get(context.projectId)?.abort()
    const controller = new AbortController()
    controllers.set(context.projectId, controller)
    return runScan(context).finally(() => {
      if (controllers.get(context.projectId) === controller) controllers.delete(context.projectId)
    })
  }

  function servePage(snapshot: ScanSnapshot, args: AgentHistoryListArgs & { limit: number }): AgentHistoryListResult {
    const filtered = args.agent ? snapshot.sessions.filter((session) => session.agent === args.agent) : snapshot.sessions
    const offset = args.cursor ? decodeCursorOffset(args.cursor, snapshot.snapshotId) : 0
    const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0
    const page = filtered.slice(safeOffset, safeOffset + args.limit)
    const hasMore = safeOffset + args.limit < filtered.length
    return {
      sessions: page.map(toSessionView),
      issues: args.agent ? snapshot.issues.filter((issue) => issue.agent === args.agent) : snapshot.issues,
      hasMore,
      nextCursor: hasMore ? encodeCursor(snapshot.snapshotId, safeOffset + args.limit) : null,
      isPartial: snapshot.isPartial,
      scannedAt: snapshot.scannedAt,
    }
  }

  function readFreshSnapshot(projectId: string): ScanSnapshot | null {
    const snapshot = snapshots.get(projectId)
    if (!snapshot) return null
    if (Date.now() - snapshot.createdAt > AGENT_HISTORY_LIMITS.snapshotTtlMs) return null
    return snapshot
  }

  return {
    async listSessions(args: AgentHistoryListArgs): Promise<AgentHistoryListResult> {
      const limit = normalizeLimit(args.limit)
      const normalizedArgs: AgentHistoryListArgs & { limit: number } = { ...args, limit }

      // Cursor path: serve from the frozen snapshot when still valid.
      if (normalizedArgs.cursor) {
        const snapshot = readFreshSnapshot(normalizedArgs.projectId)
        const cursor = decodeCursor(normalizedArgs.cursor)
        if (snapshot && cursor && cursor.snapshotId === snapshot.snapshotId) {
          return servePage(snapshot, normalizedArgs)
        }
        // Invalid/expired cursor → restart from the first page of a fresh scan.
        delete normalizedArgs.cursor
      }

      const { context } = buildContext(normalizedArgs.projectId)
      // Plan 20 stage 1: WSL projects scan through the routed data source (D3 empty state removed).

      // D9 cache-first: persisted rows serve instantly while a refresh runs in
      // the background. Cursor requests keep the frozen-snapshot semantics.
      if (cache && !normalizedArgs.cursor) {
        const cached = cache.listByProject(normalizedArgs.projectId)
        if (cached.length > 0) {
          void startTrackedScan(context).catch(() => {
            /* background refresh failure keeps the cached view */
          })
          return serveCachedPage(normalizedArgs.projectId, normalizedArgs)
        }
      }

      const existing = inFlight.get(normalizedArgs.projectId)
      const pending = existing ?? startTrackedScan(context)
      if (!existing) {
        inFlight.set(normalizedArgs.projectId, pending)
        void pending.finally(() => {
          if (inFlight.get(normalizedArgs.projectId) === pending) inFlight.delete(normalizedArgs.projectId)
        })
      }
      const snapshot = await pending
      return servePage(snapshot, normalizedArgs)
    },

    resolveSessionPath(projectId: string, sessionKey: string): AgentHistoryResolveSessionPathResult {
      if (!loadConfig().projects.some((project) => projectIdFromPath(project.path) === projectId)) {
        return { ok: false, reason: 'PROJECT_MISMATCH' }
      }
      const filePath = pathIndex.get(projectId)?.get(sessionKey)
      if (!filePath) return { ok: false, reason: 'SESSION_NOT_FOUND' }
      return { ok: true, filePath }
    },

    async readMessages(args: AgentHistoryMessagesArgs): Promise<AgentHistoryMessagesResult> {
      const { context } = buildContext(args.projectId)
      const filePath = pathIndex.get(args.projectId)?.get(args.sessionKey) ?? cache?.get(args.projectId, args.agent, args.sessionKey)?.filePath
      if (!filePath) throw new Error('Session not found in current project scan.')
      const provider = registry.get(args.agent)
      if (!provider?.readMessages) throw new Error('Full transcript reading is unsupported for this provider.')
      const dataSource = dataSourceRegistry.getFor(context)
      const stat = await dataSource.stat(filePath)
      if (!stat || stat.sizeBytes > AGENT_HISTORY_LIMITS.maxFileReadBytes) throw new Error('Session source is unavailable or exceeds the read limit.')
      const limit = Math.min(Math.max(Math.trunc(args.limit ?? 30), 1), 100)
      const before = Math.min(Math.max(Math.trunc(args.before), 0), 1_000_000)
      const result = await provider.readMessages({ agent: args.agent, filePath, mtimeMs: stat.mtimeMs, sizeBytes: stat.sizeBytes }, dataSource, before, limit)
      return { messages: result.messages, total: result.total, nextBefore: before > 0 ? Math.max(0, before - result.messages.length) : null }
    },

    cancelScan(projectId: string) {
      controllers.get(projectId)?.abort()
    },

    async refresh(projectId: string): Promise<number> {
      snapshots.delete(projectId)
      const { context } = buildContext(projectId)
      const snapshot = await startTrackedScan(context)
      return snapshot.sessions.length
    },
  }
}

/** Environment from the path shape (plan 20 stages 1/9): plain Linux paths are WSL; ssh:// is a remote host. */
function resolveExecutionEnvironment(path: string): AgentHistoryExecutionEnvironment {
  if (extractSshInfo(path) !== null) return 'ssh'
  return detectProjectEnvironment(path) === 'ubuntu' ? 'wsl' : 'windows'
}

/** ssh://[user@]host[:port]/absolute/path → target + remote cwd. */
export function extractSshInfo(path: string): { host: string; port?: number; user?: string; remotePath: string } | null {
  const match = /^ssh:\/\/([^/]+)(\/.*)$/.exec(path.trim())
  if (!match) return null
  const authority = match[1]
  const remotePath = match[2]
  const userInfo = authority.split('@')
  if (userInfo.length > 2) return null
  const hostPart = userInfo[userInfo.length - 1]
  const user = userInfo.length === 2 && userInfo[0] ? userInfo[0] : undefined
  const hostSplit = hostPart.split(':')
  const host = hostSplit[0]
  const port = hostSplit[1] ? Number(hostSplit[1]) : undefined
  // Host whitelist: hostname chars only — no spaces or shell metacharacters.
  if (!host || !/^[A-Za-z0-9.-]+$/.test(host) || (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535))) return null
  return { host, port, user, remotePath }
}

/** Extract the WSL distro and the project's cwd inside the distro from the project path. */
function extractWslInfo(path: string): { distro?: string; posixPath?: string } {
  const unified = path.trim().split('/').join('\\')
  const lower = unified.toLowerCase()
  if (lower.startsWith('\\\\wsl.localhost\\') || lower.startsWith('\\\\wsl$\\')) {
    const rest = unified.slice(unified.indexOf('\\', 2) + 1)
    const sep = rest.indexOf('\\')
    const distro = sep === -1 ? rest : rest.slice(0, sep)
    const tail = sep === -1 ? '' : rest.slice(sep + 1)
    return { distro, posixPath: '/' + tail.split('\\').join('/') }
  }
  // Plain Linux absolute path: distro unknown (registry falls back to the default), posix cwd is the path itself.
  if (unified.startsWith('/') && !/^\/mnt\/[a-z](\/|$)/i.test(unified)) return { posixPath: unified }
  return {}
}

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) return AGENT_HISTORY_LIMITS.defaultPageSize
  return Math.min(limit, AGENT_HISTORY_LIMITS.maxPageSize)
}

function compareSessions(a: AgentHistorySession, b: AgentHistorySession): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1
  return a.sessionKey < b.sessionKey ? -1 : a.sessionKey > b.sessionKey ? 1 : 0
}

function createSnapshotId(): string {
  return `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`
}

function encodeCursor(snapshotId: string, offset: number): string {
  return Buffer.from(`${snapshotId}|${offset}`, 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8')
    const separator = raw.lastIndexOf('|')
    if (separator <= 0) return null
    const snapshotId = raw.slice(0, separator)
    const offset = Number.parseInt(raw.slice(separator + 1), 10)
    if (!snapshotId || !Number.isInteger(offset) || offset < 0) return null
    return { snapshotId, offset }
  } catch {
    return null
  }
}

function decodeCursorOffset(cursor: string, expectedSnapshotId: string): number {
  const payload = decodeCursor(cursor)
  if (!payload || payload.snapshotId !== expectedSnapshotId) return 0
  return payload.offset
}

function issueCodeFromError(error: unknown): AgentHistoryIssueCode {
  const code = (error as AgentHistoryFileError | null)?.code
  if (code) return code
  return 'INVALID_FORMAT'
}

function recordIssue(issues: AgentHistoryIssue[], agent: AgentHistoryProviderRef, code: AgentHistoryIssueCode, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error)
  issues.push({ agent, code, detail: detail.slice(0, 200) })
}

function dedupeIssues(issues: AgentHistoryIssue[]): AgentHistoryIssue[] {
  const seen = new Set<string>()
  const result: AgentHistoryIssue[] = []
  for (const issue of issues) {
    const key = `${issue.agent}:${issue.code}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(issue)
  }
  return result
}

/** Persist a completed scan (stage 2): full rows + reconcile only when the scan was NOT partial. */
function persistToCache(cache: AgentHistoryCache, projectId: string, sessions: AgentHistorySession[], isPartial: boolean, anchors: Map<string, { byteOffset: number; prefixHash: string }>): void {
  const scannedAt = new Date().toISOString()
  const rows: SessionCacheRow[] = sessions.map((session) => {
    const anchor = anchors.get(session.sessionKey)
    return {
      providerId: session.agent,
      sessionKey: session.sessionKey,
      updatedAt: session.updatedAt,
      title: session.title,
      dataJson: JSON.stringify(toSessionView(session)),
      filePath: session.source.filePath,
      mtimeMs: session.source.mtimeMs,
      sizeBytes: session.source.sizeBytes,
      parserVersion: session.source.parserVersion,
      // Stage 3 semantics: byteOffset = end of last committed record. Full parses
      // commit at EOF; verified increments commit at their last record boundary.
      byteOffset: anchor?.byteOffset ?? session.source.sizeBytes,
      prefixHash: anchor?.prefixHash ?? null,
      scannedAt,
    }
  })
  cache.upsertBatch(projectId, rows)
  cache.setMeta('lastScan:' + projectId, scannedAt)
  // Never reconcile after a partial scan (caps may hide real files).
  if (!isPartial) {
    cache.reconcile(
      projectId,
      rows.map((row) => ({ providerId: row.providerId, sessionKey: row.sessionKey })),
    )
  }
}

function encodeCachedCursor(offset: number): string {
  return 'cached:' + offset
}

function decodeCachedCursorOffset(cursor: string): number {
  if (!cursor.startsWith('cached:')) return NaN
  return Number.parseInt(cursor.slice('cached:'.length), 10)
}
