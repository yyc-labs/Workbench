import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { getCodexScopeCacheKey, resolveCodexScopeDescriptor } from '../../shared/codexScope'
import { SettingsSidebar } from './settings/SettingsSidebar'
import { SettingsGeneralPanel } from './settings/SettingsGeneralPanel'
import { SettingsRuntimePanel } from './settings/SettingsRuntimePanel'
import { SettingsAgentsPanel } from './settings/SettingsAgentsPanel'
import { SettingsTranscriptPanel } from './settings/SettingsTranscriptPanel'
import { SettingsAgentHooksPanel } from './settings/SettingsAgentHooksPanel'
import { SettingsStartupLogsPanel } from './settings/SettingsStartupLogsPanel'
import { SettingsAiCommitPanel } from './settings/SettingsAiCommitPanel'
import { SettingsRulesPanel } from './settings/SettingsRulesPanel'
import { SettingsAboutPanel } from './settings/SettingsAboutPanel'
import {
  DEFAULT_SETTINGS_SECTION,
  isSettingsSection,
  isSettingsSectionAlias,
  type SettingsSectionAlias,
  type ThemeMode,
} from './settings/settings.types'
import { useI18n } from '../i18n'
import type { AppLocale } from '../../shared/types'

export function SettingsPage() {
  const { section: sectionParam } = useParams<{ section?: string }>()
  const navigate = useNavigate()
  const config = useAppStore((s) => s.config)
  const capability = useAppStore((s) => s.capability)
  const projects = useAppStore((s) => s.projects)
  const runtimeEntries = useAppStore((s) => s.runtimeEntries)
  const setThemeConfig = useAppStore((s) => s.setTheme)
  const setLocaleConfig = useAppStore((s) => s.setLocale)
  const setAiEnvironmentConfig = useAppStore((s) => s.setAiEnvironmentConfig)
  const setRuntimeKeepAliveOnQuit = useAppStore((s) => s.setRuntimeKeepAliveOnQuit)
  const setAiCommitConfig = useAppStore((s) => s.setAiCommitConfig)
  const setClaudeRuntimeProfiles = useAppStore((s) => s.setClaudeRuntimeProfiles)
  const [theme, setTheme] = useState<ThemeMode>(config.theme)
  const [locale, setLocale] = useState<NonNullable<AppLocale>>(config.locale ?? 'system')
  const alias = isSettingsSectionAlias(sectionParam) ? sectionParam as SettingsSectionAlias : null
  const section = isSettingsSection(sectionParam) ? sectionParam : alias ? 'agents' : DEFAULT_SETTINGS_SECTION
  const preferredCodexScopeKey = getCodexScopeCacheKey(
    resolveCodexScopeDescriptor(capability, config.aiEnvironment)
  )
  const { t } = useI18n()

  useEffect(() => {
    setTheme(config.theme)
  }, [config.theme])

  useEffect(() => {
    setLocale(config.locale ?? 'system')
  }, [config.locale])

  const handleThemeChange = async (newTheme: ThemeMode) => {
    setTheme(newTheme)
    await setThemeConfig(newTheme)
  }

  const handleLocaleChange = async (nextLocale: NonNullable<AppLocale>) => {
    setLocale(nextLocale)
    await setLocaleConfig(nextLocale)
  }

  if (!isSettingsSection(sectionParam) && !isSettingsSectionAlias(sectionParam)) {
    return <Navigate to={`/settings/${DEFAULT_SETTINGS_SECTION}`} replace />
  }

  return (
    <div className="h-full flex flex-col">
      <header className="app-chrome flex min-h-[84px] items-center gap-4 px-8 py-4 shrink-0">
        <button
          className="button-interactive p-2 rounded-full text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)] transition-colors"
          onClick={() => navigate('/')}
        >
          <ChevronLeft className="w-5 h-5" strokeWidth={1.8} />
        </button>
        <h1 className="text-xl font-semibold text-[color:var(--color-foreground)] tracking-[-0.03em]">
          {t('settings.title')}
        </h1>
      </header>

      <div className="flex-1 min-h-0 overflow-hidden px-8 pb-10 pt-10">
        <div className="flex h-full min-h-0 min-w-0">
          <SettingsSidebar
            active={section}
            onSelect={(nextSection) => navigate(`/settings/${nextSection}`)}
          />

          <main className="flex-1 min-h-0 min-w-0 ml-12 overflow-y-auto px-6 pt-1">
            <div className="pb-6 -mb-6">
              {section === 'general' && (
                <SettingsGeneralPanel
                  theme={theme}
                  locale={locale}
                  onThemeChange={handleThemeChange}
                  onLocaleChange={handleLocaleChange}
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
                  projects={projects}
                  runtimeEntries={runtimeEntries}
                />
              )}
              {section === 'agents' && (
                <SettingsAgentsPanel
                  capability={capability}
                  mode={config.aiEnvironment?.mode}
                  profiles={config.claudeRuntimeProfiles ?? []}
                  activeProfileId={config.activeClaudeRuntimeProfileId}
                  onProfilesSave={setClaudeRuntimeProfiles}
                  initialTab={alias === 'codex' ? 'codex' : 'claude'}
                />
              )}
              {section === 'transcripts' && (
                <SettingsTranscriptPanel
                  projects={projects}
                  removedProjects={config.removedProjects}
                />
              )}
              {section === 'hooks' && <SettingsAgentHooksPanel />}
              {section === 'logs' && (
                <SettingsStartupLogsPanel
                  projects={projects}
                />
              )}
              {section === 'ai' && (
                <SettingsAiCommitPanel
                  aiCommit={config.aiCommit || {}}
                  onSave={setAiCommitConfig}
                  claudeRuntimeProfiles={config.claudeRuntimeProfiles ?? []}
                  codexSettingsSnapshots={config.codexSettingsSnapshots ?? {}}
                  preferredCodexScopeKey={preferredCodexScopeKey}
                />
              )}
              {section === 'rules' && <SettingsRulesPanel />}
              {section === 'about' && <SettingsAboutPanel />}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
