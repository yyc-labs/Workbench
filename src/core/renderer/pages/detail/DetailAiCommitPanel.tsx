import { type Dispatch, type MouseEvent as ReactMouseEvent, type MutableRefObject, type SetStateAction } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AiCommitUndoState } from '../../../shared/types'
import { useI18n } from '../../i18n'
import { DetailAiCommitBranchManagerModal } from './DetailAiCommitBranchManagerModal'
import { DetailAiCommitBranchPanel } from './DetailAiCommitBranchPanel'
import { DetailAiCommitGitGuideModal } from './DetailAiCommitGitGuideModal'
import { DetailAiCommitHeader } from './DetailAiCommitHeader'
import { DetailAiCommitMiddlePanel } from './DetailAiCommitMiddlePanel'
import { DetailAiCommitOperationConfirmModal } from './DetailAiCommitOperationConfirmModal'
import { DetailAiCommitWorkingTreePanel } from './DetailAiCommitWorkingTreePanel'
import { DetailGitRepositorySelector } from './DetailGitRepositorySelector'
import { buildCommitHistoryDisplayItems } from './detail.commitHistory'
import type {
  BranchManagerMode,
  IndexedBranchCandidate,
  MiddlePanelMode,
  OperationConfirmState,
  ProjectLinkItem,
} from './detail.aiCommitPanel.types'
import {
  computeOperationState,
  getGitOperationItems,
  PanelGitOperationKind,
  pickDefaultDiffViewMode,
  type OperationCardState,
} from './detail.gitOperations'
import { DetailGitDiffDrawer } from './DetailGitDiffDrawer'
import type {
  AiCommitStatus,
  AiFlowNode,
  DetailGitRepositorySummary,
  DetailGitSnapshot,
  GitDiffViewMode,
  GitConflictFileResult,
  GitFileDiffResult,
  GitOperationKind,
  GitOperationResult,
  GitResolveConflictResult,
  GitSetFileStageResult,
} from './detail.types'

type DetailAiCommitPanelProps = {
  projectHeaderCollapsed?: boolean
  projectName?: string
  projectLinkItems?: ProjectLinkItem[]
  activePane?: 'code' | 'aicommit'
  onSwitchPane?: (pane: 'code' | 'aicommit') => void
  onOpenTranscript?: () => void
  onOpenProjectLinksManager?: () => void
  jumpToAiLogToken: number
  flowNodes: AiFlowNode[]
  aiRawText: string
  statusClass: string
  statusText: string
  gitSnapshot: DetailGitSnapshot | null
  gitSnapshotLoading: boolean
  gitSnapshotError: string | null
  gitRepositories: DetailGitRepositorySummary[]
  gitRepositoriesLoading: boolean
  gitRepositoriesError: string | null
  gitRepositoriesTruncated: boolean
  selectedGitRepositoryId: string | null
  onChangeGitRepository: (repoId: string) => void
  onRefreshGitRepositories: () => void
  onRefreshGitSnapshot: () => void
  activeCommitHash: string | null
  setActiveCommitHash: Dispatch<SetStateAction<string | null>>
  aiCommitUndo: AiCommitUndoState | null
  aiCommitUndoAuthActive: boolean
  aiCommitUndoAvailable: boolean
  aiCommitUndoActionAvailable: boolean
  aiCommitUndoRemainingSeconds: number
  aiCommitUndoGraceActive: boolean
  aiCommitUndoGraceRemainingSeconds: number
  aiCommitUndoRunning: boolean
  aiCommitUndoError: string | null
  aiCommitStatus: AiCommitStatus
  isAiEnabled: boolean
  aiAutoCommitButtonRef: MutableRefObject<HTMLButtonElement | null>
  onAiAutoCommit: () => void
  onBeginUndoAiCommitAuth: () => Promise<boolean>
  onCancelUndoAiCommitAuth: () => Promise<void>
  onUndoAiCommit: () => void
  onAiAutoCommitContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void
}

type GitChangedFile = DetailGitSnapshot['changedFiles'][number]
type PreflightItem = {
  key: string
  label: string
  title: string
  tone: 'success' | 'warning' | 'danger' | 'neutral'
}

const BRANCH_SEARCH_DEBOUNCE_MS = 140

