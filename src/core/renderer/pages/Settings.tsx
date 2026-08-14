import { ChevronLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { getCodexScopeCacheKey, resolveCodexScopeDescriptor } from '../../shared/codexScope'
import type { AppCacheLocationConfig, AppCacheLocationInfo, AppLocale, BrowserDataCleanupResult, BrowserDataMaintenanceInfo, CloseWindowBehavior, LaunchOnLoginDisplayMode, LegacyUserDataMigrationInfo, ProjectFileExclusionsConfig } from '../../shared/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Input } from '../components/ui/input'
import { useI18n } from '../i18n'
import { useAppStore } from '../stores/appStore'
import { SettingsAboutPanel } from './settings/SettingsAboutPanel'
import { SettingsAgentHooksPanel } from './settings/SettingsAgentHooksPanel'
import { SettingsAgentLogsPanel } from './settings/SettingsAgentLogsPanel'
import { SettingsAgentsPanel } from './settings/SettingsAgentsPanel'
import { SettingsAiCommitPanel } from './settings/SettingsAiCommitPanel'
import { SettingsAiConnectionPanel } from './settings/SettingsAiConnectionPanel'
import { SettingsAiGatewayPanel } from './settings/SettingsAiGatewayPanel'
import { SettingsBrowserAiPanel } from './settings/SettingsBrowserAiPanel'
import { SettingsDataCachePanel } from './settings/SettingsDataCachePanel'
import { SettingsGeneralPanel } from './settings/SettingsGeneralPanel'
import { SettingsRulesPanel } from './settings/SettingsRulesPanel'
import { SettingsRuntimePanel } from './settings/SettingsRuntimePanel'
import { SettingsShortcutsPanel } from './settings/SettingsShortcutsPanel'
import { SettingsSidebar } from './settings/SettingsSidebar'
import { SettingsStartupLogsPanel } from './settings/SettingsStartupLogsPanel'
import { SettingsTranscriptPanel } from './settings/SettingsTranscriptPanel'
import { DEFAULT_SETTINGS_SECTION, isSettingsSection, isSettingsSectionAlias, type SettingsSectionAlias, type ThemeMode } from './settings/settings.types'

const DEFAULT_CACHE_LOCATION: AppCacheLocationConfig = { mode: 'default' }

type SettingsConfirmDialogState = { type: 'restart' } | { type: 'migration-confirm' } | { type: 'migration-restart' } | { type: 'install-cache-warning'; nextLocation: AppCacheLocationConfig } | { type: 'cleanup'; rootPath: string | null }

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function SettingsPage() {
  const { section: sectionParam } = useParams<{ section?: string }>()
  const navigate = useNavigate()
  const config = useAppStore((s) => s.config)
  const capability = useAppStore((s) => s.capability)
  const projects = useAppStore((s) => s.projects)
  const runtimeEntries = useAppStore((s) => s.runtimeEntries)
  const setThemeConfig = useAppStore((s) => s.setTheme)
  const setLocaleConfig = useAppStore((s) => s.setLocale)
  const setLaunchOnLoginConfig = useAppStore((s) => s.setLaunchOnLogin)
  const setLaunchOnLoginDisplayModeConfig = useAppStore((s) => s.setLaunchOnLoginDisplayMode)
  const setCloseWindowBehaviorConfig = useAppStore((s) => s.setCloseWindowBehavior)
  const setCodeFileExclusions = useAppStore((s) => s.setCodeFileExclusions)
  const setCacheLocationConfig = useAppStore((s) => s.setCacheLocation)
  const setAiEnvironmentConfig = useAppStore((s) => s.setAiEnvironmentConfig)
  const setRuntimeKeepAliveOnQuit = useAppStore((s) => s.setRuntimeKeepAliveOnQuit)
  const setAiCommitConfig = useAppStore((s) => s.setAiCommitConfig)
  const setAiRuntimeProfiles = useAppStore((s) => s.setAiRuntimeProfiles)
  const setClaudeRuntimeProfiles = useAppStore((s) => s.setClaudeRuntimeProfiles)
  const setShortcutPreferences = useAppStore((s) => s.setShortcutPreferences)
  const [theme, setTheme] = useState<ThemeMode>(config.theme)
  const [locale, setLocale] = useState<NonNullable<AppLocale>>(config.locale ?? 'system')
  const [launchOnLogin, setLaunchOnLogin] = useState(config.launchOnLogin ?? false)
  const [launchOnLoginDisplayMode, setLaunchOnLoginDisplayMode] = useState<LaunchOnLoginDisplayMode>(config.launchOnLoginDisplayMode ?? 'tray')
  const [closeWindowBehavior, setCloseWindowBehavior] = useState<CloseWindowBehavior>(config.closeWindowBehavior ?? 'quit')
  const [codeFileExclusions, setCodeFileExclusionsState] = useState<ProjectFileExclusionsConfig>(config.codeFileExclusions ?? { directories: [], files: [] })
  const [cacheLocation, setCacheLocation] = useState<AppCacheLocationConfig>(config.cacheLocation ?? DEFAULT_CACHE_LOCATION)
  const [cacheLocationInfo, setCacheLocationInfo] = useState<AppCacheLocationInfo | null>(null)
  const [browserDataMaintenanceInfo, setBrowserDataMaintenanceInfo] = useState<BrowserDataMaintenanceInfo | null>(null)
  const [browserDataMaintenanceAction, setBrowserDataMaintenanceAction] = useState<'cleanup' | null>(null)
  const [browserDataMaintenanceResult, setBrowserDataMaintenanceResult] = useState<BrowserDataCleanupResult | null>(null)
  const [browserDataMaintenanceError, setBrowserDataMaintenanceError] = useState<string | null>(null)
  const [legacyUserDataMigrationInfo, setLegacyUserDataMigrationInfo] = useState<LegacyUserDataMigrationInfo | null>(null)
  const [legacyUserDataMigrationAction, setLegacyUserDataMigrationAction] = useState(false)
  const [legacyUserDataMigrationError, setLegacyUserDataMigrationError] = useState<string | null>(null)
  const [legacyMigrationConfirmText, setLegacyMigrationConfirmText] = useState('')
  const [confirmDialog, setConfirmDialog] = useState<SettingsConfirmDialogState | null>(null)
  const alias = isSettingsSectionAlias(sectionParam) ? (sectionParam as SettingsSectionAlias) : null
  const section = isSettingsSection(sectionParam) ? sectionParam : alias ? 'agents' : DEFAULT_SETTINGS_SECTION
  const preferredCodexScopeKey = getCodexScopeCacheKey(resolveCodexScopeDescriptor(capability, config.aiEnvironment))
  const { t } = useI18n()

  useEffect(() => {
    setTheme(config.theme)
  }, [config.theme])

  useEffect(() => {
    setLocale(config.locale ?? 'system')
  }, [config.locale])

  useEffect(() => {
    setLaunchOnLogin(config.launchOnLogin ?? false)
  }, [config.launchOnLogin])

  useEffect(() => {
    setLaunchOnLoginDisplayMode(config.launchOnLoginDisplayMode ?? 'tray')
  }, [config.launchOnLoginDisplayMode])

  useEffect(() => {
    setCloseWindowBehavior(config.closeWindowBehavior ?? 'quit')
  }, [config.closeWindowBehavior])

  useEffect(() => {
    setCodeFileExclusionsState(config.codeFileExclusions ?? { directories: [], files: [] })
  }, [config.codeFileExclusions])

  useEffect(() => {
    setCacheLocation(config.cacheLocation ?? DEFAULT_CACHE_LOCATION)
    setBrowserDataMaintenanceResult(null)
    setBrowserDataMaintenanceError(null)
  }, [config.cacheLocation])

  useEffect(() => {
    let canceled = false
    window.electronAPI
      .getLegacyUserDataMigrationInfo()
      .then((info) => {
        if (!canceled) setLegacyUserDataMigrationInfo(info)
      })
      .catch(() => {
        if (!canceled) setLegacyUserDataMigrationInfo(null)
      })
    return () => {
      canceled = true
    }
  }, [])

  useEffect(() => {
    let canceled = false
    window.electronAPI
      .getCacheLocationInfo()
      .then((info) => {
        if (!canceled) {
          setCacheLocationInfo(info)
        }
      })
      .catch(() => {
        if (!canceled) {
          setCacheLocationInfo(null)
        }
      })
    return () => {
      canceled = true
    }
  }, [config.cacheLocation])

  useEffect(() => {
    let canceled = false
    window.electronAPI
      .getBrowserDataMaintenanceInfo()
      .then((info) => {
        if (!canceled) {
          setBrowserDataMaintenanceInfo(info)
        }
      })
      .catch(() => {
        if (!canceled) {
          setBrowserDataMaintenanceInfo(null)
        }
      })
    return () => {
      canceled = true
    }
  }, [config.cacheLocation])

  const refreshBrowserDataMaintenanceInfo = async () => {
    const info = await window.electronAPI.getBrowserDataMaintenanceInfo()
    setBrowserDataMaintenanceInfo(info)
    return info
  }

  const handleThemeChange = async (newTheme: ThemeMode) => {
    setTheme(newTheme)
    await setThemeConfig(newTheme)
  }

  const handleLocaleChange = async (nextLocale: NonNullable<AppLocale>) => {
    setLocale(nextLocale)
    await setLocaleConfig(nextLocale)
  }

  const handleLaunchOnLoginChange = async (enabled: boolean) => {
    setLaunchOnLogin(enabled)
    await setLaunchOnLoginConfig(enabled)
  }

  const handleLaunchOnLoginDisplayModeChange = async (mode: LaunchOnLoginDisplayMode) => {
    setLaunchOnLoginDisplayMode(mode)
    await setLaunchOnLoginDisplayModeConfig(mode)
  }

  const handleCloseWindowBehaviorChange = async (behavior: CloseWindowBehavior) => {
    setCloseWindowBehavior(behavior)
    await setCloseWindowBehaviorConfig(behavior)
  }

  const handleCodeFileExclusionsChange = async (next: ProjectFileExclusionsConfig) => {
    setCodeFileExclusionsState(next)
    await setCodeFileExclusions(next)
  }

  const applyCacheLocationChange = async (nextLocation: AppCacheLocationConfig) => {
    setCacheLocation(nextLocation)
    await setCacheLocationConfig(nextLocation)
    const info = await window.electronAPI.getCacheLocationInfo()
    setCacheLocationInfo(info)
  }

  const handleCacheLocationChange = async (nextLocation: AppCacheLocationConfig) => {
    if (nextLocation.mode === 'install' && cacheLocation.mode !== 'install') {
      setConfirmDialog({ type: 'install-cache-warning', nextLocation })
      return
    }

    await applyCacheLocationChange(nextLocation)
  }

  const handleRestartApp = () => {
    setConfirmDialog({ type: 'restart' })
  }

  const executeRestartApp = async () => {
    await window.electronAPI.restartApp()
  }

  const handleMigrateLegacyUserData = async () => {
    setLegacyUserDataMigrationAction(true)
    setLegacyUserDataMigrationError(null)
    try {
      const result = await window.electronAPI.migrateLegacyUserData()
      if (!result.ok) {
        setLegacyUserDataMigrationError(result.error || t('settings.dataCache.legacyMigrationFailed'))
        return
      }
      setLegacyUserDataMigrationInfo({
        sourcePath: result.sourcePath,
        targetPath: result.targetPath,
        sourceExists: true,
        migrationCompleted: true,
      })
      setConfirmDialog({ type: 'migration-restart' })
    } catch (error) {
      setLegacyUserDataMigrationError(toErrorMessage(error))
    } finally {
      setLegacyUserDataMigrationAction(false)
    }
  }

  const handleOpenLegacyMigrationConfirm = () => {
    setLegacyMigrationConfirmText('')
    setLegacyUserDataMigrationError(null)
    setConfirmDialog({ type: 'migration-confirm' })
  }

  const handleSelectCustomCacheDirectory = async () => {
    const selectedPath = await window.electronAPI.selectDirectory(cacheLocation.customPath || cacheLocationInfo?.configuredPath || cacheLocationInfo?.defaultPath)
    if (!selectedPath) return
    await handleCacheLocationChange({
      mode: 'custom',
      customPath: selectedPath,
    })
  }

  const executeCleanupLegacyBrowserCaches = async (rootPath?: string | null) => {
    setBrowserDataMaintenanceAction('cleanup')
    setBrowserDataMaintenanceError(null)
    try {
      const result = await window.electronAPI.cleanupLegacyBrowserCaches(rootPath ?? undefined)
      setBrowserDataMaintenanceInfo(result.info)
      setBrowserDataMaintenanceResult(result)
    } catch (error) {
      setBrowserDataMaintenanceError(toErrorMessage(error))
    } finally {
      setBrowserDataMaintenanceAction(null)
    }
  }

  const handleCleanupLegacyBrowserCaches = (rootPath?: string | null) => {
    setConfirmDialog({
      type: 'cleanup',
      rootPath: rootPath ?? null,
    })
  }

  const handleOpenCurrentBrowserDataDirectory = async () => {
    try {
      const info = browserDataMaintenanceInfo ?? (await refreshBrowserDataMaintenanceInfo())
      await window.electronAPI.openFolder(info.currentBrowserDataPath)
    } catch (error) {
      setBrowserDataMaintenanceError(toErrorMessage(error))
    }
  }

  const handleOpenOldBrowserDataDirectory = async (rootPath?: string | null) => {
    try {
      const info = browserDataMaintenanceInfo ?? (await refreshBrowserDataMaintenanceInfo())
      const targetRoots = rootPath ? info.oldCacheRoots.filter((item) => item.rootPath === rootPath) : info.oldCacheRoots
      const oldPaths = targetRoots.filter((item) => item.rootExists || item.browserDataExists || item.browserDataDetected).map((item) => (item.browserDataExists ? item.browserDataPath : item.rootPath))

      if (oldPaths.length === 0) {
        setBrowserDataMaintenanceError(t('settings.dataCache.noOldBrowserDataDetected'))
        return
      }

      await Promise.all(oldPaths.map((targetPath) => window.electronAPI.openFolder(targetPath)))
    } catch (error) {
      setBrowserDataMaintenanceError(toErrorMessage(error))
    }
  }

  const handleCloseConfirmDialog = () => {
    if (browserDataMaintenanceAction === 'cleanup') return
    setConfirmDialog(null)
  }

  const handleConfirmDialogConfirm = async () => {
    if (!confirmDialog) return

    if (confirmDialog.type === 'restart') {
      setConfirmDialog(null)
      await executeRestartApp()
      return
    }

    if (confirmDialog.type === 'migration-restart') {
      setConfirmDialog(null)
      await executeRestartApp()
      return
    }

    if (confirmDialog.type === 'migration-confirm') {
      if (legacyMigrationConfirmText.trim() !== t('settings.dataCache.legacyMigrationConfirmPhrase')) {
        setLegacyUserDataMigrationError(t('settings.dataCache.legacyMigrationConfirmMismatch'))
        return
      }
      setConfirmDialog(null)
      await handleMigrateLegacyUserData()
      return
    }

    if (confirmDialog.type === 'install-cache-warning') {
      setConfirmDialog(null)
      await applyCacheLocationChange(confirmDialog.nextLocation)
      return
    }

    await executeCleanupLegacyBrowserCaches(confirmDialog.rootPath)
    setConfirmDialog(null)
  }

  if (!isSettingsSection(sectionParam) && !isSettingsSectionAlias(sectionParam)) {
    return <Navigate to={`/settings/${DEFAULT_SETTINGS_SECTION}`} replace />
  }

  return (
    <div className="h-full flex flex-col">
      <header className="app-chrome flex min-h-[84px] items-center gap-4 px-8 py-4 shrink-0">
        <button className="button-interactive p-2 rounded-full text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)] transition-colors" onClick={() => navigate('/')}>
          <ChevronLeft className="w-5 h-5" strokeWidth={1.8} />
        </button>
        <h1 className="text-xl font-semibold text-[color:var(--color-foreground)] tracking-[-0.03em]">{t('settings.title')}</h1>
      </header>

      <div className="flex-1 min-h-0 overflow-hidden px-8 pb-10 pt-10">
        <div className="flex h-full min-h-0 min-w-0">
          <SettingsSidebar active={section} onSelect={(nextSection) => navigate(`/settings/${nextSection}`)} />

          <main className="flex-1 min-h-0 min-w-0 ml-12 overflow-y-auto px-6 pt-1">
            <div className="h-full min-h-0 pb-6 -mb-6">
              {section === 'general' && (
                <SettingsGeneralPanel
                  theme={theme}
                  locale={locale}
                  launchOnLogin={launchOnLogin}
                  launchOnLoginDisplayMode={launchOnLoginDisplayMode}
                  closeWindowBehavior={closeWindowBehavior}
                  codeFileExclusions={codeFileExclusions}
                  supportsLaunchOnLogin={capability?.hostPlatform === 'windows'}
                  supportsCloseWindowBehavior={capability?.hostPlatform === 'windows'}
                  configRecovery={config.configRecovery}
                  onThemeChange={handleThemeChange}
                  onLocaleChange={handleLocaleChange}
                  onLaunchOnLoginChange={handleLaunchOnLoginChange}
                  onLaunchOnLoginDisplayModeChange={handleLaunchOnLoginDisplayModeChange}
                  onCloseWindowBehaviorChange={handleCloseWindowBehaviorChange}
                  onCodeFileExclusionsChange={handleCodeFileExclusionsChange}
                />
              )}
              {section === 'shortcuts' && <SettingsShortcutsPanel shortcutPreferences={config.shortcutPreferences} onSave={setShortcutPreferences} />}
              {section === 'data' && (
                <SettingsDataCachePanel
                  cacheLocation={cacheLocation}
                  cacheLocationInfo={cacheLocationInfo}
                  browserDataMaintenanceInfo={browserDataMaintenanceInfo}
                  browserDataMaintenanceAction={browserDataMaintenanceAction}
                  browserDataMaintenanceResult={browserDataMaintenanceResult}
                  browserDataMaintenanceError={browserDataMaintenanceError}
                  legacyUserDataMigrationInfo={legacyUserDataMigrationInfo}
                  legacyUserDataMigrationAction={legacyUserDataMigrationAction}
                  legacyUserDataMigrationError={legacyUserDataMigrationError}
                  onCacheLocationChange={handleCacheLocationChange}
                  onRestartApp={handleRestartApp}
                  onSelectCustomCacheDirectory={handleSelectCustomCacheDirectory}
                  onCleanupLegacyBrowserCaches={handleCleanupLegacyBrowserCaches}
                  onOpenCurrentBrowserDataDirectory={handleOpenCurrentBrowserDataDirectory}
                  onOpenOldBrowserDataDirectory={handleOpenOldBrowserDataDirectory}
                  onMigrateLegacyUserData={handleOpenLegacyMigrationConfirm}
                />
              )}
              {section === 'runtime' && (
                <SettingsRuntimePanel
                  capability={capability}
                  aiEnvironment={config.aiEnvironment}
                  onAiEnvironmentSave={setAiEnvironmentConfig}
                  runtimeLauncherScript={config.aiEnvironment?.runtimeEntrypoint || ''}
                  runtimeKeepAliveOnQuit={config.runtimeKeepAliveOnQuit ?? false}
                  onRuntimeKeepAliveToggle={setRuntimeKeepAliveOnQuit}
                  aiRuntimeProfiles={config.aiRuntimeProfiles ?? []}
                  activeAiRuntimeProfileId={config.activeAiRuntimeProfileId}
                  onAiRuntimeProfilesSave={setAiRuntimeProfiles}
                  projects={projects}
                  runtimeEntries={runtimeEntries}
                />
              )}
              {section === 'agents' && (
                <SettingsAgentsPanel
                  capability={capability}
                  mode={config.aiEnvironment?.mode}
                  aiEnvironment={config.aiEnvironment}
                  profiles={config.claudeRuntimeProfiles ?? []}
                  activeProfileId={config.activeClaudeRuntimeProfileId}
                  onProfilesSave={setClaudeRuntimeProfiles}
                  initialTab={alias === 'codex' ? 'codex' : 'claude'}
                />
              )}
              {section === 'gateway' && <SettingsAiGatewayPanel profiles={config.claudeRuntimeProfiles ?? []} activeProfileId={config.activeClaudeRuntimeProfileId} onProfilesSave={setClaudeRuntimeProfiles} />}
              {section === 'browser-ai' && <SettingsBrowserAiPanel />}
              {section === 'ai-connection' && <SettingsAiConnectionPanel aiCommit={config.aiCommit} aiGateway={config.aiGateway} claudeRuntimeProfiles={config.claudeRuntimeProfiles ?? []} />}
              {section === 'transcripts' && <SettingsTranscriptPanel projects={projects} removedProjects={config.removedProjects} />}
              {section === 'hooks' && <SettingsAgentHooksPanel />}
              {section === 'agent-logs' && <SettingsAgentLogsPanel />}
              {section === 'logs' && <SettingsStartupLogsPanel projects={projects} />}
              {section === 'ai' && (
                <SettingsAiCommitPanel
                  aiCommit={config.aiCommit || {}}
                  onSave={setAiCommitConfig}
                  claudeRuntimeProfiles={config.claudeRuntimeProfiles ?? []}
                  codexSettingsSnapshots={config.codexSettingsSnapshots ?? {}}
                  codexGatewayBindings={config.codexGatewayBindings ?? {}}
                  preferredCodexScopeKey={preferredCodexScopeKey}
                />
              )}
              {section === 'rules' && <SettingsRulesPanel />}
              {section === 'about' && <SettingsAboutPanel />}
            </div>
          </main>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(confirmDialog)}
        onClose={handleCloseConfirmDialog}
        onConfirm={handleConfirmDialogConfirm}
        ariaLabel={
          confirmDialog?.type === 'cleanup'
            ? t('settings.dataCache.browserDataCleanupConfirmTitle')
            : confirmDialog?.type === 'install-cache-warning'
              ? t('settings.dataCache.cacheLocationInstallConfirmTitle')
              : confirmDialog?.type === 'migration-confirm'
                ? t('settings.dataCache.legacyMigrationConfirmTitle')
                : confirmDialog?.type === 'migration-restart'
                  ? t('settings.dataCache.legacyMigrationRestartTitle')
                  : t('settings.dataCache.restartConfirmTitle')
        }
        title={
          confirmDialog?.type === 'cleanup'
            ? t('settings.dataCache.browserDataCleanupConfirmTitle')
            : confirmDialog?.type === 'install-cache-warning'
              ? t('settings.dataCache.cacheLocationInstallConfirmTitle')
              : confirmDialog?.type === 'migration-confirm'
                ? t('settings.dataCache.legacyMigrationConfirmTitle')
                : confirmDialog?.type === 'migration-restart'
                  ? t('settings.dataCache.legacyMigrationRestartTitle')
                  : t('settings.dataCache.restartConfirmTitle')
        }
        description={
          confirmDialog?.type === 'cleanup'
            ? t('settings.dataCache.browserDataCleanupConfirm')
            : confirmDialog?.type === 'install-cache-warning'
              ? t('settings.dataCache.cacheLocationInstallConfirm')
              : confirmDialog?.type === 'migration-confirm'
                ? t('settings.dataCache.legacyMigrationConfirmDescription')
                : confirmDialog?.type === 'migration-restart'
                  ? t('settings.dataCache.legacyMigrationRestart')
                  : t('settings.dataCache.restartConfirm')
        }
        confirmLabel={
          confirmDialog?.type === 'cleanup'
            ? t('settings.dataCache.cleanupLegacyBrowserCaches')
            : confirmDialog?.type === 'install-cache-warning'
              ? t('settings.dataCache.cacheLocationInstallConfirmButton')
              : confirmDialog?.type === 'migration-confirm'
                ? t('settings.dataCache.legacyMigrationConfirmButton')
                : t('settings.dataCache.restartApp')
        }
        confirmVariant={confirmDialog?.type === 'cleanup' ? 'destructive' : 'default'}
        busy={browserDataMaintenanceAction === 'cleanup'}
      >
        {confirmDialog?.type === 'install-cache-warning' && (
          <div className="rounded-[18px] border px-4 py-3" style={{ borderColor: 'var(--color-border)' }}>
            <p className="text-xs font-medium text-[color:var(--color-foreground)]">{t('settings.dataCache.cacheLocationInstallConfirmAdviceTitle')}</p>
            <p className="mt-2 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('settings.dataCache.cacheLocationInstallConfirmAdvice')}</p>
            <code className="mt-3 block break-all font-mono text-[11px] text-[color:var(--color-foreground)]">{t('settings.dataCache.cacheLocationInstallConfirmExample')}</code>
          </div>
        )}
        {confirmDialog?.type === 'migration-confirm' && (
          <div className="space-y-3">
            <div className="rounded-[18px] border px-4 py-3" style={{ borderColor: 'var(--color-border)' }}>
              <p className="text-xs font-medium text-[color:var(--color-foreground)]">{t('settings.dataCache.legacyMigrationConfirmPhraseLabel')}</p>
              <code className="mt-2 block select-all font-mono text-[11px] text-[color:var(--color-foreground)]">{t('settings.dataCache.legacyMigrationConfirmPhrase')}</code>
            </div>
            <Input value={legacyMigrationConfirmText} onChange={(event) => setLegacyMigrationConfirmText(event.target.value)} placeholder={t('settings.dataCache.legacyMigrationConfirmInputPlaceholder')} autoFocus />
            {legacyUserDataMigrationError && <p className="text-xs leading-5 text-red-700 dark:text-red-200">{legacyUserDataMigrationError}</p>}
          </div>
        )}
        {confirmDialog?.type === 'cleanup' && (
          <div className="max-h-40 overflow-y-auto rounded-[18px] border px-4 py-3" style={{ borderColor: 'var(--color-border)' }}>
            <p className="text-xs font-medium text-[color:var(--color-muted-foreground)]">{t('settings.dataCache.oldCacheDirectorySelector')}</p>
            <div className="mt-2 space-y-2">
              {confirmDialog.rootPath ? (
                <code className="block break-all font-mono text-[11px] text-[color:var(--color-foreground)]">{confirmDialog.rootPath}</code>
              ) : (
                (browserDataMaintenanceInfo?.oldCacheRoots ?? []).map((item) => (
                  <code key={item.rootPath} className="block break-all font-mono text-[11px] text-[color:var(--color-foreground)]">
                    {item.rootPath}
                  </code>
                ))
              )}
            </div>
          </div>
        )}
      </ConfirmDialog>
    </div>
  )
}
