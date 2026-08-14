import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AiCommitConfig, AiCommitRunOverride, AiCommitTaskSnapshot, AiCommitUndoResult, AiCommitUndoState } from '../../../shared/types'
import { useAppStore } from '../../stores/appStore'
import { BASE_AI_STEPS, applyStep, clampMaxBullets, clampSplitMaxBatches, completePreviousSteps, createBaseAiSteps, getFocusedStepKey, parseAiFlowLine, restoreAiState } from './detail.aiFlow'
import { translateCurrent } from '../../i18n'
import type { AiCommitStatus, AiFlowNode, AiStepKey, AiStepState, DetailGitRepositoryList, DetailGitRepositorySummary, DetailGitSnapshot } from './detail.types'

type UseAiCommitFlowOptions = {
  projectId: string | undefined
  projectPath: string | undefined
  toolProcessId: string
  aiCommitConfig: AiCommitConfig | undefined
}

const pendingUndoCloseTimers = new Map<string, number>()
const MAX_AI_COMMIT_LOG_CHARS = 120_000

function trimAiCommitLog(text: string): string {
  if (text.length <= MAX_AI_COMMIT_LOG_CHARS) return text
  return text.slice(text.length - MAX_AI_COMMIT_LOG_CHARS)
}

function getUndoEffectiveExpiresAt(undo: AiCommitUndoState): number {
  if (Number.isFinite(undo.authStartedAt) && Number.isFinite(undo.authExpiresAt) && (undo.authStartedAt as number) <= undo.expiresAt && (undo.authExpiresAt as number) > undo.expiresAt) {
    return undo.authExpiresAt as number
  }
  return undo.expiresAt
}

