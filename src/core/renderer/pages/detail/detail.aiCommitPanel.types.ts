import type { PanelGitOperationKind } from './detail.gitOperations'

export type OperationConfirmState = {
  operation: PanelGitOperationKind | 'undo-ai-commit'
  message: string
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  helperText?: string
  riskLevel?: 'normal' | 'high'
  requireExactMatch?: string
} | null

export type BranchManagerMode = 'current' | 'upstream'

export type MiddlePanelMode = 'history' | 'ai-log' | 'git-log'

export type IndexedBranchCandidate = {
  name: string
  searchText: string
}

export type ProjectLinkItem = {
  url: string
  label: string
  tag?: string
  tagLabel?: string
}
