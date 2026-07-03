import { useEffect, useMemo, useRef, useState } from 'react'
import type { AiEnvironmentConfig, RuntimeEntrypointConfig } from '../../../../shared/types'
import {
  dedupeRuntimeEntrypointConfigs,
  normalizeRuntimeEntrypointConfig,
  normalizeRuntimeEntrypointHistoryEntries,
} from '../../../../shared/runtimeEntrypoint'

type TranslateFn = (key: string, values?: Record<string, number | string>) => string

type UseRuntimeEntrypointHistoryStateArgs = {
  aiEnvironment?: AiEnvironmentConfig
  buildAiEnvironmentPayload: (
    nextRuntimeEntrypointConfig: RuntimeEntrypointConfig | undefined,
    nextRuntimeEntrypointHistoryEntries: RuntimeEntrypointConfig[],
  ) => AiEnvironmentConfig
  currentRuntimeEntrypointConfig: RuntimeEntrypointConfig | undefined
  onAiEnvironmentSave: (value: AiEnvironmentConfig) => Promise<void>
  applyDraftConfig: (config: RuntimeEntrypointConfig | undefined) => void
  runtimeLauncherScript: string
  t: TranslateFn
}

export function getRuntimeEntrypointHistoryKey(entry: RuntimeEntrypointConfig): string {
  return `${entry.target}:${entry.path}`
}

