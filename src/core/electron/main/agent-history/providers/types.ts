/**
 * Provider contract for agent history scanning (docs/todo/19 §2.1).
 *
 * A provider owns discovery + parsing for one AI CLI. The scan service only
 * orchestrates against these interfaces and never learns per-agent details.
 */
import type { AgentHistoryAgent, AgentHistoryCapabilities, AgentHistoryIssueCode, AgentHistoryPreviewMessage, AgentHistoryProjectContext, AgentHistoryProviderRef, AgentHistorySession } from '../../../../shared/types/agentHistory'
import type { AgentHistoryDataSource } from '../datasource/types'
import type { ResumableBaseline } from './shared/incremental-parser'

/** File identity collected during discovery; stat results, not opened content. */
export interface SessionCandidate {
  agent: AgentHistoryAgent
  filePath: string
  mtimeMs: number
  sizeBytes: number
}

export interface DiscoverResult {
  candidates: SessionCandidate[]
  /** True when the discovery cap cut off more existing candidate files. */
  truncated: boolean
}

export interface ParseSessionOptions {
  signal?: AbortSignal
}

/** Typed failure so the scan service can map it to a structured issue code. */
export class AgentHistoryFileError extends Error {
  readonly code: AgentHistoryIssueCode

  constructor(code: AgentHistoryIssueCode, message: string) {
    super(message)
    this.name = 'AgentHistoryFileError'
    this.code = code
  }
}

export interface AgentHistoryProvider {
  readonly id: AgentHistoryProviderRef
  /** Bumped when parsing logic changes so parse caches invalidate wholesale. */
  readonly parserVersion: number
  /** Verified per provider (stage 0 real-CLI behavior) — never assumed from parameter similarity. */
  readonly capabilities: AgentHistoryCapabilities
  /** IO goes through the dataSource routed for this project's execution environment (plan 20 D7). */
  discover(context: AgentHistoryProjectContext, dataSource: AgentHistoryDataSource, signal?: AbortSignal): Promise<DiscoverResult>
  parseSession(candidate: SessionCandidate, dataSource: AgentHistoryDataSource, options?: ParseSessionOptions): Promise<AgentHistorySession>
  readMessages?(candidate: SessionCandidate, dataSource: AgentHistoryDataSource, before: number, limit: number, options?: ParseSessionOptions): Promise<{ messages: AgentHistoryPreviewMessage[]; total: number }>
  /**
   * Verified incremental continuation (stage 3). Implementations MUST re-hash
   * the committed prefix and fall back to a null return (caller re-parses in
   * full) on any mismatch: shrunk file, offset not on a record boundary,
   * prefix hash mismatch, or parser logic that cannot preserve derived fields.
   */
  parseIncremental?(candidate: SessionCandidate, dataSource: AgentHistoryDataSource, baseline: ResumableBaseline, options?: ParseSessionOptions): Promise<{ session: AgentHistorySession; byteOffset: number; prefixHash: string } | null>
  /**
   * Session root for the project's environment (stage 4 watch targets). The
   * watcher shares one listener per root dirKey across projects, so this
   * returns the ROOT (not the per-project bucket). null → no watch for this
   * provider/environment.
   */
  getRootDir?(context: AgentHistoryProjectContext, dataSource: AgentHistoryDataSource): Promise<string | null>
}
