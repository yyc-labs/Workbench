import { type Dispatch, type MouseEvent as ReactMouseEvent, type MutableRefObject, type SetStateAction } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  CloudDownload,
  CloudUpload,
  Code2,
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
import { GIT_GUIDE_SECTIONS, GIT_GUIDE_TITLE } from './gitGuideContent'
import { ModalShell } from '../../components/ModalShell'
import { UrlPopover } from '../../components/UrlPopover'
import { DetailGitDiffDrawer } from './DetailGitDiffDrawer'
import type {
  AiCommitStatus,
  AiFlowEdge,
  AiFlowNode,
  DetailGitSnapshot,
  FlowViewportApi,
  GitDiffViewMode,
  GitConflictFileResult,
  GitFileDiffResult,
  GitOperationKind,
  GitOperationResult,
  GitResolveConflictResult,
  GitSetFileStageResult,
  RightPaneMode,
} from './detail.types'

type DetailAiCommitPanelProps = {
  rightPaneMode: RightPaneMode
  setRightPaneMode: Dispatch<SetStateAction<RightPaneMode>>
  projectHeaderCollapsed?: boolean
  projectName?: string
  projectLinkItems?: { url: string; label: string; tag?: string; tagLabel?: string }[]
  activePane?: 'code' | 'aicommit'
  onSwitchPane?: (pane: 'code' | 'aicommit') => void
  onOpenProjectLinksManager?: () => void
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
  isAiEnabled: boolean
  aiAutoCommitButtonRef: MutableRefObject<HTMLButtonElement | null>
  onAiAutoCommit: () => void
  onAiAutoCommitContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void
}

type GitChangedFile = DetailGitSnapshot['changedFiles'][number]
type GitHistoryCommit = DetailGitSnapshot['recentCommits'][number]
type AiStepStatus = AiFlowNode['data']['status']

type OperationCardState = {
  disabled: boolean
  hint: string
}