export function useRuntimeEntrypointHistoryState({
  aiEnvironment,
  buildAiEnvironmentPayload,
  currentRuntimeEntrypointConfig,
  onAiEnvironmentSave,
  applyDraftConfig,
  runtimeLauncherScript,
  t,
}: UseRuntimeEntrypointHistoryStateArgs) {
  const historyContainerRef = useRef<HTMLDivElement | null>(null)
  const skipNextDraftSyncRef = useRef(false)
  const [scriptHistoryOpen, setScriptHistoryOpen] = useState(false)
  const [runtimeEntrypointHistoryEntries, setRuntimeEntrypointHistoryEntries] = useState<RuntimeEntrypointConfig[]>(
    aiEnvironment?.runtimeEntrypointHistoryEntries
      ?? normalizeRuntimeEntrypointHistoryEntries(
        undefined,
        aiEnvironment?.runtimeEntrypointHistory,
        normalizeRuntimeEntrypointConfig(aiEnvironment?.runtimeEntrypointConfig, runtimeLauncherScript),
      )
      ?? []
  )
  const [historyMutationPending, setHistoryMutationPending] = useState(false)
  const [historyPendingTarget, setHistoryPendingTarget] = useState<string | 'clear-all' | null>(null)
  const [historyMutationError, setHistoryMutationError] = useState<string | null>(null)
  const [historyDeleteConfirmTarget, setHistoryDeleteConfirmTarget] = useState<string | 'clear-all' | null>(null)

  useEffect(() => {
    if (skipNextDraftSyncRef.current) {
      skipNextDraftSyncRef.current = false
      return
    }
    applyDraftConfig(normalizeRuntimeEntrypointConfig(aiEnvironment?.runtimeEntrypointConfig, runtimeLauncherScript))
  }, [
    aiEnvironment?.runtimeEntrypointConfig?.target,
    aiEnvironment?.runtimeEntrypointConfig?.wslPrefix,
    aiEnvironment?.runtimeEntrypointConfig?.wslRelativePath,
    aiEnvironment?.runtimeEntrypoint,
    runtimeLauncherScript,
    applyDraftConfig,
  ])

  useEffect(() => {
    setRuntimeEntrypointHistoryEntries(
      aiEnvironment?.runtimeEntrypointHistoryEntries
        ?? normalizeRuntimeEntrypointHistoryEntries(
          undefined,
          aiEnvironment?.runtimeEntrypointHistory,
          aiEnvironment?.runtimeEntrypointConfig ?? aiEnvironment?.runtimeEntrypoint,
        )
        ?? []
    )
  }, [
    aiEnvironment?.runtimeEntrypoint,
    aiEnvironment?.runtimeEntrypointConfig,
    aiEnvironment?.runtimeEntrypointHistory,
    aiEnvironment?.runtimeEntrypointHistoryEntries,
  ])

  useEffect(() => {
    if (!scriptHistoryOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (!historyContainerRef.current?.contains(target)) setScriptHistoryOpen(false)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setScriptHistoryOpen(false)
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [scriptHistoryOpen])

  const mergedRuntimeEntrypointHistoryEntries = useMemo(() => (
    dedupeRuntimeEntrypointConfigs([
      currentRuntimeEntrypointConfig,
      ...runtimeEntrypointHistoryEntries,
    ])
  ), [currentRuntimeEntrypointConfig, runtimeEntrypointHistoryEntries])

  const persistRuntimeEntrypointHistory = (
    nextPersistedEntrypointConfig: RuntimeEntrypointConfig | undefined,
    nextHistoryEntries: RuntimeEntrypointConfig[],
    nextDraftConfig: RuntimeEntrypointConfig | undefined,
    pendingTarget: string | 'clear-all',
    fallbackErrorKey: string,
  ) => {
    setHistoryMutationPending(true)
    setHistoryPendingTarget(pendingTarget)
    setHistoryMutationError(null)
    skipNextDraftSyncRef.current = true

    void onAiEnvironmentSave(buildAiEnvironmentPayload(nextPersistedEntrypointConfig, nextHistoryEntries))
      .then(() => {
        setRuntimeEntrypointHistoryEntries(nextHistoryEntries)
        applyDraftConfig(nextDraftConfig)
        setScriptHistoryOpen(false)
        setHistoryDeleteConfirmTarget(null)
      })
      .catch((error) => {
        skipNextDraftSyncRef.current = false
        const message = error instanceof Error ? error.message : String(error)
        setHistoryMutationError(message || t(fallbackErrorKey))
      })
      .finally(() => {
        setHistoryMutationPending(false)
        setHistoryPendingTarget(null)
      })
  }

  const handleSelectRuntimeEntrypoint = (entry: RuntimeEntrypointConfig) => {
    applyDraftConfig(entry)
    setScriptHistoryOpen(false)
  }

  const handleDeleteRuntimeEntrypoint = (historyKey: string) => {
    if (historyMutationPending) return
    const persistedRuntimeEntrypointConfig = normalizeRuntimeEntrypointConfig(
      aiEnvironment?.runtimeEntrypointConfig,
      aiEnvironment?.runtimeEntrypoint,
    )
    const nextHistoryEntries = runtimeEntrypointHistoryEntries.filter((item) => getRuntimeEntrypointHistoryKey(item) !== historyKey)
    const currentHistoryKey = currentRuntimeEntrypointConfig ? getRuntimeEntrypointHistoryKey(currentRuntimeEntrypointConfig) : null
    const nextPersistedEntrypointConfig = currentHistoryKey === historyKey
      ? nextHistoryEntries[0]
      : persistedRuntimeEntrypointConfig
    const nextDraftConfig = currentHistoryKey === historyKey
      ? nextHistoryEntries[0]
      : currentRuntimeEntrypointConfig

    persistRuntimeEntrypointHistory(
      nextPersistedEntrypointConfig,
      nextHistoryEntries,
      nextDraftConfig,
      historyKey,
      'settingsRuntime.scriptHistoryUpdateFailed',
    )
  }

  const handleClearRuntimeEntrypointHistory = () => {
    if (historyMutationPending || runtimeEntrypointHistoryEntries.length === 0) return
    const persistedRuntimeEntrypointConfig = normalizeRuntimeEntrypointConfig(
      aiEnvironment?.runtimeEntrypointConfig,
      aiEnvironment?.runtimeEntrypoint,
    )
    persistRuntimeEntrypointHistory(
      persistedRuntimeEntrypointConfig,
      [],
      currentRuntimeEntrypointConfig,
      'clear-all',
      'settingsRuntime.scriptHistoryClearFailed',
    )
  }

  const openRuntimeEntrypointDeleteConfirm = (value: string) => {
    if (historyMutationPending) return
    setHistoryMutationError(null)
    setHistoryDeleteConfirmTarget(value)
  }

  const openRuntimeEntrypointClearConfirm = () => {
    if (historyMutationPending || runtimeEntrypointHistoryEntries.length === 0) return
    setHistoryMutationError(null)
    setHistoryDeleteConfirmTarget('clear-all')
  }

  const handleConfirmRuntimeEntrypointHistoryDelete = () => {
    if (!historyDeleteConfirmTarget || historyMutationPending) return
    if (historyDeleteConfirmTarget === 'clear-all') {
      handleClearRuntimeEntrypointHistory()
      return
    }
    handleDeleteRuntimeEntrypoint(historyDeleteConfirmTarget)
  }

  const historyDeleteConfirmIsClearAll = historyDeleteConfirmTarget === 'clear-all'
  const historyDeleteConfirmValue = historyDeleteConfirmIsClearAll
    ? t('settingsRuntime.clearAll')
    : runtimeEntrypointHistoryEntries.find((item) => getRuntimeEntrypointHistoryKey(item) === historyDeleteConfirmTarget)?.path
      ?? historyDeleteConfirmTarget
      ?? ''
  const selectedRuntimeEntrypointHistoryKey = currentRuntimeEntrypointConfig
    ? getRuntimeEntrypointHistoryKey(currentRuntimeEntrypointConfig)
    : ''

  return {
    handleConfirmRuntimeEntrypointHistoryDelete,
    handleSelectRuntimeEntrypoint,
    historyContainerRef,
    historyDeleteConfirmIsClearAll,
    historyDeleteConfirmTarget,
    historyDeleteConfirmValue,
    historyMutationError,
    historyMutationPending,
    historyPendingTarget,
    mergedRuntimeEntrypointHistoryEntries,
    openRuntimeEntrypointClearConfirm,
    openRuntimeEntrypointDeleteConfirm,
    runtimeEntrypointHistoryEntries,
    scriptHistoryOpen,
    selectedRuntimeEntrypointHistoryKey,
    setHistoryDeleteConfirmTarget,
    setScriptHistoryOpen,
  }
}