export function useAiCommitFlow({ projectId, projectPath, toolProcessId, aiCommitConfig }: UseAiCommitFlowOptions) {
  const [aiCommitStatus, setAiCommitStatus] = useState<AiCommitStatus>('idle')
  const [aiCommitStatusResolved, setAiCommitStatusResolved] = useState(false)
  const [flowSteps, setFlowSteps] = useState<AiStepState[]>(createBaseAiSteps())
  const [aiRawText, setAiRawText] = useState('')
  const [jumpToAiLogToken, setJumpToAiLogToken] = useState(0)
  const [gitSnapshot, setGitSnapshot] = useState<DetailGitSnapshot | null>(null)
  const [gitSnapshotLoading, setGitSnapshotLoading] = useState(false)
  const [gitSnapshotError, setGitSnapshotError] = useState<string | null>(null)
  const [gitRepositories, setGitRepositories] = useState<DetailGitRepositorySummary[]>([])
  const [gitRepositoriesLoading, setGitRepositoriesLoading] = useState(false)
  const [gitRepositoriesError, setGitRepositoriesError] = useState<string | null>(null)
  const [gitRepositoriesTruncated, setGitRepositoriesTruncated] = useState(false)
  const [selectedGitRepositoryId, setSelectedGitRepositoryId] = useState<string | null>(null)
  const [activeCommitHash, setActiveCommitHash] = useState<string | null>(null)
  const [aiCommitUndo, setAiCommitUndo] = useState<AiCommitUndoState | null>(null)
  const [aiCommitUndoRemainingMs, setAiCommitUndoRemainingMs] = useState(0)
  const [aiCommitUndoEffectiveRemainingMs, setAiCommitUndoEffectiveRemainingMs] = useState(0)
  const [aiCommitUndoRunning, setAiCommitUndoRunning] = useState(false)
  const [aiCommitCanceling, setAiCommitCanceling] = useState(false)
  const [aiCommitUndoError, setAiCommitUndoError] = useState<string | null>(null)
  const [quickConfigOpen, setQuickConfigOpen] = useState(false)
  const [quickSplit, setQuickSplit] = useState(Boolean(aiCommitConfig?.split ?? false))
  const [quickSplitMaxBatches, setQuickSplitMaxBatches] = useState(String(clampSplitMaxBatches(aiCommitConfig?.splitMaxBatches)))
  const [quickMaxBullets, setQuickMaxBullets] = useState(String(clampMaxBullets(aiCommitConfig?.maxBullets)))
  const [quickConfigPos, setQuickConfigPos] = useState({ x: 0, y: 0 })
  const quickConfigRef = useRef<HTMLDivElement | null>(null)
  const quickButtonRef = useRef<HTMLButtonElement | null>(null)
  const gitSnapshotRequestSeqRef = useRef(0)

  const isAiEnabled = aiCommitConfig?.enabled ?? true
  const defaultSplit = Boolean(aiCommitConfig?.split ?? false)
  const defaultSplitMaxBatches = clampSplitMaxBatches(aiCommitConfig?.splitMaxBatches)
  const defaultMaxBullets = clampMaxBullets(aiCommitConfig?.maxBullets)
  const quickSplitMaxBatchesNumber = clampSplitMaxBatches(Number.parseInt(quickSplitMaxBatches.trim(), 10))
  const quickMaxBulletsNumber = clampMaxBullets(Number.parseInt(quickMaxBullets.trim(), 10))
  const aiCommitUndoAvailable = Boolean(aiCommitUndo && aiCommitUndo.status === 'available' && aiCommitUndoRemainingMs > 0)
  const aiCommitUndoActionAvailable = Boolean(aiCommitUndo && aiCommitUndo.status === 'available' && aiCommitUndoEffectiveRemainingMs > 0)
  const aiCommitUndoRemainingSeconds = Math.max(0, Math.ceil(aiCommitUndoRemainingMs / 1000))
  const aiCommitUndoAuthActive = Boolean(aiCommitUndo && aiCommitUndo.status === 'available' && Number.isFinite(aiCommitUndo.authStartedAt) && Number.isFinite(aiCommitUndo.authExpiresAt) && aiCommitUndoEffectiveRemainingMs > 0)
  const aiCommitUndoGraceActive = Boolean(aiCommitUndoAuthActive && aiCommitUndoRemainingMs <= 0 && aiCommitUndoEffectiveRemainingMs > 0)
  const aiCommitUndoGraceRemainingSeconds = aiCommitUndoGraceActive ? Math.max(0, Math.ceil(aiCommitUndoEffectiveRemainingMs / 1000)) : 0
  const selectedGitRepository = useMemo(() => {
    if (gitRepositories.length <= 0) return null
    return gitRepositories.find((repo) => repo.id === selectedGitRepositoryId) ?? gitRepositories[0]
  }, [gitRepositories, selectedGitRepositoryId])
  const activeRepoRoot = selectedGitRepository?.repoRoot || (gitSnapshot?.isGitRepository ? gitSnapshot.repoRoot : undefined)
  const selectGitRepository = useCallback((repoId: string) => {
    setSelectedGitRepositoryId(repoId || null)
  }, [])

  const applyUndoState = useCallback((undo: AiCommitUndoState | null | undefined) => {
    const availableUndo = undo && undo.status === 'available' ? undo : null
    setAiCommitUndo(availableUndo)
    if (!availableUndo) {
      setAiCommitUndoRemainingMs(0)
      setAiCommitUndoEffectiveRemainingMs(0)
      return
    }

    const now = Date.now()
    setAiCommitUndoRemainingMs(Math.max(0, availableUndo.expiresAt - now))
    setAiCommitUndoEffectiveRemainingMs(Math.max(0, getUndoEffectiveExpiresAt(availableUndo) - now))
  }, [])

  useEffect(() => {
    gitSnapshotRequestSeqRef.current += 1
    setGitRepositories([])
    setSelectedGitRepositoryId(null)
    setGitSnapshot(null)
    setGitSnapshotError(null)
    setGitRepositoriesError(null)
    setGitRepositoriesTruncated(false)
    setActiveCommitHash(null)
    setAiCommitUndo(null)
    setAiCommitUndoRemainingMs(0)
    setAiCommitUndoEffectiveRemainingMs(0)
    setAiCommitCanceling(false)
    setAiCommitUndoError(null)
    setAiCommitStatus('idle')
    setAiCommitStatusResolved(false)
  }, [projectPath])

  useEffect(() => {
    gitSnapshotRequestSeqRef.current += 1
    setGitSnapshot(null)
    setGitSnapshotError(null)
    setActiveCommitHash(null)
    setAiCommitUndo(null)
    setAiCommitUndoRemainingMs(0)
    setAiCommitUndoEffectiveRemainingMs(0)
    setAiCommitCanceling(false)
    setAiCommitUndoError(null)
  }, [selectedGitRepositoryId])

  useEffect(() => {
    if (!projectId || !toolProcessId) return
    const api = window.electronAPI

    if (typeof api.onAiCommitOutput !== 'function' || typeof api.onAiCommitStatus !== 'function') {
      useAppStore.getState().appendOutput(toolProcessId, '\r\n[AI Commit] preload API is outdated, please restart Electron app process.\r\n')
      return
    }

    const cleanupOutput = api.onAiCommitOutput(({ projectId: pid, data }) => {
      if (pid !== projectId) return
      useAppStore.getState().appendOutput(toolProcessId, data)
      setAiRawText((prev) => trimAiCommitLog(prev + data))
      const split = data
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      if (split.length > 0) {
        setFlowSteps((prev) => split.reduce((acc, line) => parseAiFlowLine(line, acc), prev))
      }
    })

    const cleanupStatus = api.onAiCommitStatus(({ projectId: pid, status }) => {
      if (pid !== projectId) return
      setAiCommitStatusResolved(true)
      setAiCommitStatus(status)
      if (status === 'running') {
        setAiCommitCanceling(false)
        setFlowSteps(createBaseAiSteps())
        setAiRawText('')
        setAiCommitUndo(null)
        setAiCommitUndoRemainingMs(0)
        setAiCommitUndoEffectiveRemainingMs(0)
        setAiCommitUndoError(null)
      } else {
        setAiCommitCanceling(false)
        if (status === 'success') {
          setFlowSteps((prev) => applyStep(completePreviousSteps(prev, 'done'), 'done', 'success'))
          if (typeof api.getAiCommitState === 'function') {
            void api
              .getAiCommitState(projectId)
              .then((state) => {
                applyUndoState(state?.undo)
              })
              .catch(() => {
                // ignore undo refresh failures; the commit itself has already completed
              })
          }
        }
        if (status === 'error') {
          setFlowSteps((prev) => {
            const running = [...prev].reverse().find((s) => s.status === 'running')
            if (running) return applyStep(prev, running.key, 'error')
            return applyStep(prev, 'done', 'error')
          })
          setAiCommitUndo(null)
          setAiCommitUndoRemainingMs(0)
          setAiCommitUndoEffectiveRemainingMs(0)
        }
      }
    })

    void (async () => {
      if (typeof api.getAiCommitState !== 'function') return
      try {
        const state = await api.getAiCommitState(projectId)
        setAiCommitStatusResolved(true)
        if (!state) return
        const restored = restoreAiState({ status: state.status, output: state.output })
        setAiCommitStatus(restored.status)
        setAiCommitCanceling(false)
        setAiRawText(trimAiCommitLog(restored.rawText))
        setFlowSteps(restored.steps)
        applyUndoState(state.undo)
        if (restored.rawText) {
          useAppStore.getState().appendOutput(toolProcessId, `\r\n[AI Commit] restored persisted task (${restored.status})\r\n`)
        }
      } catch {
        setAiCommitStatusResolved(true)
        // ignore restore failures
      }
    })()

    return () => {
      cleanupOutput()
      cleanupStatus()
    }
  }, [applyUndoState, projectId, toolProcessId])

  useEffect(() => {
    setQuickSplit(defaultSplit)
    setQuickSplitMaxBatches(String(defaultSplitMaxBatches))
    setQuickMaxBullets(String(defaultMaxBullets))
  }, [defaultSplit, defaultSplitMaxBatches, defaultMaxBullets, projectId])

  useEffect(() => {
    if (!aiCommitUndo || aiCommitUndo.status !== 'available') {
      setAiCommitUndoRemainingMs(0)
      setAiCommitUndoEffectiveRemainingMs(0)
      return
    }

    const updateRemaining = () => {
      const now = Date.now()
      const baseRemaining = Math.max(0, aiCommitUndo.expiresAt - now)
      const effectiveRemaining = Math.max(0, getUndoEffectiveExpiresAt(aiCommitUndo) - now)
      setAiCommitUndoRemainingMs(baseRemaining)
      setAiCommitUndoEffectiveRemainingMs(effectiveRemaining)
      if (effectiveRemaining <= 0) {
        setAiCommitUndo(null)
        const api = window.electronAPI
        if (projectId && typeof api.closeAiCommitUndo === 'function') {
          void api.closeAiCommitUndo(projectId, 'expired')
        }
      }
    }

    updateRemaining()
    const timer = window.setInterval(updateRemaining, 250)
    return () => {
      window.clearInterval(timer)
    }
  }, [aiCommitUndo, projectId])

  useEffect(() => {
    if (!projectId) return undefined

    const pendingTimer = pendingUndoCloseTimers.get(projectId)
    if (pendingTimer) {
      window.clearTimeout(pendingTimer)
      pendingUndoCloseTimers.delete(projectId)
    }

    return () => {
      const previousTimer = pendingUndoCloseTimers.get(projectId)
      if (previousTimer) {
        window.clearTimeout(previousTimer)
      }

      const api = window.electronAPI

      const timer = window.setTimeout(() => {
        pendingUndoCloseTimers.delete(projectId)
        if (typeof api.closeAiCommitUndo === 'function') {
          void api.closeAiCommitUndo(projectId, 'left-pane')
        }
      }, 0)

      pendingUndoCloseTimers.set(projectId, timer)
    }
  }, [projectId])

  useEffect(() => {
    if (!quickConfigOpen) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as globalThis.Node
      if (quickConfigRef.current?.contains(target)) return
      if (quickButtonRef.current?.contains(target)) return
      setQuickConfigOpen(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setQuickConfigOpen(false)
      }
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [quickConfigOpen])

  useEffect(() => {
    if (!activeCommitHash) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveCommitHash(null)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [activeCommitHash])

  const refreshGitRepositories = useCallback(async () => {
    if (!projectPath) {
      setGitRepositories([])
      setSelectedGitRepositoryId(null)
      setGitSnapshot(null)
      setGitSnapshotError(null)
      setGitRepositoriesError(null)
      setGitRepositoriesTruncated(false)
      setActiveCommitHash(null)
      return
    }

    const api = window.electronAPI

    if (typeof api.listGitRepositories !== 'function') {
      setGitRepositoriesError('Git repository list API is unavailable. Please restart Electron app process.')
      return
    }

    setGitRepositoriesLoading(true)
    setGitRepositoriesError(null)
    try {
      const result = await api.listGitRepositories(projectPath)
      setGitRepositories(result.repositories)
      setGitRepositoriesTruncated(result.truncated)
      const noRepositoryError = result.repositories.length <= 0 ? translateCurrent('detail.gitNotARepository') : null
      setGitRepositoriesError(result.error ?? noRepositoryError)
      setSelectedGitRepositoryId((prev) => {
        if (prev && result.repositories.some((repo) => repo.id === prev)) return prev
        return result.repositories[0]?.id ?? null
      })
      setGitSnapshotError(result.error ?? noRepositoryError)
    } catch (error) {
      setGitRepositoriesError(error instanceof Error ? error.message : String(error))
      setGitRepositories([])
      setSelectedGitRepositoryId(null)
      setGitSnapshotError(error instanceof Error ? error.message : String(error))
    } finally {
      setGitRepositoriesLoading(false)
    }
  }, [projectPath])

  const refreshGitSnapshot = useCallback(async () => {
    if (!selectedGitRepository) {
      setGitSnapshot(null)
      setGitSnapshotError(null)
      setActiveCommitHash(null)
      return
    }

    const api = window.electronAPI

    if (typeof api.getGitRepositorySnapshot !== 'function') {
      setGitSnapshotError('Git repository API is unavailable. Please restart Electron app process.')
      return
    }

    setGitSnapshotLoading(true)
    setGitSnapshotError(null)
    const requestSeq = gitSnapshotRequestSeqRef.current + 1
    gitSnapshotRequestSeqRef.current = requestSeq
    try {
      const result = await api.getGitRepositorySnapshot(selectedGitRepository.repoRoot)
      if (requestSeq !== gitSnapshotRequestSeqRef.current) return
      setGitSnapshot(result)
      setGitSnapshotError(result.error ?? null)
      setActiveCommitHash((prev) => (result.recentCommits.some((item) => item.hash === prev) ? prev : null))
    } catch (error) {
      if (requestSeq !== gitSnapshotRequestSeqRef.current) return
      setGitSnapshotError(error instanceof Error ? error.message : String(error))
    } finally {
      if (requestSeq === gitSnapshotRequestSeqRef.current) setGitSnapshotLoading(false)
    }
  }, [selectedGitRepository])

  useEffect(() => {
    void refreshGitRepositories()
  }, [refreshGitRepositories])

  useEffect(() => {
    if (aiCommitStatus === 'running') return
    void refreshGitSnapshot()
  }, [refreshGitSnapshot, aiCommitStatus])

  const handleAiCommit = useCallback(
    async (override?: AiCommitRunOverride) => {
      if (!projectId || !activeRepoRoot) return
      if (aiCommitStatus === 'running') return

      setAiCommitUndo(null)
      setAiCommitUndoRemainingMs(0)
      setAiCommitCanceling(false)
      setAiCommitUndoError(null)

      const api = window.electronAPI

      if (typeof api.runAiCommit !== 'function') {
        useAppStore.getState().appendOutput(toolProcessId, '\r\n[AI Commit] runAiCommit API is unavailable, please restart Electron app process.\r\n')
        setAiCommitStatus('error')
        return
      }

      setAiCommitStatus('running')
      setJumpToAiLogToken((prev) => prev + 1)
      useAppStore.getState().appendOutput(toolProcessId, `\r\n[AI Commit] trigger: ${isAiEnabled ? 'AI enabled' : 'AI disabled (fallback local message)'}\r\n`)
      if (override) {
        useAppStore.getState().appendOutput(toolProcessId, `[AI Commit] quick override: split=${override.split ? 'on' : 'off'}, maxBatches=${override.splitMaxBatches ?? defaultSplitMaxBatches}, maxBullets=${override.maxBullets ?? defaultMaxBullets}\r\n`)
      }
      const ok = await api.runAiCommit(projectId, activeRepoRoot, override)
      if (!ok) {
        setAiCommitStatus('error')
      }
    },
    [aiCommitStatus, defaultMaxBullets, defaultSplitMaxBatches, isAiEnabled, projectId, activeRepoRoot, toolProcessId],
  )

  const handleCancelAiCommit = useCallback(async () => {
    if (!projectId || aiCommitStatus !== 'running' || aiCommitCanceling) return
    const api = window.electronAPI

    if (typeof api.cancelAiCommit !== 'function') {
      useAppStore.getState().appendOutput(toolProcessId, '\r\n[AI Commit] cancelAiCommit API is unavailable, please restart Electron app process.\r\n')
      return
    }

    setAiCommitCanceling(true)
    try {
      const ok = await api.cancelAiCommit(projectId)
      if (!ok) {
        setAiCommitCanceling(false)
        useAppStore.getState().appendOutput(toolProcessId, '\r\n[AI Commit] no running task was available to cancel.\r\n')
      }
    } catch (error) {
      setAiCommitCanceling(false)
      useAppStore.getState().appendOutput(toolProcessId, `\r\n[AI Commit] failed to cancel task: ${error instanceof Error ? error.message : String(error)}\r\n`)
    }
  }, [aiCommitCanceling, aiCommitStatus, projectId, toolProcessId])

  const handleUndoAiCommit = useCallback(async () => {
    if (!projectId || !aiCommitUndoActionAvailable || aiCommitUndoRunning) return
    const api = window.electronAPI
    if (typeof api.undoAiCommit !== 'function') {
      setAiCommitUndoError(translateCurrent('detail.operationConfirmUndoTitle'))
      return
    }

    setAiCommitUndoRunning(true)
    setAiCommitUndoError(null)
    try {
      const result = await api.undoAiCommit(projectId)
      if (!result.ok) {
        setAiCommitUndoError(result.error || result.output || translateCurrent('common.unknown'))
        applyUndoState(result.undo)
        return
      }
      applyUndoState(null)
      await refreshGitSnapshot()
    } catch (error) {
      setAiCommitUndoError(error instanceof Error ? error.message : String(error))
    } finally {
      setAiCommitUndoRunning(false)
    }
  }, [aiCommitUndoActionAvailable, aiCommitUndoRunning, applyUndoState, projectId, refreshGitSnapshot])

  const handleBeginUndoAiCommitAuth = useCallback(async (): Promise<boolean> => {
    if (!projectId || !aiCommitUndoAvailable || aiCommitUndoRunning) return false
    const api = window.electronAPI
    if (typeof api.beginAiCommitUndoAuth !== 'function') {
      setAiCommitUndoError(translateCurrent('detail.operationConfirmUndoTitle'))
      return false
    }

    setAiCommitUndoError(null)
    try {
      const state = await api.beginAiCommitUndoAuth(projectId)
      applyUndoState(state?.undo)
      if (!state?.undo || state.undo.status !== 'available') {
        setAiCommitUndoError(translateCurrent('detail.operationConfirmUndoHelper'))
        return false
      }
      return true
    } catch (error) {
      setAiCommitUndoError(error instanceof Error ? error.message : String(error))
      return false
    }
  }, [aiCommitUndoAvailable, aiCommitUndoRunning, applyUndoState, projectId])

  const handleCancelUndoAiCommitAuth = useCallback(async (): Promise<void> => {
    if (!projectId) return
    const api = window.electronAPI
    if (typeof api.cancelAiCommitUndoAuth !== 'function') return

    try {
      const state = await api.cancelAiCommitUndoAuth(projectId)
      applyUndoState(state?.undo)
    } catch {
      // ignore auth cancel failures; undo availability will naturally expire if needed
    }
  }, [applyUndoState, projectId])

  const runWithQuickConfig = useCallback(async () => {
    const override = {
      split: quickSplit,
      splitMaxBatches: quickSplitMaxBatchesNumber,
      maxBullets: quickMaxBulletsNumber,
    }
    setQuickConfigOpen(false)
    await handleAiCommit(override)
  }, [handleAiCommit, quickMaxBulletsNumber, quickSplit, quickSplitMaxBatchesNumber])

  const saveQuickConfigAsDefault = useCallback(async () => {
    const nextConfig = {
      ...(aiCommitConfig || {}),
      split: quickSplit,
      splitMaxBatches: quickSplitMaxBatchesNumber,
      maxBullets: quickMaxBulletsNumber,
    }
    await useAppStore.getState().setAiCommitConfig(nextConfig)
    setQuickConfigOpen(false)
  }, [aiCommitConfig, quickMaxBulletsNumber, quickSplit, quickSplitMaxBatchesNumber])

  const statusText = !aiCommitStatusResolved
    ? translateCurrent('common.loading')
    : aiCommitStatus === 'running'
      ? translateCurrent('common.running')
      : aiCommitStatus === 'success'
        ? translateCurrent('detail.gitStatusSuccess')
        : aiCommitStatus === 'error'
          ? translateCurrent('detail.gitStatusFailed')
          : translateCurrent('detail.aiStatusIdle')
  const statusClass = !aiCommitStatusResolved
    ? 'text-[color:var(--color-muted-foreground)] bg-[color:var(--color-background-sunken)]'
    : aiCommitStatus === 'running'
      ? 'text-[color:var(--color-warning)] bg-[color:var(--color-warning-background)]'
      : aiCommitStatus === 'success'
        ? 'text-[color:var(--color-success)] bg-[color:var(--color-success-background)]'
        : aiCommitStatus === 'error'
          ? 'text-[color:var(--color-destructive)] bg-[color:var(--color-destructive-background)]'
          : 'text-[color:var(--color-muted-foreground)] border-[color:var(--color-border)]'

  const flowFocusedStepKey = getFocusedStepKey(flowSteps, aiCommitStatus)
  const flowNodes = useMemo<AiFlowNode[]>(
    () =>
      flowSteps.map((step, index) => ({
        id: step.key,
        data: {
          key: step.key,
          label: step.label,
          status: step.status,
          detail: step.detail,
          index,
          isFocused: step.key === flowFocusedStepKey,
        },
      })),
    [flowSteps, flowFocusedStepKey],
  )

  return {
    aiCommitStatus,
    aiRawText,
    jumpToAiLogToken,
    gitSnapshot,
    gitSnapshotLoading,
    gitSnapshotError,
    gitRepositories,
    gitRepositoriesLoading,
    gitRepositoriesError,
    gitRepositoriesTruncated,
    selectedGitRepositoryId,
    selectedGitRepository,
    setSelectedGitRepositoryId: selectGitRepository,
    refreshGitRepositories,
    refreshGitSnapshot,
    activeCommitHash,
    setActiveCommitHash,
    aiCommitUndo,
    aiCommitUndoAvailable,
    aiCommitUndoActionAvailable,
    aiCommitUndoRemainingSeconds,
    aiCommitUndoAuthActive,
    aiCommitUndoGraceActive,
    aiCommitUndoGraceRemainingSeconds,
    aiCommitCanceling,
    aiCommitUndoRunning,
    aiCommitUndoError,
    quickConfigOpen,
    setQuickConfigOpen,
    quickSplit,
    setQuickSplit,
    quickSplitMaxBatches,
    setQuickSplitMaxBatches,
    quickMaxBullets,
    setQuickMaxBullets,
    quickConfigPos,
    setQuickConfigPos,
    quickConfigRef,
    quickButtonRef,
    isAiEnabled,
    defaultSplit,
    defaultSplitMaxBatches,
    defaultMaxBullets,
    quickSplitMaxBatchesNumber,
    quickMaxBulletsNumber,
    handleAiCommit,
    handleCancelAiCommit,
    handleBeginUndoAiCommitAuth,
    handleCancelUndoAiCommitAuth,
    handleUndoAiCommit,
    runWithQuickConfig,
    saveQuickConfigAsDefault,
    statusText,
    statusClass,
    flowNodes,
  }
}
