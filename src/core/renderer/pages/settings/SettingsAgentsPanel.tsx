import { Bot, KeyRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AiEnvironmentConfig, AiExecutionMode, Capability, ClaudeRuntimeProfile } from '../../../shared/types'
import { useI18n } from '../../i18n'
import { SettingsAgentInstallCommandsPanel } from './SettingsAgentInstallCommandsPanel'
import { SettingsAiRuntimePanel } from './SettingsAiRuntimePanel'
import { SettingsCodexPanel } from './SettingsCodexPanel'

type AgentsTab = 'claude' | 'codex'

type SettingsAgentsPanelProps = {
  capability: Capability | null
  mode?: AiExecutionMode
  aiEnvironment?: AiEnvironmentConfig
  profiles: ClaudeRuntimeProfile[]
  activeProfileId?: string
  onProfilesSave: (profiles: ClaudeRuntimeProfile[], activeProfileId: string) => Promise<void>
  initialTab?: AgentsTab
}

function SettingsAgentsPanel({
  capability,
  mode,
  aiEnvironment,
  profiles,
  activeProfileId,
  onProfilesSave,
  initialTab = 'claude',
}: SettingsAgentsPanelProps) {
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState<AgentsTab>(initialTab)

  useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab])

  return (
    <div className="space-y-8">
      <div>
        <p className="section-label mb-3">{t('settings.agents.kicker')}</p>
        <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">
          {t('settings.agents.title')}
        </h2>
        <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2">
          {t('settings.agents.description')}
        </p>
      </div>

      <SettingsAgentInstallCommandsPanel />

      <div className="rounded-[28px] border px-5 py-5 surface-card" style={{ borderColor: 'var(--color-border)' }}>
        <div className="quiet-control inline-flex flex-wrap rounded-full p-1 gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('claude')}
            className={`button-interactive flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition-all ${
              activeTab === 'claude'
                ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm'
                : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
            }`}
          >
            <Bot className="h-4 w-4" strokeWidth={1.8} />
            {t('settings.agents.tabs.claude')}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('codex')}
            className={`button-interactive flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition-all ${
              activeTab === 'codex'
                ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm'
                : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
            }`}
          >
            <KeyRound className="h-4 w-4" strokeWidth={1.8} />
            {t('settings.agents.tabs.codex')}
          </button>
        </div>
      </div>

      {activeTab === 'claude' ? (
        <SettingsAiRuntimePanel
          capability={capability}
          mode={mode}
          aiEnvironment={aiEnvironment}
          profiles={profiles}
          activeProfileId={activeProfileId}
          onProfilesSave={onProfilesSave}
          embedded
        />
      ) : (
        <SettingsCodexPanel capability={capability} embedded />
      )}
    </div>
  )
}

export { SettingsAgentsPanel }
