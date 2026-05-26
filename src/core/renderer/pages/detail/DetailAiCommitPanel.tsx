import { type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  CloudDownload,
  CloudUpload,
  Copy,
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
import { DetailGitDiffDrawer } from './DetailGitDiffDrawer'
import type {
  AiCommitStatus,
  AiFlowEdge,
  AiFlowNode,
  DetailGitSnapshot,
  FlowViewportApi,
  GitDiffViewMode,
  GitFileDiffResult,
  GitOperationKind,
  GitOperationResult,
  GitSetFileStageResult,
  RightPaneMode,
} from './detail.types'

type DetailAiCommitPanelProps = {
  rightPaneMode: RightPaneMode
  setRightPaneMode: Dispatch<SetStateAction<RightPaneMode>>
  jumpToAiLogToken: number
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

type MiddlePanelMode = 'history' | 'ai-log' | 'git-log'
type CopyStatus = 'idle' | 'success' | 'error'
type CommitHistoryDisplayItem = GitHistoryCommit & {
  withinRecentBatch: boolean
}

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

function formatGitBadgeCount(count: number): string {
  return count > 99 ? '99+' : String(count)
}

function getScopeLabel(file: GitChangedFile): string {
  if (file.scope === 'conflicted') return '冲突'
  if (file.scope === 'untracked') return '未跟踪'
  if (file.staged && file.unstaged) return '已暂存 + 未暂存'
  if (file.staged) return '已暂存'
  return '未暂存'
}

function formatLogTime(value: number): string {
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

function pickDefaultDiffViewMode(file: GitChangedFile): GitDiffViewMode {
  return file.unstaged || file.scope === 'untracked' ? 'unstaged' : 'staged'
}

function getOperationLabel(operation: GitOperationKind): string {
  return GIT_OPERATION_ITEMS.find((item) => item.key === operation)?.label ?? operation
}

function getOperationStatusClass(result: GitOperationResult): string {
  if (result.ok) {
    return 'border-[color:var(--color-success)]/30 bg-[color:var(--color-success-background)]'
  }
  if (result.skipped) {
    return 'border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-background)]'
  }
  return 'border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-background)]'
}

function getOperationStatusText(result: GitOperationResult): string {
  if (result.ok) return '成功'
  if (result.skipped) return '已跳过'
  return '失败'
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

function formatFilesChangedLabel(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '0 文件'
  return `${count} 文件`
}

function buildCommitHistoryDisplayItems(commits: GitHistoryCommit[]): CommitHistoryDisplayItem[] {
  const COMMIT_BATCH_WINDOW_MS = 15_000
  const commitTimes = commits.map((commit) => new Date(commit.committedAt).getTime())

  return commits.map((commit, index) => {
    const currentTime = commitTimes[index]
    if (!Number.isFinite(currentTime)) {
      return { ...commit, withinRecentBatch: false }
    }

    const prevTime = index > 0 ? commitTimes[index - 1] : Number.NaN
    const nextTime = index < commits.length - 1 ? commitTimes[index + 1] : Number.NaN
    const nearPrev = Number.isFinite(prevTime) && Math.abs(prevTime - currentTime) <= COMMIT_BATCH_WINDOW_MS
    const nearNext = Number.isFinite(nextTime) && Math.abs(nextTime - currentTime) <= COMMIT_BATCH_WINDOW_MS
    const withinRecentBatch = nearPrev || nearNext

    return { ...commit, withinRecentBatch }
  })
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fallback below.
    }
  }

  if (typeof document === 'undefined') return false

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '-9999px'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)

  textarea.focus()
  textarea.select()

  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  } finally {
    document.body.removeChild(textarea)
  }

  return copied
}

