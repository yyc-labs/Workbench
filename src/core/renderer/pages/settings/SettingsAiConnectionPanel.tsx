import { CheckCircle2, CircleAlert, LoaderCircle, Play, PlugZap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { AiCommitConfig, AiConnectionTestRequest, AiConnectionTestResult, AiGatewayConfig, ClaudeRuntimeProfile } from '../../../shared/types'
import { Button } from '../../components/ui/button'
import { useI18n } from '../../i18n'

type ConnectionTarget = AiConnectionTestRequest & {
  id: string
  name: string
  source: string
  category: 'commit' | 'gateway' | 'claude'
}

type ConnectionFilter = 'all' | ConnectionTarget['category']

type SettingsAiConnectionPanelProps = {
  aiCommit?: AiCommitConfig
  aiGateway?: AiGatewayConfig
  claudeRuntimeProfiles: ClaudeRuntimeProfile[]
}

function buildTargets(aiCommit: AiCommitConfig | undefined, aiGateway: AiGatewayConfig | undefined, claudeRuntimeProfiles: ClaudeRuntimeProfile[]): ConnectionTarget[] {
  const commitProfiles = aiCommit?.profiles?.length
    ? aiCommit.profiles
    : [
        {
          id: 'default',
          name: 'AI Commit',
          apiBaseUrl: aiCommit?.apiBaseUrl,
          apiKey: aiCommit?.apiKey,
          model: aiCommit?.model,
        },
      ]
  const commitTargets = commitProfiles
    .filter((profile) => profile.apiBaseUrl?.trim() && profile.model?.trim())
    .map((profile) => ({
      id: `commit:${profile.id}`,
      name: profile.name,
      source: 'AI Commit',
      category: 'commit' as const,
      baseUrl: profile.apiBaseUrl!,
      apiKey: profile.apiKey,
      model: profile.model!,
      protocol: 'openai_chat' as const,
    }))
  const gatewayTargets = (aiGateway?.providers ?? [])
    .filter((provider) => provider.baseUrl.trim() && provider.enabled)
    .map((provider) => ({
      id: `gateway:${provider.id}`,
      name: provider.name,
      source: 'AI Gateway',
      category: 'gateway' as const,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      apiKeyEnv: provider.apiKeyEnv,
      model: Object.values(provider.modelMap ?? {})[0] ?? 'gpt-4o-mini',
      protocol: provider.protocol,
    }))
  const claudeTargets = claudeRuntimeProfiles
    .filter((profile) => profile.config.anthropicBaseUrl.trim() && profile.config.anthropicModel.trim())
    .map((profile) => ({
      id: `claude:${profile.id}`,
      name: profile.name,
      source: 'Claude',
      category: 'claude' as const,
      baseUrl: profile.config.anthropicBaseUrl,
      apiKey: profile.config.anthropicAuthToken,
      model: profile.config.anthropicModel,
      protocol: 'anthropic_messages' as const,
    }))
  return [...commitTargets, ...gatewayTargets, ...claudeTargets]
}

export function SettingsAiConnectionPanel({ aiCommit, aiGateway, claudeRuntimeProfiles }: SettingsAiConnectionPanelProps) {
  const { t } = useI18n()
  const targets = useMemo(() => buildTargets(aiCommit, aiGateway, claudeRuntimeProfiles), [aiCommit, aiGateway, claudeRuntimeProfiles])
  const [results, setResults] = useState<Record<string, AiConnectionTestResult>>({})
  const [running, setRunning] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<ConnectionFilter>('all')
  const visibleTargets = useMemo(() => (filter === 'all' ? targets : targets.filter((target) => target.category === filter)), [filter, targets])

  useEffect(() => {
    setSelectedId((current) => (current && visibleTargets.some((target) => target.id === current) ? current : (visibleTargets[0]?.id ?? null)))
  }, [visibleTargets])

  const selectedTarget = visibleTargets.find((target) => target.id === selectedId) ?? null

  const runTest = async (target: ConnectionTarget) => {
    setRunning((current) => new Set(current).add(target.id))
    try {
      const result = await window.electronAPI.testAiConnection({
        baseUrl: target.baseUrl,
        apiKey: target.apiKey,
        apiKeyEnv: target.apiKeyEnv,
        model: target.model,
        protocol: target.protocol,
      })
      setResults((current) => ({ ...current, [target.id]: result }))
    } finally {
      setRunning((current) => {
        const next = new Set(current)
        next.delete(target.id)
        return next
      })
    }
  }

  const runAll = async () => {
    await Promise.all(visibleTargets.map((target) => runTest(target)))
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="section-label mb-3">{t('settings.aiConnection.kicker')}</p>
          <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">{t('settings.aiConnection.title')}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[color:var(--color-muted-foreground)]">{t('settings.aiConnection.description')}</p>
        </div>
        <Button onClick={() => void runAll()} disabled={visibleTargets.length === 0 || running.size > 0}>
          <Play />
          {t('settings.aiConnection.testAll')}
        </Button>
      </div>

      {targets.length === 0 ? (
        <div className="surface-card rounded-[24px] border p-6 text-sm text-[color:var(--color-muted-foreground)]" style={{ borderColor: 'var(--color-border)' }}>
          {t('settings.aiConnection.empty')}
        </div>
      ) : (
        <div className="grid min-h-[430px] gap-5 lg:grid-cols-[250px_minmax(0,1fr)]">
          <aside className="quiet-control max-h-[420px] overflow-y-auto rounded-[24px] p-2 lg:sticky lg:top-0">
            <div className="mb-2 flex flex-wrap gap-1 px-1 pt-1">
              {(['all', 'commit', 'gateway', 'claude'] as const).map((value) => (
                <Button
                  key={value}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setFilter(value)}
                  className={`h-7 rounded-full px-2.5 text-[11px] ${filter === value ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm' : 'text-[color:var(--color-muted-foreground)]'}`}
                  aria-pressed={filter === value}
                >
                  {t(`settings.aiConnection.filters.${value}`)}
                </Button>
              ))}
            </div>
            <div className="flex flex-col gap-1">
              {visibleTargets.map((target) => {
                const result = results[target.id]
                const isRunning = running.has(target.id)
                const selected = target.id === selectedTarget?.id
                return (
                  <button key={target.id} type="button" onClick={() => setSelectedId(target.id)} className={`button-interactive flex min-h-[62px] w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left ${selected ? 'bg-[color:var(--color-card)] shadow-sm' : 'hover:bg-[color:var(--color-accent)]/60'}`}>
                    {isRunning ? (
                      <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-[color:var(--color-primary)]" />
                    ) : result?.ok ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-[color:var(--color-primary)]" />
                    ) : result ? (
                      <CircleAlert className="h-4 w-4 shrink-0 text-[color:var(--color-destructive)]" />
                    ) : (
                      <PlugZap className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-[color:var(--color-foreground)]">{target.name}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-[color:var(--color-muted-foreground)]">{target.source}</span>
                    </span>
                  </button>
                )
              })}
              {visibleTargets.length === 0 && <p className="px-3 py-5 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('settings.aiConnection.noMatches')}</p>}
            </div>
          </aside>

          {selectedTarget &&
            (() => {
              const result = results[selectedTarget.id]
              const isRunning = running.has(selectedTarget.id)
              return (
                <section className="surface-card flex min-w-0 flex-col rounded-[24px] border p-6" style={{ borderColor: 'var(--color-border)' }}>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="section-label mb-2">{selectedTarget.source}</p>
                      <h3 className="text-xl font-semibold tracking-[-0.03em] text-[color:var(--color-foreground)]">{selectedTarget.name}</h3>
                      <p className="mt-2 text-sm text-[color:var(--color-muted-foreground)]">{selectedTarget.model}</p>
                    </div>
                    <Button onClick={() => void runTest(selectedTarget)} loading={isRunning} disabled={running.size > 0 && !isRunning}>
                      <Play />
                      {t('settings.aiConnection.test')}
                    </Button>
                  </div>

                  <div className="mt-6 rounded-[18px] bg-[color:var(--color-accent)]/60 px-4 py-3">
                    <p className="text-[11px] text-[color:var(--color-muted-foreground)]">{t('settings.aiConnection.endpoint')}</p>
                    <p className="mt-1 break-all font-mono text-xs text-[color:var(--color-foreground)]">{selectedTarget.baseUrl}</p>
                  </div>

                  <div className="mt-5 flex-1 rounded-[18px] border p-4" style={{ borderColor: 'var(--color-border)' }}>
                    {result ? (
                      <div className={`text-sm leading-6 ${result.ok ? 'text-[color:var(--color-foreground)]' : 'text-[color:var(--color-destructive)]'}`}>
                        <p className="font-medium">{result.ok ? t('settings.aiConnection.success', { value: String(result.durationMs) }) : t('settings.aiConnection.failed', { value: result.error ?? '' })}</p>
                        {result.response ? <p className="mt-3 whitespace-pre-wrap break-words text-[color:var(--color-muted-foreground)]">{result.response}</p> : null}
                      </div>
                    ) : (
                      <p className="text-sm text-[color:var(--color-muted-foreground)]">{t('settings.aiConnection.noResult')}</p>
                    )}
                  </div>
                </section>
              )
            })()}
        </div>
      )}
    </div>
  )
}