function DetailAiCommitPanel({
  projectHeaderCollapsed = false,
  projectName,
  projectLinkItems = [],
  activePane = 'aicommit',
  onSwitchPane,
  onOpenTranscript,
  onOpenProjectLinksManager,
  jumpToAiLogToken,
  flowNodes,
  aiRawText,
  statusClass,
  statusText,
  gitSnapshot,
  gitSnapshotLoading,
  gitSnapshotError,
  gitRepositories,
  gitRepositoriesLoading,
  gitRepositoriesError,
  gitRepositoriesTruncated,
  selectedGitRepositoryId,
  onChangeGitRepository,
  onRefreshGitRepositories,
  onRefreshGitSnapshot,
  activeCommitHash,
  setActiveCommitHash,
  aiCommitUndo,
  aiCommitUndoAuthActive,
  aiCommitUndoAvailable,
  aiCommitUndoActionAvailable,
  aiCommitUndoRemainingSeconds,
  aiCommitUndoGraceActive,
  aiCommitUndoGraceRemainingSeconds,
  aiCommitUndoRunning,
  aiCommitUndoError,
  aiCommitStatus,
  isAiEnabled,
  aiAutoCommitButtonRef,
  onAiAutoCommit,
  onBeginUndoAiCommitAuth,
  onCancelUndoAiCommitAuth,
  onUndoAiCommit,
  onAiAutoCommitContextMenu,
}: DetailAiCommitPanelProps) {
  const { t } = useI18n()
  const firstProjectLinkItem = projectLinkItems[0]
  const gitOperationItems = getGitOperationItems()
  const [middlePanelMode, setMiddlePanelMode] = useState<MiddlePanelMode>('history')
  const [runningOperation, setRunningOperation] = useState<PanelGitOperationKind | null>(null)
  const [mergeTarget, setMergeTarget] = useState('')
  const [mergeDropdownOpen, setMergeDropdownOpen] = useState(false)
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
  const currentBranch = branch?.current || t('detail.noBranch')
  const upstreamBranch = branch?.upstream || t('detail.noUpstream')
  const remoteBranches = branch?.remoteBranches ?? []
  const localBranches = branch?.localBranches ?? []
  const conflictedCount = changedFiles.filter((file) => file.scope === 'conflicted').length
  const hasWorkingTreeChanges = changedFiles.length > 0
  const hasConflicts = conflictedCount > 0
  const showBranchRemoteLoading = gitSnapshotLoading || runningOperation === 'switch'
  const showCommitHistoryLoading = gitSnapshotLoading
  const branchAhead = branch?.ahead ?? 0
  const branchBehind = branch?.behind ?? 0
  const hasUpstream = Boolean(branch?.upstream)
  const upstreamGone = branch?.upstreamGone ?? false
  const activeDiffFile = activeDiffFilePath ? changedFilesMap.get(activeDiffFilePath) ?? null : null
  const activeDiffSupportsUnstaged = Boolean(activeDiffFile && (activeDiffFile.unstaged || activeDiffFile.scope === 'untracked'))
  const activeDiffSupportsStaged = Boolean(activeDiffFile?.staged)
  const gitOperationsUnavailable = !gitSnapshot?.isGitRepository || gitSnapshotLoading
  const preflightItems = useMemo<PreflightItem[]>(() => {
    if (gitSnapshotLoading) {
      return [{
        key: 'loading',
        label: t('detail.preflightLoading'),
        title: t('detail.preflightLoading'),
        tone: 'neutral',
      }]
    }
    if (!gitSnapshot?.isGitRepository) {
      return [{
        key: 'not-git',
        label: t('detail.preflightNotGit'),
        title: t('detail.preflightNotGitTitle'),
        tone: 'danger',
      }]
    }

    const items: PreflightItem[] = []
    if (!hasWorkingTreeChanges) {
      items.push({
        key: 'clean',
        label: t('detail.preflightClean'),
        title: t('detail.preflightCleanTitle'),
        tone: 'neutral',
      })
    }
    if (hasConflicts) {
      items.push({
        key: 'conflicts',
        label: t('detail.preflightConflicts', { count: conflictedCount }),
        title: t('detail.preflightConflictsTitle'),
        tone: 'danger',
      })
    }
    if (branchBehind > 0) {
      items.push({
        key: 'behind',
        label: t('detail.preflightBehind', { count: branchBehind }),
        title: t('detail.preflightBehindTitle'),
        tone: 'warning',
      })
    }
    if (branch?.detached) {
      items.push({
        key: 'detached',
        label: t('detail.preflightDetached'),
        title: t('detail.preflightDetachedTitle'),
        tone: 'warning',
      })
    }
    if (!hasUpstream && !branch?.detached) {
      items.push({
        key: 'no-upstream',
        label: t('detail.preflightNoUpstream'),
        title: t('detail.preflightNoUpstreamTitle'),
        tone: 'warning',
      })
    }
    if (items.length > 0) return items

    return [{
      key: 'ready',
      label: t('detail.preflightReady', { count: changedFiles.length }),
      title: t('detail.preflightReadyTitle'),
      tone: 'success',
    }]
  }, [
    branch?.detached,
    branchBehind,
    changedFiles.length,
    conflictedCount,
    gitSnapshot?.isGitRepository,
    gitSnapshotLoading,
    hasConflicts,
    hasUpstream,
    hasWorkingTreeChanges,
    t,
  ])

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
  const mergeTargetLabel = mergeTarget || t('detail.mergeTargetPlaceholder')
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
    if (!operationConfirm || operationConfirm.operation !== 'undo-ai-commit') return
    if (aiCommitUndoActionAvailable) return
    setOperationConfirm(null)
  }, [aiCommitUndoActionAvailable, operationConfirm])

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
    if (gitOperationsUnavailable) {
      const hint = gitSnapshotLoading ? t('detail.gitSnapshotLoadingHint') : t('detail.gitRepositoryUnavailableHint')
      return {
        fetch: { disabled: true, hint },
        pull: { disabled: true, hint },
        push: { disabled: true, hint },
        switch: { disabled: true, hint },
        merge: { disabled: true, hint },
      }
    }

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
    gitOperationsUnavailable,
    gitSnapshotLoading,
    t,
  ])

  const setFileStaged = async (file: GitChangedFile, stage: boolean) => {
    if (!gitSnapshot || stagingFilePath) return
    setFileActionError(null)
    setStagingFilePath(file.path)
    try {
      const result: GitSetFileStageResult = await window.electronAPI.setGitFileStage({
        repoRoot: gitSnapshot.repoRoot,
        filePath: file.path,
        stage,
      })
      if (!result.ok) {
        setFileActionError(result.error || result.output || t('detail.gitFileStageFailed'))
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
        repoRoot: gitSnapshot.repoRoot,
        filePath,
        staged,
      })
      if (requestSeq !== diffRequestSeqRef.current) return
      if (!result.ok) {
        setDiffContent('')
        setDiffError(result.error || result.output || t('detail.gitDiffLoadFailed'))
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
        repoRoot: gitSnapshot.repoRoot,
        filePath,
      })
      if (requestSeq !== conflictRequestSeqRef.current) return
      if (!result.ok) {
        setConflictData(null)
        setConflictError(result.error || result.output || t('detail.gitConflictLoadFailed'))
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
        repoRoot: gitSnapshot.repoRoot,
        filePath: payload.filePath,
        content: payload.content,
        markResolved: payload.markResolved,
      })
      if (!result.ok) {
        const msg = result.error || result.output || t('detail.gitConflictSaveFailed')
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
      ? t('detail.operationConfirmMergeMessage', { targetBranch: mergeTarget, currentBranch })
      : operation === 'switch'
        ? t('detail.operationConfirmSwitchMessage', { targetBranch: mergeTarget })
        : operation === 'pull'
        ? t('detail.operationConfirmPullMessage', { currentBranch })
        : operation === 'push'
          ? t('detail.operationConfirmPushMessage', { currentBranch })
          : t('detail.operationConfirmFetchMessage')

    setOperationConfirm({
      operation,
      message,
      riskLevel: operation === 'switch' ? 'high' : 'normal',
      requireExactMatch: operation === 'switch' ? mergeTarget : undefined,
    })
  }

  const requestUndoAiCommit = useCallback(async () => {
    if (!aiCommitUndoAvailable || !aiCommitUndoActionAvailable || aiCommitUndoRunning) return
    const ready = await onBeginUndoAiCommitAuth()
    if (!ready) return
    setOperationConfirm({
      operation: 'undo-ai-commit',
      message: '',
      title: t('detail.operationConfirmUndoTitle'),
      confirmLabel: t('detail.operationConfirmUndoConfirm'),
      cancelLabel: t('detail.operationConfirmUndoCancel'),
      riskLevel: 'normal',
    })
  }, [
    aiCommitUndoActionAvailable,
    aiCommitUndoAvailable,
    aiCommitUndoRunning,
    onBeginUndoAiCommitAuth,
    t,
  ])

  const runGitOperation = async (operation: PanelGitOperationKind) => {
    const state = operationStates[operation]
    if (state.disabled || !gitSnapshot) return

    setRunningOperation(operation)
    try {
      const result = await window.electronAPI.runGitOperation({
        repoRoot: gitSnapshot.repoRoot,
        operation,
        targetBranch: operation === 'merge' || operation === 'switch' ? mergeTarget : undefined,
      })
      setOperationLogs((prev) => [result, ...prev].slice(0, 50))
      if (!result.ok && !result.skipped) {
        setMiddlePanelMode('git-log')
      }
    } catch (error) {
      const failedResult: GitOperationResult = {
        repoRoot: gitSnapshot.repoRoot,
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
        repoRoot: '',
        operation: request.operation,
        ok: false,
        checkedAt: Date.now(),
        command: '',
        output: t('detail.gitSnapshotUnavailable'),
        exitCode: null,
        error: t('detail.gitSnapshotUnavailable'),
      }
    }
    return window.electronAPI.runGitOperation({
      repoRoot: gitSnapshot.repoRoot,
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
        setBranchManagerError(result.error || result.output || t('detail.gitBranchCreateLocalFailed'))
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
        setBranchManagerError(result.error || result.output || t('detail.gitBranchDeleteLocalFailed'))
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
        setBranchManagerError(result.error || result.output || t('detail.gitBranchSetUpstreamFailed'))
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
        setBranchManagerError(result.error || result.output || t('detail.gitBranchCreateRemoteFailed'))
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

  const pendingOperationLabel = operationConfirm
    ? operationConfirm.operation === 'undo-ai-commit'
      ? t('detail.operationConfirmUndoConfirm')
      : gitOperationItems.find((item) => item.key === operationConfirm.operation)?.label ?? 'Git'
    : 'Git'
  const pendingOperation = operationConfirm?.operation ?? null
  const pendingOperationMessage = pendingOperation === 'undo-ai-commit'
    ? aiCommitUndoGraceActive
      ? t('detail.operationConfirmUndoMessageGrace', { seconds: aiCommitUndoGraceRemainingSeconds })
      : t('detail.operationConfirmUndoMessage')
    : operationConfirm?.message ?? ''
  const confirmExactMatch = operationConfirm?.requireExactMatch ?? ''
  const confirmNeedsTypedMatch = Boolean(confirmExactMatch)
  const confirmTypedMatchPassed = !confirmNeedsTypedMatch || operationConfirmInput.trim() === confirmExactMatch
  const pendingOperationTitle = pendingOperation === 'undo-ai-commit'
    ? t('detail.operationConfirmUndoTitle')
    : operationConfirm?.title
  const pendingOperationConfirmLabel = pendingOperation === 'undo-ai-commit'
    ? t('detail.operationConfirmUndoConfirm')
    : operationConfirm?.confirmLabel
  const pendingOperationCancelLabel = pendingOperation === 'undo-ai-commit'
    ? t('detail.operationConfirmUndoCancel')
    : operationConfirm?.cancelLabel
  const pendingOperationHelperText = pendingOperation === 'undo-ai-commit'
    ? aiCommitUndoGraceActive
      ? t('detail.operationConfirmUndoHelper')
      : t('detail.operationConfirmUndoHelperGrace')
    : operationConfirm?.helperText
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
  const gitRepositoryControls = (
    <DetailGitRepositorySelector
      repositories={gitRepositories}
      selectedRepositoryId={selectedGitRepositoryId}
      snapshot={gitSnapshot}
      loading={gitSnapshotLoading}
      repositoriesLoading={gitRepositoriesLoading}
      repositoriesTruncated={gitRepositoriesTruncated}
      variant="inline"
      onChangeRepository={onChangeGitRepository}
      onRefreshRepositories={onRefreshGitRepositories}
    />
  )

  return (
    <>
      <div className="relative flex h-full min-h-0 min-w-0 flex-col">
        <div className="flex h-full min-h-0 flex-col gap-4">
          <DetailAiCommitHeader
            activePane={activePane}
            aiAutoCommitButtonRef={aiAutoCommitButtonRef}
            aiCommitStatus={aiCommitStatus}
            aiCommitUndo={aiCommitUndo}
            aiCommitUndoAuthActive={aiCommitUndoAuthActive}
            aiCommitUndoAvailable={aiCommitUndoAvailable}
            aiCommitUndoError={aiCommitUndoError}
            aiCommitUndoGraceActive={aiCommitUndoGraceActive}
            aiCommitUndoGraceRemainingSeconds={aiCommitUndoGraceRemainingSeconds}
            aiCommitUndoRemainingSeconds={aiCommitUndoRemainingSeconds}
            aiCommitUndoRunning={aiCommitUndoRunning}
            firstProjectLinkItem={firstProjectLinkItem}
            flowNodes={flowNodes}
            gitRepositoryControls={gitRepositoryControls}
            isAiEnabled={isAiEnabled}
            onAiAutoCommit={onAiAutoCommit}
            onAiAutoCommitContextMenu={onAiAutoCommitContextMenu}
            onOpenTranscript={onOpenTranscript}
            onUndoAiCommit={() => {
              void requestUndoAiCommit()
            }}
            onOpenProjectLinksManager={onOpenProjectLinksManager}
            onSwitchPane={onSwitchPane}
            projectHeaderCollapsed={projectHeaderCollapsed}
            projectLinkItems={projectLinkItems}
            projectName={projectName}
            preflightItems={preflightItems}
            statusClass={statusClass}
            statusText={statusText}
          />

        {gitRepositoriesError && (
          <div className="shrink-0 rounded-[14px] border border-[color:var(--color-destructive)]/25 bg-[color:var(--color-destructive-background)] px-3 py-2 text-xs text-[color:var(--color-destructive)]">
            {gitRepositoriesError}
          </div>
        )}

        {gitSnapshotError && (
          <div className="shrink-0 rounded-[14px] border border-[color:var(--color-destructive)]/25 bg-[color:var(--color-destructive-background)] px-3 py-2 text-xs text-[color:var(--color-destructive)]">
            {gitSnapshotError}
          </div>
        )}

        <section className="grid min-h-0 flex-1 grid-cols-[minmax(260px,0.9fr)_minmax(360px,1.1fr)_300px] gap-4 overflow-hidden xl:grid-cols-[minmax(320px,0.95fr)_minmax(460px,1.2fr)_340px]">
          <DetailAiCommitWorkingTreePanel
            changedFiles={changedFiles}
            conflictedCount={conflictedCount}
            fileActionError={fileActionError}
            gitSnapshotLoading={gitSnapshotLoading}
            onOpenDiff={openDiffDrawerForFile}
            onRefresh={onRefreshGitSnapshot}
            onSetFileStaged={setFileStaged}
            stagingFilePath={stagingFilePath}
          />

          <DetailAiCommitMiddlePanel
            activeCommitHash={activeCommitHash}
            aiRawText={aiRawText}
            commitHistoryItems={commitHistoryItems}
            middlePanelMode={middlePanelMode}
            onSetMiddlePanelMode={setMiddlePanelMode}
            operationLogs={operationLogs}
            setActiveCommitHash={setActiveCommitHash}
            showCommitHistoryLoading={showCommitHistoryLoading}
          />

          <DetailAiCommitBranchPanel
            branchAhead={branchAhead}
            branchBehind={branchBehind}
            currentBranch={currentBranch}
            filteredLocalMergeCandidates={filteredLocalMergeCandidates}
            filteredRemoteMergeCandidates={filteredRemoteMergeCandidates}
            localMergeCandidates={localMergeCandidates}
            mergeDropdownOpen={mergeDropdownOpen}
            mergeDropdownRef={mergeDropdownRef}
            mergeSearchDraft={mergeSearchDraft}
            mergeSearchInputRef={mergeSearchInputRef}
            mergeSearchQuery={mergeSearchQuery}
            mergeSearchResultCount={mergeSearchResultCount}
            mergeTarget={mergeTarget}
            mergeTargetLabel={mergeTargetLabel}
            onChangeMergeSearchDraft={setMergeSearchDraft}
            onOpenCurrentBranchManager={() => setBranchManagerMode('current')}
            onOpenGitGuide={() => setGitGuideOpen(true)}
            onOpenUpstreamManager={() => setBranchManagerMode('upstream')}
            onRequestGitOperation={requestGitOperation}
            onSelectMergeTarget={(branchName) => {
              setMergeTarget(branchName)
              setMergeDropdownOpen(false)
            }}
            onToggleMergeDropdown={() => setMergeDropdownOpen((prev) => !prev)}
            operationStates={operationStates}
            remoteMergeCandidates={remoteMergeCandidates}
            runningOperation={runningOperation}
            showBranchRemoteLoading={showBranchRemoteLoading}
            upstreamBranch={upstreamBranch}
          />
          </section>
        </div>
      </div>
      <DetailAiCommitOperationConfirmModal
        confirmExactMatch={confirmExactMatch}
        confirmNeedsTypedMatch={confirmNeedsTypedMatch}
        confirmTypedMatchPassed={confirmTypedMatchPassed}
        onChangeOperationConfirmInput={setOperationConfirmInput}
        onClose={() => {
          const shouldCancelUndoAuth = operationConfirm?.operation === 'undo-ai-commit'
          setOperationConfirm(null)
          if (shouldCancelUndoAuth) {
            void onCancelUndoAiCommitAuth()
          }
        }}
        onConfirm={() => {
          if (!pendingOperation) return
          setOperationConfirm(null)
          if (pendingOperation === 'undo-ai-commit') {
            void onUndoAiCommit()
            return
          }
          setMiddlePanelMode('git-log')
          void runGitOperation(pendingOperation)
        }}
        open={Boolean(operationConfirm)}
        operationConfirmInput={operationConfirmInput}
        pendingOperationLabel={pendingOperationLabel}
        pendingOperationMessage={pendingOperationMessage}
        riskLevel={operationConfirm?.riskLevel}
        title={pendingOperationTitle}
        confirmLabel={pendingOperationConfirmLabel}
        cancelLabel={pendingOperationCancelLabel}
        helperText={pendingOperationHelperText}
      />
      <DetailAiCommitBranchManagerModal
        branchManagerDangerText={branchManagerDangerText}
        branchManagerError={branchManagerError}
        branchManagerLoading={branchManagerLoading}
        currentBranch={currentBranch}
        currentBranchInputRef={currentBranchInputRef}
        currentManagerDeleteTarget={currentManagerDeleteTarget}
        currentManagerInput={currentManagerInput}
        localBranches={localBranches}
        mode={branchManagerMode}
        onChangeCurrentManagerDeleteTarget={setCurrentManagerDeleteTarget}
        onChangeCurrentManagerInput={setCurrentManagerInput}
        onChangeUpstreamManagerBranchName={setUpstreamManagerBranchName}
        onChangeUpstreamManagerDangerInput={setUpstreamManagerDangerInput}
        onChangeUpstreamManagerRemoteName={setUpstreamManagerRemoteName}
        onClose={() => setBranchManagerMode(null)}
        onCreateLocalBranch={() => {
          void handleCreateLocalBranch()
        }}
        onCreateRemoteBranchFromUpstream={() => {
          void handleCreateRemoteBranchFromUpstream()
        }}
        onDeleteLocalBranch={() => {
          void handleDeleteLocalBranch()
        }}
        onSetUpstream={() => {
          void handleSetUpstream()
        }}
        upstreamBranchInputRef={upstreamBranchInputRef}
        upstreamManagerBranchName={upstreamManagerBranchName}
        upstreamManagerDangerInput={upstreamManagerDangerInput}
        upstreamManagerRemoteName={upstreamManagerRemoteName}
      />
      <DetailAiCommitGitGuideModal
        open={gitGuideOpen}
        onClose={() => setGitGuideOpen(false)}
      />
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
