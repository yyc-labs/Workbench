import type { PanelGitOperationKind } from './detail.gitOperations'

export type OperationConfirmState = {
  operation: PanelGitOperationKind | 'undo-ai-commit' | 'undo-commit'
  message: string
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  helperText?: string
  riskLevel?: 'normal' | 'high'
  requireExactMatch?: string
} | null

export type BranchManagerMode = 'current' | 'upstream'

export type MiddlePanelMode = 'history' | 'ai-log' | 'git-log' | 'workflow'

export type IndexedBranchCandidate = {
  name: string
  searchText: string
}

export type ProjectLinkItem = {
  url: string
  label: string
  tag?: string
  tagLabel?: string
  onOpen?: () => void | Promise<void>
  kind?: 'url' | 'ssh'
  description?: string
  copyValue?: string
  copyLabel?: string
  copyValueResolver?: () => Promise<string>
}
