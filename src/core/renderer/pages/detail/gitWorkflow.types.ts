import type { GitOperationResult as SharedGitOperationResult } from '../../../shared/types'

export type GitWorkflowOperation = 'fetch' | 'pull' | 'push' | 'switch' | 'merge' | 'commit'

export type GitWorkflowEdgeKind = 'success' | 'failure'

export type GitWorkflowFailurePolicy = 'follow-failure-edge' | 'pause'

export type GitBranchTarget = { mode: 'prompt' } | { mode: 'fixed'; branch: string }

export type GitWorkflowNodeBase<TOperation extends GitWorkflowOperation, TConfig> = {
  schemaVersion: 1
  operation: TOperation
  label?: string
  config: TConfig
  failurePolicy: GitWorkflowFailurePolicy
}

export type FetchNodeData = GitWorkflowNodeBase<
  'fetch',
  {
    remoteName?: string
  }
>

export type PullNodeData = GitWorkflowNodeBase<
  'pull',
  {
    strategy: 'ff-only'
  }
>

export type PushNodeData = GitWorkflowNodeBase<
  'push',
  {
    remoteName?: string
    setUpstreamWhenMissing: true
  }
>

export type SwitchNodeData = GitWorkflowNodeBase<
  'switch',
  {
    target: GitBranchTarget
  }
>

export type MergeNodeData = GitWorkflowNodeBase<
  'merge',
  {
    source: GitBranchTarget
    noEdit: true
  }
>

export type CommitNodeData = GitWorkflowNodeBase<
  'commit',
  {
    message: {
      mode: 'prompt'
      preset?: string
    }
  }
>

export type GitWorkflowNodeData = FetchNodeData | PullNodeData | PushNodeData | SwitchNodeData | MergeNodeData | CommitNodeData

export type GitWorkflowNode = {
  id: string
  type: 'gitOperation'
  position: {
    x: number
    y: number
  }
  data: GitWorkflowNodeData
}

export type GitWorkflowEdge = {
  id: string
  type: GitWorkflowEdgeKind
  source: string
  sourceHandle: GitWorkflowEdgeKind
  target: string
  targetHandle: 'input'
  data: {
    kind: GitWorkflowEdgeKind
  }
}

export type PersistedGitWorkflowGraph = {
  version: 2
  updatedAt: number
  entryNodeId: string
  nodes: GitWorkflowNode[]
  edges: GitWorkflowEdge[]
  viewport?: {
    x: number
    y: number
    zoom: number
  }
}

export type GitWorkflowNodeState = {
  status: 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  startedAt?: number
  finishedAt?: number
  result?: SharedGitOperationResult
  reason?: string
  noOp?: boolean
}

export type GitWorkflowRunState = {
  status: 'idle' | 'validating' | 'running' | 'waiting-for-input' | 'waiting-for-confirmation' | 'paused' | 'completed' | 'failed'
  activeNodeId?: string
  activeEdgeId?: string
  nodeStates: Record<string, GitWorkflowNodeState>
}

export type GitWorkflowValidationIssueCode = 'empty-graph' | 'entry-missing' | 'entry-invalid' | 'duplicate-node-id' | 'duplicate-edge-id' | 'unknown-operation' | 'invalid-config' | 'invalid-edge' | 'dangling-edge' | 'self-loop' | 'duplicate-source-handle' | 'cycle' | 'unreachable-node'

export type GitWorkflowValidationIssue = {
  code: GitWorkflowValidationIssueCode
  level: 'error' | 'warning'
  nodeId?: string
  edgeId?: string
  message?: string
}

export type GitWorkflowValidationResult = {
  ok: boolean
  issues: GitWorkflowValidationIssue[]
}

export type GitWorkflowGraphMigrationResult = {
  graph: PersistedGitWorkflowGraph
  migratedFromVersion?: 1
}

export type GitWorkflowExecutionContext = {
  currentBranch?: string
  localBranches: string[]
  remoteBranches: string[]
  selectedTargetBranch?: string
}

export type GitWorkflowValidationContext = {
  currentBranch?: string
  localBranches: string[]
  remoteBranches: string[]
}

export type GitWorkflowNodeOutcome = { kind: 'success'; result: SharedGitOperationResult; noOp?: boolean } | { kind: 'failure'; result?: SharedGitOperationResult; reason: string } | { kind: 'cancelled'; reason: string }
