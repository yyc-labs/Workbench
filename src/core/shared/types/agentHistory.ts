/** Agent history (local AI CLI sessions) domain contract: a read-only view over raw session files.
 *  See docs/todo/19-项目会话Tab智能体会话历史-plan.md for the design (§2.1 core contracts). */

export type AgentHistoryAgent = 'claude' | 'codebuddy' | 'codex'

export const AGENT_HISTORY_AGENTS = ['claude', 'codebuddy', 'codex'] as const satisfies readonly AgentHistoryAgent[]

export type AgentHistoryExecutionEnvironment = 'windows' | 'wsl' | 'ssh'

/** Project context resolved on the main process from trusted config — never accepted from the renderer. */
export interface AgentHistoryProjectContext {
  projectId: string
  nativePath: string
  executionEnvironment: AgentHistoryExecutionEnvironment
  namespaceId?: string
  /** WSL projects: distro name backing the data source (UNC target). */
  wslDistro?: string
  /** WSL projects: the project's cwd as seen inside the distro (bucket encoding + identity). */
  posixPath?: string
  /** SSH projects (stage 9): resolved from an ssh:// project path. */
  sshHost?: string
  sshPort?: number
  sshUser?: string
}

/** Built-in providers keep the literal union so existing switch/capability logic stays narrow. */
export type AgentHistoryBuiltinAgent = AgentHistoryAgent

declare const customProviderBrand: unique symbol
/** Dynamic provider id (plan 20 §3.2): branded so `AgentHistoryAgent | string` never collapses to string. */
export type CustomProviderId = string & { readonly [customProviderBrand]: 'CustomProviderId' }
/** Wide id for generic surfaces (search results, issues, provider management) only. */
export type AgentHistoryProviderRef = AgentHistoryAgent | CustomProviderId

export interface AgentHistoryPreviewMessage {
  role: 'user' | 'assistant' | 'system'
  text: string
  timestamp: string | null
}

/** Layer C: internal source info. Main-process only — never sent across IPC. */
export interface AgentHistorySessionSource {
  filePath: string
  mtimeMs: number
  sizeBytes: number
  parserVersion: number
  /** Reserved for future incremental parsing of append-only JSONL (plan v2.1 ④). */
  byteOffset?: number
}

/** Full session model: required (A) + optional (B) + internal source (C). Layer B fields are null when the source lacks them. */
export interface AgentHistorySession {
  // Layer A — required
  sessionKey: string
  /** Built-in literal union for the three static providers; branded string for dynamic ones (stage 8). */
  agent: AgentHistoryProviderRef
  updatedAt: string
  // Layer B — optional
  sessionId: string | null
  title: string | null
  cwd: string | null
  branch: string | null
  model: string | null
  createdAt: string | null
  messageCount: number
  previewMessages: AgentHistoryPreviewMessage[]
  // Layer C — internal
  source: AgentHistorySessionSource
}

/** Renderer-facing view: layers A + B only. */
export interface AgentHistorySessionView {
  sessionKey: string
  agent: AgentHistoryAgent
  updatedAt: string
  sessionId: string | null
  title: string | null
  cwd: string | null
  branch: string | null
  model: string | null
  createdAt: string | null
  messageCount: number
  previewMessages: AgentHistoryPreviewMessage[]
}

export type AgentHistoryIssueCode = 'SOURCE_UNAVAILABLE' | 'PERMISSION_DENIED' | 'INVALID_FORMAT' | 'FILE_TOO_LARGE' | 'UNSUPPORTED_SOURCE' | 'PROJECT_PATH_MISMATCH' | 'RESULT_TRUNCATED'

export interface AgentHistoryIssue {
  agent: AgentHistoryProviderRef
  code: AgentHistoryIssueCode
  /** Diagnostic info only; must not contain session content or full stacks. */
  detail?: string
}

/** Declared per provider. Future resume/handoff features must consult these instead of assuming support. */
export interface AgentHistoryCapabilities {
  preview: boolean
  fullTranscript: boolean
  incrementalRead: boolean
  nativeResume: boolean
}

