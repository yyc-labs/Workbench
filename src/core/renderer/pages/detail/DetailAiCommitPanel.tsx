import { type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  CloudDownload,
  CloudUpload,
  Download,
  FileText,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  History,
  RefreshCw,
  Shuffle,
  X,
} from 'lucide-react'
import { formatCommitDate } from './detail.aiFlow'
import { ModalShell } from '../../components/ModalShell'
import type {
  AiCommitStatus,
  AiFlowEdge,
  AiFlowNode,
  DetailGitSnapshot,
  FlowViewportApi,
  GitOperationKind,
  GitOperationResult,
  RightPaneMode,
} from './detail.types'

type DetailAiCommitPanelProps = {
  rightPaneMode: RightPaneMode
  setRightPaneMode: Dispatch<SetStateAction<RightPaneMode>>
  flowNodes: AiFlowNode[]
  flowEdges: AiFlowEdge[]
  aiRawText: string
  statusClass: string
  statusText: string
  gitSnapshot: DetailGitSnapshot | null
  gitSnapshotLoading: boolean
  gitSnapshotError: string | null
  onRefreshGitSnapshot: () => void
  activeCommitHash: string | null
  setActiveCommitHash: Dispatch<SetStateAction<string | null>>
  flowApiRef: MutableRefObject<FlowViewportApi | null>
  flowViewportReadyRef: MutableRefObject<boolean>
  flowInitialFocusDoneRef: MutableRefObject<boolean>
  flowLastFocusedStepRef: MutableRefObject<string | null>
  aiCommitStatus: AiCommitStatus
}

type GitChangedFile = DetailGitSnapshot['changedFiles'][number]
type GitHistoryCommit = DetailGitSnapshot['recentCommits'][number]
type AiStepStatus = AiFlowNode['data']['status']

type OperationCardState = {
  disabled: boolean
  hint: string
}

type OperationConfirmState = {
  operation: GitOperationKind
  message: string
} | null