type BranchOperationStateParams = {
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

type OperationConfirmState = {
  operation: PanelGitOperationKind
  message: string
  riskLevel?: 'normal' | 'high'
  requireExactMatch?: string
} | null

type BranchManagerMode = 'current' | 'upstream'

type MiddlePanelMode = 'history' | 'ai-log' | 'git-log'
type CopyStatus = 'idle' | 'success' | 'error'
type CommitHistoryDisplayItem = GitHistoryCommit & {
  withinRecentBatch: boolean
  isLocalHead: boolean
  isUpstreamHead: boolean
  relationLabel: string
}
type IndexedBranchCandidate = {
  name: string
  searchText: string
}
type PanelGitOperationKind = (typeof GIT_OPERATION_ITEMS)[number]['key']

const BRANCH_SEARCH_DEBOUNCE_MS = 140

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
  return GIT_OPERATION_LABELS[operation] ?? operation
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

function buildCommitHistoryDisplayItems(
  commits: GitHistoryCommit[],
  options: {
    localHead?: string
    upstreamHead?: string
    hasUpstream: boolean
    upstreamGone: boolean
    branchAhead: number
    branchBehind: number
  }
): CommitHistoryDisplayItem[] {
  const COMMIT_BATCH_WINDOW_MS = 15_000
  const commitTimes = commits.map((commit) => new Date(commit.committedAt).getTime())
  const localHeadLower = options.localHead?.toLowerCase()
  const upstreamHeadLower = options.upstreamHead?.toLowerCase()
  const relationLabel = !options.hasUpstream
    ? 'NO UPSTREAM'
    : options.upstreamGone
      ? 'UPSTREAM GONE'
      : options.branchAhead === 0 && options.branchBehind === 0
        ? 'SYNCED'
        : options.branchAhead > 0 && options.branchBehind > 0
          ? `AHEAD ${options.branchAhead} / BEHIND ${options.branchBehind}`
          : options.branchAhead > 0
            ? `AHEAD ${options.branchAhead}`
            : options.branchBehind > 0
              ? `BEHIND ${options.branchBehind}`
              : 'UNKNOWN'

  return commits.map((commit, index) => {
    const currentTime = commitTimes[index]
    const commitHashLower = commit.hash.toLowerCase()
    const isLocalHead = Boolean(localHeadLower && commitHashLower === localHeadLower)
    const isUpstreamHead = Boolean(upstreamHeadLower && commitHashLower === upstreamHeadLower)
    if (!Number.isFinite(currentTime)) {
      return {
        ...commit,
        withinRecentBatch: false,
        isLocalHead,
        isUpstreamHead,
        relationLabel,
      }
    }

    const prevTime = index > 0 ? commitTimes[index - 1] : Number.NaN
    const nextTime = index < commits.length - 1 ? commitTimes[index + 1] : Number.NaN
    const nearPrev = Number.isFinite(prevTime) && Math.abs(prevTime - currentTime) <= COMMIT_BATCH_WINDOW_MS
    const nearNext = Number.isFinite(nextTime) && Math.abs(nextTime - currentTime) <= COMMIT_BATCH_WINDOW_MS
    const withinRecentBatch = nearPrev || nearNext

    return {
      ...commit,
      withinRecentBatch,
      isLocalHead,
      isUpstreamHead,
      relationLabel,
    }
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
  const showRelationBadge = commit.isLocalHead || commit.isUpstreamHead

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
          {showRelationBadge && (
            <>
              {commit.isLocalHead && (
                <span className="rounded-full border border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary)]/12 px-2 py-0.5 text-[color:var(--color-primary)]">
                  LOCAL HEAD
                </span>
              )}
              {commit.isUpstreamHead && (
                <span className="rounded-full border border-[color:var(--color-success)]/45 bg-[color:var(--color-success-background)] px-2 py-0.5 text-[color:var(--color-success)]">
                  UPSTREAM
                </span>
              )}
              <span className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)] px-2 py-0.5 text-[color:var(--color-foreground)]/80">
                {commit.relationLabel}
              </span>
            </>
          )}
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
  projectHeaderCollapsed = false,
  projectName,
  projectLinkItems = [],
  activePane = 'aicommit',
  onSwitchPane,
  onOpenProjectLinksManager,
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
  aiCommitStatus,
  isAiEnabled,
  aiAutoCommitButtonRef,
  onAiAutoCommit,
  onAiAutoCommitContextMenu,
}: DetailAiCommitPanelProps) {
  const firstProjectLinkItem = projectLinkItems[0]
  const [middlePanelMode, setMiddlePanelMode] = useState<MiddlePanelMode>('history')
  const [runningOperation, setRunningOperation] = useState<PanelGitOperationKind | null>(null)
  const [mergeTarget, setMergeTarget] = useState('')
  const [mergeDropdownOpen, setMergeDropdownOpen] = useState(false)
  const [createRemoteRemoteName, setCreateRemoteRemoteName] = useState('origin')
  const [operationConfirmInput, setOperationConfirmInput] = useState('')
  const [mergeSearchDraft, setMergeSearchDraft] = useState('')
  const [mergeSearchQuery, setMergeSearchQuery] = useState('')
  const [operationConfirm, setOperationConfirm] = useState<OperationConfirmState>(null)
  const [operationLogs, setOperationLogs] = useState<GitOperationResult[]>([])
  const [branchManagerMode, setBranchManagerMode] = useState<BranchManagerMode | null>(null)
  const [gitGuideOpen, setGitGuideOpen] = useState(false)
  const [currentManagerInput, setCurrentManagerInput] = useState('')
  const [currentManagerDeleteTarget, setCurrentManagerDeleteTarget] = useState('')
  const [upstreamManagerRemoteName, setUpstreamManagerRemoteName] = useState('origin')
  const [upstreamManagerBranchName, setUpstreamManagerBranchName] = useState('')
  const [upstreamManagerDangerInput, setUpstreamManagerDangerInput] = useState('')
  const [branchManagerLoading, setBranchManagerLoading] = useState(false)
  const [branchManagerError, setBranchManagerError] = useState<string | null>(null)
  const [stagingFilePath, setStagingFilePath] = useState<string | null>(null)
  const [fileActionError, setFileActionError] = useState<string | null>(null)
  const [diffDrawerOpen, setDiffDrawerOpen] = useState(false)
  const [activeDiffFilePath, setActiveDiffFilePath] = useState<string | null>(null)
  const [diffViewMode, setDiffViewMode] = useState<GitDiffViewMode>('unstaged')
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffContent, setDiffContent] = useState('')
  const [diffError, setDiffError] = useState<string | null>(null)
  const [diffTruncated, setDiffTruncated] = useState(false)
  const [conflictLoading, setConflictLoading] = useState(false)
  const [conflictData, setConflictData] = useState<GitConflictFileResult | null>(null)
  const [conflictError, setConflictError] = useState<string | null>(null)
  const [conflictSaving, setConflictSaving] = useState(false)
  const mergeDropdownRef = useRef<HTMLDivElement | null>(null)
  const mergeSearchInputRef = useRef<HTMLInputElement | null>(null)
  const currentBranchInputRef = useRef<HTMLInputElement | null>(null)
  const upstreamBranchInputRef = useRef<HTMLInputElement | null>(null)
  const diffRequestSeqRef = useRef(0)
  const conflictRequestSeqRef = useRef(0)

  const branch = gitSnapshot?.branch
  const changedFiles = gitSnapshot?.changedFiles ?? []
  const changedFilesMap = useMemo(() => {
    const map = new Map<string, GitChangedFile>()
    for (const item of changedFiles) map.set(item.path, item)
    return map
  }, [changedFiles])
  const recentCommits = gitSnapshot?.recentCommits ?? []
  const commitHistoryItems = useMemo(
    () => buildCommitHistoryDisplayItems(recentCommits, {
      localHead: branch?.oid,
      upstreamHead: branch?.upstreamOid,
      hasUpstream: Boolean(branch?.upstream),
      upstreamGone: branch?.upstreamGone ?? false,
      branchAhead: branch?.ahead ?? 0,
      branchBehind: branch?.behind ?? 0,
    }),
    [recentCommits, branch?.oid, branch?.upstreamOid, branch?.upstream, branch?.upstreamGone, branch?.ahead, branch?.behind]
  )
  const currentBranch = branch?.current || 'No branch'
  const upstreamBranch = branch?.upstream || 'No upstream'
  const remoteBranches = branch?.remoteBranches ?? []
  const localBranches = branch?.localBranches ?? []
  const stagedCount = changedFiles.filter((file) => file.staged).length
  const unstagedCount = changedFiles.filter((file) => file.unstaged).length
  const untrackedCount = changedFiles.filter((file) => file.scope === 'untracked').length
  const conflictedCount = changedFiles.filter((file) => file.scope === 'conflicted').length
  const hasWorkingTreeChanges = changedFiles.length > 0
  const hasConflicts = conflictedCount > 0
  const showWorkingTreeLoading = gitSnapshotLoading
  const showBranchRemoteLoading = gitSnapshotLoading || runningOperation === 'switch'
  const showCommitHistoryLoading = gitSnapshotLoading
  const branchAhead = branch?.ahead ?? 0
  const branchBehind = branch?.behind ?? 0
  const hasUpstream = Boolean(branch?.upstream)
  const upstreamGone = branch?.upstreamGone ?? false
  const activeDiffFile = activeDiffFilePath ? changedFilesMap.get(activeDiffFilePath) ?? null : null
  const activeDiffSupportsUnstaged = Boolean(activeDiffFile && (activeDiffFile.unstaged || activeDiffFile.scope === 'untracked'))
  const activeDiffSupportsStaged = Boolean(activeDiffFile?.staged)

  const localMergeCandidates = useMemo<IndexedBranchCandidate[]>(
    () =>
      localBranches
        .filter((name) => name !== currentBranch)
        .map((name) => ({
          name,
          searchText: name.toLowerCase(),
        })),
    [localBranches, currentBranch]
  )

  const remoteMergeCandidates = useMemo<IndexedBranchCandidate[]>(
    () =>
      remoteBranches
        .filter((name) => name !== currentBranch)
        .map((name) => ({
          name,
          searchText: name.toLowerCase(),
        })),
    [remoteBranches, currentBranch]
  )

  const filteredLocalMergeCandidates = useMemo(() => {
    if (!mergeSearchQuery) return localMergeCandidates
    return localMergeCandidates.filter((candidate) => candidate.searchText.includes(mergeSearchQuery))
  }, [localMergeCandidates, mergeSearchQuery])

  const filteredRemoteMergeCandidates = useMemo(() => {
    if (!mergeSearchQuery) return remoteMergeCandidates
    return remoteMergeCandidates.filter((candidate) => candidate.searchText.includes(mergeSearchQuery))
  }, [remoteMergeCandidates, mergeSearchQuery])

  const mergeSearchResultCount = filteredLocalMergeCandidates.length + filteredRemoteMergeCandidates.length
  const branchManagerDangerText = `${(upstreamManagerRemoteName.trim() || 'origin')}/${upstreamManagerBranchName.trim()}`
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
  const conflictSavingRef = useRef(conflictSaving)

  useEffect(() => {
    conflictSavingRef.current = conflictSaving
  }, [conflictSaving])

  useEffect(() => {
    if (jumpToAiLogToken <= 0) return
    setMiddlePanelMode('ai-log')
  }, [jumpToAiLogToken])

  useEffect(() => {
    if (!mergeDropdownOpen) return
    const frame = window.requestAnimationFrame(() => {
      mergeSearchInputRef.current?.focus()
    })
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
      window.cancelAnimationFrame(frame)
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [mergeDropdownOpen])

  useEffect(() => {
    const normalizedDraft = mergeSearchDraft.trim().toLowerCase()
    if (!normalizedDraft) {
      if (mergeSearchQuery) setMergeSearchQuery('')
      return
    }
    if (normalizedDraft === mergeSearchQuery) return

    const timer = window.setTimeout(() => {
      setMergeSearchQuery(normalizedDraft)
    }, BRANCH_SEARCH_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [mergeSearchDraft, mergeSearchQuery])

  useEffect(() => {
    if (mergeDropdownOpen) return
    if (!mergeSearchDraft && !mergeSearchQuery) return
    setMergeSearchDraft('')
    setMergeSearchQuery('')
  }, [mergeDropdownOpen, mergeSearchDraft, mergeSearchQuery])

  useEffect(() => {
    if (!operationConfirm) return
    setOperationConfirmInput('')
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOperationConfirm(null)
    }
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [operationConfirm])

  useEffect(() => {
    if (!branchManagerMode) return
    setBranchManagerError(null)
    if (branchManagerMode === 'current') {
      setCurrentManagerDeleteTarget('')
      setCurrentManagerInput('')
      return
    }
    const upstream = branch?.upstream || ''
    const match = upstream.match(/^([^/]+)\/(.+)$/)
    if (match) {
      setUpstreamManagerRemoteName(match[1])
      setUpstreamManagerBranchName(match[2])
    } else {
      setUpstreamManagerRemoteName('origin')
      setUpstreamManagerBranchName('')
    }
    setUpstreamManagerDangerInput('')
  }, [branchManagerMode, branch?.upstream])

  useEffect(() => {
    if (!branchManagerMode) return
    const targetRef = branchManagerMode === 'current' ? currentBranchInputRef : upstreamBranchInputRef
    const frame = window.requestAnimationFrame(() => {
      targetRef.current?.focus()
    })
    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [branchManagerMode])

  useEffect(() => {
    if (!diffDrawerOpen) return
    if (activeDiffFilePath && changedFilesMap.has(activeDiffFilePath)) return
    if (changedFiles.length <= 0) {
      setDiffDrawerOpen(false)
      setActiveDiffFilePath(null)
      setDiffContent('')
      setDiffError(null)
      setDiffTruncated(false)
      setConflictData(null)
      setConflictError(null)
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
    if (activeDiffFile.scope === 'conflicted') return
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
    if (file.scope === 'conflicted') return
    if (file.scope === 'untracked' && diffViewMode === 'unstaged') return
    if (file.kind === 'deleted') return
    setDiffContent('(no diff output)')
  }, [diffLoading, diffError, diffContent, activeDiffFilePath, changedFilesMap, diffViewMode])

  useEffect(() => {
    if (!diffDrawerOpen) return
    if (!activeDiffFilePath || !activeDiffFile) return
    if (activeDiffFile.scope !== 'conflicted') return
    void loadConflict(activeDiffFilePath)
  }, [diffDrawerOpen, activeDiffFilePath, activeDiffFile, gitSnapshot?.checkedAt])

  const operationStates = useMemo<Record<PanelGitOperationKind, OperationCardState>>(() => {
    return {
      fetch: computeOperationState('fetch', {
        hasConflicts,
        hasWorkingTreeChanges,
        branchAhead,
        branchBehind,
        hasUpstream,
        upstreamGone,
        mergeTarget,
        currentBranch,
        localBranches,
        remoteBranches,
        runningOperation,
      }),
      pull: computeOperationState('pull', {
        hasConflicts,
        hasWorkingTreeChanges,
        branchAhead,
        branchBehind,
        hasUpstream,
        upstreamGone,
        mergeTarget,
        currentBranch,
        localBranches,
        remoteBranches,
        runningOperation,
      }),
      push: computeOperationState('push', {
        hasConflicts,
        hasWorkingTreeChanges,
        branchAhead,
        branchBehind,
        hasUpstream,
        upstreamGone,
        mergeTarget,
        currentBranch,
        localBranches,
        remoteBranches,
        runningOperation,
      }),
      switch: computeOperationState('switch', {
        hasConflicts,
        hasWorkingTreeChanges,
        branchAhead,
        branchBehind,
        hasUpstream,
        upstreamGone,
        mergeTarget,
        currentBranch,
        localBranches,
        remoteBranches,
        runningOperation,
      }),
      merge: computeOperationState('merge', {
        hasConflicts,
        hasWorkingTreeChanges,
        branchAhead,
        branchBehind,
        hasUpstream,
        upstreamGone,
        mergeTarget,
        currentBranch,
        localBranches,
        remoteBranches,
        runningOperation,
      }),
    }
  }, [
    hasConflicts,
    hasWorkingTreeChanges,
    branchAhead,
    branchBehind,
    hasUpstream,
    upstreamGone,
    mergeTarget,
    currentBranch,
    localBranches,
    remoteBranches,
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
    } catch (error) {
      setFileActionError(error instanceof Error ? error.message : String(error))
    } finally {
      await onRefreshGitSnapshot()
      setStagingFilePath(null)
    }
  }

  const loadDiff = useCallback(async (filePath: string, staged: boolean) => {
    if (!gitSnapshot) return
    const requestSeq = diffRequestSeqRef.current + 1
    diffRequestSeqRef.current = requestSeq
    setDiffLoading(true)
    setDiffError(null)
    setDiffTruncated(false)
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
      setDiffTruncated(Boolean(result.outputLimit))
      setDiffContent(result.output)
    } catch (error) {
      if (requestSeq !== diffRequestSeqRef.current) return
      setDiffContent('')
      setDiffError(error instanceof Error ? error.message : String(error))
      setDiffTruncated(false)
    } finally {
      if (requestSeq === diffRequestSeqRef.current) setDiffLoading(false)
    }
  }, [gitSnapshot])

  const loadConflict = useCallback(async (filePath: string) => {
    if (!gitSnapshot) return
    const requestSeq = conflictRequestSeqRef.current + 1
    conflictRequestSeqRef.current = requestSeq
    setConflictLoading(true)
    setConflictError(null)
    try {
      const result: GitConflictFileResult = await window.electronAPI.getGitConflictFile({
        projectPath: gitSnapshot.projectPath,
        filePath,
      })
      if (requestSeq !== conflictRequestSeqRef.current) return
      if (!result.ok) {
        setConflictData(null)
        setConflictError(result.error || result.output || '读取冲突详情失败')
        return
      }
      setConflictData(result)
    } catch (error) {
      if (requestSeq !== conflictRequestSeqRef.current) return
      setConflictData(null)
      setConflictError(error instanceof Error ? error.message : String(error))
    } finally {
      if (requestSeq === conflictRequestSeqRef.current) setConflictLoading(false)
    }
  }, [gitSnapshot])

  const saveConflict = useCallback(async (payload: { filePath: string; content: string; markResolved: boolean }) => {
    if (!gitSnapshot) return
    if (conflictSavingRef.current) return
    setConflictSaving(true)
    setConflictError(null)
    setFileActionError(null)
    try {
      const result: GitResolveConflictResult = await window.electronAPI.resolveGitConflictFile({
        projectPath: gitSnapshot.projectPath,
        filePath: payload.filePath,
        content: payload.content,
        markResolved: payload.markResolved,
      })
      if (!result.ok) {
        const msg = result.error || result.output || '保存冲突内容失败'
        setConflictError(msg)
        setFileActionError(msg)
        return
      }
      if (!payload.markResolved) {
        await loadConflict(payload.filePath)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setConflictError(message)
      setFileActionError(message)
    } finally {
      await onRefreshGitSnapshot()
      setConflictSaving(false)
    }
  }, [gitSnapshot, loadConflict, onRefreshGitSnapshot])

  const openDiffDrawerForFile = useCallback((filePath: string) => {
    const target = changedFilesMap.get(filePath)
    if (!target) return
    setFileActionError(null)
    setConflictError(null)
    setDiffDrawerOpen(true)
    setActiveDiffFilePath(filePath)
    const initialMode = pickDefaultDiffViewMode(target)
    setDiffViewMode(initialMode)
    if (target.scope !== 'conflicted') {
      setConflictData(null)
      return
    }
    void loadConflict(filePath)
  }, [changedFilesMap, loadConflict])

  const requestGitOperation = (operation: PanelGitOperationKind) => {
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

    setOperationConfirm({
      operation,
      message,
      riskLevel: operation === 'switch' ? 'high' : 'normal',
      requireExactMatch: operation === 'switch' ? mergeTarget : undefined,
    })
  }

  const runGitOperation = async (operation: PanelGitOperationKind) => {
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
      await onRefreshGitSnapshot()
      setRunningOperation(null)
    }
  }

  const runBranchManagerOperation = useCallback(async (request: {
    operation: GitOperationKind
    targetBranch?: string
    remoteName?: string
  }): Promise<GitOperationResult> => {
    if (!gitSnapshot) {
      return {
        operation: request.operation,
        ok: false,
        checkedAt: Date.now(),
        command: '',
        output: 'Git snapshot is unavailable.',
        exitCode: null,
        error: 'Git snapshot is unavailable.',
      }
    }
    return window.electronAPI.runGitOperation({
      projectPath: gitSnapshot.projectPath,
      operation: request.operation,
      targetBranch: request.targetBranch,
      remoteName: request.remoteName,
    })
  }, [gitSnapshot])

  const handleCreateLocalBranch = useCallback(async () => {
    const branchName = currentManagerInput.trim()
    if (!branchName || branchManagerLoading) return
    setBranchManagerLoading(true)
    setBranchManagerError(null)
    try {
      const result = await runBranchManagerOperation({
        operation: 'create-local-branch',
        targetBranch: branchName,
      })
      setOperationLogs((prev) => [result, ...prev].slice(0, 50))
      if (!result.ok) {
        setBranchManagerError(result.error || result.output || '本地分支创建失败')
        return
      }
      setCurrentManagerInput('')
    } catch (error) {
      setBranchManagerError(error instanceof Error ? error.message : String(error))
    } finally {
      await onRefreshGitSnapshot()
      setBranchManagerLoading(false)
    }
  }, [branchManagerLoading, currentManagerInput, onRefreshGitSnapshot, runBranchManagerOperation])

  const handleDeleteLocalBranch = useCallback(async () => {
    const branchName = currentManagerDeleteTarget.trim()
    if (!branchName || branchManagerLoading) return
    setBranchManagerLoading(true)
    setBranchManagerError(null)
    try {
      const result = await runBranchManagerOperation({
        operation: 'delete-local-branch',
        targetBranch: branchName,
      })
      setOperationLogs((prev) => [result, ...prev].slice(0, 50))
      if (!result.ok) {
        setBranchManagerError(result.error || result.output || '本地分支删除失败')
        return
      }
      setCurrentManagerDeleteTarget('')
    } catch (error) {
      setBranchManagerError(error instanceof Error ? error.message : String(error))
    } finally {
      await onRefreshGitSnapshot()
      setBranchManagerLoading(false)
    }
  }, [branchManagerLoading, currentManagerDeleteTarget, onRefreshGitSnapshot, runBranchManagerOperation])

  const handleSetUpstream = useCallback(async () => {
    const remoteName = upstreamManagerRemoteName.trim() || 'origin'
    const branchName = upstreamManagerBranchName.trim()
    if (!branchName || branchManagerLoading) return
    if (upstreamManagerDangerInput.trim() !== branchManagerDangerText) return
    setBranchManagerLoading(true)
    setBranchManagerError(null)
    try {
      const result = await runBranchManagerOperation({
        operation: 'set-upstream',
        targetBranch: branchName,
        remoteName,
      })
      setOperationLogs((prev) => [result, ...prev].slice(0, 50))
      if (!result.ok) {
        setBranchManagerError(result.error || result.output || 'upstream 绑定失败')
        return
      }
      setUpstreamManagerDangerInput('')
      setBranchManagerMode(null)
    } catch (error) {
      setBranchManagerError(error instanceof Error ? error.message : String(error))
    } finally {
      await onRefreshGitSnapshot()
      setBranchManagerLoading(false)
    }
  }, [
    branchManagerDangerText,
    branchManagerLoading,
    onRefreshGitSnapshot,
    runBranchManagerOperation,
    upstreamManagerBranchName,
    upstreamManagerDangerInput,
    upstreamManagerRemoteName,
  ])

  const handleCreateRemoteBranchFromUpstream = useCallback(async () => {
    const remoteName = upstreamManagerRemoteName.trim() || 'origin'
    const branchName = upstreamManagerBranchName.trim()
    if (!branchName || branchManagerLoading) return
    if (upstreamManagerDangerInput.trim() !== branchManagerDangerText) return
    setBranchManagerLoading(true)
    setBranchManagerError(null)
    try {
      const result = await runBranchManagerOperation({
        operation: 'create-remote-branch',
        targetBranch: branchName,
        remoteName,
      })
      setOperationLogs((prev) => [result, ...prev].slice(0, 50))
      if (!result.ok) {
        setBranchManagerError(result.error || result.output || '远程分支创建失败')
        return
      }
      setCreateRemoteRemoteName(remoteName)
      setUpstreamManagerDangerInput('')
      setBranchManagerMode(null)
    } catch (error) {
      setBranchManagerError(error instanceof Error ? error.message : String(error))
    } finally {
      await onRefreshGitSnapshot()
      setBranchManagerLoading(false)
    }
  }, [
    branchManagerDangerText,
    branchManagerLoading,
    onRefreshGitSnapshot,
    runBranchManagerOperation,
    upstreamManagerBranchName,
    upstreamManagerDangerInput,
    upstreamManagerRemoteName,
  ])

  const pendingOperationLabel = operationConfirm
    ? GIT_OPERATION_ITEMS.find((item) => item.key === operationConfirm.operation)?.label ?? 'Git'
    : 'Git'
  const pendingOperation = operationConfirm?.operation ?? null
  const pendingOperationMessage = operationConfirm?.message ?? ''
  const confirmExactMatch = operationConfirm?.requireExactMatch ?? ''
  const confirmNeedsTypedMatch = Boolean(confirmExactMatch)
  const confirmTypedMatchPassed = !confirmNeedsTypedMatch || operationConfirmInput.trim() === confirmExactMatch
  const handleDiffDrawerClose = useCallback(() => {
    setDiffDrawerOpen(false)
  }, [])
  const handleDiffDrawerSelectFile = useCallback((filePath: string) => {
    const file = changedFilesMap.get(filePath)
    if (!file) return
    setActiveDiffFilePath(filePath)
    const mode = pickDefaultDiffViewMode(file)
    setDiffViewMode(mode)
    if (file.scope === 'conflicted') {
      void loadConflict(filePath)
    } else {
      setConflictData(null)
      setConflictError(null)
    }
  }, [changedFilesMap, loadConflict])
  const handleDiffViewModeChange = useCallback((mode: GitDiffViewMode) => {
    if (mode === diffViewMode) return
    setDiffViewMode(mode)
  }, [diffViewMode])
  const handleLoadConflict = useCallback((filePath: string) => {
    void loadConflict(filePath)
  }, [loadConflict])
  const handleSaveConflict = useCallback((payload: { filePath: string; content: string; markResolved: boolean }) => {
    void saveConflict(payload)
  }, [saveConflict])

  return (
    <>
      <div className="relative flex h-full min-h-0 min-w-0 flex-col">
        <div className="flex h-full min-h-0 flex-col gap-4">
          <div className="shrink-0 space-y-3">
            <section className="min-h-[52px] rounded-[20px] border border-[color:var(--color-border)] bg-[color:var(--color-card)]/62 px-4 py-2">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {projectHeaderCollapsed && (
                      <p className="max-w-[320px] truncate text-sm font-medium text-[color:var(--color-foreground)]" title={projectName || '当前项目'}>
                        {projectName || '当前项目'}
                      </p>
                    )}
                    {projectHeaderCollapsed && (
                      <div className="quiet-control flex items-center gap-1 rounded-full border border-[color:var(--color-border)] p-1">
                        <button
                          type="button"
                          className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                            activePane === 'code'
                              ? 'bg-primary text-white'
                              : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
                          }`}
                          onClick={() => onSwitchPane?.('code')}
                        >
                          <Code2 className="h-3.5 w-3.5" />
                          Code
                        </button>
                        <button
                          type="button"
                          className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                            activePane === 'aicommit'
                              ? 'bg-primary text-white'
                              : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
                          }`}
                          onClick={() => onSwitchPane?.('aicommit')}
                        >
                          <Bot className="h-3.5 w-3.5" />
                          AI Commit
                        </button>
                      </div>
                    )}
                    {projectHeaderCollapsed && firstProjectLinkItem && (
                      <UrlPopover items={projectLinkItems}>
                        <button
                          type="button"
                          className="quiet-control inline-flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                          onClick={() => window.electronAPI.openExternal(firstProjectLinkItem.url)}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            onOpenProjectLinksManager?.()
                          }}
                          title="左键打开首个链接，右键打开资料管理"
                        >
                          <BookOpen className="h-3.5 w-3.5 shrink-0" />
                        </button>
                      </UrlPopover>
                    )}
                  </div>
                </div>
                <div className="shrink-0">
                  <button
                    ref={aiAutoCommitButtonRef}
                    type="button"
                    className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-all ${aiCommitStatus === 'running'
                      ? 'bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)]'
                      : aiCommitStatus === 'error'
                        ? 'text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-background)]'
                        : 'border-[color:var(--color-border)] text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]'
                      }`}
                    style={
                      aiCommitStatus === 'running'
                        ? { borderColor: 'color-mix(in srgb, var(--color-warning) 34%, transparent)' }
                        : aiCommitStatus === 'error'
                          ? { borderColor: 'color-mix(in srgb, var(--color-destructive) 34%, transparent)' }
                          : undefined
                    }
                    onClick={() => {
                      onAiAutoCommit()
                    }}
                    onContextMenu={onAiAutoCommitContextMenu}
                    disabled={aiCommitStatus === 'running'}
                    title={isAiEnabled ? 'Left click: run commit. Right click: quick config.' : 'AI disabled in Settings, local commit message only'}
                  >
                    <Bot className="h-3.5 w-3.5" />
                    {aiCommitStatus === 'running' ? 'AI Committing...' : 'AI Auto Commit'}
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-[20px] border border-[color:var(--color-border)] bg-[color:var(--color-card)]/62 p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <p className="section-label">AI Commit</p>
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] ${statusClass}`}>
                  {statusText}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
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
            </section>
          </div>

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
                {showWorkingTreeLoading ? (
                  <>
                    <div className="git-panel-skeleton h-5 w-8 rounded-md" />
                    <div className="git-panel-skeleton mt-1.5 h-3 w-9 rounded-md" />
                  </>
                ) : (
                  <>
                    <p className="font-mono text-sm font-semibold text-[color:var(--color-foreground)]">{formatGitBadgeCount(changedFiles.length)}</p>
                    <p className="text-[10.5px] text-[color:var(--color-muted-foreground)]">全部</p>
                  </>
                )}
              </div>
              <div className="rounded-[13px] bg-[color:var(--color-success-background)] px-2.5 py-2">
                {showWorkingTreeLoading ? (
                  <>
                    <div className="git-panel-skeleton h-5 w-8 rounded-md" />
                    <div className="git-panel-skeleton mt-1.5 h-3 w-11 rounded-md" />
                  </>
                ) : (
                  <>
                    <p className="font-mono text-sm font-semibold text-[color:var(--color-success)]">{formatGitBadgeCount(stagedCount)}</p>
                    <p className="text-[10.5px] text-[color:var(--color-success)]/80">已暂存</p>
                  </>
                )}
              </div>
              <div className="rounded-[13px] bg-[color:var(--color-warning-background)] px-2.5 py-2">
                {showWorkingTreeLoading ? (
                  <>
                    <div className="git-panel-skeleton h-5 w-8 rounded-md" />
                    <div className="git-panel-skeleton mt-1.5 h-3 w-11 rounded-md" />
                  </>
                ) : (
                  <>
                    <p className="font-mono text-sm font-semibold text-[color:var(--color-warning)]">{formatGitBadgeCount(unstagedCount)}</p>
                    <p className="text-[10.5px] text-[color:var(--color-warning)]/80">未暂存</p>
                  </>
                )}
              </div>
              <div className="rounded-[13px] bg-[color:var(--color-background-sunken)]/60 px-2.5 py-2">
                {showWorkingTreeLoading ? (
                  <>
                    <div className="git-panel-skeleton h-5 w-8 rounded-md" />
                    <div className="git-panel-skeleton mt-1.5 h-3 w-11 rounded-md" />
                  </>
                ) : (
                  <>
                    <p className="font-mono text-sm font-semibold text-[color:var(--color-foreground)]">{formatGitBadgeCount(untrackedCount)}</p>
                    <p className="text-[10.5px] text-[color:var(--color-muted-foreground)]">未跟踪</p>
                  </>
                )}
              </div>
            </div>

            {!showWorkingTreeLoading && conflictedCount > 0 && (
              <div className="mb-3 rounded-[13px] border border-[color:var(--color-destructive)]/25 bg-[color:var(--color-destructive-background)] px-3 py-2 text-xs text-[color:var(--color-destructive)]">
                当前有 {conflictedCount} 个冲突文件，建议先解决后再提交。
              </div>
            )}

            {fileActionError && (
              <div className="mb-3 rounded-[13px] border border-[color:var(--color-destructive)]/25 bg-[color:var(--color-destructive-background)] px-3 py-2 text-xs text-[color:var(--color-destructive)]">
                {fileActionError}
              </div>
            )}

            {showWorkingTreeLoading ? (
              <div className="git-panel-loading-surface flex min-h-0 flex-1 flex-col gap-2 rounded-[16px] border border-[color:var(--color-border)] bg-[color:var(--color-background)]/45 px-3 py-3">
                <div className="git-panel-skeleton h-4 w-24 rounded-md" />
                <div className="git-panel-skeleton h-[68px] w-full rounded-[12px]" />
                <div className="git-panel-skeleton h-[68px] w-full rounded-[12px]" />
                <div className="git-panel-skeleton h-[68px] w-[86%] rounded-[12px]" />
              </div>
            ) : changedFiles.length > 0 ? (
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
                {showCommitHistoryLoading ? (
                  <div className="git-panel-loading-surface min-h-0 flex-1 space-y-2 overflow-hidden pr-1">
                    <div className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-3 py-2.5">
                      <div className="git-panel-skeleton h-4 w-[76%] rounded-md" />
                      <div className="mt-2 flex items-center gap-2">
                        <div className="git-panel-skeleton h-5 w-20 rounded-full" />
                        <div className="git-panel-skeleton h-5 w-14 rounded-full" />
                        <div className="git-panel-skeleton h-4 w-24 rounded-md" />
                      </div>
                    </div>
                    <div className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-3 py-2.5">
                      <div className="git-panel-skeleton h-4 w-[62%] rounded-md" />
                      <div className="mt-2 flex items-center gap-2">
                        <div className="git-panel-skeleton h-5 w-20 rounded-full" />
                        <div className="git-panel-skeleton h-5 w-14 rounded-full" />
                        <div className="git-panel-skeleton h-4 w-24 rounded-md" />
                      </div>
                    </div>
                    <div className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-3 py-2.5">
                      <div className="git-panel-skeleton h-4 w-[70%] rounded-md" />
                      <div className="mt-2 flex items-center gap-2">
                        <div className="git-panel-skeleton h-5 w-20 rounded-full" />
                        <div className="git-panel-skeleton h-5 w-14 rounded-full" />
                        <div className="git-panel-skeleton h-4 w-24 rounded-md" />
                      </div>
                    </div>
                  </div>
                ) : recentCommits.length > 0 ? (
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
            {showBranchRemoteLoading ? (
              <div className="git-panel-loading-surface">
                <div className="mb-3 flex items-center justify-between">
                  <div className="inline-flex min-w-0 items-center gap-2">
                    <div className="git-panel-skeleton h-9 w-9 rounded-full" />
                    <div className="min-w-0">
                      <div className="git-panel-skeleton h-5 w-24 rounded-md" />
                      <div className="git-panel-skeleton mt-1.5 h-3.5 w-52 rounded-md" />
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <div className="git-panel-skeleton h-6 w-12 rounded-full" />
                    <div className="git-panel-skeleton h-6 w-12 rounded-full" />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/62 px-3 py-2">
                    <div className="git-panel-skeleton h-3 w-16 rounded-md" />
                    <div className="git-panel-skeleton mt-2 h-4 w-28 rounded-md" />
                  </div>
                  <div className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/62 px-3 py-2">
                    <div className="git-panel-skeleton h-3 w-16 rounded-md" />
                    <div className="git-panel-skeleton mt-2 h-4 w-32 rounded-md" />
                  </div>
                </div>
                <div className="mt-3">
                  <div className="git-panel-skeleton h-3 w-24 rounded-md" />
                  <div className="git-panel-skeleton mt-1.5 h-10 w-full rounded-[14px]" />
                  <div className="git-panel-skeleton mt-1.5 h-3 w-36 rounded-md" />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="git-panel-skeleton h-[62px] rounded-[14px]" />
                  <div className="git-panel-skeleton h-[62px] rounded-[14px]" />
                  <div className="git-panel-skeleton h-[62px] rounded-[14px]" />
                  <div className="git-panel-skeleton h-[62px] rounded-[14px]" />
                  <div className="git-panel-skeleton h-[62px] rounded-[14px]" />
                </div>
              </div>
            ) : (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <div className="inline-flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)] transition-colors hover:bg-[color:var(--color-primary)]/18"
                      onClick={() => setGitGuideOpen(true)}
                      title="打开 Git 操作指南"
                    >
                      <GitBranch className="h-4.5 w-4.5" />
                    </button>
                    <div className="min-w-0">
                      <p className="text-base font-semibold tracking-[-0.02em] text-[color:var(--color-foreground)]">分支与远程</p>
                      <p className="text-xs text-[color:var(--color-muted-foreground)]">状态摘要与常用远程操作（点左侧图标看指南）</p>
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
                  <button
                    type="button"
                    className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/62 px-3 py-2 text-left transition-colors hover:border-[color:var(--color-border-hover)] hover:bg-[color:var(--color-background-sunken)]"
                    onClick={() => setBranchManagerMode('current')}
                    title="管理本地分支（新增/删除）"
                  >
                    <p className="text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">Current</p>
                    <p className="mt-1 truncate font-mono text-[12px] text-[color:var(--color-foreground)]" title={currentBranch}>{currentBranch}</p>
                  </button>
                  <button
                    type="button"
                    className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/62 px-3 py-2 text-left transition-colors hover:border-[color:var(--color-border-hover)] hover:bg-[color:var(--color-background-sunken)]"
                    onClick={() => setBranchManagerMode('upstream')}
                    title="管理 upstream（仅新增绑定，高危）"
                  >
                    <p className="text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">Upstream</p>
                    <p className="mt-1 truncate font-mono text-[12px] text-[color:var(--color-foreground)]" title={upstreamBranch}>{upstreamBranch}</p>
                  </button>
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
                            <div className="sticky top-0 z-10 px-1 pb-2 pt-1">
                              <div className="surface-card rounded-[10px] border border-[color:var(--color-border)] px-2">
                                <input
                                  ref={mergeSearchInputRef}
                                  type="text"
                                  value={mergeSearchDraft}
                                  onChange={(event) => setMergeSearchDraft(event.target.value)}
                                  placeholder="搜索分支..."
                                  className="h-8 w-full bg-transparent text-[11.5px] text-[color:var(--color-foreground)] outline-none placeholder:text-[color:var(--color-muted-foreground)]"
                                  spellCheck={false}
                                />
                              </div>
                            </div>
                            {filteredLocalMergeCandidates.length > 0 && (
                              <div className="mb-1">
                                <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">
                                  本地分支
                                </p>
                                {filteredLocalMergeCandidates.map((candidate) => {
                                  const active = mergeTarget === candidate.name
                                  return (
                                    <button
                                      key={`local-${candidate.name}`}
                                      type="button"
                                      className={`flex w-full items-center justify-between rounded-[10px] px-2.5 py-1.5 text-left text-[11.5px] transition-colors ${
                                        active
                                          ? 'bg-[color:var(--color-primary)]/12 text-[color:var(--color-foreground)]'
                                          : 'text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]'
                                      }`}
                                      onClick={() => {
                                        setMergeTarget(candidate.name)
                                        setMergeDropdownOpen(false)
                                      }}
                                    >
                                      <span className="truncate font-mono">{candidate.name}</span>
                                      {active && <Check className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-primary)]" />}
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                            {filteredRemoteMergeCandidates.length > 0 && (
                              <div>
                                <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">
                                  远程分支
                                </p>
                                {filteredRemoteMergeCandidates.map((candidate) => {
                                  const active = mergeTarget === candidate.name
                                  return (
                                    <button
                                      key={`remote-${candidate.name}`}
                                      type="button"
                                      className={`flex w-full items-center justify-between rounded-[10px] px-2.5 py-1.5 text-left text-[11.5px] transition-colors ${
                                        active
                                          ? 'bg-[color:var(--color-primary)]/12 text-[color:var(--color-foreground)]'
                                          : 'text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]'
                                      }`}
                                      onClick={() => {
                                        setMergeTarget(candidate.name)
                                        setMergeDropdownOpen(false)
                                      }}
                                    >
                                      <span className="truncate font-mono">{candidate.name}</span>
                                      {active && <Check className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-primary)]" />}
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                            {filteredLocalMergeCandidates.length === 0 && filteredRemoteMergeCandidates.length === 0 && (
                              <p className="px-2 py-2 text-[11px] text-[color:var(--color-muted-foreground)]">
                                {mergeSearchQuery ? '未找到匹配分支' : '暂无可选分支'}
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    <p className="mt-1 text-[10.5px] text-[color:var(--color-muted-foreground)]">
                      本地 {localMergeCandidates.length} 个 · 远程 {remoteMergeCandidates.length} 个{mergeSearchQuery ? ` · 匹配 ${mergeSearchResultCount} 个` : ''}
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
              </>
            )}

          </div>
          </section>
        </div>
      </div>
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
            {operationConfirm?.riskLevel === 'high' && (
              <div className="mt-2 rounded-[14px] border border-[color:var(--color-destructive)]/28 bg-[color:var(--color-destructive-background)] px-3 py-2">
                <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-[color:var(--color-destructive)]">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  高危操作：切换分支会改变当前工作目录视图与上下文
                </p>
                {confirmNeedsTypedMatch && (
                  <>
                    <p className="mt-1 text-[10.5px] text-[color:var(--color-destructive)]/90">
                      请输入目标分支名以确认：<span className="font-mono">{confirmExactMatch}</span>
                    </p>
                    <input
                      type="text"
                      value={operationConfirmInput}
                      onChange={(event) => setOperationConfirmInput(event.target.value)}
                      className="mt-2 h-8 w-full rounded-[10px] border border-[color:var(--color-destructive)]/28 bg-[color:var(--color-background)] px-2.5 font-mono text-[11.5px] text-[color:var(--color-foreground)] outline-none ring-[color:var(--color-ring)] focus:ring-2"
                      placeholder={confirmExactMatch}
                      spellCheck={false}
                    />
                  </>
                )}
              </div>
            )}
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
                className={`inline-flex h-9 items-center justify-center rounded-full px-4 text-xs font-medium text-white transition-colors ${
                  operationConfirm?.riskLevel === 'high'
                    ? 'bg-[color:var(--color-destructive)] hover:opacity-90'
                    : 'bg-primary hover:bg-primary-hover'
                } disabled:cursor-not-allowed disabled:opacity-50`}
                disabled={!confirmTypedMatchPassed}
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
      <ModalShell
        open={Boolean(branchManagerMode)}
        onClose={() => setBranchManagerMode(null)}
        widthClassName="max-w-[460px]"
        baseZIndex={1120}
        ariaLabel={branchManagerMode === 'current' ? 'Current Branch 管理' : 'Upstream 管理'}
      >
        {branchManagerMode === 'current' ? (
          <>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="section-label mb-1">Current Branch</p>
                <p className="text-sm font-semibold text-[color:var(--color-foreground)]">本地分支管理</p>
              </div>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                onClick={() => setBranchManagerMode(null)}
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2">
              <div className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/62 px-3 py-2">
                <p className="mb-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">新增本地分支</p>
                <input
                  ref={currentBranchInputRef}
                  type="text"
                  value={currentManagerInput}
                  onChange={(event) => setCurrentManagerInput(event.target.value)}
                  placeholder="feature/new-branch"
                  className="h-8 w-full bg-transparent font-mono text-[12px] text-[color:var(--color-foreground)] outline-none placeholder:text-[color:var(--color-muted-foreground)]"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="mt-2 inline-flex h-8 items-center justify-center rounded-full bg-primary px-3 text-[11px] font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!currentManagerInput.trim() || branchManagerLoading}
                  onClick={() => { void handleCreateLocalBranch() }}
                >
                  {branchManagerLoading ? '执行中...' : '新增'}
                </button>
              </div>

              <div className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/62 px-3 py-2">
                <p className="mb-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">删除本地分支</p>
                <select
                  value={currentManagerDeleteTarget}
                  onChange={(event) => setCurrentManagerDeleteTarget(event.target.value)}
                  className="h-8 w-full rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 font-mono text-[11.5px] text-[color:var(--color-foreground)] outline-none ring-[color:var(--color-ring)] focus:ring-2"
                >
                  <option value="">选择分支（不含当前分支）</option>
                  {localBranches
                    .filter((name) => name !== currentBranch)
                    .map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                </select>
                <button
                  type="button"
                  className="mt-2 inline-flex h-8 items-center justify-center rounded-full bg-[color:var(--color-destructive)] px-3 text-[11px] font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!currentManagerDeleteTarget || branchManagerLoading}
                  onClick={() => { void handleDeleteLocalBranch() }}
                >
                  {branchManagerLoading ? '执行中...' : '删除'}
                </button>
              </div>
            </div>
            {branchManagerError && (
              <p className="mt-2 rounded-[12px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-background)] px-3 py-2 text-[11px] text-[color:var(--color-destructive)]">
                {branchManagerError}
              </p>
            )}
          </>
        ) : (
          <>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="section-label mb-1">Upstream</p>
                <p className="text-sm font-semibold text-[color:var(--color-foreground)]">远程绑定管理（仅新增）</p>
              </div>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                onClick={() => setBranchManagerMode(null)}
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="rounded-[14px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-background)] px-3 py-2">
              <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-[color:var(--color-destructive)]">
                <AlertTriangle className="h-3.5 w-3.5" />
                高危操作：会修改当前分支的 upstream 绑定
              </p>
            </div>
            <div className="mt-2 space-y-2">
              <div className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/62 px-3 py-2">
                <p className="mb-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">Remote</p>
                <input
                  type="text"
                  value={upstreamManagerRemoteName}
                  onChange={(event) => setUpstreamManagerRemoteName(event.target.value)}
                  placeholder="origin"
                  className="h-8 w-full bg-transparent font-mono text-[12px] text-[color:var(--color-foreground)] outline-none placeholder:text-[color:var(--color-muted-foreground)]"
                  spellCheck={false}
                />
              </div>
              <div className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/62 px-3 py-2">
                <p className="mb-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">Branch</p>
                <input
                  ref={upstreamBranchInputRef}
                  type="text"
                  value={upstreamManagerBranchName}
                  onChange={(event) => setUpstreamManagerBranchName(event.target.value)}
                  placeholder="feature/new-branch"
                  className="h-8 w-full bg-transparent font-mono text-[12px] text-[color:var(--color-foreground)] outline-none placeholder:text-[color:var(--color-muted-foreground)]"
                  spellCheck={false}
                />
              </div>
              <div className="rounded-[14px] border border-[color:var(--color-destructive)]/28 bg-[color:var(--color-destructive-background)]/55 px-3 py-2">
                <p className="text-[10.5px] text-[color:var(--color-destructive)]/92">
                  请输入以下目标以确认：
                  <span className="ml-1 font-mono">{branchManagerDangerText}</span>
                </p>
                <input
                  type="text"
                  value={upstreamManagerDangerInput}
                  onChange={(event) => setUpstreamManagerDangerInput(event.target.value)}
                  placeholder={branchManagerDangerText}
                  className="mt-2 h-8 w-full rounded-[10px] border border-[color:var(--color-destructive)]/28 bg-[color:var(--color-background)] px-2 font-mono text-[11.5px] text-[color:var(--color-foreground)] outline-none ring-[color:var(--color-ring)] focus:ring-2"
                  spellCheck={false}
                />
              </div>
            </div>
            {branchManagerError && (
              <p className="mt-2 rounded-[12px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-background)] px-3 py-2 text-[11px] text-[color:var(--color-destructive)]">
                {branchManagerError}
              </p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 text-xs font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                disabled={
                  branchManagerLoading
                  || !upstreamManagerBranchName.trim()
                  || upstreamManagerDangerInput.trim() !== branchManagerDangerText
                }
                onClick={() => { void handleCreateRemoteBranchFromUpstream() }}
              >
                {branchManagerLoading ? '执行中...' : '创建远程分支'}
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-full bg-[color:var(--color-destructive)] px-4 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={
                  branchManagerLoading
                  || !upstreamManagerBranchName.trim()
                  || upstreamManagerDangerInput.trim() !== branchManagerDangerText
                }
                onClick={() => { void handleSetUpstream() }}
              >
                {branchManagerLoading ? '执行中...' : '仅绑定 upstream'}
              </button>
            </div>
          </>
        )}
      </ModalShell>
      <ModalShell
        open={gitGuideOpen}
        onClose={() => setGitGuideOpen(false)}
        widthClassName="max-w-[520px]"
        baseZIndex={1130}
        ariaLabel="Git 操作指南"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="section-label mb-1">Git Guide</p>
            <p className="text-sm font-semibold text-[color:var(--color-foreground)]">{GIT_GUIDE_TITLE}</p>
          </div>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
            onClick={() => setGitGuideOpen(false)}
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2 text-[12px] leading-5 text-[color:var(--color-foreground)]">
          {GIT_GUIDE_SECTIONS.map((section) => (
            <div
              key={section.title}
              className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/62 px-3 py-2"
            >
              <p className="font-semibold">{section.title}</p>
              {section.lines.map((line, index) => (
                <p key={`${section.title}-${index}`} className={index === 0 ? 'mt-1' : ''}>{line}</p>
              ))}
            </div>
          ))}
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
        diffTruncated={diffTruncated}
        canViewUnstaged={activeDiffSupportsUnstaged}
        canViewStaged={activeDiffSupportsStaged}
        conflictLoading={conflictLoading}
        conflictData={conflictData}
        conflictError={conflictError}
        conflictSaving={conflictSaving}
        onClose={handleDiffDrawerClose}
        onSelectFile={handleDiffDrawerSelectFile}
        onChangeDiffViewMode={handleDiffViewModeChange}
        onLoadConflict={handleLoadConflict}
        onSaveConflict={handleSaveConflict}
      />
    </>
  )
}

export { DetailAiCommitPanel }
