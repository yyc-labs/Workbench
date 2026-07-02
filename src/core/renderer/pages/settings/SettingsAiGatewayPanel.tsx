import { AlertTriangle, Link2, Play, Plus, RefreshCw, RotateCcw, Router, Save, Square, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  AiGatewayClientCli,
  AiGatewayConfig,
  AiGatewayProviderConfig,
  AiGatewayStatus,
  AiGatewayUpstreamProtocol,
  ClaudeRuntimeProfile,
} from '../../../shared/types'
import { ModalShell } from '../../components/ModalShell'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Select, type SelectOption } from '../../components/ui/select'
import { useI18n } from '../../i18n'
import {
  getCodexGatewayBindingIssue,
  getCodexScopesUsingGateway,
} from '../../lib/codexGatewaySummary'
import {
  syncClaudeGatewayProfileConfigs,
  withClaudeProfileModelRoutes,
} from '../../lib/claudeGatewayProfiles'
import { useAppStore } from '../../stores/appStore'

type ProviderDraft = AiGatewayProviderConfig & {
  draftId: string
  modelMapText: string
}

type SettingsAiGatewayPanelProps = {
  profiles?: ClaudeRuntimeProfile[]
  activeProfileId?: string
  onProfilesSave?: (profiles: ClaudeRuntimeProfile[], activeProfileId: string) => Promise<void>
}

const PROTOCOL_OPTIONS: SelectOption[] = [
  { value: 'openai_chat', label: 'openai_chat' },
  { value: 'openai_responses', label: 'openai_responses' },
  { value: 'anthropic_messages', label: 'anthropic_messages' },
]

function modelMapToText(modelMap: Record<string, string> | undefined): string {
  return Object.entries(modelMap ?? {})
    .map(([source, target]) => `${source}=${target}`)
    .join('\n')
}

