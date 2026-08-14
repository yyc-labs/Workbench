import { CloudDownload, CloudUpload, Download, GitMerge, Shuffle } from 'lucide-react'
import { translateCurrent } from '../../i18n'
import type { DetailGitSnapshot, GitDiffViewMode, GitOperationKind, GitOperationResult } from './detail.types'

type GitChangedFile = DetailGitSnapshot['changedFiles'][number]

export type OperationCardState = {
  disabled: boolean
  hint: string
}

export type BranchOperationStateParams = {
  hasConflicts: boolean
  hasWorkingTreeChanges: boolean
  branchAhead: number
  branchBehind: number
  hasUpstream: boolean
  upstreamGone: boolean
  mergeTarget: string
  currentBranch: string
  localBranches: string[]
  remoteBranches: string[]
  runningOperation: GitOperationKind | null
}

export function getChangeMeta(kind: GitChangedFile['kind']): { label: string; className: string } {
  const localeKey = {
    added: 'detail.gitChangeAdded',
    modified: 'detail.gitChangeModified',
    deleted: 'detail.gitChangeDeleted',
    renamed: 'detail.gitChangeRenamed',
    copied: 'detail.gitChangeCopied',
    untracked: 'detail.gitChangeUntracked',
    conflicted: 'detail.gitChangeConflicted',
    typechanged: 'detail.gitChangeTypechanged',
    unknown: 'detail.gitChangeUnknown',
  }[kind]

  const className = {
    added: 'text-[color:var(--color-success)] bg-[color:var(--color-success-background)]',
    modified: 'text-[color:var(--color-primary)] bg-[color:var(--color-primary)]/10',
    deleted: 'text-[color:var(--color-destructive)] bg-[color:var(--color-destructive-background)]',
    renamed: 'text-[color:var(--color-warning)] bg-[color:var(--color-warning-background)]',
    copied: 'text-[color:var(--color-primary)] bg-[color:var(--color-primary)]/10',
    untracked: 'text-[color:var(--color-muted-foreground)] bg-[color:var(--color-background-sunken)]',
    conflicted: 'text-[color:var(--color-destructive)] bg-[color:var(--color-destructive-background)]',
    typechanged: 'text-[color:var(--color-warning)] bg-[color:var(--color-warning-background)]',
    unknown: 'text-[color:var(--color-muted-foreground)] bg-[color:var(--color-background-sunken)]',
  }[kind]

  return { label: translateCurrent(localeKey), className }
}

export function getGitOperationItems() {
  return [
    { key: 'fetch', label: translateCurrent('detail.gitOpFetch'), description: translateCurrent('detail.gitOpDescFetch'), icon: CloudDownload },
    { key: 'pull', label: translateCurrent('detail.gitOpPull'), description: translateCurrent('detail.gitOpDescPull'), icon: Download },
    { key: 'push', label: translateCurrent('detail.gitOpPush'), description: translateCurrent('detail.gitOpDescPush'), icon: CloudUpload },
    { key: 'switch', label: translateCurrent('detail.gitOpSwitch'), description: translateCurrent('detail.gitOpDescSwitch'), icon: Shuffle },
    { key: 'merge', label: translateCurrent('detail.gitOpMerge'), description: translateCurrent('detail.gitOpDescMerge'), icon: GitMerge },
  ] as const
}

export type PanelGitOperationKind = 'fetch' | 'pull' | 'push' | 'switch' | 'merge'

export function formatGitBadgeCount(count: number): string {
  return count > 99 ? '99+' : String(count)
}

export function getScopeLabel(file: GitChangedFile): string {
  if (file.scope === 'conflicted') return translateCurrent('detail.gitScopeConflicted')
  if (file.scope === 'untracked') return translateCurrent('detail.gitScopeUntracked')
  if (file.staged && file.unstaged) return translateCurrent('detail.gitScopeStagedAndUnstaged')
  if (file.staged) return translateCurrent('detail.gitScopeStaged')
  return translateCurrent('detail.gitScopeUnstaged')
}

