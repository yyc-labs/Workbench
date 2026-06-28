import { AlertTriangle, Check, ChevronDown, Loader2, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { projectDisplayName } from '../../lib/projectDisplay'
import type {
  AiEnvironmentConfig,
  AiExecutionMode,
  AiRuntimeProfile,
  BackendMode,
  Capability,
  ManagedProcessSnapshot,
  RuntimeEntrypointConfig,
  RuntimeEntrypointTarget,
  RuntimeEntrypointWslPrefix,
  RuntimeEntry,
  TerminalProcessInventory,
} from '../../../shared/types'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Select, type SelectOption } from '../../components/ui/select'
import { ModalShell } from '../../components/ModalShell'
import { useI18n } from '../../i18n'
import { isTmuxRuntimeMode } from '../../lib/runtimePresentation'
import {
  composeRuntimeEntrypointConfig,
  composeWslEntrypointPath,
  createRuntimeEntrypointConfigFromPath,
  createWslRuntimeEntrypointConfig,
  dedupeRuntimeEntrypointConfigs,
  isLikelyWslEntrypointPath,
  normalizeRuntimeEntrypointConfig,
  normalizeRuntimeEntrypointHistoryEntries,
  runtimeEntrypointConfigsToHistory,
  splitWslEntrypointPath,
} from '../../../shared/runtimeEntrypoint'
import { backendLabel, formatSince } from './settings.helpers'
import { SettingsAiRuntimeProfilesPanel } from './SettingsAiRuntimeProfilesPanel'

type WindowsAiRunningShell = 'pwsh' | 'cmd'

type RuntimePanelProps = {
  capability: Capability | null
  aiEnvironment?: AiEnvironmentConfig
  onAiEnvironmentSave: (value: AiEnvironmentConfig) => Promise<void>
  runtimeLauncherScript: string
  runtimeKeepAliveOnQuit: boolean
  onRuntimeKeepAliveToggle: (enabled: boolean) => Promise<void>
  aiRuntimeProfiles: AiRuntimeProfile[]
  activeAiRuntimeProfileId?: string
  onAiRuntimeProfilesSave: (profiles: AiRuntimeProfile[], activeProfileId: string) => Promise<void>
  projects: { id: string; name: string; path: string }[]
  runtimeEntries: Record<string, RuntimeEntry>
}

function normalizeWindowsAiRunningShell(shell?: AiEnvironmentConfig['shell']): WindowsAiRunningShell {
  return shell === 'cmd' ? 'cmd' : 'pwsh'
}

function supportsWindowsWslOption(capability: Capability | null): boolean {
  return capability?.hostPlatform === 'windows' && Boolean(capability.hasWsl || capability.hasWslInstalled)
}

function getRuntimeEntrypointHistoryKey(entry: RuntimeEntrypointConfig): string {
  return `${entry.target}:${entry.path}`
}

