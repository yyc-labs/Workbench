import { Check, ChevronDown, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { projectDisplayName } from '../../lib/projectDisplay'
import type {
  AiEnvironmentConfig,
  AiExecutionMode,
  BackendMode,
  Capability,
  ManagedProcessSnapshot,
  RuntimeEntry,
  RuntimeSessionInfo,
  TerminalProcessInventory,
  TmuxSessionInfo,
} from '../../../shared/types'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { useI18n } from '../../i18n'
import { isTmuxRuntimeMode } from '../../lib/runtimePresentation'
import { backendLabel, formatSince } from './settings.helpers'

type RuntimePanelProps = {
  capability: Capability | null
  aiEnvironment?: AiEnvironmentConfig
  onAiEnvironmentSave: (value: AiEnvironmentConfig) => Promise<void>
  runtimeLauncherScript: string
  runtimeKeepAliveOnQuit: boolean
  onRuntimeKeepAliveToggle: (enabled: boolean) => Promise<void>
  projects: { id: string; name: string; path: string }[]
  runtimeEntries: Record<string, RuntimeEntry>
}

function SettingsRuntimePanel({
  capability,
  aiEnvironment,
  onAiEnvironmentSave,
  runtimeLauncherScript,
  runtimeKeepAliveOnQuit,
  onRuntimeKeepAliveToggle,
  projects,
  runtimeEntries,
}: RuntimePanelProps) {
  const { t } = useI18n()
  const historyContainerRef = useRef<HTMLDivElement | null>(null)
  const skipNextScriptPathSyncRef = useRef(false)
  const getDefaultMode = (): AiExecutionMode => {
    if (capability?.hostPlatform === 'windows') {
      return capability.hasWsl ? 'windows-wsl' : 'windows-native'
    }
    if (capability?.hostPlatform === 'macos') return 'macos-native'
    return 'linux-native'
  }

  const getAvailableModes = (): AiExecutionMode[] => {
    if (!capability) return []
    if (capability.hostPlatform === 'windows') {
      const modes: AiExecutionMode[] = []
      if (capability.hasWsl) modes.push('windows-wsl')
      modes.push('windows-native', 'custom-script', 'disabled')
      return modes
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
  const [scriptPath, setScriptPath] = useState(runtimeLauncherScript)
  const [scriptHistoryOpen, setScriptHistoryOpen] = useState(false)
  const [runtimeEntrypointHistory, setRuntimeEntrypointHistory] = useState<string[]>(aiEnvironment?.runtimeEntrypointHistory ?? [])
  const [runtimePassProjectPath, setRuntimePassProjectPath] = useState(aiEnvironment?.runtimePassProjectPath ?? true)
  const [historyMutationPending, setHistoryMutationPending] = useState(false)
  const [historyMutationError, setHistoryMutationError] = useState<string | null>(null)
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

  useEffect(() => {
    if (skipNextScriptPathSyncRef.current) {
      skipNextScriptPathSyncRef.current = false
      return
    }
    setScriptPath(runtimeLauncherScript)
  }, [runtimeLauncherScript])

  useEffect(() => {
    setRuntimeEntrypointHistory(aiEnvironment?.runtimeEntrypointHistory ?? [])
  }, [aiEnvironment?.runtimeEntrypointHistory])

  useEffect(() => {
    setExecutionMode(resolveMode(aiEnvironment?.mode))
  }, [aiEnvironment?.mode, capability?.hostPlatform, capability?.hasWsl])

  useEffect(() => {
    setRuntimePassProjectPath(aiEnvironment?.runtimePassProjectPath ?? true)
  }, [aiEnvironment?.runtimePassProjectPath])

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
  const runtimeSessionProjectNameMap = new Map(
    Object.values(runtimeEntries).map((entry) => [entry.sessionName, projectNameMap.get(entry.projectId) || entry.projectId])
  )

  const classifyManagedProcess = (item: ManagedProcessSnapshot): 'tmux' | 'project' | 'idle' => {
    if (item.processId.includes('::toolbox')) return 'idle'
    if (item.backend === 'tmux') return 'tmux'
    return 'project'
  }

  const classifyTmuxSession = (
    session: TmuxSessionInfo,
    managedTmuxNames: Set<string>,
    projectSessionNames: Set<string>
  ): 'tmux' | 'project' | 'idle' => {
    if (managedTmuxNames.has(session.sessionName)) return 'tmux'
    if (projectSessionNames.has(session.sessionName)) return 'project'
    if (session.sessionName.startsWith('lx_')) return 'project'
    return 'idle'
  }

  const projectSessionNameSet = new Set(Object.values(runtimeEntries).map((entry) => entry.sessionName))

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

  const managedTmuxNames = new Set(
    (inventory?.managedProcesses || [])
      .filter((p) => p.backend === 'tmux' && p.sessionName)
      .map((p) => p.sessionName as string)
  )

  const projectManaged = (inventory?.managedProcesses || []).filter((p) => classifyManagedProcess(p) === 'project')
  const tmuxManaged = (inventory?.managedProcesses || []).filter((p) => classifyManagedProcess(p) === 'tmux')
  const idleManaged = (inventory?.managedProcesses || []).filter((p) => classifyManagedProcess(p) === 'idle')

  const projectTmux = (inventory?.tmuxSessions || []).filter(
    (s) => classifyTmuxSession(s, managedTmuxNames, projectSessionNameSet) === 'project'
  )
  const idleTmux = (inventory?.tmuxSessions || []).filter(
    (s) => classifyTmuxSession(s, managedTmuxNames, projectSessionNameSet) === 'idle'
  )
  const runtimeSessions = inventory?.runtimeSessions || []
  const projectRuntimeSessions = runtimeSessions.filter((item) => projectSessionNameSet.has(item.sessionName))
  const idleRuntimeSessions = runtimeSessions.filter((item) => !projectSessionNameSet.has(item.sessionName))

  const closeManagedProcess = async (processId: string) => {
    await window.electronAPI.stopProcess(processId)
    await refreshInventory()
  }

  const closeTmuxSession = async (sessionName: string) => {
    await window.electronAPI.killTmuxSession(sessionName)
    await refreshInventory()
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

  const normalizedScriptPath = scriptPath.trim()
  const mergedRuntimeEntrypointHistory = useMemo(() => {
    const merged = normalizedScriptPath
      ? [normalizedScriptPath, ...runtimeEntrypointHistory]
      : [...runtimeEntrypointHistory]
    return Array.from(new Set(merged.map((item) => item.trim()).filter(Boolean)))
  }, [normalizedScriptPath, runtimeEntrypointHistory])

  const buildAiEnvironmentPayload = (
    nextRuntimeEntrypoint: string,
    nextRuntimeEntrypointHistory: string[],
  ): AiEnvironmentConfig => ({
    mode: executionMode,
    wslDistro: aiEnvironment?.wslDistro,
    shell: aiEnvironment?.shell,
    runtimeEntrypoint: executionMode === 'custom-script' ? nextRuntimeEntrypoint : aiEnvironment?.runtimeEntrypoint,
    runtimeEntrypointHistory: executionMode === 'custom-script' ? nextRuntimeEntrypointHistory : aiEnvironment?.runtimeEntrypointHistory,
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
    const nextRuntimeEntrypoint = executionMode === 'custom-script' ? normalizedScriptPath : aiEnvironment?.runtimeEntrypoint
    await onAiEnvironmentSave(buildAiEnvironmentPayload(
      nextRuntimeEntrypoint || '',
      executionMode === 'custom-script' ? mergedRuntimeEntrypointHistory : (aiEnvironment?.runtimeEntrypointHistory ?? []),
    ))
  }

  const handleSelectRuntimeEntrypoint = (value: string) => {
    setScriptPath(value)
    setScriptHistoryOpen(false)
  }

  const handleDeleteRuntimeEntrypoint = (value: string) => {
    if (historyMutationPending) return
    const persistedRuntimeEntrypoint = aiEnvironment?.runtimeEntrypoint?.trim() || ''
    const nextHistory = runtimeEntrypointHistory.filter((item) => item !== value)
    const nextPersistedEntrypoint = persistedRuntimeEntrypoint === value ? (nextHistory[0] || '') : persistedRuntimeEntrypoint
    const nextDraftPath = scriptPath.trim() === value ? (nextHistory[0] || '') : scriptPath
    setHistoryMutationPending(true)
    setHistoryMutationError(null)
    skipNextScriptPathSyncRef.current = true
    void onAiEnvironmentSave(buildAiEnvironmentPayload(nextPersistedEntrypoint, nextHistory))
      .then(() => {
        setRuntimeEntrypointHistory(nextHistory)
        setScriptPath(nextDraftPath)
        setScriptHistoryOpen(false)
      })
      .catch((error) => {
        skipNextScriptPathSyncRef.current = false
        const message = error instanceof Error ? error.message : String(error)
        setHistoryMutationError(message || t('settingsRuntime.scriptHistoryUpdateFailed'))
      })
      .finally(() => {
        setHistoryMutationPending(false)
      })
  }

  const handleClearRuntimeEntrypointHistory = () => {
    if (historyMutationPending || runtimeEntrypointHistory.length === 0) return
    const persistedRuntimeEntrypoint = aiEnvironment?.runtimeEntrypoint?.trim() || ''
    const nextDraftPath = scriptPath
    setHistoryMutationPending(true)
    setHistoryMutationError(null)
    skipNextScriptPathSyncRef.current = true
    void onAiEnvironmentSave(buildAiEnvironmentPayload(persistedRuntimeEntrypoint, []))
      .then(() => {
        setRuntimeEntrypointHistory([])
        setScriptPath(nextDraftPath)
        setScriptHistoryOpen(false)
      })
      .catch((error) => {
        skipNextScriptPathSyncRef.current = false
        const message = error instanceof Error ? error.message : String(error)
        setHistoryMutationError(message || t('settingsRuntime.scriptHistoryClearFailed'))
      })
      .finally(() => {
        setHistoryMutationPending(false)
      })
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
          {executionMode === 'custom-script' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <div ref={historyContainerRef} className="relative flex-1">
                  <div className="flex gap-2">
                    <Input
                      value={scriptPath}
                      onChange={(e) => setScriptPath(e.target.value)}
                      className="quiet-control flex-1 h-11 rounded-full border-0 px-4 pr-12 text-[color:var(--color-foreground)]"
                      placeholder={t('settingsRuntime.customScriptPlaceholder')}
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
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
                          className="inline-flex h-7 items-center justify-center rounded-full px-2 text-[11px] text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={runtimeEntrypointHistory.length === 0 || historyMutationPending}
                          onClick={handleClearRuntimeEntrypointHistory}
                        >
                          {historyMutationPending ? t('settingsRuntime.clearing') : t('settingsRuntime.clearAll')}
                        </button>
                      </div>
                      <div className="max-h-[260px] overflow-auto">
                        {mergedRuntimeEntrypointHistory.length > 0 ? (
                          mergedRuntimeEntrypointHistory.map((item) => {
                            const selected = item === normalizedScriptPath
                            return (
                              <div
                                key={item}
                                className={`flex items-center gap-2 rounded-[13px] px-2 py-1.5 ${
                                  selected ? 'bg-[color:var(--color-primary)]/12' : ''
                                }`}
                              >
                                <button
                                  type="button"
                                  className="flex min-w-0 flex-1 items-center gap-2 rounded-[11px] px-1.5 py-1.5 text-left outline-none transition-colors hover:bg-[color:var(--color-accent)]"
                                  onClick={() => handleSelectRuntimeEntrypoint(item)}
                                >
                                  <span className="min-w-0 flex-1 truncate text-[12px]">{item}</span>
                                  {selected && <Check className="h-4 w-4 shrink-0 text-[color:var(--color-primary)]" />}
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-destructive-background)] hover:text-[color:var(--color-destructive)] disabled:cursor-not-allowed disabled:opacity-50"
                                  onClick={() => handleDeleteRuntimeEntrypoint(item)}
                                  title={t('settingsRuntime.deleteSavedPath')}
                                  disabled={historyMutationPending}
                                >
                                  <Trash2 className="h-4 w-4" />
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
          >
            {t('settingsRuntime.saveMode')}
          </Button>
        </div>
      </div>

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
            checked={runtimeKeepAliveOnQuit}
            onChange={(e) => void onRuntimeKeepAliveToggle(e.target.checked)}
            disabled={!usesTmuxRuntime}
          />
          {usesTmuxRuntime ? t('settings.runtimePanel.managedQuitLabel') : t('settings.runtimePanel.unmanagedQuitLabel')}
        </label>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-medium text-[color:var(--color-foreground)]">{t('settingsRuntime.diagnostics')}</h3>
          <Button
            variant="outline"
            className="quiet-control h-8 rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]"
            onClick={() => void runDiagnostics()}
            disabled={loading}
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
              disabled={inventoryLoading || stopAllLoading}
            >
              {inventoryLoading ? t('settingsRuntime.refreshing') : t('settingsRuntime.refresh')}
            </Button>
            <Button
              variant="outline"
              className="h-8 rounded-full px-3 text-xs"
              onClick={() => void closeAllTerminals()}
              disabled={stopAllLoading}
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
              <span className="text-xs text-[color:var(--color-muted-foreground)]">{projectManaged.length + projectRuntimeSessions.length}</span>
            </div>
            {projectManaged.length === 0 && projectRuntimeSessions.length === 0 ? (
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
                    >
                      {t('settingsRuntime.close')}
                    </Button>
                  </div>
                ))}
                {projectRuntimeSessions.map((item) => (
                  <div key={`runtime-project-${item.sessionName}`} className="flex items-center justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate text-[color:var(--color-foreground)]">
                      {runtimeSessionProjectNameMap.get(item.sessionName) || item.sessionName} · {item.mode} · {item.status}
                    </span>
                    <Button
                      variant="outline"
                      className="h-7 rounded-full px-2 text-[11px]"
                      onClick={() => void closeTmuxSession(item.sessionName)}
                    >
                      {t('settingsRuntime.close')}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {usesTmuxRuntime && (
            <div className="rounded-[22px] border px-5 py-4 surface-card" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-[color:var(--color-foreground)]">{t('settingsRuntime.tmuxTerminals')}</p>
                <span className="text-xs text-[color:var(--color-muted-foreground)]">{tmuxManaged.length}</span>
              </div>
              {tmuxManaged.length === 0 ? (
                <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsRuntime.none')}</p>
              ) : (
                <div className="space-y-1.5">
                  {tmuxManaged.map((item) => (
                    <div key={`tmux-${item.processId}`} className="flex items-center justify-between gap-3 text-xs">
                      <span className="min-w-0 truncate text-[color:var(--color-foreground)]">
                        {item.sessionName || item.processId} · {formatSince(item.startTime)}
                      </span>
                      <Button
                        variant="outline"
                        className="h-7 rounded-full px-2 text-[11px]"
                        onClick={() => void closeManagedProcess(item.processId)}
                      >
                        {t('settingsRuntime.close')}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="rounded-[22px] border px-5 py-4 surface-card" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-[color:var(--color-foreground)]">{t('settingsRuntime.cleanable')}</p>
              <span className="text-xs text-[color:var(--color-muted-foreground)]">{idleManaged.length + idleTmux.length}</span>
            </div>
            {idleManaged.length === 0 && idleTmux.length === 0 ? (
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
                    >
                      {t('settingsRuntime.close')}
                    </Button>
                  </div>
                ))}
                {idleTmux.map((item) => (
                  <div key={`idle-t-${item.sessionName}`} className="flex items-center justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate text-[color:var(--color-foreground)]">
                      {item.sessionName} · tmux · {item.status}
                    </span>
                    <Button
                      variant="outline"
                      className="h-7 rounded-full px-2 text-[11px]"
                      onClick={() => void closeTmuxSession(item.sessionName)}
                    >
                      {t('settingsRuntime.close')}
                    </Button>
                  </div>
                ))}
                {idleRuntimeSessions.map((item) => (
                  <div key={`idle-runtime-${item.sessionName}`} className="flex items-center justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate text-[color:var(--color-foreground)]">
                      {item.sessionName} · {item.mode} · {item.status}
                    </span>
                    <Button
                      variant="outline"
                      className="h-7 rounded-full px-2 text-[11px]"
                      onClick={() => void closeTmuxSession(item.sessionName)}
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