const CHANGE_META: Record<GitChangedFile['kind'], { label: string; className: string }> = {
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

const GIT_OPERATION_ITEMS = [
  { key: 'fetch', label: 'Fetch', description: '同步远程引用', icon: CloudDownload },
  { key: 'pull', label: 'Pull', description: '拉取并合并', icon: Download },
  { key: 'push', label: 'Push', description: '推送当前分支', icon: CloudUpload },
  { key: 'switch', label: 'Switch', description: '切换到目标分支', icon: Shuffle },
  { key: 'merge', label: 'Merge', description: '合并目标分支', icon: GitMerge },
] as const

function getScopeLabel(file: GitChangedFile): string {
  if (file.scope === 'conflicted') return '冲突'
  if (file.scope === 'untracked') return '未跟踪'
  if (file.staged && file.unstaged) return '已暂存 + 未暂存'
  if (file.staged) return '已暂存'
  return '未暂存'
}

function formatGitBadgeCount(count: number): string {
  return count > 99 ? '99+' : String(count)
}

function computeOperationState(
  operation: GitOperationKind,
  params: {
    hasConflicts: boolean
    hasWorkingTreeChanges: boolean
    branchAhead: number
    branchBehind: number
    hasUpstream: boolean
    mergeTarget: string
    currentBranch: string
    runningOperation: GitOperationKind | null
  }
): OperationCardState {
  if (params.runningOperation && params.runningOperation !== operation) {
    return { disabled: true, hint: '另一个 Git 操作执行中' }
  }
  if (params.hasConflicts && operation !== 'fetch') {
    return { disabled: true, hint: '存在冲突，先解决冲突' }
  }
  if (operation === 'pull') {
    if (!params.hasUpstream) return { disabled: true, hint: '当前分支无 upstream' }
    if (params.hasWorkingTreeChanges) return { disabled: true, hint: '工作区不干净，先提交或暂存' }
    if (params.branchBehind <= 0) return { disabled: true, hint: '没有可拉取提交' }
  }
  if (operation === 'push') {
    if (!params.currentBranch || params.currentBranch === 'DETACHED') return { disabled: true, hint: 'Detached HEAD 不能推送' }
    if (params.branchAhead <= 0) return { disabled: true, hint: '没有可推送提交' }
  }
  if (operation === 'merge') {
    if (params.hasWorkingTreeChanges) return { disabled: true, hint: '工作区不干净，先提交或暂存' }
    if (!params.mergeTarget) return { disabled: true, hint: '请选择要合并的分支' }
    if (params.mergeTarget === params.currentBranch) return { disabled: true, hint: '不能合并到自己' }
  }
  if (operation === 'switch') {
    if (!params.mergeTarget) return { disabled: true, hint: '请选择要切换的分支' }
    if (params.mergeTarget === params.currentBranch) return { disabled: true, hint: '已在当前分支' }
  }
  return { disabled: false, hint: '可执行' }
}

function getStepClass(status: AiStepStatus): string {
  if (status === 'success') return 'border-[color:var(--color-success)]/30 bg-[color:var(--color-success-background)] text-[color:var(--color-success)]'
  if (status === 'running') return 'border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)]'
  if (status === 'error') return 'border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-background)] text-[color:var(--color-destructive)]'
  return 'border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)] text-[color:var(--color-muted-foreground)]'
}

function getStepDotClass(status: AiStepStatus): string {
  if (status === 'success') return 'bg-[color:var(--color-success)]'
  if (status === 'running') return 'bg-[color:var(--color-warning)] animate-pulse'
  if (status === 'error') return 'bg-[color:var(--color-destructive)]'
  return 'bg-[color:var(--color-muted-foreground)]/45'
}

function CommitHistoryItem({
  commit,
  activeCommitHash,
  setActiveCommitHash,
}: {
  commit: GitHistoryCommit
  activeCommitHash: string | null
  setActiveCommitHash: Dispatch<SetStateAction<string | null>>
}) {
  const active = activeCommitHash === commit.hash

  return (
    <div
      className={`rounded-[14px] border px-3 py-2.5 transition-all duration-200 ${
        active
          ? 'border-[color:var(--color-primary)]/45 bg-[color:var(--color-background)]'
          : 'border-[color:var(--color-border)] bg-[color:var(--color-card)] hover:border-[color:var(--color-border-hover)] hover:bg-[color:var(--color-background)]/70'
      }`}
    >
      <button
        type="button"
        className="block w-full min-w-0 text-left"
        onClick={() => setActiveCommitHash((prev) => (prev === commit.hash ? null : commit.hash))}
      >
        <p className="truncate text-[13px] font-semibold tracking-[-0.01em] text-[color:var(--color-foreground)]">
          {commit.subject}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10.5px] text-[color:var(--color-muted-foreground)]">
          <span className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)] px-2 py-0.5 font-mono">
            {commit.shortHash}
          </span>
          <span>{formatCommitDate(commit.committedAt)}</span>
        </div>
      </button>

      {active && (
        <div className="mt-2 rounded-[12px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/70 px-3 py-2">
          <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
            {commit.authorName || 'Unknown author'}
            {commit.refs.length > 0 ? ` · ${commit.refs.join(', ')}` : ''}
          </p>
          {commit.bullets.length > 0 && (
            <div className="mt-2 space-y-1">
              {commit.bullets.map((line, idx) => (
                <div key={`${commit.hash}-b-${idx}`} className="flex items-start gap-1.5 text-[11.5px] leading-5 text-[color:var(--color-foreground)]">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[color:var(--color-muted-foreground)]/70" />
                  <span className="min-w-0 break-words">{line.replace(/^-+\s*/, '')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DetailAiCommitPanel({
  rightPaneMode,
  setRightPaneMode,
  flowNodes,
  aiRawText,
  statusClass,
  statusText,
  gitSnapshot,
  gitSnapshotLoading,
  gitSnapshotError,
  onRefreshGitSnapshot,
  activeCommitHash,
  setActiveCommitHash,
}: DetailAiCommitPanelProps) {
  const [runningOperation, setRunningOperation] = useState<GitOperationKind | null>(null)
  const [mergeTarget, setMergeTarget] = useState('')
  const [mergeDropdownOpen, setMergeDropdownOpen] = useState(false)
  const [operationConfirm, setOperationConfirm] = useState<OperationConfirmState>(null)
  const [operationResult, setOperationResult] = useState<GitOperationResult | null>(null)
  const mergeDropdownRef = useRef<HTMLDivElement | null>(null)

  const branch = gitSnapshot?.branch
  const changedFiles = gitSnapshot?.changedFiles ?? []
  const recentCommits = gitSnapshot?.recentCommits ?? []
  const currentBranch = branch?.current || 'No branch'
  const upstreamBranch = branch?.upstream || 'No upstream'
  const remoteBranches = branch?.remoteBranches ?? []
  const localBranches = branch?.localBranches ?? []
  const stagedCount = changedFiles.filter((file) => file.staged).length
  const unstagedCount = changedFiles.filter((file) => file.unstaged && file.scope !== 'untracked').length
  const untrackedCount = changedFiles.filter((file) => file.scope === 'untracked').length
  const conflictedCount = changedFiles.filter((file) => file.scope === 'conflicted').length
  const hasWorkingTreeChanges = changedFiles.length > 0
  const hasConflicts = conflictedCount > 0
  const branchAhead = branch?.ahead ?? 0
  const branchBehind = branch?.behind ?? 0
  const hasUpstream = Boolean(branch?.upstream)

  const localMergeCandidates = useMemo(
    () => localBranches.filter((name) => name !== currentBranch),
    [localBranches, currentBranch]
  )

  const remoteMergeCandidates = useMemo(
    () => remoteBranches.filter((name) => name !== currentBranch),
    [remoteBranches, currentBranch]
  )
  const mergeTargetLabel = mergeTarget || '选择分支（本地 / 远程）...'

  useEffect(() => {
    if (!mergeDropdownOpen) return
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (mergeDropdownRef.current?.contains(target)) return
      setMergeDropdownOpen(false)
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMergeDropdownOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [mergeDropdownOpen])

  useEffect(() => {
    if (!operationConfirm) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOperationConfirm(null)
    }
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [operationConfirm])

  const operationStates = useMemo<Record<GitOperationKind, OperationCardState>>(() => {
    return {
      fetch: computeOperationState('fetch', {
        hasConflicts,
        hasWorkingTreeChanges,
        branchAhead,
        branchBehind,
        hasUpstream,
        mergeTarget,
        currentBranch,
        runningOperation,
      }),
      pull: computeOperationState('pull', {
        hasConflicts,
        hasWorkingTreeChanges,
        branchAhead,
        branchBehind,
        hasUpstream,
        mergeTarget,
        currentBranch,
        runningOperation,
      }),
      push: computeOperationState('push', {
        hasConflicts,
        hasWorkingTreeChanges,
        branchAhead,
        branchBehind,
        hasUpstream,
        mergeTarget,
        currentBranch,
        runningOperation,
      }),
      switch: computeOperationState('switch', {
        hasConflicts,
        hasWorkingTreeChanges,
        branchAhead,
        branchBehind,
        hasUpstream,
        mergeTarget,
        currentBranch,
        runningOperation,
      }),
      merge: computeOperationState('merge', {
        hasConflicts,
        hasWorkingTreeChanges,
        branchAhead,
        branchBehind,
        hasUpstream,
        mergeTarget,
        currentBranch,
        runningOperation,
      }),
    }
  }, [
    hasConflicts,
    hasWorkingTreeChanges,
    branchAhead,
    branchBehind,
    hasUpstream,
    mergeTarget,
    currentBranch,
    runningOperation,
  ])

  const requestGitOperation = (operation: GitOperationKind) => {
    const state = operationStates[operation]
    if (state.disabled || !gitSnapshot) return

    const message = operation === 'merge'
      ? `将把 ${mergeTarget} 合并到 ${currentBranch}，继续吗？`
      : operation === 'switch'
        ? `将切换到 ${mergeTarget}，继续吗？`
        : operation === 'pull'
        ? `将拉取并快进合并到 ${currentBranch}，继续吗？`
        : operation === 'push'
          ? `将把 ${currentBranch} 推送到远程，继续吗？`
          : '将执行 fetch 更新远程引用，继续吗？'

    setOperationConfirm({ operation, message })
  }

  const runGitOperation = async (operation: GitOperationKind) => {
    const state = operationStates[operation]
    if (state.disabled || !gitSnapshot) return

    setRunningOperation(operation)
    setOperationResult(null)
    try {
      const result = await window.electronAPI.runGitOperation({
        projectPath: gitSnapshot.projectPath,
        operation,
        targetBranch: operation === 'merge' || operation === 'switch' ? mergeTarget : undefined,
      })
      setOperationResult(result)
      await onRefreshGitSnapshot()
    } catch (error) {
      setOperationResult({
        operation,
        ok: false,
        checkedAt: Date.now(),
        command: '',
        output: error instanceof Error ? error.message : String(error),
        exitCode: null,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setRunningOperation(null)
    }
  }

  const pendingOperationLabel = operationConfirm
    ? GIT_OPERATION_ITEMS.find((item) => item.key === operationConfirm.operation)?.label ?? 'Git'
    : 'Git'
  const pendingOperation = operationConfirm?.operation ?? null
  const pendingOperationMessage = operationConfirm?.message ?? ''

  return (
    <>
      <aside className="h-full min-h-0 min-w-0 overflow-hidden rounded-[24px] surface-card">
        <div className="flex h-full min-h-0 flex-col gap-4 p-4">
          <section className="shrink-0 rounded-[20px] border border-[color:var(--color-border)] bg-[color:var(--color-card)]/62 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="section-label">AI Commit</p>
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] ${statusClass}`}>
                  {statusText}
                </span>
                <span className="text-[11px] text-[color:var(--color-muted-foreground)]">
                  动画改为轻量状态条，主体空间留给 Git 数据
                </span>
              </div>

              {rightPaneMode === 'flow' ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {flowNodes.map((node, index) => (
                    <div
                      key={node.id}
                      className={`inline-flex max-w-[190px] items-center gap-2 rounded-full border px-3 py-1.5 text-[11.5px] font-medium ${getStepClass(node.data.status)}`}
                      title={node.data.detail || node.data.label}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${getStepDotClass(node.data.status)}`} />
                      <span className="shrink-0 font-mono text-[10px] opacity-70">{index + 1}</span>
                      <span className="truncate">{node.data.label}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 max-h-[128px] overflow-auto rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/60 p-3">
                  <pre className="whitespace-pre-wrap break-words text-[11px] leading-5 text-[color:var(--color-foreground)]/85">
                    {aiRawText || '暂无原始日志'}
                  </pre>
                </div>
              )}
            </div>

            <div className="quiet-control flex shrink-0 items-center gap-1 rounded-full border-0 p-1">
              <button
                className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${rightPaneMode === 'flow'
                  ? 'bg-primary text-white'
                  : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
                  }`}
                onClick={() => setRightPaneMode('flow')}
              >
                状态
              </button>
              <button
                className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${rightPaneMode === 'raw'
                  ? 'bg-primary text-white'
                  : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
                  }`}
                onClick={() => setRightPaneMode('raw')}
              >
                日志
              </button>
            </div>
          </div>
        </section>

        {gitSnapshotError && (
          <div className="shrink-0 rounded-[14px] border border-[color:var(--color-destructive)]/25 bg-[color:var(--color-destructive-background)] px-3 py-2 text-xs text-[color:var(--color-destructive)]">
            {gitSnapshotError}
          </div>
        )}

        <section className="grid min-h-0 flex-1 grid-cols-[minmax(300px,1.05fr)_minmax(340px,1fr)_300px] gap-4 overflow-hidden xl:grid-cols-[minmax(380px,1.1fr)_minmax(420px,1fr)_340px]">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-[20px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="inline-flex min-w-0 items-center gap-2">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)]">
                  <FileText className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-base font-semibold tracking-[-0.02em] text-[color:var(--color-foreground)]">暂未提交文件</p>
                  <p className="text-xs text-[color:var(--color-muted-foreground)]">工作区变更优先显示，方便提交前确认</p>
                </div>
              </div>
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2.5 py-1 text-[11px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
                onClick={onRefreshGitSnapshot}
                disabled={gitSnapshotLoading}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${gitSnapshotLoading ? 'animate-spin' : ''}`} />
                刷新
              </button>
            </div>

            <div className="mb-3 grid grid-cols-4 gap-2">
              <div className="rounded-[13px] bg-[color:var(--color-background-sunken)]/60 px-2.5 py-2">
                <p className="font-mono text-sm font-semibold text-[color:var(--color-foreground)]">{formatGitBadgeCount(changedFiles.length)}</p>
                <p className="text-[10.5px] text-[color:var(--color-muted-foreground)]">全部</p>
              </div>
              <div className="rounded-[13px] bg-[color:var(--color-success-background)] px-2.5 py-2">
                <p className="font-mono text-sm font-semibold text-[color:var(--color-success)]">{formatGitBadgeCount(stagedCount)}</p>
                <p className="text-[10.5px] text-[color:var(--color-success)]/80">已暂存</p>
              </div>
              <div className="rounded-[13px] bg-[color:var(--color-warning-background)] px-2.5 py-2">
                <p className="font-mono text-sm font-semibold text-[color:var(--color-warning)]">{formatGitBadgeCount(unstagedCount)}</p>
                <p className="text-[10.5px] text-[color:var(--color-warning)]/80">未暂存</p>
              </div>
              <div className="rounded-[13px] bg-[color:var(--color-background-sunken)]/60 px-2.5 py-2">
                <p className="font-mono text-sm font-semibold text-[color:var(--color-foreground)]">{formatGitBadgeCount(untrackedCount)}</p>
                <p className="text-[10.5px] text-[color:var(--color-muted-foreground)]">未跟踪</p>
              </div>
            </div>

            {conflictedCount > 0 && (
              <div className="mb-3 rounded-[13px] border border-[color:var(--color-destructive)]/25 bg-[color:var(--color-destructive-background)] px-3 py-2 text-xs text-[color:var(--color-destructive)]">
                当前有 {conflictedCount} 个冲突文件，建议先解决后再提交。
              </div>
            )}

            {changedFiles.length > 0 ? (
              <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
                {changedFiles.map((file) => {
                  const meta = CHANGE_META[file.kind]
                  return (
                    <div key={`${file.path}-${file.indexStatus}-${file.worktreeStatus}`} className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background)]/72 px-3 py-2.5">
                      <div className="flex items-start gap-2">
                        <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${meta.className}`}>
                          {meta.label}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-[12px] text-[color:var(--color-foreground)]" title={file.path}>{file.path}</p>
                          {file.originalPath && (
                            <p className="mt-0.5 truncate font-mono text-[10.5px] text-[color:var(--color-muted-foreground)]" title={file.originalPath}>
                              from {file.originalPath}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[10.5px] text-[color:var(--color-muted-foreground)]">
                        <span>{getScopeLabel(file)}</span>
                        <span className="font-mono">{file.indexStatus}{file.worktreeStatus}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center rounded-[16px] border border-dashed border-[color:var(--color-border)] bg-[color:var(--color-background)]/45 px-3 py-5 text-center">
                <div>
                  <p className="text-base font-semibold text-[color:var(--color-foreground)]">工作区干净</p>
                  <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">没有暂未提交的文件</p>
                </div>
              </div>
            )}
          </div>

          <div className="flex min-h-0 flex-col overflow-hidden rounded-[20px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="inline-flex min-w-0 items-center gap-2">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)]">
                  <History className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-base font-semibold tracking-[-0.02em] text-[color:var(--color-foreground)]">提交历史</p>
                  <p className="text-xs text-[color:var(--color-muted-foreground)]">最近 10 次提交，点击可展开说明</p>
                </div>
              </div>
              <GitCommitHorizontal className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]" />
            </div>

            {recentCommits.length > 0 ? (
              <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
                {recentCommits.map((commit) => (
                  <CommitHistoryItem
                    key={commit.hash}
                    commit={commit}
                    activeCommitHash={activeCommitHash}
                    setActiveCommitHash={setActiveCommitHash}
                  />
                ))}
              </div>
            ) : (
              <p className="flex min-h-0 flex-1 items-center justify-center rounded-[16px] border border-dashed border-[color:var(--color-border)] px-3 py-5 text-center text-xs text-[color:var(--color-muted-foreground)]">
                暂无提交记录
              </p>
            )}
          </div>

          <div className="min-h-0 rounded-[20px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="inline-flex min-w-0 items-center gap-2">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)]">
                  <GitBranch className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-base font-semibold tracking-[-0.02em] text-[color:var(--color-foreground)]">分支与远程</p>
                  <p className="text-xs text-[color:var(--color-muted-foreground)]">状态摘要与常用远程操作</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span className="rounded-full bg-[color:var(--color-success-background)] px-2 py-0.5 text-[10.5px] font-medium text-[color:var(--color-success)]">
                  ↑ {branch?.ahead ?? 0}
                </span>
                <span className="rounded-full bg-[color:var(--color-warning-background)] px-2 py-0.5 text-[10.5px] font-medium text-[color:var(--color-warning)]">
                  ↓ {branch?.behind ?? 0}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/62 px-3 py-2">
                <p className="text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">Current</p>
                <p className="mt-1 truncate font-mono text-[12px] text-[color:var(--color-foreground)]" title={currentBranch}>{currentBranch}</p>
              </div>
              <div className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/62 px-3 py-2">
                <p className="text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">Upstream</p>
                <p className="mt-1 truncate font-mono text-[12px] text-[color:var(--color-foreground)]" title={upstreamBranch}>{upstreamBranch}</p>
              </div>
            </div>

            <div className="mt-3">
              <label className="block">
                <p className="mb-1 text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">
                  Merge Target
                </p>
                <div ref={mergeDropdownRef} className="relative">
                  <button
                    type="button"
                    className={`quiet-control flex h-10 w-full items-center justify-between rounded-[14px] px-3 text-left text-[12px] transition-colors ${
                      mergeDropdownOpen
                        ? 'border-[color:var(--color-ring)]/65 ring-2 ring-[color:var(--color-ring)]/22'
                        : 'hover:border-[color:var(--color-border-hover)]'
                    }`}
                    aria-haspopup="listbox"
                    aria-expanded={mergeDropdownOpen}
                    onClick={() => setMergeDropdownOpen((prev) => !prev)}
                  >
                    <span className={mergeTarget ? 'font-mono text-[color:var(--color-foreground)]' : 'text-[color:var(--color-muted-foreground)]'}>
                      {mergeTargetLabel}
                    </span>
                    <ChevronDown className={`h-3.5 w-3.5 text-[color:var(--color-muted-foreground)] transition-transform ${mergeDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {mergeDropdownOpen && (
                    <div
                      className="surface-card absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-[14px]"
                      role="listbox"
                      aria-label="Merge target branches"
                    >
                      <div className="max-h-[240px] overflow-auto p-1">
                        {localMergeCandidates.length > 0 && (
                          <div className="mb-1">
                            <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">
                              本地分支
                            </p>
                            {localMergeCandidates.map((name) => {
                              const active = mergeTarget === name
                              return (
                                <button
                                  key={`local-${name}`}
                                  type="button"
                                  className={`flex w-full items-center justify-between rounded-[10px] px-2.5 py-1.5 text-left text-[11.5px] transition-colors ${
                                    active
                                      ? 'bg-[color:var(--color-primary)]/12 text-[color:var(--color-foreground)]'
                                      : 'text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]'
                                  }`}
                                  onClick={() => {
                                    setMergeTarget(name)
                                    setMergeDropdownOpen(false)
                                  }}
                                >
                                  <span className="truncate font-mono">{name}</span>
                                  {active && <Check className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-primary)]" />}
                                </button>
                              )
                            })}
                          </div>
                        )}
                        {remoteMergeCandidates.length > 0 && (
                          <div>
                            <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">
                              远程分支
                            </p>
                            {remoteMergeCandidates.map((name) => {
                              const active = mergeTarget === name
                              return (
                                <button
                                  key={`remote-${name}`}
                                  type="button"
                                  className={`flex w-full items-center justify-between rounded-[10px] px-2.5 py-1.5 text-left text-[11.5px] transition-colors ${
                                    active
                                      ? 'bg-[color:var(--color-primary)]/12 text-[color:var(--color-foreground)]'
                                      : 'text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]'
                                  }`}
                                  onClick={() => {
                                    setMergeTarget(name)
                                    setMergeDropdownOpen(false)
                                  }}
                                >
                                  <span className="truncate font-mono">{name}</span>
                                  {active && <Check className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-primary)]" />}
                                </button>
                              )
                            })}
                          </div>
                        )}
                        {localMergeCandidates.length === 0 && remoteMergeCandidates.length === 0 && (
                          <p className="px-2 py-2 text-[11px] text-[color:var(--color-muted-foreground)]">
                            暂无可选分支
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <p className="mt-1 text-[10.5px] text-[color:var(--color-muted-foreground)]">
                  本地 {localMergeCandidates.length} 个 · 远程 {remoteMergeCandidates.length} 个
                </p>
              </label>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              {GIT_OPERATION_ITEMS.map((item) => {
                const Icon = item.icon
                const opState = operationStates[item.key]
                const running = runningOperation === item.key
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`rounded-[14px] border border-[color:var(--color-border)] px-3 py-2 text-left transition-colors ${
                      opState.disabled
                        ? 'cursor-not-allowed bg-[color:var(--color-background-sunken)]/40 opacity-55'
                        : 'bg-[color:var(--color-background-sunken)]/65 hover:bg-[color:var(--color-background)]'
                    }`}
                    title={`${item.description} · ${opState.hint}`}
                    disabled={opState.disabled}
                    onClick={() => requestGitOperation(item.key)}
                  >
                    <div className="flex items-center gap-2 text-[12px] font-semibold text-[color:var(--color-foreground)]">
                      <Icon className={`h-3.5 w-3.5 ${running ? 'animate-pulse text-[color:var(--color-warning)]' : 'text-[color:var(--color-primary)]'}`} />
                      {running ? `${item.label}...` : item.label}
                    </div>
                    <p className="mt-1 text-[10px] text-[color:var(--color-muted-foreground)]/85">{opState.hint}</p>
                  </button>
                )
              })}
            </div>

            {operationResult && (
              <div className={`mt-3 rounded-[12px] border px-3 py-2 ${
                operationResult.ok
                  ? 'border-[color:var(--color-success)]/30 bg-[color:var(--color-success-background)]'
                  : operationResult.skipped
                    ? 'border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-background)]'
                    : 'border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-background)]'
              }`}>
                <p className="text-[11px] font-semibold text-[color:var(--color-foreground)]">
                  {operationResult.ok ? '操作成功' : operationResult.skipped ? '操作已跳过' : '操作失败'}
                </p>
                {operationResult.command && (
                  <p className="mt-1 font-mono text-[10.5px] text-[color:var(--color-muted-foreground)]">
                    {operationResult.command}
                  </p>
                )}
                <pre className="mt-1 max-h-[110px] overflow-auto whitespace-pre-wrap break-words text-[10.5px] leading-5 text-[color:var(--color-foreground)]/88">
                  {operationResult.output}
                </pre>
              </div>
            )}
          </div>
          </section>
        </div>
      </aside>
      <ModalShell
        open={Boolean(operationConfirm)}
        onClose={() => setOperationConfirm(null)}
        widthClassName="max-w-[420px]"
        baseZIndex={1100}
        ariaLabel={`${pendingOperationLabel} 操作确认`}
      >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="section-label mb-1">Remote Operation</p>
                <p className="text-sm font-semibold text-[color:var(--color-foreground)]">
                  {pendingOperationLabel} 操作确认
                </p>
              </div>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                onClick={() => setOperationConfirm(null)}
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/70 px-3 py-2 text-[12px] text-[color:var(--color-foreground)]">
              {pendingOperationMessage}
            </p>
            <p className="mt-2 text-[10.5px] text-[color:var(--color-muted-foreground)]">
              将执行真实 git 命令并刷新状态快照。
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                className="quiet-control inline-flex h-9 items-center justify-center rounded-full border-0 px-4 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
                onClick={() => setOperationConfirm(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 text-xs font-medium text-white transition-colors hover:bg-primary-hover"
                onClick={() => {
                  if (!pendingOperation) return
                  setOperationConfirm(null)
                  void runGitOperation(pendingOperation)
                }}
              >
                确认执行
              </button>
            </div>
      </ModalShell>
    </>
  )
}

export { DetailAiCommitPanel }