function CommitHistoryItem({
  commit,
  activeCommitHash,
  setActiveCommitHash,
}: {
  commit: CommitHistoryDisplayItem
  activeCommitHash: string | null
  setActiveCommitHash: Dispatch<SetStateAction<string | null>>
}) {
  const active = activeCommitHash === commit.hash
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle')
  const hashLabel = copyStatus === 'success' ? '已复制' : copyStatus === 'error' ? '复制失败' : commit.shortHash

  useEffect(() => {
    if (copyStatus === 'idle') return
    const timer = window.setTimeout(() => {
      setCopyStatus('idle')
    }, 1500)
    return () => {
      window.clearTimeout(timer)
    }
  }, [copyStatus])

  const handleCopyHash = async () => {
    const ok = await copyTextToClipboard(commit.hash)
    setCopyStatus(ok ? 'success' : 'error')
  }

  return (
    <div
      className={`rounded-[14px] border px-3 py-2.5 transition-all duration-200 ${
        active
          ? 'border-[color:var(--color-primary)]/45 bg-[color:var(--color-background)]'
          : commit.withinRecentBatch
            ? 'border-[color:var(--color-warning)]/45 bg-[color:var(--color-warning-background)]/45 hover:border-[color:var(--color-warning)]/65 hover:bg-[color:var(--color-warning-background)]/60'
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
          <span
            className={`inline-flex cursor-pointer select-none items-center gap-1 rounded-full border px-2 py-0.5 font-mono transition-colors ${
              copyStatus === 'success'
                ? 'border-[color:var(--color-success)]/40 bg-[color:var(--color-success-background)] text-[color:var(--color-success)]'
                : copyStatus === 'error'
                  ? 'border-[color:var(--color-destructive)]/40 bg-[color:var(--color-destructive-background)] text-[color:var(--color-destructive)]'
                  : 'border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)] text-[color:var(--color-foreground)] hover:bg-[color:var(--color-background)]'
            }`}
            onClick={(event) => {
              event.stopPropagation()
              void handleCopyHash()
            }}
            title="点击复制完整 hash"
          >
            <Copy className="h-3 w-3" />
            {hashLabel}
          </span>
          <span className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)] px-2 py-0.5">
            {formatFilesChangedLabel(commit.filesChanged)}
          </span>
          {commit.withinRecentBatch && (
            <span className="rounded-full border border-[color:var(--color-warning)]/45 bg-[color:var(--color-warning-background)] px-2 py-0.5 text-[color:var(--color-warning)]">
              同批（15s）
            </span>
          )}
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
  jumpToAiLogToken,
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
  const [middlePanelMode, setMiddlePanelMode] = useState<MiddlePanelMode>('history')
  const [runningOperation, setRunningOperation] = useState<GitOperationKind | null>(null)
  const [mergeTarget, setMergeTarget] = useState('')
  const [mergeDropdownOpen, setMergeDropdownOpen] = useState(false)
  const [operationConfirm, setOperationConfirm] = useState<OperationConfirmState>(null)
  const [operationLogs, setOperationLogs] = useState<GitOperationResult[]>([])
  const [stagingFilePath, setStagingFilePath] = useState<string | null>(null)
  const [fileActionError, setFileActionError] = useState<string | null>(null)
  const [diffDrawerOpen, setDiffDrawerOpen] = useState(false)
  const [activeDiffFilePath, setActiveDiffFilePath] = useState<string | null>(null)
  const [diffViewMode, setDiffViewMode] = useState<GitDiffViewMode>('unstaged')
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffContent, setDiffContent] = useState('')
  const [diffError, setDiffError] = useState<string | null>(null)
  const mergeDropdownRef = useRef<HTMLDivElement | null>(null)
  const diffRequestSeqRef = useRef(0)

  const branch = gitSnapshot?.branch
  const changedFiles = gitSnapshot?.changedFiles ?? []
  const changedFilesMap = useMemo(() => {
    const map = new Map<string, GitChangedFile>()
    for (const item of changedFiles) map.set(item.path, item)
    return map
  }, [changedFiles])
  const recentCommits = gitSnapshot?.recentCommits ?? []
  const commitHistoryItems = useMemo(() => buildCommitHistoryDisplayItems(recentCommits), [recentCommits])
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
  const activeDiffFile = activeDiffFilePath ? changedFilesMap.get(activeDiffFilePath) ?? null : null
  const activeDiffSupportsUnstaged = Boolean(activeDiffFile && (activeDiffFile.unstaged || activeDiffFile.scope === 'untracked'))
  const activeDiffSupportsStaged = Boolean(activeDiffFile?.staged)

  const localMergeCandidates = useMemo(
    () => localBranches.filter((name) => name !== currentBranch),
    [localBranches, currentBranch]
  )

  const remoteMergeCandidates = useMemo(
    () => remoteBranches.filter((name) => name !== currentBranch),
    [remoteBranches, currentBranch]
  )
  const mergeTargetLabel = mergeTarget || '选择分支（本地 / 远程）...'
  const middlePanelMeta = middlePanelMode === 'history'
    ? {
      title: '提交历史',
      description: '最近 10 次提交，支持复制 hash、文件数与 15 秒同批标记',
      icon: History,
    }
    : middlePanelMode === 'ai-log'
      ? {
        title: 'AI Commit 日志',
        description: '完整原始输出，便于排查生成过程',
        icon: GitCommitHorizontal,
      }
      : {
        title: 'Git 操作日志',
        description: '右侧操作执行记录会累计到这里',
        icon: GitBranch,
      }
  const MiddlePanelIcon = middlePanelMeta.icon

  useEffect(() => {
    if (jumpToAiLogToken <= 0) return
    setMiddlePanelMode('ai-log')
  }, [jumpToAiLogToken])

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

  useEffect(() => {
    if (!diffDrawerOpen) return
    if (activeDiffFilePath && changedFilesMap.has(activeDiffFilePath)) return
    if (changedFiles.length <= 0) {
      setDiffDrawerOpen(false)
      setActiveDiffFilePath(null)
      setDiffContent('')
      setDiffError(null)
      return
    }
    setActiveDiffFilePath(changedFiles[0].path)
  }, [changedFiles, changedFilesMap, diffDrawerOpen, activeDiffFilePath])

  useEffect(() => {
    if (!activeDiffFile) {
      setDiffViewMode('unstaged')
      return
    }
    if (diffViewMode === 'staged' && !activeDiffSupportsStaged) {
      setDiffViewMode(activeDiffSupportsUnstaged ? 'unstaged' : 'staged')
      return
    }
    if (diffViewMode === 'unstaged' && !activeDiffSupportsUnstaged && activeDiffSupportsStaged) {
      setDiffViewMode('staged')
    }
  }, [activeDiffFile, diffViewMode, activeDiffSupportsStaged, activeDiffSupportsUnstaged])

  useEffect(() => {
    if (!diffDrawerOpen) return
    if (!activeDiffFilePath || !activeDiffFile) return
    if (diffViewMode === 'staged' && !activeDiffSupportsStaged) return
    if (diffViewMode === 'unstaged' && !activeDiffSupportsUnstaged) return
    void loadDiff(activeDiffFilePath, diffViewMode === 'staged')
  }, [
    gitSnapshot?.checkedAt,
    diffDrawerOpen,
    activeDiffFilePath,
    activeDiffFile,
    diffViewMode,
    activeDiffSupportsStaged,
    activeDiffSupportsUnstaged,
  ])

  useEffect(() => {
    if (diffLoading) return
    if (diffError || diffContent) return
    if (!activeDiffFilePath || !changedFilesMap.has(activeDiffFilePath)) return
    const file = changedFilesMap.get(activeDiffFilePath)
    if (!file) return
    if (file.scope === 'untracked' && diffViewMode === 'unstaged') return
    if (file.kind === 'deleted') return
    setDiffContent('(no diff output)')
  }, [diffLoading, diffError, diffContent, activeDiffFilePath, changedFilesMap, diffViewMode])

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

  const setFileStaged = async (file: GitChangedFile, stage: boolean) => {
    if (!gitSnapshot || stagingFilePath) return
    setFileActionError(null)
    setStagingFilePath(file.path)
    try {
      const result: GitSetFileStageResult = await window.electronAPI.setGitFileStage({
        projectPath: gitSnapshot.projectPath,
        filePath: file.path,
        stage,
      })
      if (!result.ok) {
        setFileActionError(result.error || result.output || '文件暂存操作失败')
      }
      await onRefreshGitSnapshot()
    } catch (error) {
      setFileActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setStagingFilePath(null)
    }
  }

  const loadDiff = async (filePath: string, staged: boolean) => {
    if (!gitSnapshot) return
    const requestSeq = diffRequestSeqRef.current + 1
    diffRequestSeqRef.current = requestSeq
    setDiffLoading(true)
    setDiffError(null)
    try {
      const result: GitFileDiffResult = await window.electronAPI.getGitFileDiff({
        projectPath: gitSnapshot.projectPath,
        filePath,
        staged,
      })
      if (requestSeq !== diffRequestSeqRef.current) return
      if (!result.ok) {
        setDiffContent('')
        setDiffError(result.error || result.output || '读取 diff 失败')
        return
      }
      setDiffContent(result.output)
    } catch (error) {
      if (requestSeq !== diffRequestSeqRef.current) return
      setDiffContent('')
      setDiffError(error instanceof Error ? error.message : String(error))
    } finally {
      if (requestSeq === diffRequestSeqRef.current) setDiffLoading(false)
    }
  }

  const openDiffDrawerForFile = (filePath: string) => {
    const target = changedFilesMap.get(filePath)
    if (!target) return
    setFileActionError(null)
    setDiffDrawerOpen(true)
    setActiveDiffFilePath(filePath)
    const initialMode = pickDefaultDiffViewMode(target)
    setDiffViewMode(initialMode)
  }

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
    try {
      const result = await window.electronAPI.runGitOperation({
        projectPath: gitSnapshot.projectPath,
        operation,
        targetBranch: operation === 'merge' || operation === 'switch' ? mergeTarget : undefined,
      })
      setOperationLogs((prev) => [result, ...prev].slice(0, 50))
      if (!result.ok && !result.skipped) {
        setMiddlePanelMode('git-log')
      }
      await onRefreshGitSnapshot()
    } catch (error) {
      const failedResult: GitOperationResult = {
        operation,
        ok: false,
        checkedAt: Date.now(),
        command: '',
        output: error instanceof Error ? error.message : String(error),
        exitCode: null,
        error: error instanceof Error ? error.message : String(error),
      }
      setOperationLogs((prev) => [failedResult, ...prev].slice(0, 50))
      setMiddlePanelMode('git-log')
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
          <div className="flex items-start gap-4">
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
            </div>
          </div>
        </section>

        {gitSnapshotError && (
          <div className="shrink-0 rounded-[14px] border border-[color:var(--color-destructive)]/25 bg-[color:var(--color-destructive-background)] px-3 py-2 text-xs text-[color:var(--color-destructive)]">
            {gitSnapshotError}
          </div>
        )}

        <section className="grid min-h-0 flex-1 grid-cols-[minmax(260px,0.9fr)_minmax(360px,1.1fr)_300px] gap-4 overflow-hidden xl:grid-cols-[minmax(320px,0.95fr)_minmax(460px,1.2fr)_340px]">
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

            {fileActionError && (
              <div className="mb-3 rounded-[13px] border border-[color:var(--color-destructive)]/25 bg-[color:var(--color-destructive-background)] px-3 py-2 text-xs text-[color:var(--color-destructive)]">
                {fileActionError}
              </div>
            )}

            {changedFiles.length > 0 ? (
              <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
                {changedFiles.map((file) => {
                  const meta = CHANGE_META[file.kind]
                  const isBusy = stagingFilePath === file.path
                  const canStage = (file.unstaged || file.scope === 'untracked') && file.scope !== 'conflicted'
                  const canUnstage = file.staged && file.scope !== 'conflicted'
                  return (
                    <div
                      key={`${file.path}-${file.indexStatus}-${file.worktreeStatus}`}
                      className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background)]/72 px-3 py-2.5"
                    >
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => openDiffDrawerForFile(file.path)}
                        >
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
                        </button>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2.5 py-1 text-[10.5px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => {
                              void setFileStaged(file, true)
                            }}
                            disabled={!canStage || Boolean(stagingFilePath)}
                            title={canStage ? '将文件加入暂存区' : '当前状态不可暂存'}
                          >
                            {isBusy && canStage ? '暂存中...' : '暂存'}
                          </button>
                          <button
                            type="button"
                            className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2.5 py-1 text-[10.5px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => {
                              void setFileStaged(file, false)
                            }}
                            disabled={!canUnstage || Boolean(stagingFilePath)}
                            title={canUnstage ? '将文件移出暂存区' : '当前状态不可取消暂存'}
                          >
                            {isBusy && canUnstage ? '取消中...' : '取消暂存'}
                          </button>
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
                  <MiddlePanelIcon className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-base font-semibold tracking-[-0.02em] text-[color:var(--color-foreground)]">
                    {middlePanelMeta.title}
                  </p>
                  <p className="text-xs text-[color:var(--color-muted-foreground)]">{middlePanelMeta.description}</p>
                </div>
              </div>
              <div className="quiet-control flex shrink-0 items-center gap-1 rounded-full border-0 p-1">
                <button
                  type="button"
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${middlePanelMode === 'history'
                    ? 'bg-primary text-white'
                    : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
                    }`}
                  onClick={() => setMiddlePanelMode('history')}
                >
                  历史
                </button>
                <button
                  type="button"
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${middlePanelMode === 'ai-log'
                    ? 'bg-primary text-white'
                    : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
                    }`}
                  onClick={() => setMiddlePanelMode('ai-log')}
                >
                  AI 日志
                </button>
                <button
                  type="button"
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${middlePanelMode === 'git-log'
                    ? 'bg-primary text-white'
                    : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
                    }`}
                  onClick={() => setMiddlePanelMode('git-log')}
                >
                  Git 日志
                </button>
              </div>
            </div>

            {middlePanelMode === 'history' && (
              <>
                {recentCommits.length > 0 ? (
                  <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
                    {commitHistoryItems.map((commit) => (
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
              </>
            )}

            {middlePanelMode === 'ai-log' && (
              <>
                {aiRawText.trim() ? (
                  <div className="min-h-0 flex-1 overflow-auto rounded-[16px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/60 p-3">
                    <pre className="whitespace-pre-wrap break-words text-[11px] leading-5 text-[color:var(--color-foreground)]/88">
                      {aiRawText}
                    </pre>
                  </div>
                ) : (
                  <p className="flex min-h-0 flex-1 items-center justify-center rounded-[16px] border border-dashed border-[color:var(--color-border)] px-3 py-5 text-center text-xs text-[color:var(--color-muted-foreground)]">
                    暂无 AI Commit 日志
                  </p>
                )}
              </>
            )}

            {middlePanelMode === 'git-log' && (
              <>
                {operationLogs.length > 0 ? (
                  <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
                    {operationLogs.map((result, index) => (
                      <div
                        key={`${result.operation}-${result.checkedAt}-${index}`}
                        className={`rounded-[14px] border px-3 py-2 ${getOperationStatusClass(result)}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[12px] font-semibold text-[color:var(--color-foreground)]">
                            {getOperationLabel(result.operation)} · {getOperationStatusText(result)}
                          </p>
                          <p className="text-[10.5px] text-[color:var(--color-muted-foreground)]">
                            {formatLogTime(result.checkedAt)}
                          </p>
                        </div>
                        {result.targetBranch && (
                          <p className="mt-1 text-[10.5px] text-[color:var(--color-muted-foreground)]">
                            目标分支：{result.targetBranch}
                          </p>
                        )}
                        {result.command && (
                          <p className="mt-1 font-mono text-[10.5px] text-[color:var(--color-muted-foreground)]">
                            {result.command}
                          </p>
                        )}
                        <pre className="mt-1 max-h-[140px] overflow-auto whitespace-pre-wrap break-words text-[10.5px] leading-5 text-[color:var(--color-foreground)]/88">
                          {result.output}
                        </pre>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="flex min-h-0 flex-1 items-center justify-center rounded-[16px] border border-dashed border-[color:var(--color-border)] px-3 py-5 text-center text-xs text-[color:var(--color-muted-foreground)]">
                    暂无 Git 操作日志，执行右侧操作后会显示在这里
                  </p>
                )}
              </>
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
                  setMiddlePanelMode('git-log')
                  setOperationConfirm(null)
                  void runGitOperation(pendingOperation)
                }}
              >
                确认执行
              </button>
            </div>
      </ModalShell>
      <DetailGitDiffDrawer
        open={diffDrawerOpen}
        changedFiles={changedFiles}
        activeFilePath={activeDiffFilePath}
        activeFile={activeDiffFile}
        diffViewMode={diffViewMode}
        diffLoading={diffLoading}
        diffContent={diffContent}
        diffError={diffError}
        canViewUnstaged={activeDiffSupportsUnstaged}
        canViewStaged={activeDiffSupportsStaged}
        onClose={() => setDiffDrawerOpen(false)}
        onSelectFile={(filePath) => {
          const file = changedFilesMap.get(filePath)
          if (!file) return
          setActiveDiffFilePath(filePath)
          const mode = pickDefaultDiffViewMode(file)
          setDiffViewMode(mode)
        }}
        onChangeDiffViewMode={(mode) => {
          if (mode === diffViewMode) return
          setDiffViewMode(mode)
        }}
      />
    </>
  )
}

export { DetailAiCommitPanel }
