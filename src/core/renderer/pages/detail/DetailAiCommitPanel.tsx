import { type Dispatch, type MouseEvent as ReactMouseEvent, type MutableRefObject, type SetStateAction } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AiCommitUndoState } from '../../../shared/types'
import type { ProjectPanePreload } from '../../components/ProjectPaneTabs'
import { useI18n } from '../../i18n'
import { DetailAiCommitBranchManagerModal } from './DetailAiCommitBranchManagerModal'
import { DetailAiCommitBranchPanel } from './DetailAiCommitBranchPanel'
import { DetailAiCommitCommitModal } from './DetailAiCommitCommitModal'
import { DetailAiCommitGitGuideModal } from './DetailAiCommitGitGuideModal'
import { DetailAiCommitHeader } from './DetailAiCommitHeader'
import { DetailAiCommitMiddlePanel } from './DetailAiCommitMiddlePanel'
import { DetailAiCommitOperationConfirmModal } from './DetailAiCommitOperationConfirmModal'
import { DetailAiCommitWorkingTreePanel } from './DetailAiCommitWorkingTreePanel'
import { DetailGitRepositorySelector } from './DetailGitRepositorySelector'
import { buildCommitHistoryDisplayItems } from './detail.commitHistory'
import type { IndexedBranchCandidate, MiddlePanelMode, OperationConfirmState, ProjectLinkItem } from './detail.aiCommitPanel.types'
import { computeOperationState, getGitOperationItems, PanelGitOperationKind, type OperationCardState } from './detail.gitOperations'
import { DetailGitDiffDrawer } from './DetailGitDiffDrawer'
import type { AiCommitStatus, AiFlowNode, DetailGitRepositorySummary, DetailGitSnapshot, GitOperationResult, GitSetFileStageResult } from './detail.types'
import { useDetailBranchManagerState } from './useDetailBranchManagerState'
import { useDetailGitDiffState } from './useDetailGitDiffState'

