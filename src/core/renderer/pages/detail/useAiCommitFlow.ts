import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AiCommitConfig, AiCommitRunOverride, AiCommitTaskSnapshot } from '../../../shared/types'
import { useAppStore } from '../../stores/appStore'
import {
  BASE_AI_STEPS,
  applyStep,
  clampMaxBullets,
  clampSplitMaxBatches,
  completePreviousSteps,
  getFocusedStepKey,
  parseAiFlowLine,
  restoreAiState,
} from './detail.aiFlow'
import type {
  AiCommitStatus,
  AiFlowNode,
  AiStepKey,
  AiStepState,
  DetailGitSnapshot,
} from './detail.types'

type UseAiCommitFlowOptions = {
  projectId: string | undefined
  projectPath: string | undefined
  toolProcessId: string
  aiCommitConfig: AiCommitConfig | undefined
}

export function useAiCommitFlow({
  projectId,
  projectPath,
  toolProcessId,
  aiCommitConfig,
}: UseAiCommitFlowOptions) {
  const [aiCommitStatus, setAiCommitStatus] = useState<AiCommitStatus>('idle')
  const [flowSteps, setFlowSteps] = useState<AiStepState[]>(BASE_AI_STEPS)
  const [aiRawText, setAiRawText] = useState('')
  const [jumpToAiLogToken, setJumpToAiLogToken] = useState(0)
  const [gitSnapshot, setGitSnapshot] = useState<DetailGitSnapshot | null>(null)
  const [gitSnapshotLoading, setGitSnapshotLoading] = useState(false)
  const [gitSnapshotError, setGitSnapshotError] = useState<string | null>(null)
  const [activeCommitHash, setActiveCommitHash] = useState<string | null>(null)
  const [quickConfigOpen, setQuickConfigOpen] = useState(false)
  const [quickSplit, setQuickSplit] = useState(Boolean(aiCommitConfig?.split ?? false))
  const [quickSplitMaxBatches, setQuickSplitMaxBatches] = useState(
    String(clampSplitMaxBatches(aiCommitConfig?.splitMaxBatches))
  )
  const [quickMaxBullets, setQuickMaxBullets] = useState(
    String(clampMaxBullets(aiCommitConfig?.maxBullets))
  )
  const [quickConfigPos, setQuickConfigPos] = useState({ x: 0, y: 0 })
  const quickConfigRef = useRef<HTMLDivElement | null>(null)
  const quickButtonRef = useRef<HTMLButtonElement | null>(null)

  const isAiEnabled = aiCommitConfig?.enabled ?? true
  const defaultSplit = Boolean(aiCommitConfig?.split ?? false)
  const defaultSplitMaxBatches = clampSplitMaxBatches(aiCommitConfig?.splitMaxBatches)
  const defaultMaxBullets = clampMaxBullets(aiCommitConfig?.maxBullets)
  const quickSplitMaxBatchesNumber = clampSplitMaxBatches(Number.parseInt(quickSplitMaxBatches.trim(), 10))
  const quickMaxBulletsNumber = clampMaxBullets(Number.parseInt(quickMaxBullets.trim(), 10))

  useEffect(() => {
    if (!projectId || !toolProcessId) return
    const api = window.electronAPI as unknown as {
      onAiCommitOutput?: (cb: (d: { projectId: string; data: string }) => void) => () => void
      onAiCommitStatus?: (cb: (d: { projectId: string; status: 'running' | 'success' | 'error' }) => void) => () => void
      getAiCommitState?: (projectId: string) => Promise<AiCommitTaskSnapshot | null>
    }

    if (typeof api.onAiCommitOutput !== 'function' || typeof api.onAiCommitStatus !== 'function') {
      useAppStore.getState().appendOutput(
        toolProcessId,
        '\r\n[AI Commit] preload API is outdated, please restart Electron app process.\r\n'
      )
      return
    }

    const cleanupOutput = api.onAiCommitOutput(({ projectId: pid, data }) => {
      if (pid !== projectId) return
      useAppStore.getState().appendOutput(toolProcessId, data)
      setAiRawText((prev) => prev + data)
      const split = data.replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean)
      if (split.length > 0) {
        setFlowSteps((prev) => split.reduce((acc, line) => parseAiFlowLine(line, acc), prev))
      }
    })

    const cleanupStatus = api.onAiCommitStatus(({ projectId: pid, status }) => {
      if (pid !== projectId) return
      setAiCommitStatus(status)
      if (status === 'running') {
        setFlowSteps(BASE_AI_STEPS)
        setAiRawText('')
      } else {
        if (status === 'success') {
          setFlowSteps((prev) => applyStep(completePreviousSteps(prev, 'done'), 'done', 'success'))
        }
        if (status === 'error') {
          setFlowSteps((prev) => {
            const running = [...prev].reverse().find((s) => s.status === 'running')
            if (running) return applyStep(prev, running.key, 'error')
            return applyStep(prev, 'done', 'error')
          })
        }
      }
    })

    void (async () => {
      if (typeof api.getAiCommitState !== 'function') return
      try {
        const state = await api.getAiCommitState(projectId)
        if (!state) return
        const restored = restoreAiState({ status: state.status, output: state.output })
        setAiCommitStatus(restored.status)
        setAiRawText(restored.rawText)
        setFlowSteps(restored.steps)
        if (restored.rawText) {
          useAppStore.getState().appendOutput(
            toolProcessId,
            `\r\n[AI Commit] restored persisted task (${restored.status})\r\n`
          )
        }
      } catch {
        // ignore restore failures
      }
    })()

    return () => {
      cleanupOutput()
      cleanupStatus()
    }
  }, [projectId, toolProcessId])

  useEffect(() => {
    setQuickSplit(defaultSplit)
    setQuickSplitMaxBatches(String(defaultSplitMaxBatches))
    setQuickMaxBullets(String(defaultMaxBullets))
  }, [defaultSplit, defaultSplitMaxBatches, defaultMaxBullets, projectId])

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

  const refreshGitSnapshot = useCallback(async () => {
    if (!projectPath) {
      setGitSnapshot(null)
      setGitSnapshotError(null)
      setActiveCommitHash(null)
      return
    }

    const api = window.electronAPI as unknown as {
      getGitWorkspaceSnapshot?: (projectPath: string) => Promise<DetailGitSnapshot>
    }

    if (typeof api.getGitWorkspaceSnapshot !== 'function') {
      setGitSnapshotError('Git workspace API is unavailable. Please restart Electron app process.')
      return
    }

    setGitSnapshotLoading(true)
    setGitSnapshotError(null)
    try {
      const result = await api.getGitWorkspaceSnapshot(projectPath)
      setGitSnapshot(result)
      setGitSnapshotError(result.error ?? null)
      setActiveCommitHash((prev) => (
        result.recentCommits.some((item) => item.hash === prev) ? prev : null
      ))
    } catch (error) {
      setGitSnapshotError(error instanceof Error ? error.message : String(error))
    } finally {
      setGitSnapshotLoading(false)
    }
  }, [projectPath])

  useEffect(() => {
    void refreshGitSnapshot()
  }, [refreshGitSnapshot, aiCommitStatus])

  const handleAiCommit = useCallback(async (override?: AiCommitRunOverride) => {
    if (!projectId || !projectPath) return
    if (aiCommitStatus === 'running') return

    const api = window.electronAPI as unknown as {
      runAiCommit?: (
        projectId: string,
        projectPath: string,
        override?: AiCommitRunOverride
      ) => Promise<boolean>
    }

    if (typeof api.runAiCommit !== 'function') {
      useAppStore.getState().appendOutput(
        toolProcessId,
        '\r\n[AI Commit] runAiCommit API is unavailable, please restart Electron app process.\r\n'
      )
      setAiCommitStatus('error')
      return
    }

    setAiCommitStatus('running')
    setJumpToAiLogToken((prev) => prev + 1)
    useAppStore.getState().appendOutput(
      toolProcessId,
      `\r\n[AI Commit] trigger: ${isAiEnabled ? 'AI enabled' : 'AI disabled (fallback local message)'}\r\n`
    )
    if (override) {
      useAppStore.getState().appendOutput(
        toolProcessId,
        `[AI Commit] quick override: split=${override.split ? 'on' : 'off'}, maxBatches=${override.splitMaxBatches ?? defaultSplitMaxBatches}, maxBullets=${override.maxBullets ?? defaultMaxBullets}\r\n`
      )
    }
    const ok = await api.runAiCommit(projectId, projectPath, override)
    if (!ok) {
      setAiCommitStatus('error')
    }
  }, [
    aiCommitStatus,
    defaultMaxBullets,
    defaultSplitMaxBatches,
    isAiEnabled,
    projectId,
    projectPath,
    toolProcessId,
  ])

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

  const statusText =
    aiCommitStatus === 'running' ? 'Running' : aiCommitStatus === 'success' ? 'Success' : aiCommitStatus === 'error' ? 'Failed' : 'Idle'
  const statusClass =
    aiCommitStatus === 'running'
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
    [flowSteps, flowFocusedStepKey]
  )

  return {
    aiCommitStatus,
    aiRawText,
    jumpToAiLogToken,
    gitSnapshot,
    gitSnapshotLoading,
    gitSnapshotError,
    refreshGitSnapshot,
    activeCommitHash,
    setActiveCommitHash,
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
    runWithQuickConfig,
    saveQuickConfigAsDefault,
    statusText,
    statusClass,
    flowNodes,
  }
}