export function formatLogTime(value: number): string {
  if (!Number.isFinite(value)) return '-'
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

export function pickDefaultDiffViewMode(file: GitChangedFile): GitDiffViewMode {
  return file.unstaged || file.scope === 'untracked' ? 'unstaged' : 'staged'
}

export function getOperationLabel(operation: GitOperationKind): string {
  switch (operation) {
    case 'fetch':
      return translateCurrent('detail.gitOpFetch')
    case 'pull':
      return translateCurrent('detail.gitOpPull')
    case 'push':
      return translateCurrent('detail.gitOpPush')
    case 'switch':
      return translateCurrent('detail.gitOpSwitch')
    case 'merge':
      return translateCurrent('detail.gitOpMerge')
    case 'commit':
      return translateCurrent('detail.gitOpCommit')
    case 'undo-commit':
      return translateCurrent('detail.gitOpUndoCommit')
    case 'create-remote-branch':
      return translateCurrent('detail.gitOpCreateRemote')
    case 'create-local-branch':
      return translateCurrent('detail.gitOpCreateLocal')
    case 'delete-local-branch':
      return translateCurrent('detail.gitOpDeleteLocal')
    case 'set-upstream':
      return translateCurrent('detail.gitOpSetUpstream')
    default:
      return operation
  }
}

export function getOperationStatusClass(result: GitOperationResult): string {
  if (result.ok) {
    return 'border-[color:var(--color-success)]/30 bg-[color:var(--color-success-background)]'
  }
  if (result.skipped) {
    return 'border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-background)]'
  }
  return 'border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-background)]'
}

export function getOperationStatusText(result: GitOperationResult): string {
  if (result.ok) return translateCurrent('detail.gitStatusSuccess')
  if (result.skipped) return translateCurrent('detail.gitStatusSkipped')
  return translateCurrent('detail.gitStatusFailed')
}

export function computeOperationState(operation: GitOperationKind, params: BranchOperationStateParams): OperationCardState {
  if (params.runningOperation && params.runningOperation !== operation) {
    return { disabled: true, hint: translateCurrent('detail.gitHintAnotherOperationRunning') }
  }
  if (params.hasConflicts && operation !== 'fetch') {
    return { disabled: true, hint: translateCurrent('detail.gitHintHasConflicts') }
  }
  if (operation === 'pull') {
    if (!params.hasUpstream) return { disabled: true, hint: translateCurrent('detail.gitHintNoUpstream') }
    if (params.upstreamGone) return { disabled: true, hint: translateCurrent('detail.gitHintUpstreamGone') }
    if (params.hasWorkingTreeChanges) return { disabled: true, hint: translateCurrent('detail.gitHintDirtyWorktree') }
    if (params.branchBehind <= 0) return { disabled: true, hint: translateCurrent('detail.gitHintNoCommitsToPull') }
  }
  if (operation === 'push') {
    if (!params.currentBranch || params.currentBranch === 'DETACHED') return { disabled: true, hint: translateCurrent('detail.gitHintDetachedHead') }
    if (params.hasUpstream && !params.upstreamGone && params.branchAhead <= 0) return { disabled: true, hint: translateCurrent('detail.gitHintNoCommitsToPush') }
  }
  if (operation === 'merge') {
    if (params.hasWorkingTreeChanges) return { disabled: true, hint: translateCurrent('detail.gitHintDirtyWorktree') }
    if (!params.mergeTarget) return { disabled: true, hint: translateCurrent('detail.gitHintChooseMergeTarget') }
    if (params.mergeTarget === params.currentBranch) return { disabled: true, hint: translateCurrent('detail.gitHintCannotMergeToSelf') }
  }
  if (operation === 'switch') {
    if (!params.mergeTarget) return { disabled: true, hint: translateCurrent('detail.gitHintChooseSwitchTarget') }
    const normalizedTarget = params.mergeTarget.trim()
    if (normalizedTarget === params.currentBranch) return { disabled: true, hint: translateCurrent('detail.gitHintAlreadyOnCurrentBranch') }
    const localCandidates = new Set(params.localBranches)
    const remoteCandidates = new Set(params.remoteBranches)
    if (localCandidates.has(normalizedTarget)) return { disabled: false, hint: translateCurrent('detail.gitHintSwitchLocalBranch') }
    const remoteMatch = normalizedTarget.match(/^([^/]+)\/(.+)$/)
    if (!remoteMatch) {
      return { disabled: true, hint: translateCurrent('detail.gitHintRemoteBranchFormat') }
    }
    const localName = remoteMatch[2]
    if (remoteCandidates.has(normalizedTarget)) {
      if (localCandidates.has(localName)) {
        return { disabled: false, hint: translateCurrent('detail.gitHintLocalExistsWillRebind', { localName }) }
      }
      return { disabled: false, hint: translateCurrent('detail.gitHintCreateLocalTrackRemote') }
    }
    if (localCandidates.has(localName)) {
      return { disabled: false, hint: translateCurrent('detail.gitHintLocalExistsWillValidateRebind', { localName }) }
    }
    return { disabled: true, hint: translateCurrent('detail.gitHintTargetBranchNotFound') }
  }
  return { disabled: false, hint: translateCurrent('detail.gitHintExecutable') }
}