function parseModelMap(value: string): Record<string, string> | undefined {
  const entries = value.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.includes('=>') ? '=>' : '='
      const [source, ...rest] = line.split(separator)
      const target = rest.join(separator)
      const sourceModel = source?.trim() ?? ''
      const targetModel = target?.trim() ?? ''
      return sourceModel && targetModel ? [sourceModel, targetModel] as const : null
    })
    .filter((entry): entry is readonly [string, string] => Boolean(entry))

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function providerToDraft(provider: AiGatewayProviderConfig): ProviderDraft {
  return {
    ...provider,
    draftId: `${provider.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    modelMapText: modelMapToText(provider.modelMap),
  }
}

function draftToProvider(draft: ProviderDraft): AiGatewayProviderConfig {
  return {
    id: draft.id.trim(),
    name: draft.name.trim(),
    baseUrl: draft.baseUrl.trim(),
    apiKeyEnv: draft.apiKeyEnv?.trim() || undefined,
    apiKey: draft.apiKey?.trim() || undefined,
    protocol: draft.protocol,
    modelMap: parseModelMap(draft.modelMapText),
    enabled: draft.enabled,
    timeoutMs: Number.isFinite(Number(draft.timeoutMs)) ? Number(draft.timeoutMs) : undefined,
  }
}

function createNewProviderDraft(index: number): ProviderDraft {
  const id = `openai-chat-${index + 1}`
  return {
    draftId: `${id}-${Date.now()}`,
    id,
    name: `OpenAI Chat ${index + 1}`,
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    protocol: 'openai_chat',
    modelMap: {},
    modelMapText: '',
    enabled: true,
    timeoutMs: 60000,
  }
}

type ProviderUsage = {
  claudeProfiles: string[]
  codexScopes: string[]
  manualRoutes: string[]
}

function isProviderUsageEmpty(usage: ProviderUsage): boolean {
  return usage.claudeProfiles.length === 0
    && usage.codexScopes.length === 0
    && usage.manualRoutes.length === 0
}

function BindingCard({
  cli,
  status,
  busy,
  onApply,
  onRestore,
}: {
  cli: AiGatewayClientCli
  status: AiGatewayStatus | null
  busy: boolean
  onApply: (cli: AiGatewayClientCli) => void
  onRestore: (cli: AiGatewayClientCli) => void
}) {
  const { t } = useI18n()
  const binding = status?.clientBindings[cli]
  const title = cli === 'claude'
    ? t('settings.aiGateway.bindingClaude')
    : t('settings.aiGateway.bindingCodex')

  return (
    <div className="rounded-[22px] border px-5 py-5" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-[color:var(--color-foreground)]">{title}</h4>
          <p className="mt-1 text-xs leading-5 text-[color:var(--color-muted-foreground)]">
            {cli === 'claude'
              ? t('settings.aiGateway.bindingClaudeHint')
              : t('settings.aiGateway.bindingCodexHint')}
          </p>
        </div>
        <span className="rounded-full bg-[color:var(--color-card)] px-3 py-1 text-xs text-[color:var(--color-muted-foreground)]">
          {binding?.enabled ? t('settings.aiGateway.bound') : t('settings.aiGateway.notBound')}
        </span>
      </div>

      <div className="mt-4 space-y-1.5">
        <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.bindingBaseUrl')}</p>
        <div className="quiet-control rounded-[16px] px-4 py-3 font-mono text-xs text-[color:var(--color-foreground)] break-all">
          {binding?.baseUrl || t('settings.aiGateway.notAvailable')}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          className="h-10 rounded-full px-4 text-sm"
          onClick={() => onApply(cli)}
          disabled={busy}
        >
          <Link2 className="h-4 w-4" />
          {t('settings.aiGateway.applyBinding')}
        </Button>
        <Button
          variant="outline"
          className="h-10 rounded-full px-4 text-sm"
          onClick={() => onRestore(cli)}
          disabled={busy || !binding?.backup}
        >
          <RotateCcw className="h-4 w-4" />
          {t('settings.aiGateway.restoreBinding')}
        </Button>
      </div>
    </div>
  )
}

function GatewayGuideCard() {
  const { t } = useI18n()

  return (
    <div className="rounded-[28px] border px-6 py-6 surface-card space-y-5" style={{ borderColor: 'var(--color-border)' }}>
      <div>
        <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">{t('settings.aiGateway.guideTitle')}</h3>
        <p className="mt-1 text-sm leading-6 text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.guideDescription')}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {[
          {
            title: t('settings.aiGateway.guideClaudeTitle'),
            body: t('settings.aiGateway.guideClaudeDescription'),
            flow: t('settings.aiGateway.guideClaudeFlow'),
          },
          {
            title: t('settings.aiGateway.guideCodexTitle'),
            body: t('settings.aiGateway.guideCodexDescription'),
            flow: t('settings.aiGateway.guideCodexFlow'),
          },
          {
            title: t('settings.aiGateway.guideProviderTitle'),
            body: t('settings.aiGateway.guideProviderDescription'),
            flow: t('settings.aiGateway.guideProviderFlow'),
          },
        ].map((item) => (
          <div key={item.title} className="rounded-[20px] bg-[color:var(--color-card)] px-4 py-4">
            <h4 className="text-sm font-semibold text-[color:var(--color-foreground)]">{item.title}</h4>
            <p className="mt-2 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{item.body}</p>
            <div className="mt-3 rounded-[14px] bg-[color:var(--color-background-sunken)]/65 px-3 py-2 font-mono text-[11px] leading-5 text-[color:var(--color-muted-foreground)]">
              {item.flow}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-[20px] border px-4 py-4" style={{ borderColor: 'var(--color-border)' }}>
          <h4 className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('settings.aiGateway.guideProfileTitle')}</h4>
          <p className="mt-2 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.guideProfileDescription')}</p>
        </div>
        <div className="rounded-[20px] border px-4 py-4" style={{ borderColor: 'var(--color-border)' }}>
          <h4 className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('settings.aiGateway.guideGlobalTitle')}</h4>
          <p className="mt-2 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.guideGlobalDescription')}</p>
        </div>
      </div>
    </div>
  )
}

export function SettingsAiGatewayPanel({
  profiles = [],
  activeProfileId,
  onProfilesSave,
}: SettingsAiGatewayPanelProps) {
  const { t } = useI18n()
  const codexGatewayBindings = useAppStore((s) => s.config.codexGatewayBindings ?? {})
  const [config, setConfig] = useState<AiGatewayConfig | null>(null)
  const [status, setStatus] = useState<AiGatewayStatus | null>(null)
  const [providers, setProviders] = useState<ProviderDraft[]>([])
  const [selectedProviderDraftId, setSelectedProviderDraftId] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedHint, setSavedHint] = useState('')
  const [deleteConfirmProviderDraftId, setDeleteConfirmProviderDraftId] = useState<string | null>(null)

  const activeProviderIndex = providers.findIndex((provider) => provider.draftId === selectedProviderDraftId)
  const activeProvider = activeProviderIndex >= 0 ? providers[activeProviderIndex] : null
  const deleteConfirmProvider = providers.find((provider) => provider.draftId === deleteConfirmProviderDraftId) ?? null
  const providerOptions = providers.map((provider) => ({
    value: provider.draftId,
    label: provider.name || provider.id,
  }))
  const inputDisabled = loading || saving
  const claudeGatewayProfiles = profiles.filter((profile) => profile.gateway?.enabled)
  const codexGatewayScopes = getCodexScopesUsingGateway(codexGatewayBindings)
  const invalidCodexBindingCount = codexGatewayScopes.filter((binding) => (
    getCodexGatewayBindingIssue(binding, config) !== null
  )).length

  const getProviderUsage = (providerId: string): ProviderUsage => ({
    claudeProfiles: profiles
      .filter((profile) => profile.gateway?.enabled && profile.gateway.providerId === providerId)
      .map((profile) => profile.name || profile.id),
    codexScopes: codexGatewayScopes
      .filter((binding) => binding.providerId === providerId)
      .map((binding) => binding.scopeKey),
    manualRoutes: (config?.modelRoutes ?? [])
      .filter((route) => (
        route.enabled
        && route.providerId === providerId
        && route.source !== 'claude-profile'
        && route.source !== 'codex-scope'
      ))
      .map((route) => route.model),
  })
  const activeProviderUsage = activeProvider ? getProviderUsage(activeProvider.id) : null
  const deleteConfirmProviderUsage = deleteConfirmProvider
    ? getProviderUsage(deleteConfirmProvider.id)
    : null

  const statusCards = useMemo(() => ([
    {
      label: t('settings.aiGateway.status'),
      value: status?.running ? t('settings.aiGateway.running') : t('settings.aiGateway.stopped'),
    },
    {
      label: t('settings.aiGateway.endpoint'),
      value: status?.url ?? t('settings.aiGateway.notAvailable'),
    },
    {
      label: t('settings.aiGateway.activeProvider'),
      value: status?.activeProvider?.name ?? t('settings.aiGateway.notAvailable'),
    },
    {
      label: t('settings.aiGateway.protocol'),
      value: status?.activeProvider?.protocol ?? t('settings.aiGateway.notAvailable'),
    },
  ]), [status, t])

  const refreshGatewayTelemetry = async () => {
    const nextStatus = await window.electronAPI.getAiGatewayStatus()
    setStatus(nextStatus)
  }

  const loadGateway = async () => {
    setLoading(true)
    setError('')
    try {
      const [nextConfig, nextStatus] = await Promise.all([
        window.electronAPI.getAiGatewayConfig(),
        window.electronAPI.getAiGatewayStatus(),
      ])
      setConfig(nextConfig)
      setStatus(nextStatus)
      const drafts = nextConfig.providers.map(providerToDraft)
      setProviders(drafts)
      const activeDraft = drafts.find((draft) => draft.id === nextConfig.activeProviderId) ?? drafts[0]
      setSelectedProviderDraftId(activeDraft?.draftId ?? '')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('settings.aiGateway.loadError'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadGateway()
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshGatewayTelemetry().catch(() => undefined)
    }, 2500)
    return () => window.clearInterval(timer)
  }, [])

  const buildDraftConfig = (): AiGatewayConfig => {
    const currentConfig = config
    if (!currentConfig) throw new Error(t('settings.aiGateway.loadFirst'))
    const nextProviders = providers.map(draftToProvider).filter((provider) => provider.id)
    if (nextProviders.length === 0) throw new Error(t('settings.aiGateway.providerRequired'))
    const selectedProvider = providers.find((provider) => provider.draftId === selectedProviderDraftId)
    return {
      ...currentConfig,
      providers: nextProviders,
      activeProviderId: selectedProvider?.id || nextProviders[0]!.id,
    }
  }

  const persistDraftConfig = async (): Promise<AiGatewayConfig> => {
    const nextConfig = buildDraftConfig()
    let result = await window.electronAPI.saveAiGatewayConfig(nextConfig)
    if (onProfilesSave && profiles.length > 0) {
      const syncedProfiles = syncClaudeGatewayProfileConfigs(profiles, result.config)
      await onProfilesSave(syncedProfiles, activeProfileId || syncedProfiles[0]?.id || '')
      result = await window.electronAPI.saveAiGatewayConfig(withClaudeProfileModelRoutes(result.config, syncedProfiles))
    }
    setConfig(result.config)
    setStatus(result.status)
    const drafts = result.config.providers.map(providerToDraft)
    setProviders(drafts)
    const activeDraft = drafts.find((draft) => draft.id === result.config.activeProviderId) ?? drafts[0]
    setSelectedProviderDraftId(activeDraft?.draftId ?? '')
    return result.config
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setSavedHint('')
    try {
      await persistDraftConfig()
      setSavedHint(t('settings.aiGateway.savedHint'))
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('settings.aiGateway.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const handleStartStop = async (nextRunning: boolean) => {
    setSaving(true)
    setError('')
    setSavedHint('')
    try {
      await persistDraftConfig()
      const nextStatus = nextRunning
        ? await window.electronAPI.startAiGateway()
        : await window.electronAPI.stopAiGateway()
      setStatus(nextStatus)
      setConfig(await window.electronAPI.getAiGatewayConfig())
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t('settings.aiGateway.actionError'))
    } finally {
      setSaving(false)
    }
  }

  const handleBindingAction = async (cli: AiGatewayClientCli, action: 'apply' | 'restore') => {
    setSaving(true)
    setError('')
    setSavedHint('')
    try {
      await persistDraftConfig()
      const result = action === 'apply'
        ? await window.electronAPI.applyAiGatewayClientBinding(cli)
        : await window.electronAPI.restoreAiGatewayClientBinding(cli)
      setConfig(result.config)
      setStatus(result.status)
      setSavedHint(action === 'apply'
        ? t('settings.aiGateway.bindingApplied')
        : t('settings.aiGateway.bindingRestored'))
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t('settings.aiGateway.actionError'))
    } finally {
      setSaving(false)
    }
  }

  const updateConfigDraft = (partial: Partial<AiGatewayConfig>) => {
    setConfig((current) => current ? { ...current, ...partial } : current)
  }

  const updateProvider = <K extends keyof ProviderDraft>(field: K, value: ProviderDraft[K]) => {
    if (activeProviderIndex < 0) return
    setProviders((current) => current.map((provider, index) => (
      index === activeProviderIndex ? { ...provider, [field]: value } : provider
    )))
  }

  const handleAddProvider = () => {
    const draft = createNewProviderDraft(providers.length)
    setProviders((current) => [...current, draft])
    setSelectedProviderDraftId(draft.draftId)
  }

  const handleDeleteProvider = () => {
    if (!activeProvider || providers.length <= 1) return
    const usage = getProviderUsage(activeProvider.id)
    if (!isProviderUsageEmpty(usage)) {
      setDeleteConfirmProviderDraftId(activeProvider.draftId)
      return
    }
    deleteProviderDraft(activeProvider.draftId)
  }

  const deleteProviderDraft = (draftId: string) => {
    const nextProviders = providers.filter((provider) => provider.draftId !== draftId)
    setProviders(nextProviders)
    setSelectedProviderDraftId(nextProviders[0]?.draftId ?? '')
    setDeleteConfirmProviderDraftId(null)
  }

  return (
    <div className="space-y-8">
      <div className="rounded-[28px] border px-6 py-6 surface-card" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="section-label mb-3">{t('settings.aiGateway.kicker')}</p>
            <h3 className="text-xl font-semibold tracking-[-0.03em] text-[color:var(--color-foreground)]">
              {t('settings.aiGateway.title')}
            </h3>
            <p className="mt-2 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
              {t('settings.aiGateway.description')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="h-10 rounded-full px-4 text-sm"
              onClick={() => void loadGateway()}
              loading={loading}
              disabled={saving}
            >
              <RefreshCw className="h-4 w-4" />
              {t('settings.aiGateway.refresh')}
            </Button>
            <Button
              className="h-10 rounded-full px-4 text-sm"
              onClick={() => void handleStartStop(!status?.running)}
              disabled={inputDisabled}
            >
              {status?.running ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {status?.running ? t('settings.aiGateway.stop') : t('settings.aiGateway.start')}
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {statusCards.map((card) => (
            <div key={card.label} className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3">
              <div className="text-xs text-[color:var(--color-muted-foreground)]">{card.label}</div>
              <div className="mt-1 truncate text-sm font-medium text-[color:var(--color-foreground)]">{card.value}</div>
            </div>
          ))}
        </div>

        {status?.error && (
          <p className="mt-4 text-xs text-[color:var(--color-destructive)]">{status.error}</p>
        )}
      </div>

      <div className="rounded-[28px] border px-6 py-6 surface-card space-y-5" style={{ borderColor: 'var(--color-border)' }}>
        <div>
          <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">{t('settings.aiGateway.relationshipTitle')}</h3>
          <p className="mt-1 text-sm leading-6 text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.relationshipDescription')}</p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3">
            <div className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.relationshipClaudeProfiles')}</div>
            <div className="mt-1 text-sm font-medium text-[color:var(--color-foreground)]">
              {t('settings.aiGateway.relationshipCount', { count: String(claudeGatewayProfiles.length) })}
            </div>
          </div>
          <div className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3">
            <div className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.relationshipCodexScopes')}</div>
            <div className="mt-1 text-sm font-medium text-[color:var(--color-foreground)]">
              {t('settings.aiGateway.relationshipCount', { count: String(codexGatewayScopes.length) })}
            </div>
          </div>
          <div className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3">
            <div className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.relationshipWarnings')}</div>
            <div className={`mt-1 text-sm font-medium ${invalidCodexBindingCount > 0 ? 'text-[color:var(--color-destructive)]' : 'text-[color:var(--color-foreground)]'}`}>
              {t('settings.aiGateway.relationshipCount', { count: String(invalidCodexBindingCount) })}
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-[20px] border px-4 py-4" style={{ borderColor: 'var(--color-border)' }}>
            <h4 className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('settings.aiGateway.relationshipClaudeProfiles')}</h4>
            <div className="mt-3 space-y-2">
              {claudeGatewayProfiles.length > 0 ? claudeGatewayProfiles.map((profile) => (
                <div key={profile.id} className="flex items-center justify-between gap-3 rounded-[14px] bg-[color:var(--color-card)] px-3 py-2 text-xs">
                  <span className="min-w-0 truncate text-[color:var(--color-foreground)]">{profile.name || profile.id}</span>
                  <span className="shrink-0 text-[color:var(--color-muted-foreground)]">{profile.gateway?.providerId}</span>
                </div>
              )) : (
                <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.relationshipNoClaudeProfiles')}</p>
              )}
            </div>
          </div>

          <div className="rounded-[20px] border px-4 py-4" style={{ borderColor: 'var(--color-border)' }}>
            <h4 className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('settings.aiGateway.relationshipCodexScopes')}</h4>
            <div className="mt-3 space-y-2">
              {codexGatewayScopes.length > 0 ? codexGatewayScopes.map((binding) => {
                const issue = getCodexGatewayBindingIssue(binding, config)
                return (
                  <div key={binding.scopeKey} className="flex items-center justify-between gap-3 rounded-[14px] bg-[color:var(--color-card)] px-3 py-2 text-xs">
                    <span className="min-w-0 truncate text-[color:var(--color-foreground)]">{binding.scopeKey}</span>
                    <span className={issue ? 'shrink-0 text-[color:var(--color-destructive)]' : 'shrink-0 text-[color:var(--color-muted-foreground)]'}>
                      {issue ? t('settings.aiGateway.relationshipInvalid') : binding.providerId}
                    </span>
                  </div>
                )
              }) : (
                <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.relationshipNoCodexScopes')}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <GatewayGuideCard />

      <div className="rounded-[28px] border px-6 py-6 surface-card space-y-5" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center gap-3">
          <Router className="h-5 w-5 text-[color:var(--color-muted-foreground)]" strokeWidth={1.8} />
          <div>
            <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">{t('settings.aiGateway.serverTitle')}</h3>
            <p className="mt-1 text-sm text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.serverDescription')}</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.host')}</p>
            <Input
              value={config?.host ?? ''}
              onChange={(event) => updateConfigDraft({ host: event.target.value })}
              disabled={inputDisabled}
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.port')}</p>
            <Input
              type="number"
              value={config?.port ?? ''}
              onChange={(event) => updateConfigDraft({ port: Number(event.target.value) })}
              disabled={inputDisabled}
            />
          </div>
        </div>
      </div>

      <div className="rounded-[28px] border px-6 py-6 surface-card space-y-5" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">{t('settings.aiGateway.providerTitle')}</h3>
            <p className="mt-1 text-sm text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.providerDescription')}</p>
          </div>
          <Button
            variant="outline"
            className="h-10 rounded-full px-4 text-sm"
            onClick={handleAddProvider}
            disabled={inputDisabled}
          >
            <Plus className="h-4 w-4" />
            {t('settings.aiGateway.addProvider')}
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {[
            t('settings.aiGateway.providerBaseUrlHelp'),
            t('settings.aiGateway.providerProtocolHelp'),
            t('settings.aiGateway.providerModelMapHelp'),
            t('settings.aiGateway.providerApiKeyHelp'),
          ].map((hint) => (
            <div key={hint} className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3 text-xs leading-5 text-[color:var(--color-muted-foreground)]">
              {hint}
            </div>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.activeProvider')}</p>
            <Select
              ariaLabel={t('settings.aiGateway.activeProvider')}
              value={selectedProviderDraftId}
              options={providerOptions}
              onChange={setSelectedProviderDraftId}
              disabled={inputDisabled || providerOptions.length === 0}
              triggerClassName="h-11"
            />
          </div>

          {activeProvider && (
            <>
              {!isProviderUsageEmpty(activeProviderUsage ?? { claudeProfiles: [], codexScopes: [], manualRoutes: [] }) && (
                <div className="md:col-span-2 flex flex-wrap gap-2">
                  {activeProviderUsage?.claudeProfiles.map((name) => (
                    <span key={`claude:${name}`} className="rounded-full bg-[color:var(--color-primary)]/10 px-3 py-1 text-xs text-[color:var(--color-primary)]">
                      {t('settings.aiGateway.usedByClaude', { value: name })}
                    </span>
                  ))}
                  {activeProviderUsage?.codexScopes.map((scopeKey) => (
                    <span key={`codex:${scopeKey}`} className="rounded-full bg-[color:var(--color-primary)]/10 px-3 py-1 text-xs text-[color:var(--color-primary)]">
                      {t('settings.aiGateway.usedByCodex', { value: scopeKey })}
                    </span>
                  ))}
                  {activeProviderUsage?.manualRoutes.map((modelName) => (
                    <span key={`manual:${modelName}`} className="rounded-full bg-[color:var(--color-card)] px-3 py-1 text-xs text-[color:var(--color-muted-foreground)]">
                      {t('settings.aiGateway.usedByRoute', { value: modelName })}
                    </span>
                  ))}
                </div>
              )}
              <div className="space-y-1.5">
                <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.providerId')}</p>
                <Input value={activeProvider.id} onChange={(event) => updateProvider('id', event.target.value)} disabled={inputDisabled} />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.providerName')}</p>
                <Input value={activeProvider.name} onChange={(event) => updateProvider('name', event.target.value)} disabled={inputDisabled} />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.providerBaseUrl')}</p>
                <Input value={activeProvider.baseUrl} onChange={(event) => updateProvider('baseUrl', event.target.value)} disabled={inputDisabled} />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.protocol')}</p>
                <Select
                  ariaLabel={t('settings.aiGateway.protocol')}
                  value={activeProvider.protocol}
                  options={PROTOCOL_OPTIONS}
                  onChange={(value) => updateProvider('protocol', value as AiGatewayUpstreamProtocol)}
                  disabled={inputDisabled}
                  triggerClassName="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.timeoutMs')}</p>
                <Input
                  type="number"
                  value={activeProvider.timeoutMs ?? ''}
                  onChange={(event) => updateProvider('timeoutMs', Number(event.target.value))}
                  disabled={inputDisabled}
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.apiKeyEnv')}</p>
                <Input value={activeProvider.apiKeyEnv ?? ''} onChange={(event) => updateProvider('apiKeyEnv', event.target.value)} disabled={inputDisabled} />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.apiKey')}</p>
                <Input
                  type="password"
                  value={activeProvider.apiKey ?? ''}
                  onChange={(event) => updateProvider('apiKey', event.target.value)}
                  disabled={inputDisabled}
                  placeholder="sk-..."
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.modelMap')}</p>
                <textarea
                  value={activeProvider.modelMapText}
                  onChange={(event) => updateProvider('modelMapText', event.target.value)}
                  disabled={inputDisabled}
                  placeholder={t('settings.aiGateway.modelMapPlaceholder')}
                  className="quiet-control min-h-[96px] w-full rounded-[18px] px-4 py-3 font-mono text-sm text-[color:var(--color-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                />
                <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.modelMapHint')}</p>
              </div>
              <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3">
                <label className="quiet-control flex h-10 items-center gap-2 rounded-full px-4 text-sm text-[color:var(--color-foreground)]">
                  <input
                    type="checkbox"
                    checked={activeProvider.enabled}
                    onChange={(event) => updateProvider('enabled', event.target.checked)}
                    disabled={inputDisabled}
                  />
                  {t('settings.aiGateway.providerEnabled')}
                </label>
                <Button
                  variant="outline"
                  className="h-10 rounded-full px-4 text-sm text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-background)]"
                  onClick={handleDeleteProvider}
                  disabled={inputDisabled || providers.length <= 1}
                >
                  <Trash2 className="h-4 w-4" />
                  {t('common.delete')}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="rounded-[28px] border px-6 py-6 surface-card space-y-5" style={{ borderColor: 'var(--color-border)' }}>
        <div>
          <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">{t('settings.aiGateway.bindingsTitle')}</h3>
          <p className="mt-1 text-sm text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.bindingsDescription')}</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <BindingCard
            cli="claude"
            status={status}
            busy={inputDisabled}
            onApply={(cli) => void handleBindingAction(cli, 'apply')}
            onRestore={(cli) => void handleBindingAction(cli, 'restore')}
          />
          <BindingCard
            cli="codex"
            status={status}
            busy={inputDisabled}
            onApply={(cli) => void handleBindingAction(cli, 'apply')}
            onRestore={(cli) => void handleBindingAction(cli, 'restore')}
          />
        </div>
      </div>

      <ModalShell
        open={Boolean(deleteConfirmProvider)}
        onClose={() => {
          if (saving) return
          setDeleteConfirmProviderDraftId(null)
        }}
        widthClassName="max-w-[600px]"
        ariaLabel={t('settings.aiGateway.deleteProviderConfirmLabel')}
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
            <div>
              <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">
                {t('settings.aiGateway.deleteProviderConfirmTitle')}
              </h3>
              <p className="mt-1 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
                {t('settings.aiGateway.deleteProviderConfirmHint', {
                  provider: deleteConfirmProvider?.name || deleteConfirmProvider?.id || '',
                })}
              </p>
            </div>
          </div>

          <div className="grid gap-3">
            {deleteConfirmProviderUsage?.claudeProfiles.map((name) => (
              <div key={`delete-claude:${name}`} className="rounded-[14px] bg-[color:var(--color-card)] px-3 py-2 text-sm text-[color:var(--color-foreground)]">
                {t('settings.aiGateway.usedByClaude', { value: name })}
              </div>
            ))}
            {deleteConfirmProviderUsage?.codexScopes.map((scopeKey) => (
              <div key={`delete-codex:${scopeKey}`} className="rounded-[14px] bg-[color:var(--color-card)] px-3 py-2 text-sm text-[color:var(--color-foreground)]">
                {t('settings.aiGateway.usedByCodex', { value: scopeKey })}
              </div>
            ))}
            {deleteConfirmProviderUsage?.manualRoutes.map((modelName) => (
              <div key={`delete-route:${modelName}`} className="rounded-[14px] bg-[color:var(--color-card)] px-3 py-2 text-sm text-[color:var(--color-foreground)]">
                {t('settings.aiGateway.usedByRoute', { value: modelName })}
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-10 px-4"
              onClick={() => setDeleteConfirmProviderDraftId(null)}
              disabled={saving}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-10 px-4"
              onClick={() => {
                if (!deleteConfirmProvider) return
                deleteProviderDraft(deleteConfirmProvider.draftId)
              }}
              disabled={saving || !deleteConfirmProvider}
            >
              {t('settings.aiGateway.deleteProviderAnyway')}
            </Button>
          </div>
        </div>
      </ModalShell>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          className="h-10 rounded-full px-5 text-sm"
          onClick={() => void handleSave()}
          loading={saving}
          disabled={inputDisabled || !config}
        >
          <Save className="h-4 w-4" />
          {saving ? t('common.saving') : t('settings.aiGateway.save')}
        </Button>
        {savedHint && <p className="text-sm text-[color:var(--color-muted-foreground)]">{savedHint}</p>}
        {error && <p className="text-sm text-[color:var(--color-destructive)]">{error}</p>}
      </div>
    </div>
  )
}
