import type { PanelGitOperationKind } from './detail.gitOperations'

export type OperationConfirmState = {
  operation: PanelGitOperationKind
  message: string
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
