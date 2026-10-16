import type { UrlPopoverItem } from '../../components/UrlPopover'
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

/** 与 UrlPopoverItem 完全重合，直接别名：详情浮层/徽标/凭证动作全链路通用。 */
export type ProjectLinkItem = UrlPopoverItem
