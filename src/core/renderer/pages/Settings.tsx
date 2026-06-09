import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { SettingsSidebar } from './settings/SettingsSidebar'
import { SettingsGeneralPanel } from './settings/SettingsGeneralPanel'
import { SettingsRuntimePanel } from './settings/SettingsRuntimePanel'
import { SettingsTranscriptPanel } from './settings/SettingsTranscriptPanel'
import { SettingsAgentHooksPanel } from './settings/SettingsAgentHooksPanel'
import { SettingsStartupLogsPanel } from './settings/SettingsStartupLogsPanel'
import { SettingsAiCommitPanel } from './settings/SettingsAiCommitPanel'
import { SettingsRulesPanel } from './settings/SettingsRulesPanel'
import { SettingsAboutPanel } from './settings/SettingsAboutPanel'
import type { Section, ThemeMode } from './settings/settings.types'

export function SettingsPage() {
  const navigate = useNavigate()
  const config = useAppStore((s) => s.config)
  const projects = useAppStore((s) => s.projects)
  const runtimeEntries = useAppStore((s) => s.runtimeEntries)
  const setThemeConfig = useAppStore((s) => s.setTheme)
  const setRuntimeLauncherScript = useAppStore((s) => s.setRuntimeLauncherScript)
  const setRuntimeKeepAliveOnQuit = useAppStore((s) => s.setRuntimeKeepAliveOnQuit)
  const setAiCommitConfig = useAppStore((s) => s.setAiCommitConfig)
  const [theme, setTheme] = useState<ThemeMode>(config.theme)
  const [section, setSection] = useState<Section>('general')

  useEffect(() => {
    setTheme(config.theme)
  }, [config.theme])

  const handleThemeChange = async (newTheme: ThemeMode) => {
    setTheme(newTheme)
    await setThemeConfig(newTheme)
  }

  return (
    <div className="h-full flex flex-col">
      <header className="app-chrome flex min-h-[84px] items-center gap-4 px-8 py-4 shrink-0">
        <button
          className="p-2 rounded-full text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)] transition-colors"
          onClick={() => navigate('/')}
        >
          <ChevronLeft className="w-5 h-5" strokeWidth={1.8} />
        </button>
        <h1 className="text-xl font-semibold text-[color:var(--color-foreground)] tracking-[-0.03em]">
          Settings
        </h1>
      </header>

      <div className="flex-1 min-h-0 overflow-hidden px-8 pb-10 pt-10">
        <div className="flex h-full min-h-0 min-w-0">
          <SettingsSidebar active={section} onSelect={setSection} />

          <main className="flex-1 min-h-0 min-w-0 ml-12 overflow-y-auto px-6 pt-1">
            <div className="pb-6 -mb-6">
              {section === 'general' && (
                <SettingsGeneralPanel theme={theme} onThemeChange={handleThemeChange} />
              )}
              {section === 'runtime' && (
                <SettingsRuntimePanel
                  runtimeLauncherScript={config.runtimeLauncherScript || '$HOME/tools/claude-code-script/start-claude-with-env.sh'}
                  onRuntimeLauncherScriptSave={setRuntimeLauncherScript}
                  runtimeKeepAliveOnQuit={config.runtimeKeepAliveOnQuit ?? false}
                  onRuntimeKeepAliveToggle={setRuntimeKeepAliveOnQuit}
                  projects={projects}
                  runtimeEntries={runtimeEntries}
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
