import {
  CloudDownload,
  CloudUpload,
  Download,
  GitMerge,
  Shuffle,
} from 'lucide-react'
import type {
  DetailGitSnapshot,
  GitDiffViewMode,
  GitOperationKind,
  GitOperationResult,
} from './detail.types'

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

export const CHANGE_META: Record<GitChangedFile['kind'], { label: string; className: string }> = {
  added: { label: '新增', className: 'text-[color:var(--color-success)] bg-[color:var(--color-success-background)]' },
  modified: { label: '修改', className: 'text-[color:var(--color-primary)] bg-[color:var(--color-primary)]/10' },
  deleted: { label: '删除', className: 'text-[color:var(--color-destructive)] bg-[color:var(--color-destructive-background)]' },
  renamed: { label: '重命名', className: 'text-[color:var(--color-warning)] bg-[color:var(--color-warning-background)]' },
  copied: { label: '复制', className: 'text-[color:var(--color-primary)] bg-[color:var(--color-primary)]/10' },
  untracked: { label: '未跟踪', className: 'text-[color:var(--color-muted-foreground)] bg-[color:var(--color-background-sunken)]' },
  conflicted: { label: '冲突', className: 'text-[color:var(--color-destructive)] bg-[color:var(--color-destructive-background)]' },
  typechanged: { label: '类型变更', className: 'text-[color:var(--color-warning)] bg-[color:var(--color-warning-background)]' },
  unknown: { label: '变更', className: 'text-[color:var(--color-muted-foreground)] bg-[color:var(--color-background-sunken)]' },
}

export const GIT_OPERATION_ITEMS = [
  { key: 'fetch', label: 'Fetch', description: '同步远程引用', icon: CloudDownload },
  { key: 'pull', label: 'Pull', description: '拉取并合并', icon: Download },
  { key: 'push', label: 'Push', description: '推送当前分支', icon: CloudUpload },
  { key: 'switch', label: 'Switch', description: '切换到目标分支', icon: Shuffle },
  { key: 'merge', label: 'Merge', description: '合并目标分支', icon: GitMerge },
] as const

const GIT_OPERATION_LABELS: Partial<Record<GitOperationKind, string>> = {
  fetch: 'Fetch',
  pull: 'Pull',
  push: 'Push',
  switch: 'Switch',
  merge: 'Merge',
  'create-remote-branch': 'Create Remote',
  'create-local-branch': 'Create Local',
  'delete-local-branch': 'Delete Local',
  'set-upstream': 'Set Upstream',
}

export type PanelGitOperationKind = (typeof GIT_OPERATION_ITEMS)[number]['key']

export function formatGitBadgeCount(count: number): string {
  return count > 99 ? '99+' : String(count)
}

export function getScopeLabel(file: GitChangedFile): string {
  if (file.scope === 'conflicted') return '冲突'
  if (file.scope === 'untracked') return '未跟踪'
  if (file.staged && file.unstaged) return '已暂存 + 未暂存'
  if (file.staged) return '已暂存'
  return '未暂存'
}

export function formatLogTime(value: number): string {
  if (!Number.isFinite(value)) return '-'
  return new Date(value).toLocaleString('zh-CN', {
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
  return GIT_OPERATION_LABELS[operation] ?? operation
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
  if (result.ok) return '成功'
  if (result.skipped) return '已跳过'
  return '失败'
}

export function computeOperationState(
  operation: GitOperationKind,
  params: BranchOperationStateParams
): OperationCardState {
  if (params.runningOperation && params.runningOperation !== operation) {
    return { disabled: true, hint: '另一个 Git 操作执行中' }
  }
  if (params.hasConflicts && operation !== 'fetch') {
    return { disabled: true, hint: '存在冲突，先解决冲突' }
  }
  if (operation === 'pull') {
    if (!params.hasUpstream) return { disabled: true, hint: '当前分支无 upstream' }
    if (params.upstreamGone) return { disabled: true, hint: 'upstream 已丢失，先 push -u 重建远程分支' }
    if (params.hasWorkingTreeChanges) return { disabled: true, hint: '工作区不干净，先提交或暂存' }
    if (params.branchBehind <= 0) return { disabled: true, hint: '没有可拉取提交' }
  }
  if (operation === 'push') {
    if (!params.currentBranch || params.currentBranch === 'DETACHED') return { disabled: true, hint: 'Detached HEAD 不能推送' }
    if (params.hasUpstream && !params.upstreamGone && params.branchAhead <= 0) return { disabled: true, hint: '没有可推送提交' }
  }
  if (operation === 'merge') {
    if (params.hasWorkingTreeChanges) return { disabled: true, hint: '工作区不干净，先提交或暂存' }
    if (!params.mergeTarget) return { disabled: true, hint: '请选择要合并的分支' }
    if (params.mergeTarget === params.currentBranch) return { disabled: true, hint: '不能合并到自己' }
  }
  if (operation === 'switch') {
    if (!params.mergeTarget) return { disabled: true, hint: '请选择要切换的分支' }
    const normalizedTarget = params.mergeTarget.trim()
    if (normalizedTarget === params.currentBranch) return { disabled: true, hint: '已在当前分支' }
    const localCandidates = new Set(params.localBranches)
    const remoteCandidates = new Set(params.remoteBranches)
    if (localCandidates.has(normalizedTarget)) return { disabled: false, hint: '将切换本地分支' }
    const remoteMatch = normalizedTarget.match(/^([^/]+)\/(.+)$/)
    if (!remoteMatch) {
      return { disabled: true, hint: '远程分支请使用 remote/branch 格式（如 origin/feature/x）' }
    }
    const localName = remoteMatch[2]
    if (remoteCandidates.has(normalizedTarget)) {
      if (localCandidates.has(localName)) {
        return { disabled: false, hint: `本地已存在 ${localName}，将切换并重绑 upstream` }
      }
      return { disabled: false, hint: '将创建本地分支并跟踪远程分支' }
    }
    if (localCandidates.has(localName)) {
      return { disabled: false, hint: `本地已存在 ${localName}，将尝试切换并在执行时校验远程后重绑 upstream` }
    }
    return { disabled: true, hint: '目标分支不存在（本地/远程）' }
  }
  return { disabled: false, hint: '可执行' }
}
