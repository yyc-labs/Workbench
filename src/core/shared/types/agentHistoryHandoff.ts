/**
 * Handoff contracts (plan 20 stage 7, D11/v2 ⑧).
 *
 * DELIVERED ≠ LOADED: delivery means the context package reached the target
 * runtime; loading means the target agent verifiably received it. States that
 * cannot be verified show as "awaiting confirmation" — never assumed success.
 */
export type AgentHistoryHandoffMode = 'focused' | 'full'

/** How the package reaches the target CLI (per-CLI verified matrix). */
export type AgentHistoryHandoffMechanism = 'prompt-injection' | 'startup-file' | 'manual'

export type AgentHistoryHandoffStatus = 'pending' | 'delivered' | 'loaded' | 'confirmed' | 'failed'

export interface AgentHistoryHandoffCreateArgs {
  sourceProjectId: string
  sourceSessionKey: string
  /** Builtin or custom provider id. */
  targetAgent: string
  targetProjectId: string
  mode: AgentHistoryHandoffMode
  note?: string
}

export interface AgentHistoryHandoffRecord {
  id: string
  createdAt: string
  sourceProjectId: string
  sourceSessionKey: string
  sourceAgent: string
  sourceTitle: string | null
  targetAgent: string
  targetProjectId: string
  mode: AgentHistoryHandoffMode
  mechanism: AgentHistoryHandoffMechanism
  status: AgentHistoryHandoffStatus
  /** Context package file path (written under userData/agent-history/handoff/). */
  packagePath: string | null
  note?: string
}