function SettingsRuntimePanel({
  capability,
  aiEnvironment,
  onAiEnvironmentSave,
  runtimeLauncherScript,
  runtimeKeepAliveOnQuit,
  onRuntimeKeepAliveToggle,
  aiRuntimeProfiles,
  activeAiRuntimeProfileId,
  onAiRuntimeProfilesSave,
  projects,
  runtimeEntries,
}: RuntimePanelProps) {
  const { t } = useI18n()
  const historyContainerRef = useRef<HTMLDivElement | null>(null)
  const skipNextScriptPathSyncRef = useRef(false)
  const getDefaultMode = (): AiExecutionMode => {
    if (capability?.hostPlatform === 'windows') {
      return 'windows-native'
    }
    if (capability?.hostPlatform === 'macos') return 'macos-native'
    return 'linux-native'
  }

  const getAvailableModes = (): AiExecutionMode[] => {
    if (!capability) return []
    if (capability.hostPlatform === 'windows') {
      return supportsWindowsWslOption(capability)
        ? ['windows-native', 'windows-wsl', 'custom-script', 'disabled']
        : ['windows-native', 'custom-script', 'disabled']
    }
    return [capability.hostPlatform === 'macos' ? 'macos-native' : 'linux-native', 'custom-script', 'disabled']
  }

  const availableModes = getAvailableModes()
  const defaultMode = getDefaultMode()
  const resolveMode = (mode?: AiExecutionMode): AiExecutionMode => {
    if (mode && availableModes.includes(mode)) return mode
    return availableModes[0] || defaultMode
  }

  const [executionMode, setExecutionMode] = useState<AiExecutionMode>(resolveMode(aiEnvironment?.mode))
  const [windowsAiRunningShell, setWindowsAiRunningShell] = useState<WindowsAiRunningShell>(
    normalizeWindowsAiRunningShell(aiEnvironment?.shell)
  )
  const initialEntrypointConfig = normalizeRuntimeEntrypointConfig(
    aiEnvironment?.runtimeEntrypointConfig,
    runtimeLauncherScript,
  )
  const initialWslParts = splitWslEntrypointPath(initialEntrypointConfig?.path)
  const [scriptPath, setScriptPath] = useState(runtimeLauncherScript)
  const [scriptTarget, setScriptTarget] = useState<RuntimeEntrypointTarget>(initialEntrypointConfig?.target ?? 'native')
  const [wslPathPrefix, setWslPathPrefix] = useState<RuntimeEntrypointWslPrefix>(
    initialEntrypointConfig?.wslPrefix ?? initialWslParts.prefix
  )
  const [wslPathSuffix, setWslPathSuffix] = useState(
    initialEntrypointConfig?.wslRelativePath ?? initialWslParts.relativePath
  )
  const [scriptHistoryOpen, setScriptHistoryOpen] = useState(false)
  const [runtimeEntrypointHistoryEntries, setRuntimeEntrypointHistoryEntries] = useState<RuntimeEntrypointConfig[]>(
    aiEnvironment?.runtimeEntrypointHistoryEntries
      ?? normalizeRuntimeEntrypointHistoryEntries(undefined, aiEnvironment?.runtimeEntrypointHistory, initialEntrypointConfig)
      ?? []
  )
  const [runtimePassProjectPath, setRuntimePassProjectPath] = useState(aiEnvironment?.runtimePassProjectPath ?? true)
  const [historyMutationPending, setHistoryMutationPending] = useState(false)
  const [historyPendingTarget, setHistoryPendingTarget] = useState<string | 'clear-all' | null>(null)
  const [historyMutationError, setHistoryMutationError] = useState<string | null>(null)
  const [historyDeleteConfirmTarget, setHistoryDeleteConfirmTarget] = useState<string | 'clear-all' | null>(null)
  const [diag, setDiag] = useState<{
    mode: AiExecutionMode
    providerLabel: string
    supported: boolean
    availableModes: AiExecutionMode[]
    issues: string[]
    hasWsl: boolean
    hasTmux: boolean
    launcherScriptExists?: boolean
    launcherScriptExecutable?: boolean
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [inventoryLoading, setInventoryLoading] = useState(false)
  const [inventory, setInventory] = useState<TerminalProcessInventory | null>(null)
  const [stopAllLoading, setStopAllLoading] = useState(false)
  const [stopSummary, setStopSummary] = useState<string | null>(null)
  const [saveModeLoading, setSaveModeLoading] = useState(false)
  const [keepAliveEnabled, setKeepAliveEnabled] = useState(runtimeKeepAliveOnQuit)
  const [keepAliveSaving, setKeepAliveSaving] = useState(false)
  const [activeTerminalActionKey, setActiveTerminalActionKey] = useState<string | null>(null)

  useEffect(() => {
    if (skipNextScriptPathSyncRef.current) {
      skipNextScriptPathSyncRef.current = false
      return
    }
    const nextConfig = normalizeRuntimeEntrypointConfig(aiEnvironment?.runtimeEntrypointConfig, runtimeLauncherScript)
    const parts = splitWslEntrypointPath(nextConfig?.path)
    setScriptPath(runtimeLauncherScript)
    setScriptTarget(nextConfig?.target ?? 'native')
    setWslPathPrefix(nextConfig?.wslPrefix ?? parts.prefix)
    setWslPathSuffix(nextConfig?.wslRelativePath ?? parts.relativePath)
  }, [
    runtimeLauncherScript,
    aiEnvironment?.runtimeEntrypointConfig?.target,
    aiEnvironment?.runtimeEntrypointConfig?.wslPrefix,
    aiEnvironment?.runtimeEntrypointConfig?.wslRelativePath,
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
  }, [aiEnvironment?.runtimeEntrypointHistory, aiEnvironment?.runtimeEntrypointHistoryEntries, aiEnvironment?.runtimeEntrypoint, aiEnvironment?.runtimeEntrypointConfig])

  useEffect(() => {
    setExecutionMode(resolveMode(aiEnvironment?.mode))
  }, [aiEnvironment?.mode, capability?.hostPlatform])

  useEffect(() => {
    setWindowsAiRunningShell(normalizeWindowsAiRunningShell(aiEnvironment?.shell))
  }, [aiEnvironment?.shell])

  useEffect(() => {
    setRuntimePassProjectPath(aiEnvironment?.runtimePassProjectPath ?? true)
  }, [aiEnvironment?.runtimePassProjectPath])

  useEffect(() => {
    setKeepAliveEnabled(runtimeKeepAliveOnQuit)
  }, [runtimeKeepAliveOnQuit])

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

  const projectNameMap = new Map(projects.map((p) => [p.id, projectDisplayName(p)]))
  const classifyManagedProcess = (item: ManagedProcessSnapshot): 'tmux' | 'project' | 'idle' => {
    if (item.processId.includes('::toolbox')) return 'idle'
    if (item.backend === 'tmux') return 'tmux'
    return 'project'
  }

  const refreshInventory = async (silent = false) => {
    if (!silent) setInventoryLoading(true)
    try {
      const data = await window.electronAPI.listTerminalProcesses()
      setInventory(data)
    } finally {
      if (!silent) setInventoryLoading(false)
    }
  }

  useEffect(() => {
    void refreshInventory()
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshInventory(true)
    }, 5000)
    return () => {
      window.clearInterval(timer)
    }
  }, [])

  const projectManaged = (inventory?.managedProcesses || []).filter((p) => classifyManagedProcess(p) === 'project')
  const idleManaged = (inventory?.managedProcesses || []).filter((p) => classifyManagedProcess(p) === 'idle')
  const sessionRows = (() => {
    const rows = new Map<string, {
      sessionName: string
      projectLabel?: string
      mode?: string
      status?: string
      createdAt?: number
      startTime?: number
      managedProcessId?: string
      closeBy: 'session' | 'process'
    }>()

    const ensureRow = (sessionName: string) => {
      let row = rows.get(sessionName)
      if (!row) {
        row = {
          sessionName,
          closeBy: 'process',
        }
        rows.set(sessionName, row)
      }
      return row
    }

    for (const item of inventory?.managedProcesses || []) {
      if (!item.sessionName) continue
      const row = ensureRow(item.sessionName)
      row.projectLabel ||= projectNameMap.get(item.projectId) || item.projectId
      row.startTime ||= item.startTime
      row.managedProcessId ||= item.processId
    }

    for (const item of inventory?.runtimeSessions || []) {
      if (!item.sessionName) continue
      const row = ensureRow(item.sessionName)
      row.projectLabel ||= projectNameMap.get(item.projectId) || item.projectId
      row.mode ||= item.mode
      row.status ||= item.status
      row.createdAt ||= item.createdAt
      row.closeBy = 'session'
    }

    for (const item of inventory?.tmuxSessions || []) {
      if (!item.sessionName) continue
      const row = ensureRow(item.sessionName)
      row.projectLabel ||= projectNameMap.get(item.projectId) || item.projectId
      row.status ||= item.status
      row.createdAt ||= item.createdAt
      row.closeBy = 'session'
    }

    return Array.from(rows.values()).sort((a, b) => {
      const left = a.createdAt || a.startTime || 0
      const right = b.createdAt || b.startTime || 0
      return right - left
    })
  })()
  const activeSessionRows = sessionRows.filter((item) => item.status === 'attached')
  const inactiveSessionRows = sessionRows.filter((item) => item.status !== 'attached')

  const closeManagedProcess = async (processId: string) => {
    const actionKey = `process:${processId}`
    setActiveTerminalActionKey(actionKey)
    try {
      await window.electronAPI.stopProcess(processId)
      await refreshInventory()
    } finally {
      setActiveTerminalActionKey((current) => current === actionKey ? null : current)
    }
  }

  const closeTmuxSession = async (sessionName: string) => {
    const actionKey = `session:${sessionName}`
    setActiveTerminalActionKey(actionKey)
    try {
      await window.electronAPI.killTmuxSession(sessionName)
      await refreshInventory()
    } finally {
      setActiveTerminalActionKey((current) => current === actionKey ? null : current)
    }
  }

  const closeAllTerminals = async () => {
    setStopAllLoading(true)
    setStopSummary(null)
    try {
      const result = await window.electronAPI.stopAllTerminalProcesses()
      setStopSummary(
        t('settingsRuntime.stopSummary', {
          managed: result.managedStopped,
          tmux: result.tmuxKilled,
          skipped: result.tmuxSkipped > 0 ? t('settingsRuntime.stopSummarySkipped', { count: result.tmuxSkipped }) : '',
        })
      )
      await refreshInventory()
    } finally {
      setStopAllLoading(false)
    }
  }

  const renderDiagStatus = (value?: boolean) => {
    if (typeof value !== 'boolean') return t('settingsRuntime.notAvailable')
    return value ? t('settingsRuntime.yes') : t('settingsRuntime.no')
  }

  const canShowWslPathOptions = capability?.hostPlatform === 'windows'
    && (supportsWindowsWslOption(capability) || scriptTarget === 'wsl')
  const targetOptions: SelectOption[] = [
    { value: 'native', label: t('settingsRuntime.customScriptTargetNative') },
    ...(canShowWslPathOptions ? [{ value: 'wsl', label: t('settingsRuntime.customScriptTargetWsl') }] : []),
  ]
  const wslPrefixOptions: SelectOption[] = [
    { value: '~/', label: '~/' },
    { value: '$HOME/', label: '$HOME/' },
    { value: '${HOME}/', label: '${HOME}/' },
    { value: '/', label: '/' },
  ]
  const normalizedNativeScriptPath = scriptPath.trim()
  const normalizedWslScriptPath = composeWslEntrypointPath(wslPathPrefix, wslPathSuffix)
  const normalizedScriptPath = scriptTarget === 'wsl' ? normalizedWslScriptPath : normalizedNativeScriptPath
  const currentRuntimeEntrypointConfig = useMemo(() => {
    if (scriptTarget === 'wsl') {
      return createWslRuntimeEntrypointConfig(wslPathPrefix, wslPathSuffix)
    }
    return createRuntimeEntrypointConfigFromPath(normalizedNativeScriptPath, 'native')
  }, [normalizedNativeScriptPath, scriptTarget, wslPathPrefix, wslPathSuffix])
  const mergedRuntimeEntrypointHistoryEntries = useMemo(() => {
    return dedupeRuntimeEntrypointConfigs([
      currentRuntimeEntrypointConfig,
      ...runtimeEntrypointHistoryEntries,
    ])
  }, [currentRuntimeEntrypointConfig, runtimeEntrypointHistoryEntries])
  const buildAiEnvironmentPayload = (
    nextRuntimeEntrypointConfig: RuntimeEntrypointConfig | undefined,
    nextRuntimeEntrypointHistoryEntries: RuntimeEntrypointConfig[],
  ): AiEnvironmentConfig => ({
    mode: executionMode,
    wslDistro: aiEnvironment?.wslDistro,
    shell: capability?.hostPlatform === 'windows' ? windowsAiRunningShell : aiEnvironment?.shell,
    runtimeEntrypointConfig: executionMode === 'custom-script' ? nextRuntimeEntrypointConfig : aiEnvironment?.runtimeEntrypointConfig,
    runtimeEntrypoint: executionMode === 'custom-script'
      ? composeRuntimeEntrypointConfig(nextRuntimeEntrypointConfig) || ''
      : aiEnvironment?.runtimeEntrypoint,
    runtimeEntrypointHistoryEntries: executionMode === 'custom-script'
      ? nextRuntimeEntrypointHistoryEntries
      : aiEnvironment?.runtimeEntrypointHistoryEntries,
    runtimeEntrypointHistory: executionMode === 'custom-script'
      ? runtimeEntrypointConfigsToHistory(nextRuntimeEntrypointHistoryEntries)
      : aiEnvironment?.runtimeEntrypointHistory,
    runtimePassProjectPath,
    aiCommitEntrypoint: aiEnvironment?.aiCommitEntrypoint,
  })

  const runDiagnostics = async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.getRuntimeDiagnostics()
      setDiag({
        mode: result.mode,
        providerLabel: result.providerLabel,
        supported: result.supported,
        availableModes: result.availableModes || [],
        issues: result.issues,
        hasWsl: result.hasWsl,
        hasTmux: result.hasTmux,
        launcherScriptExists: result.launcherScriptExists,
        launcherScriptExecutable: result.launcherScriptExecutable,
      })
    } finally {
      setLoading(false)
    }
  }

  const handleSaveMode = async () => {
    setSaveModeLoading(true)
    try {
      await onAiEnvironmentSave(buildAiEnvironmentPayload(
        executionMode === 'custom-script' ? currentRuntimeEntrypointConfig : aiEnvironment?.runtimeEntrypointConfig,
        executionMode === 'custom-script' ? mergedRuntimeEntrypointHistoryEntries : (aiEnvironment?.runtimeEntrypointHistoryEntries ?? []),
      ))
    } finally {
      setSaveModeLoading(false)
    }
  }

  const handleSelectRuntimeEntrypoint = (entry: RuntimeEntrypointConfig) => {
    if (entry.target === 'wsl') {
      const parts = splitWslEntrypointPath(entry.path)
      setScriptTarget('wsl')
      setWslPathPrefix(entry.wslPrefix ?? parts.prefix)
      setWslPathSuffix(entry.wslRelativePath ?? parts.relativePath)
      setScriptPath(entry.path)
    } else {
      setScriptTarget('native')
      setScriptPath(entry.path)
    }
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
    setHistoryMutationPending(true)
    setHistoryPendingTarget(historyKey)
    setHistoryMutationError(null)
    skipNextScriptPathSyncRef.current = true
    void onAiEnvironmentSave(buildAiEnvironmentPayload(nextPersistedEntrypointConfig, nextHistoryEntries))
      .then(() => {
        setRuntimeEntrypointHistoryEntries(nextHistoryEntries)
        if (nextDraftConfig?.target === 'wsl') {
          const parts = splitWslEntrypointPath(nextDraftConfig.path)
          setScriptTarget('wsl')
          setWslPathPrefix(nextDraftConfig.wslPrefix ?? parts.prefix)
          setWslPathSuffix(nextDraftConfig.wslRelativePath ?? parts.relativePath)
          setScriptPath(nextDraftConfig.path)
        } else {
          setScriptTarget(nextDraftConfig?.target ?? 'native')
          setScriptPath(nextDraftConfig?.path ?? '')
        }
        setScriptHistoryOpen(false)
        setHistoryDeleteConfirmTarget(null)
      })
      .catch((error) => {
        skipNextScriptPathSyncRef.current = false
        const message = error instanceof Error ? error.message : String(error)
        setHistoryMutationError(message || t('settingsRuntime.scriptHistoryUpdateFailed'))
      })
      .finally(() => {
        setHistoryMutationPending(false)
        setHistoryPendingTarget(null)
      })
  }

  const handleClearRuntimeEntrypointHistory = () => {
    if (historyMutationPending || runtimeEntrypointHistoryEntries.length === 0) return
    const persistedRuntimeEntrypointConfig = normalizeRuntimeEntrypointConfig(
      aiEnvironment?.runtimeEntrypointConfig,
      aiEnvironment?.runtimeEntrypoint,
    )
    setHistoryMutationPending(true)
    setHistoryPendingTarget('clear-all')
    setHistoryMutationError(null)
    skipNextScriptPathSyncRef.current = true
    void onAiEnvironmentSave(buildAiEnvironmentPayload(persistedRuntimeEntrypointConfig, []))
      .then(() => {
        setRuntimeEntrypointHistoryEntries([])
        setScriptHistoryOpen(false)
        setHistoryDeleteConfirmTarget(null)
      })
      .catch((error) => {
        skipNextScriptPathSyncRef.current = false
        const message = error instanceof Error ? error.message : String(error)
        setHistoryMutationError(message || t('settingsRuntime.scriptHistoryClearFailed'))
      })
      .finally(() => {
        setHistoryMutationPending(false)
        setHistoryPendingTarget(null)
      })
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

  const handleKeepAliveToggle = async (enabled: boolean) => {
    setKeepAliveEnabled(enabled)
    setKeepAliveSaving(true)
    try {
      await onRuntimeKeepAliveToggle(enabled)
    } catch {
      setKeepAliveEnabled(runtimeKeepAliveOnQuit)
    } finally {
      setKeepAliveSaving(false)
    }
  }

  const allModeOptions: Array<{ value: AiExecutionMode; label: string }> = [
    { value: 'windows-wsl', label: t('settingsRuntime.modeWindowsWsl') },
    { value: 'windows-native', label: t('settingsRuntime.modeWindowsNative') },
    { value: 'linux-native', label: t('settingsRuntime.modeLinuxNative') },
    { value: 'macos-native', label: t('settingsRuntime.modeMacosNative') },
    { value: 'custom-script', label: t('settingsRuntime.modeCustomScript') },
    { value: 'disabled', label: t('settingsRuntime.modeDisabled') },
  ]
  const modeOptions = allModeOptions.filter((option) => availableModes.includes(option.value))
  const usesTmuxRuntime = isTmuxRuntimeMode(executionMode)
  const showWindowsShellOptions = capability?.hostPlatform === 'windows'
  const windowsShellOptions: Array<{
    value: WindowsAiRunningShell
    label: string
    description: string
  }> = [
    {
      value: 'pwsh',
      label: t('settingsRuntime.windowsShellPwsh'),
      description: t('settingsRuntime.windowsShellPwshDescription'),
    },
    {
      value: 'cmd',
      label: t('settingsRuntime.windowsShellCmd'),
      description: t('settingsRuntime.windowsShellCmdDescription'),
    },
  ]
  const historyDeleteConfirmIsClearAll = historyDeleteConfirmTarget === 'clear-all'
  const historyDeleteConfirmValue = historyDeleteConfirmIsClearAll
    ? t('settingsRuntime.clearAll')
    : runtimeEntrypointHistoryEntries.find((item) => getRuntimeEntrypointHistoryKey(item) === historyDeleteConfirmTarget)?.path
      ?? historyDeleteConfirmTarget
      ?? ''

  return (
    <div className="space-y-8">
      <div>
        <p className="section-label mb-3">{t('settingsRuntime.kicker')}</p>
        <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">{t('settingsRuntime.title')}</h2>
        <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2 mb-6">
          {usesTmuxRuntime
            ? t('settings.runtimePanel.managedDescription')
            : t('settings.runtimePanel.unmanagedDescription')}
        </p>
        <div className="mb-6 rounded-[18px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/45 px-4 py-3 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
          <p>
            {usesTmuxRuntime
              ? t('settings.runtimePanel.managedCurrentMode')
              : t('settings.runtimePanel.unmanagedCurrentMode')}
          </p>
          <p className="mt-2">
            {usesTmuxRuntime
              ? t('settings.runtimePanel.managedSwitchHint')
              : t('settings.runtimePanel.unmanagedSwitchHint')}
          </p>
        </div>
        <div className="space-y-4">
          <div className="grid gap-2 md:grid-cols-2">
            {modeOptions.map((option) => (
              <label
                key={option.value}
                className="flex items-center gap-2 rounded-[18px] border px-4 py-3 text-sm text-[color:var(--color-foreground)]"
                style={{ borderColor: executionMode === option.value ? 'var(--color-primary)' : 'var(--color-border)' }}
              >
                <input
                  type="radio"
                  name="runtime-execution-mode"
                  value={option.value}
                  checked={executionMode === option.value}
                  onChange={() => setExecutionMode(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
          {modeOptions.length === 0 && (
            <p className="text-sm text-[color:var(--color-muted-foreground)]">
              {t('settingsRuntime.detectingCapabilities')}
            </p>
          )}
          {showWindowsShellOptions && (
            <div className="rounded-[20px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/35 px-4 py-4">
              <div className="mb-3">
                <p className="text-sm font-medium text-[color:var(--color-foreground)]">
                  {t('settingsRuntime.windowsShellTitle')}
                </p>
                <p className="mt-1 text-xs leading-5 text-[color:var(--color-muted-foreground)]">
                  {t('settingsRuntime.windowsShellHint')}
                </p>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {windowsShellOptions.map((option) => (
                  <label
                    key={option.value}
                    className="flex items-start gap-2 rounded-[16px] border px-4 py-3 text-sm text-[color:var(--color-foreground)]"
                    style={{ borderColor: windowsAiRunningShell === option.value ? 'var(--color-primary)' : 'var(--color-border)' }}
                  >
                    <input
                      type="radio"
                      name="windows-ai-running-shell"
                      value={option.value}
                      checked={windowsAiRunningShell === option.value}
                      onChange={() => setWindowsAiRunningShell(option.value)}
                    />
                    <span>
                      <span className="block font-medium">{option.label}</span>
                      <span className="mt-1 block text-xs leading-5 text-[color:var(--color-muted-foreground)]">
                        {option.description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {executionMode === 'custom-script' && (
            <div className="space-y-3">
              {capability?.hostPlatform === 'windows' && (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsRuntime.customScriptTarget')}</p>
                    <Select
                      ariaLabel={t('settingsRuntime.customScriptTarget')}
                      value={scriptTarget}
                      options={targetOptions}
                      onChange={(value) => {
                        const nextTarget = value === 'wsl' ? 'wsl' : 'native'
                        setScriptTarget(nextTarget)
                        if (nextTarget === 'wsl' && normalizedNativeScriptPath && !normalizedWslScriptPath) {
                          const inferredParts = splitWslEntrypointPath(
                            isLikelyWslEntrypointPath(normalizedNativeScriptPath)
                              ? normalizedNativeScriptPath
                              : `~/${normalizedNativeScriptPath.replace(/^\/+/, '')}`
                          )
                          setWslPathPrefix(inferredParts.prefix)
                          setWslPathSuffix(inferredParts.relativePath)
                        }
                      }}
                    />
                    <p className="text-[11px] leading-5 text-[color:var(--color-muted-foreground)]">
                      {t(
                        scriptTarget === 'wsl'
                          ? 'settingsRuntime.customScriptTargetWslHint'
                          : 'settingsRuntime.customScriptTargetNativeHint'
                      )}
                    </p>
                  </div>
                  {scriptTarget === 'wsl' && (
                    <div className="space-y-1.5">
                      <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsRuntime.customScriptWslPrefix')}</p>
                      <Select
                        ariaLabel={t('settingsRuntime.customScriptWslPrefix')}
                        value={wslPathPrefix}
                        options={wslPrefixOptions}
                        onChange={(value) => setWslPathPrefix(value as RuntimeEntrypointWslPrefix)}
                      />
                    </div>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <div ref={historyContainerRef} className="relative flex-1">
                  <div className="flex gap-2">
                    {scriptTarget === 'wsl' ? (
                      <div className="quiet-control flex h-11 w-full items-center rounded-full border-0 px-4 pr-12 text-sm text-[color:var(--color-foreground)]">
                        <span className="mr-2 shrink-0 text-[color:var(--color-muted-foreground)]">{wslPathPrefix}</span>
                        <input
                          value={wslPathSuffix}
                          onChange={(e) => setWslPathSuffix(e.target.value)}
                          className="min-w-0 flex-1 bg-transparent text-[color:var(--color-foreground)] outline-none placeholder:text-[color:var(--color-muted-foreground)]"
                          placeholder={t('settingsRuntime.customScriptWslPlaceholder')}
                        />
                      </div>
                    ) : (
                      <Input
                        value={scriptPath}
                        onChange={(e) => setScriptPath(e.target.value)}
                        className="quiet-control flex-1 h-11 rounded-full border-0 px-4 pr-12 text-[color:var(--color-foreground)]"
                        placeholder={t('settingsRuntime.customScriptPlaceholder')}
                      />
                    )}
                    <button
                      type="button"
                      className="button-interactive absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                      onClick={() => setScriptHistoryOpen((open) => !open)}
                      title={t('settingsRuntime.showSavedPaths')}
                    >
                      <ChevronDown className={`h-4 w-4 transition-transform ${scriptHistoryOpen ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                  {scriptHistoryOpen && (
                    <div
                      className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-[18px] border border-[color:var(--color-border)] bg-[color:var(--color-popover)]/96 p-1.5 text-[color:var(--color-popover-foreground)] shadow-[var(--shadow-popover)] backdrop-blur-[22px]"
                      style={{ WebkitBackdropFilter: 'saturate(170%) blur(22px)' }}
                    >
                      <div className="mb-1 flex items-center justify-between gap-2 px-2 py-1">
                        <span className="text-[11px] font-medium text-[color:var(--color-muted-foreground)]">
                          {t('settingsRuntime.savedScriptPaths')}
                        </span>
                        <button
                          type="button"
                          className="button-interactive inline-flex h-7 items-center justify-center rounded-full px-2 text-[11px] text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={runtimeEntrypointHistoryEntries.length === 0 || historyMutationPending}
                          onClick={openRuntimeEntrypointClearConfirm}
                          aria-busy={historyPendingTarget === 'clear-all' || undefined}
                        >
                          {historyPendingTarget === 'clear-all' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          {historyMutationPending ? t('settingsRuntime.clearing') : t('settingsRuntime.clearAll')}
                        </button>
                      </div>
                      <div className="max-h-[260px] overflow-auto">
                        {mergedRuntimeEntrypointHistoryEntries.length > 0 ? (
                          mergedRuntimeEntrypointHistoryEntries.map((item) => {
                            const selected = getRuntimeEntrypointHistoryKey(item) === (
                              currentRuntimeEntrypointConfig ? getRuntimeEntrypointHistoryKey(currentRuntimeEntrypointConfig) : ''
                            )
                            const itemKey = getRuntimeEntrypointHistoryKey(item)
                            return (
                              <div
                                key={itemKey}
                                className={`flex items-center gap-2 rounded-[13px] px-2 py-1.5 ${
                                  selected ? 'bg-[color:var(--color-primary)]/12' : ''
                                }`}
                              >
                                <button
                                  type="button"
                                  className="button-interactive flex min-w-0 flex-1 items-center gap-2 rounded-[11px] px-1.5 py-1.5 text-left outline-none transition-colors hover:bg-[color:var(--color-accent)] disabled:opacity-60"
                                  onClick={() => handleSelectRuntimeEntrypoint(item)}
                                  disabled={historyMutationPending}
                                >
                                  <span className="min-w-0 flex-1 truncate text-[12px]">{item.path}</span>
                                  {selected && <Check className="h-4 w-4 shrink-0 text-[color:var(--color-primary)]" />}
                                </button>
                                <button
                                  type="button"
                                  className="button-interactive inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-destructive-background)] hover:text-[color:var(--color-destructive)] disabled:cursor-not-allowed disabled:opacity-50"
                                  onClick={() => openRuntimeEntrypointDeleteConfirm(itemKey)}
                                  title={t('settingsRuntime.deleteSavedPath')}
                                  disabled={historyMutationPending}
                                  aria-busy={historyPendingTarget === itemKey || undefined}
                                >
                                  {historyPendingTarget === itemKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                </button>
                              </div>
                            )
                          })
                        ) : (
                          <p className="px-2 py-2 text-[11px] text-[color:var(--color-muted-foreground)]">
                            {t('settingsRuntime.noSavedScriptPaths')}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {historyMutationError && (
                <p className="text-xs text-[color:var(--color-destructive)]">{historyMutationError}</p>
              )}
              <label className="inline-flex items-start gap-2 text-sm text-[color:var(--color-foreground)]">
                <input
                  type="checkbox"
                  checked={runtimePassProjectPath}
                  onChange={(e) => setRuntimePassProjectPath(e.target.checked)}
                />
                <span>
                  <span className="block">{t('settingsRuntime.passProjectPath')}</span>
                  <span className="mt-1 block text-xs leading-5 text-[color:var(--color-muted-foreground)]">
                    {t('settingsRuntime.passProjectPathHint')}
                  </span>
                </span>
              </label>
            </div>
          )}
          <Button
            className="h-11 rounded-full px-5 text-sm"
            onClick={() => void handleSaveMode()}
            loading={saveModeLoading}
          >
            <Save className="h-4 w-4" />
            {t('settingsRuntime.saveMode')}
          </Button>
        </div>
      </div>

      <ModalShell
        open={Boolean(historyDeleteConfirmTarget)}
        onClose={() => {
          if (historyMutationPending) return
          setHistoryDeleteConfirmTarget(null)
        }}
        widthClassName="max-w-[560px]"
        ariaLabel={t(
          historyDeleteConfirmIsClearAll
            ? 'settingsRuntime.clearSavedPathsConfirmLabel'
            : 'settingsRuntime.deleteSavedPathConfirmLabel'
        )}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div
              className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
              style={{
                background: 'var(--color-destructive-background)',
                color: 'var(--color-destructive)',
              }}
            >
              <AlertTriangle className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">
                {t(
                  historyDeleteConfirmIsClearAll
                    ? 'settingsRuntime.clearSavedPathsConfirmTitle'
                    : 'settingsRuntime.deleteSavedPathConfirmTitle'
                )}
              </h3>
              <p className="mt-1 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
                {historyDeleteConfirmIsClearAll
                  ? t('settingsRuntime.clearSavedPathsConfirmHint', { count: runtimeEntrypointHistoryEntries.length })
                  : t('settingsRuntime.deleteSavedPathConfirmHint', { value: historyDeleteConfirmValue })}
              </p>
            </div>
          </div>

          <div
            className="rounded-[18px] border px-4 py-3"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <p className="break-all text-sm text-[color:var(--color-foreground)]">
              {historyDeleteConfirmValue}
            </p>
          </div>

          {historyMutationError && (
            <p className="text-xs text-[color:var(--color-destructive)]">{historyMutationError}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-10 px-4"
              onClick={() => setHistoryDeleteConfirmTarget(null)}
              disabled={historyMutationPending}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-10 px-4"
              onClick={handleConfirmRuntimeEntrypointHistoryDelete}
              loading={historyMutationPending}
              disabled={historyMutationPending || !historyDeleteConfirmTarget}
            >
              {t('common.delete')}
            </Button>
          </div>
        </div>
      </ModalShell>

      <SettingsAiRuntimeProfilesPanel
        capability={capability}
        profiles={aiRuntimeProfiles}
        activeProfileId={activeAiRuntimeProfileId}
        onProfilesSave={onAiRuntimeProfilesSave}
      />

      <div>
        <p className="section-label mb-3">{t('settingsRuntime.lifecycle')}</p>
        <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">{t('settingsRuntime.quitBehavior')}</h3>
        <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2 mb-4">
          {usesTmuxRuntime
            ? t('settings.runtimePanel.managedQuitDescription')
            : t('settings.runtimePanel.unmanagedQuitDescription')}
        </p>
        <label className="inline-flex items-center gap-2 text-sm text-[color:var(--color-foreground)]">
          <input
            type="checkbox"
            checked={keepAliveEnabled}
            onChange={(e) => void handleKeepAliveToggle(e.target.checked)}
            disabled={!usesTmuxRuntime || keepAliveSaving}
          />
          {usesTmuxRuntime ? t('settings.runtimePanel.managedQuitLabel') : t('settings.runtimePanel.unmanagedQuitLabel')}
          {keepAliveSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[color:var(--color-muted-foreground)]" /> : null}
        </label>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-medium text-[color:var(--color-foreground)]">{t('settingsRuntime.diagnostics')}</h3>
          <Button
            variant="outline"
            className="quiet-control h-8 rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]"
            onClick={() => void runDiagnostics()}
            loading={loading}
          >
            {loading ? t('settingsRuntime.checking') : t('settingsRuntime.runCheck')}
          </Button>
        </div>
        {diag && (
          <div className="rounded-[22px] border px-5 py-4 surface-card space-y-1 text-xs" style={{ borderColor: 'var(--color-border)' }}>
            <p>{t('settingsRuntime.diagMode')}: {diag.mode}</p>
            <p>{t('settingsRuntime.diagProvider')}: {diag.providerLabel}</p>
            <p>{t('settingsRuntime.diagSupported')}: {diag.supported ? t('settingsRuntime.yes') : t('settingsRuntime.no')}</p>
            <p>{t('settingsRuntime.diagWsl')}: {diag.hasWsl ? 'OK' : t('settingsRuntime.missing')}</p>
            <p>{t('settingsRuntime.diagTmux')}: {diag.hasTmux ? 'OK' : t('settingsRuntime.missing')}</p>
            <p>{t('settingsRuntime.diagScriptExists')}: {renderDiagStatus(diag.launcherScriptExists)}</p>
            <p>{t('settingsRuntime.diagScriptExecutable')}: {renderDiagStatus(diag.launcherScriptExecutable)}</p>
            {diag.issues.length > 0 && (
              <div className="mt-2 text-[color:var(--color-destructive)] whitespace-pre-line">
                {diag.issues.map((it) => `- ${it}`).join('\n')}
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-medium text-[color:var(--color-foreground)]">{t('settingsRuntime.terminalProcesses')}</h3>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="quiet-control h-8 rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]"
              onClick={() => void refreshInventory()}
              disabled={stopAllLoading}
              loading={inventoryLoading}
            >
              {inventoryLoading ? t('settingsRuntime.refreshing') : t('settingsRuntime.refresh')}
            </Button>
            <Button
              variant="outline"
              className="h-8 rounded-full px-3 text-xs"
              onClick={() => void closeAllTerminals()}
              loading={stopAllLoading}
            >
              {stopAllLoading ? t('settingsRuntime.stopping') : t('settingsRuntime.closeAllTerminals')}
            </Button>
          </div>
        </div>
        {stopSummary && (
          <p className="mb-2 text-xs text-[color:var(--color-muted-foreground)]">{stopSummary}</p>
        )}
        <div className="space-y-3">
          <div className="rounded-[22px] border px-5 py-4 surface-card" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-[color:var(--color-foreground)]">
                {usesTmuxRuntime ? t('settings.runtimePanel.managedProjectGroup') : t('settings.runtimePanel.unmanagedProjectGroup')}
              </p>
              <span className="text-xs text-[color:var(--color-muted-foreground)]">{projectManaged.length}</span>
            </div>
            {projectManaged.length === 0 ? (
              <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsRuntime.none')}</p>
            ) : (
              <div className="space-y-1.5">
                {projectManaged.map((item) => (
                  <div key={`m-${item.processId}`} className="flex items-center justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate text-[color:var(--color-foreground)]">
                      {projectNameMap.get(item.projectId) || item.projectId} · {backendLabel(item.backend)} · {formatSince(item.startTime)}
                    </span>
                    <Button
                      variant="outline"
                      className="h-7 rounded-full px-2 text-[11px]"
                      onClick={() => void closeManagedProcess(item.processId)}
                      disabled={activeTerminalActionKey !== null}
                      loading={activeTerminalActionKey === `process:${item.processId}`}
                    >
                      {t('settingsRuntime.close')}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-[22px] border px-5 py-4 surface-card" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-[color:var(--color-foreground)]">{t('settingsRuntime.sessions')}</p>
              <span className="text-xs text-[color:var(--color-muted-foreground)]">{sessionRows.length}</span>
            </div>
            {sessionRows.length === 0 ? (
              <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsRuntime.none')}</p>
            ) : (
              <div className="space-y-3">
                {[
                  { key: 'active', label: t('common.active'), items: activeSessionRows },
                  { key: 'inactive', label: t('common.background'), items: inactiveSessionRows },
                ].map((group) => (
                  <div key={group.key}>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-medium text-[color:var(--color-muted-foreground)]">{group.label}</p>
                      <span className="text-[11px] text-[color:var(--color-muted-foreground)]">{group.items.length}</span>
                    </div>
                    {group.items.length === 0 ? (
                      <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsRuntime.none')}</p>
                    ) : (
                      <div className="space-y-1.5">
                        {group.items.map((item) => {
                          const meta = [
                            item.sessionName,
                            item.mode,
                            item.status,
                            item.createdAt ? formatSince(item.createdAt) : item.startTime ? formatSince(item.startTime) : undefined,
                          ].filter(Boolean)
                          return (
                            <div key={`session-${group.key}-${item.sessionName}`} className="flex items-center justify-between gap-3 text-xs">
                              <span className="min-w-0 truncate text-[color:var(--color-foreground)]">
                                {item.projectLabel ? `${item.projectLabel} · ${meta.join(' · ')}` : meta.join(' · ')}
                              </span>
                              <Button
                                variant="outline"
                                className="h-7 rounded-full px-2 text-[11px]"
                                onClick={() => void (
                                  item.closeBy === 'session'
                                    ? closeTmuxSession(item.sessionName)
                                    : item.managedProcessId
                                      ? closeManagedProcess(item.managedProcessId)
                                      : Promise.resolve()
                                )}
                                disabled={activeTerminalActionKey !== null}
                                loading={activeTerminalActionKey === (
                                  item.closeBy === 'session'
                                    ? `session:${item.sessionName}`
                                    : item.managedProcessId
                                      ? `process:${item.managedProcessId}`
                                      : null
                                )}
                              >
                                {t('settingsRuntime.close')}
                              </Button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-[22px] border px-5 py-4 surface-card" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-[color:var(--color-foreground)]">{t('settingsRuntime.cleanable')}</p>
              <span className="text-xs text-[color:var(--color-muted-foreground)]">{idleManaged.length}</span>
            </div>
            {idleManaged.length === 0 ? (
              <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsRuntime.none')}</p>
            ) : (
              <div className="space-y-1.5">
                {idleManaged.map((item) => (
                  <div key={`idle-m-${item.processId}`} className="flex items-center justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate text-[color:var(--color-foreground)]">
                      {item.processId} · {backendLabel(item.backend)} · {formatSince(item.startTime)}
                    </span>
                    <Button
                      variant="outline"
                      className="h-7 rounded-full px-2 text-[11px]"
                      onClick={() => void closeManagedProcess(item.processId)}
                      disabled={activeTerminalActionKey !== null}
                      loading={activeTerminalActionKey === `process:${item.processId}`}
                    >
                      {t('settingsRuntime.close')}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
            {usesTmuxRuntime
              ? t('settings.runtimePanel.managedCleanupHint')
              : t('settings.runtimePanel.unmanagedCleanupHint')}
          </p>
        </div>
      </div>
    </div>
  )
}

export { SettingsRuntimePanel }
