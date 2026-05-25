import type { Edge as FlowEdge, Node as FlowNode } from '@xyflow/react'
import type {
  AiCommitStatus as SharedAiCommitStatus,
  AiCommitTaskSnapshot,
  GitHistoryCommitInfo,
  GitOperationKind as SharedGitOperationKind,
  GitOperationResult as SharedGitOperationResult,
  GitSetFileStageRequest as SharedGitSetFileStageRequest,
  GitSetFileStageResult as SharedGitSetFileStageResult,
  GitFileDiffRequest as SharedGitFileDiffRequest,
  GitFileDiffResult as SharedGitFileDiffResult,
  GitWorkspaceSnapshot,
} from '../../../shared/types'

export type AiCommitStatus = SharedAiCommitStatus
export type AiStepStatus = 'pending' | 'running' | 'success' | 'error'
export type AiStepKey = 'start' | 'stage' | 'ai' | 'message' | 'commit' | 'done'
export type RightPaneMode = 'flow' | 'raw'

export interface AiStepState {
  key: AiStepKey
  label: string
  status: AiStepStatus
  detail?: string
}

export type LatestCommitInfo = GitHistoryCommitInfo
export type DetailGitSnapshot = GitWorkspaceSnapshot
export type GitOperationKind = SharedGitOperationKind
export type GitOperationResult = SharedGitOperationResult
export type GitSetFileStageRequest = SharedGitSetFileStageRequest
export type GitSetFileStageResult = SharedGitSetFileStageResult
export type GitFileDiffRequest = SharedGitFileDiffRequest
export type GitFileDiffResult = SharedGitFileDiffResult
export type GitDiffViewMode = 'unstaged' | 'staged'

export type AiCommitRestoreResult = Pick<AiCommitTaskSnapshot, 'status' | 'output'>

export type AiFlowNodeData = {
  key: AiStepKey
  label: string
  status: AiStepStatus
  detail?: string
  index: number
  isFocused: boolean
}

export type AiFlowNode = FlowNode<AiFlowNodeData, 'ai-step'>
export type AiFlowEdge = FlowEdge<{ status: AiStepStatus }, 'smoothstep'>

export type FlowViewportApi = {
  setCenter: (
    x: number,
    y: number,
    options?: {
      zoom?: number
      duration?: number
      interpolate?: 'smooth' | 'linear'
      ease?: (t: number) => number
    }
  ) => Promise<boolean>
}
