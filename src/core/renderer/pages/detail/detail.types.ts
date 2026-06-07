import type {
  AiCommitStatus as SharedAiCommitStatus,
  AiCommitTaskSnapshot,
  GitHistoryCommitInfo,
  GitRepositoryListResult,
  GitRepositorySummary,
  GitOperationKind as SharedGitOperationKind,
  GitOperationResult as SharedGitOperationResult,
  GitSetFileStageRequest as SharedGitSetFileStageRequest,
  GitSetFileStageResult as SharedGitSetFileStageResult,
  GitFileDiffRequest as SharedGitFileDiffRequest,
  GitFileDiffResult as SharedGitFileDiffResult,
  GitConflictFileRequest as SharedGitConflictFileRequest,
  GitConflictFileResult as SharedGitConflictFileResult,
  GitResolveConflictRequest as SharedGitResolveConflictRequest,
  GitResolveConflictResult as SharedGitResolveConflictResult,
  GitRepositorySnapshot,
} from '../../../shared/types'

export type AiCommitStatus = SharedAiCommitStatus
export type AiStepStatus = 'pending' | 'running' | 'success' | 'error'
export type AiStepKey = 'start' | 'stage' | 'ai' | 'message' | 'commit' | 'done'

export interface AiStepState {
  key: AiStepKey
  label: string
  status: AiStepStatus
  detail?: string
}

export type LatestCommitInfo = GitHistoryCommitInfo
export type DetailGitRepositoryList = GitRepositoryListResult
export type DetailGitRepositorySummary = GitRepositorySummary
export type DetailGitSnapshot = GitRepositorySnapshot
export type GitOperationKind = SharedGitOperationKind
export type GitOperationResult = SharedGitOperationResult
export type GitSetFileStageRequest = SharedGitSetFileStageRequest
export type GitSetFileStageResult = SharedGitSetFileStageResult
export type GitFileDiffRequest = SharedGitFileDiffRequest
export type GitFileDiffResult = SharedGitFileDiffResult
export type GitConflictFileRequest = SharedGitConflictFileRequest
export type GitConflictFileResult = SharedGitConflictFileResult
export type GitResolveConflictRequest = SharedGitResolveConflictRequest
export type GitResolveConflictResult = SharedGitResolveConflictResult
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

export type AiFlowNode = {
  id: AiStepKey
  data: AiFlowNodeData
}