/** Scan caps. Initial values calibrated by stage 0 measurements on 2026-10-27 (docs/todo/19 §3 stage 0). */
export const AGENT_HISTORY_LIMITS = {
  /** Max candidate files per scan (measured: codex 834 + codebuddy 109 total). */
  maxCandidateFiles: 2000,
  /** Max bytes read per file; larger files are skipped and reported as FILE_TOO_LARGE (plan 20 D13: 12MB → 64MB, 13.5MB session parses in ~122ms). */
  maxFileReadBytes: 64 * 1024 * 1024,
  defaultPageSize: 200,
  maxPageSize: 500,
  /** Max sessions kept per scan result (measured: ~600 sessions for the largest project). */
  totalSessionLimit: 2000,
  previewMessageCount: 20,
  /** Max chars kept per preview message. */
  previewTextMaxLength: 2000,
  parseConcurrency: 4,
  /** Snapshot cache TTL per project for cursor pagination, ms. */
  snapshotTtlMs: 60_000,
} as const

export interface AgentHistoryListArgs {
  projectId: string
  agent?: AgentHistoryAgent
  limit?: number
  /** Opaque cursor binding the scan snapshotId + page offset. */
  cursor?: string
}

export interface AgentHistoryListResult {
  sessions: AgentHistorySessionView[]
  issues: AgentHistoryIssue[]
  hasMore: boolean
  nextCursor: string | null
  /** True when a scan cap was hit and the result may be incomplete (RESULT_TRUNCATED). */
  isPartial: boolean
  scannedAt: string
  /** True when served from the persisted cache while a background refresh runs (plan 20 D9). */
  cacheHit?: boolean
}

export interface AgentHistoryMessagesArgs {
  projectId: string
  sessionKey: string
  agent: AgentHistoryAgent
  before: number
  limit?: number
}

export interface AgentHistoryMessagesResult {
  messages: AgentHistoryPreviewMessage[]
  nextBefore: number | null
  total: number
}

export interface AgentHistoryResolveSessionPathArgs {
  projectId: string
  sessionKey: string
}

export type AgentHistoryResolveSessionPathResult = { ok: true; filePath: string } | { ok: false; reason: 'PROJECT_MISMATCH' | 'SESSION_NOT_FOUND' }

/** Strip layer C before crossing IPC. */
export function toSessionView(session: AgentHistorySession): AgentHistorySessionView {
  return {
    sessionKey: session.sessionKey,
    agent: session.agent as AgentHistoryAgent,
    updatedAt: session.updatedAt,
    sessionId: session.sessionId,
    title: session.title,
    cwd: session.cwd,
    branch: session.branch,
    model: session.model,
    createdAt: session.createdAt,
    messageCount: session.messageCount,
    previewMessages: session.previewMessages,
  }
}

// —— Stage 5: full-text search (plan 20 §3.2; one hit per session, coverage disclosed) ——

export interface AgentHistorySearchArgs {
  /** Omitted = global (every configured project). */
  projectId?: string
  query: string
  agent?: AgentHistoryAgent
  limit?: number
  cursor?: number
}

export interface AgentHistorySearchHit {
  sessionKey: string
  projectId: string
  provider: string
  updatedAt: string
  title: string | null
  snippets: string[]
  rank: number
}

export interface AgentHistorySearchResult {
  hits: AgentHistorySearchHit[]
  hasMore: boolean
  nextCursor: number | null
  /** Short queries never hit the trigram index — metadata-only with UI notice. */
  degraded: 'none' | 'short-query-metadata-only'
  coverage: {
    status: 'complete' | 'partial'
    excluded: { scope: string; reason: 'NOT_INDEXED' | 'SOURCE_FAILED' | 'TRUNCATED_SESSIONS' }[]
  }
}

// —— Stage 6: resume (plan 20 §3.2; capability-driven, structured launch) ——

export type AgentHistoryResumeResult = { ok: true; provider: string; executionEnvironment: AgentHistoryExecutionEnvironment } | { ok: false; reason: 'SESSION_NOT_FOUND' | 'RESUME_UNSUPPORTED' | 'NO_SESSION_ID' | 'LAUNCH_FAILED' }