type DetailAiCommitPanelProps = {
  projectHeaderCollapsed?: boolean
  projectName?: string
  projectLinkItems?: ProjectLinkItem[]
  hasProjectDocLinks?: boolean
  projectLinkTagOptions?: ReadonlyArray<{ value: string; label: string }>
  projectDevUrlActionVisible?: boolean
  projectDevUrlPending?: boolean
  projectDevUrlReady?: boolean
  activePane?: 'code' | 'aicommit'
  onPreloadPane?: ProjectPanePreload
  onSwitchPane?: (pane: 'code' | 'aicommit') => void
  onStartAndOpenDevUrl?: () => void | Promise<unknown>
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
  aiCommitCanceling: boolean
  aiCommitUndoRunning: boolean
  aiCommitUndoError: string | null
  aiCommitStatus: AiCommitStatus
  isAiEnabled: boolean
  aiAutoCommitButtonRef: MutableRefObject<HTMLButtonElement | null>
  onAiAutoCommit: () => void
  onBeginUndoAiCommitAuth: () => Promise<boolean>
  onCancelUndoAiCommitAuth: () => Promise<void>
  onCancelAiCommit: () => void
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

function DetailAiCommitPanel({
  projectHeaderCollapsed = false,
  projectName,
  projectLinkItems = [],
  hasProjectDocLinks = false,
  projectLinkTagOptions = [],
  projectDevUrlActionVisible = false,
  projectDevUrlPending = false,
  projectDevUrlReady = false,
  activePane = 'aicommit',
  onPreloadPane,
  onSwitchPane,
  onStartAndOpenDevUrl,
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
  aiCommitCanceling,
  aiCommitUndoRunning,
  aiCommitUndoError,
  aiCommitStatus,
  isAiEnabled,
  aiAutoCommitButtonRef,
  onAiAutoCommit,
  onBeginUndoAiCommitAuth,
  onCancelUndoAiCommitAuth,
  onCancelAiCommit,
  onUndoAiCommit,
  onAiAutoCommitContextMenu,
}: DetailAiCommitPanelProps) {
  const { t } = useI18n()
  const firstProjectLinkItem = useMemo(() => projectLinkItems.find((item) => item.kind === 'url' || item.kind === 'ssh'), [projectLinkItems])
  const gitOperationItems = getGitOperationItems()
  const [middlePanelMode, setMiddlePanelMode] = useState<MiddlePanelMode>('history')
  const [runningOperation, setRunningOperation] = useState<PanelGitOperationKind | null>(null)
  const [mergeTarget, setMergeTarget] = useState('')
  const [mergeSearchValue, setMergeSearchValue] = useState('')
  const [operationConfirmInput, setOperationConfirmInput] = useState('')
  const [operationConfirm, setOperationConfirm] = useState<OperationConfirmState>(null)
  const [operationLogs, setOperationLogs] = useState<GitOperationResult[]>([])
  const [stagingFilePath, setStagingFilePath] = useState<string | null>(null)
  const [bulkStageAction, setBulkStageAction] = useState<'stage' | 'unstage' | null>(null)
  const [fileActionError, setFileActionError] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [commitError, setCommitError] = useState<string | null>(null)
  const [commitPending, setCommitPending] = useState(false)
  const [commitModalOpen, setCommitModalOpen] = useState(false)

  const branch = gitSnapshot?.branch
  const changedFiles = gitSnapshot?.changedFiles ?? []
  const changedFileCount = gitSnapshot?.changedFileCount ?? changedFiles.length
  const changedFilesSuppressed = gitSnapshot?.changedFilesSuppressed ?? false
  const changedFilesMap = useMemo(() => {
    const map = new Map<string, GitChangedFile>()
    for (const item of changedFiles) map.set(item.path, item)
    return map
  }, [changedFiles])
  const recentCommits = gitSnapshot?.recentCommits ?? []
  const commitHistoryItems = useMemo(
    () =>
      buildCommitHistoryDisplayItems(recentCommits, {
        localHead: branch?.oid,
        upstreamHead: branch?.upstreamOid,
        hasUpstream: Boolean(branch?.upstream),
        upstreamGone: branch?.upstreamGone ?? false,
        branchAhead: branch?.ahead ?? 0,
        branchBehind: branch?.behind ?? 0,
      }),
    [recentCommits, branch?.oid, branch?.upstreamOid, branch?.upstream, branch?.upstreamGone, branch?.ahead, branch?.behind],
  )
  const currentBranch = branch?.current || t('detail.noBranch')
  const upstreamBranch = branch?.upstream || t('detail.noUpstream')
  const remoteBranches = branch?.remoteBranches ?? []
  const localBranches = branch?.localBranches ?? []
  const conflictedCount = gitSnapshot?.conflictedFileCount ?? changedFiles.filter((file) => file.scope === 'conflicted').length
  const stagedFileCount = changedFiles.filter((file) => file.staged).length
  const hasWorkingTreeChanges = changedFileCount > 0
  const hasConflicts = conflictedCount > 0
  const gitSnapshotPending = gitRepositoriesLoading || (!gitSnapshot && !gitSnapshotError)
  const isGitSnapshotChecking = gitSnapshotLoading || gitSnapshotPending
  const showBranchRemoteLoading = isGitSnapshotChecking || runningOperation === 'switch'
  const showCommitHistoryLoading = isGitSnapshotChecking
  const branchAhead = branch?.ahead ?? 0
  const branchBehind = branch?.behind ?? 0
  const hasUpstream = Boolean(branch?.upstream)
  const upstreamGone = branch?.upstreamGone ?? false
  const gitOperationsUnavailable = !gitSnapshot?.isGitRepository || isGitSnapshotChecking || changedFilesSuppressed
  const commitBlockedReason = gitOperationsUnavailable
    ? isGitSnapshotChecking
      ? t('detail.gitSnapshotLoadingHint')
      : t('detail.gitRepositoryUnavailableHint')
    : hasConflicts
      ? t('detail.gitHintHasConflicts')
      : stagingFilePath || bulkStageAction
        ? t('detail.commitStagedChangesPending')
        : stagedFileCount === 0
          ? t('detail.commitStagedNoChanges')
          : null
  const aiCommitBlockedReason = changedFilesSuppressed ? t('detail.aiCommitBlockedDescription') : null
  const appendOperationLog = useCallback((result: GitOperationResult) => {
    setOperationLogs((prev) => [result, ...prev].slice(0, 50))
  }, [])
  const {
    branchManagerDangerText,
    branchManagerError,
    branchManagerLoading,
    branchManagerMode,
    currentBranchInputRef,
    currentManagerDeleteTarget,
    currentManagerInput,
    gitGuideOpen,
    handleCreateLocalBranch,
    handleCreateRemoteBranchFromUpstream,
    handleDeleteLocalBranch,
    handleSetUpstream,
    setBranchManagerMode,
    setCurrentManagerDeleteTarget,
    setCurrentManagerInput,
    setGitGuideOpen,
    setUpstreamManagerBranchName,
    setUpstreamManagerDangerInput,
    setUpstreamManagerRemoteName,
    upstreamBranchInputRef,
    upstreamManagerBranchName,
    upstreamManagerDangerInput,
    upstreamManagerRemoteName,
  } = useDetailBranchManagerState({
    activePane,
    branchUpstream: branch?.upstream,
    gitSnapshot,
    onOperationResult: appendOperationLog,
    onRefreshGitSnapshot,
    t,
  })
  const {
    activeDiffFile,
    activeDiffFilePath,
    activeDiffSupportsStaged,
    activeDiffSupportsUnstaged,
    conflictData,
    conflictError,
    conflictLoading,
    conflictSaving,
    diffContent,
    diffDrawerOpen,
    diffError,
    diffLoading,
    diffTruncated,
    diffViewMode,
    handleDiffDrawerClose,
    handleDiffDrawerSelectFile,
    handleDiffViewModeChange,
    handleLoadConflict,
    handleSaveConflict,
    openDiffDrawerForFile,
  } = useDetailGitDiffState({
    activePane,
    changedFiles,
    changedFilesMap,
    gitSnapshot,
    onFileActionErrorChange: setFileActionError,
    onRefreshGitSnapshot,
    t,
  })
  const preflightItems = useMemo<PreflightItem[]>(() => {
    if (isGitSnapshotChecking) {
      return [
        {
          key: 'loading',
          label: t('detail.preflightLoading'),
          title: t('detail.preflightLoading'),
          tone: 'neutral',
        },
      ]
    }
    if (!gitSnapshot?.isGitRepository) {
      return [
        {
          key: 'not-git',
          label: t('detail.preflightNotGit'),
          title: t('detail.preflightNotGitTitle'),
          tone: 'danger',
        },
      ]
    }
    if (changedFilesSuppressed) {
      return [
        {
          key: 'suppressed',
          label: t('detail.repositorySelectorChanges', { count: changedFileCount }),
          title: t('detail.gitSnapshotSuppressed'),
          tone: 'warning',
        },
      ]
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

    return [
      {
        key: 'ready',
        label: t('detail.preflightReady', { count: changedFileCount }),
        title: t('detail.preflightReadyTitle'),
        tone: 'success',
      },
    ]
  }, [branch?.detached, branchBehind, changedFileCount, changedFilesSuppressed, conflictedCount, gitSnapshot?.isGitRepository, isGitSnapshotChecking, hasConflicts, hasUpstream, hasWorkingTreeChanges, t])

  const localMergeCandidates = useMemo<IndexedBranchCandidate[]>(
    () =>
      localBranches
        .filter((name) => name !== currentBranch)
        .map((name) => ({
          name,
          searchText: name.toLowerCase(),
        })),
    [localBranches, currentBranch],
  )

  const remoteMergeCandidates = useMemo<IndexedBranchCandidate[]>(
    () =>
      remoteBranches
        .filter((name) => name !== currentBranch)
        .map((name) => ({
          name,
          searchText: name.toLowerCase(),
        })),
    [remoteBranches, currentBranch],
  )

  useEffect(() => {
    if (jumpToAiLogToken <= 0) return
    setMiddlePanelMode('ai-log')
  }, [jumpToAiLogToken])

  useEffect(() => {
    if (activePane === 'aicommit') return
    setMergeSearchValue('')
    setOperationConfirm(null)
    setOperationConfirmInput('')
    setCommitModalOpen(false)
  }, [activePane])

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
  }, [hasConflicts, hasWorkingTreeChanges, branchAhead, branchBehind, hasUpstream, upstreamGone, mergeTarget, currentBranch, localBranches, remoteBranches, runningOperation, gitOperationsUnavailable, gitSnapshotLoading, t])

  const setFileStaged = async (file: GitChangedFile, stage: boolean) => {
    if (!gitSnapshot || stagingFilePath || bulkStageAction) return
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

  const setAllFilesStaged = async (stage: boolean) => {
    if (!gitSnapshot || stagingFilePath || bulkStageAction) return
    const files = changedFiles.filter((file) => (stage ? (file.unstaged || file.scope === 'untracked') && file.scope !== 'conflicted' : file.staged && file.scope !== 'conflicted'))
    if (files.length === 0) return

    setFileActionError(null)
    setBulkStageAction(stage ? 'stage' : 'unstage')
    let failedCount = 0
    try {
      for (const file of files) {
        const result: GitSetFileStageResult = await window.electronAPI.setGitFileStage({
          repoRoot: gitSnapshot.repoRoot,
          filePath: file.path,
          stage,
        })
        if (!result.ok) failedCount += 1
      }
      if (failedCount > 0) {
        setFileActionError(t('detail.gitFilesStageFailed', { count: failedCount }))
      }
    } catch (error) {
      setFileActionError(error instanceof Error ? error.message : String(error))
    } finally {
      try {
        await onRefreshGitSnapshot()
      } finally {
        setBulkStageAction(null)
      }
    }
  }

  const requestCommitStagedChanges = () => {
    if (commitBlockedReason || commitPending) return
    setCommitError(null)
    setCommitModalOpen(true)
  }

  const commitStagedChanges = async () => {
    const message = commitMessage.trim()
    if (!gitSnapshot || commitPending || commitBlockedReason || !message) return

    setCommitError(null)
    setCommitPending(true)
    try {
      const result = await window.electronAPI.runGitOperation({
        repoRoot: gitSnapshot.repoRoot,
        operation: 'commit',
        message,
      })
      appendOperationLog(result)
      if (result.ok) {
        setCommitMessage('')
        setCommitModalOpen(false)
        setMiddlePanelMode('history')
      } else {
        setCommitError(result.error || result.output || t('detail.gitCommitFailed'))
        setMiddlePanelMode('git-log')
      }
    } catch (error) {
      const output = error instanceof Error ? error.message : String(error)
      setCommitError(output)
      const failedResult: GitOperationResult = {
        repoRoot: gitSnapshot.repoRoot,
        operation: 'commit',
        ok: false,
        checkedAt: Date.now(),
        command: '',
        output,
        exitCode: null,
        error: output,
      }
      appendOperationLog(failedResult)
      setMiddlePanelMode('git-log')
    } finally {
      try {
        await onRefreshGitSnapshot()
      } finally {
        setCommitPending(false)
      }
    }
  }

  const handleOpenDiffDrawerForFile = useCallback(
    (filePath: string) => {
      if (!changedFilesMap.has(filePath)) return
      setFileActionError(null)
      openDiffDrawerForFile(filePath)
    },
    [changedFilesMap, openDiffDrawerForFile],
  )

  const requestGitOperation = (operation: PanelGitOperationKind) => {
    const state = operationStates[operation]
    if (state.disabled || !gitSnapshot) return

    const message =
      operation === 'merge'
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
  }, [aiCommitUndoActionAvailable, aiCommitUndoAvailable, aiCommitUndoRunning, onBeginUndoAiCommitAuth, t])

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

  const pendingOperationLabel = operationConfirm ? (operationConfirm.operation === 'undo-ai-commit' ? t('detail.operationConfirmUndoConfirm') : (gitOperationItems.find((item) => item.key === operationConfirm.operation)?.label ?? 'Git')) : 'Git'
  const pendingOperation = operationConfirm?.operation ?? null
  const pendingOperationMessage = pendingOperation === 'undo-ai-commit' ? (aiCommitUndoGraceActive ? t('detail.operationConfirmUndoMessageGrace', { seconds: aiCommitUndoGraceRemainingSeconds }) : t('detail.operationConfirmUndoMessage')) : (operationConfirm?.message ?? '')
  const confirmExactMatch = operationConfirm?.requireExactMatch ?? ''
  const confirmNeedsTypedMatch = Boolean(confirmExactMatch)
  const confirmTypedMatchPassed = !confirmNeedsTypedMatch || operationConfirmInput.trim() === confirmExactMatch
  const pendingOperationTitle = pendingOperation === 'undo-ai-commit' ? t('detail.operationConfirmUndoTitle') : operationConfirm?.title
  const pendingOperationConfirmLabel = pendingOperation === 'undo-ai-commit' ? t('detail.operationConfirmUndoConfirm') : operationConfirm?.confirmLabel
  const pendingOperationCancelLabel = pendingOperation === 'undo-ai-commit' ? t('detail.operationConfirmUndoCancel') : operationConfirm?.cancelLabel
  const pendingOperationHelperText = pendingOperation === 'undo-ai-commit' ? (aiCommitUndoGraceActive ? t('detail.operationConfirmUndoHelper') : t('detail.operationConfirmUndoHelperGrace')) : operationConfirm?.helperText
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
      <div className="relative flex h-full min-h-0 min-w-0 flex-col" style={{ contain: 'layout paint', isolation: 'isolate' }}>
        <div className="flex h-full min-h-0 flex-col gap-4">
          <DetailAiCommitHeader
            activePane={activePane}
            aiAutoCommitButtonRef={aiAutoCommitButtonRef}
            aiCommitStatus={aiCommitStatus}
            aiCommitBlockedReason={aiCommitBlockedReason}
            aiCommitUndo={aiCommitUndo}
            aiCommitUndoAuthActive={aiCommitUndoAuthActive}
            aiCommitUndoAvailable={aiCommitUndoAvailable}
            aiCommitUndoError={aiCommitUndoError}
            aiCommitUndoGraceActive={aiCommitUndoGraceActive}
            aiCommitUndoGraceRemainingSeconds={aiCommitUndoGraceRemainingSeconds}
            aiCommitUndoRemainingSeconds={aiCommitUndoRemainingSeconds}
            aiCommitCanceling={aiCommitCanceling}
            aiCommitUndoRunning={aiCommitUndoRunning}
            firstProjectLinkItem={firstProjectLinkItem}
            hasProjectDocLinks={hasProjectDocLinks}
            flowNodes={flowNodes}
            gitRepositoryControls={gitRepositoryControls}
            isAiEnabled={isAiEnabled}
            onAiAutoCommit={onAiAutoCommit}
            onAiAutoCommitContextMenu={onAiAutoCommitContextMenu}
            onCancelAiCommit={onCancelAiCommit}
            onOpenTranscript={onOpenTranscript}
            onPreloadPane={onPreloadPane}
            onStartAndOpenDevUrl={onStartAndOpenDevUrl}
            onUndoAiCommit={() => {
              void requestUndoAiCommit()
            }}
            onOpenProjectLinksManager={onOpenProjectLinksManager}
            onSwitchPane={onSwitchPane}
            projectHeaderCollapsed={projectHeaderCollapsed}
            projectDevUrlActionVisible={projectDevUrlActionVisible}
            projectDevUrlPending={projectDevUrlPending}
            projectDevUrlReady={projectDevUrlReady}
            projectLinkItems={projectLinkItems}
            projectLinkTagOptions={projectLinkTagOptions}
            projectName={projectName}
            preflightItems={preflightItems}
            statusClass={statusClass}
            statusText={statusText}
          />

          {gitRepositoriesError && <div className="shrink-0 rounded-[14px] border border-[color:var(--color-destructive)]/25 bg-[color:var(--color-destructive-background)] px-3 py-2 text-xs text-[color:var(--color-destructive)]">{gitRepositoriesError}</div>}

          {gitSnapshotError && <div className="shrink-0 rounded-[14px] border border-[color:var(--color-destructive)]/25 bg-[color:var(--color-destructive-background)] px-3 py-2 text-xs text-[color:var(--color-destructive)]">{gitSnapshotError}</div>}

          <section className="grid min-h-0 flex-1 grid-cols-[minmax(260px,0.9fr)_minmax(360px,1.1fr)_300px] gap-4 overflow-hidden xl:grid-cols-[minmax(320px,0.95fr)_minmax(460px,1.2fr)_340px]">
            <DetailAiCommitWorkingTreePanel
              changedFiles={changedFiles}
              changedFileCount={changedFileCount}
              changedFilesSuppressed={changedFilesSuppressed}
              conflictedCount={conflictedCount}
              fileActionError={fileActionError}
              gitSnapshotLoading={isGitSnapshotChecking}
              bulkStageAction={bulkStageAction}
              onOpenDiff={handleOpenDiffDrawerForFile}
              onRefresh={onRefreshGitSnapshot}
              onSetAllFilesStaged={setAllFilesStaged}
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
              commitBlockedReason={commitBlockedReason}
              commitPending={commitPending}
              currentBranch={currentBranch}
              localMergeCandidates={localMergeCandidates}
              remoteMergeCandidates={remoteMergeCandidates}
              mergeTarget={mergeTarget}
              mergeSearchValue={mergeSearchValue}
              onChangeMergeSearchValue={setMergeSearchValue}
              onOpenCurrentBranchManager={() => setBranchManagerMode('current')}
              onOpenGitGuide={() => setGitGuideOpen(true)}
              onOpenUpstreamManager={() => setBranchManagerMode('upstream')}
              onRequestCommit={requestCommitStagedChanges}
              onRequestGitOperation={requestGitOperation}
              onSelectMergeTarget={setMergeTarget}
              operationStates={operationStates}
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
      <DetailAiCommitCommitModal
        blockedReason={commitBlockedReason}
        commitError={commitError}
        commitMessage={commitMessage}
        committing={commitPending}
        onChangeCommitMessage={setCommitMessage}
        onClose={() => {
          if (commitPending) return
          setCommitModalOpen(false)
        }}
        onCommit={() => {
          void commitStagedChanges()
        }}
        open={commitModalOpen}
        stagedFileCount={stagedFileCount}
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
      <DetailAiCommitGitGuideModal open={gitGuideOpen} onClose={() => setGitGuideOpen(false)} />
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
