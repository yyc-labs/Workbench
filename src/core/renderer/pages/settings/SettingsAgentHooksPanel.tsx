import { useEffect, useState } from 'react'
import { Check, CircleAlert, Copy, RefreshCw } from 'lucide-react'
import type { AgentHookGatewayStatus, AppConfig } from '../../../shared/types'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Select } from '../../components/ui/select'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'

const feishuReceiveIdTypeOptions = [
  { value: 'open_id', label: 'open_id' },
  { value: 'user_id', label: 'user_id' },
  { value: 'union_id', label: 'union_id' },
  { value: 'email', label: 'email' },
  { value: 'chat_id', label: 'chat_id' },
]

const GATEWAY_HOST_LAN = '0.0.0.0'
const GATEWAY_HOST_LOCAL = '127.0.0.1'

type GatewayHost = typeof GATEWAY_HOST_LAN | typeof GATEWAY_HOST_LOCAL

function normalizeGatewayHost(value: string | undefined): GatewayHost {
  return value === GATEWAY_HOST_LOCAL ? GATEWAY_HOST_LOCAL : GATEWAY_HOST_LAN
}

export function SettingsAgentHooksPanel() {
  const { t, tHtml } = useI18n()
  const capability = useAppStore((s) => s.capability)
  const [agentHookConfig, setAgentHookConfig] = useState<NonNullable<AppConfig['agentHooks']> | null>(null)
  const [status, setStatus] = useState<AgentHookGatewayStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gatewayHost, setGatewayHost] = useState<GatewayHost>(GATEWAY_HOST_LAN)
  const [savingGatewayHost, setSavingGatewayHost] = useState(false)
  const [gatewayHostSaveError, setGatewayHostSaveError] = useState<string | null>(null)
  const [skillPromptCopied, setSkillPromptCopied] = useState(false)
  const [savingTranscriptImport, setSavingTranscriptImport] = useState(false)
  const [transcriptImportSaveError, setTranscriptImportSaveError] = useState<string | null>(null)
  const [transcriptImportEnabled, setTranscriptImportEnabled] = useState(true)
  const [transcriptImportToken, setTranscriptImportToken] = useState('')
  const [transcriptImportOpenViewerByDefault, setTranscriptImportOpenViewerByDefault] = useState(false)
  const [savingFeishu, setSavingFeishu] = useState(false)
  const [feishuSaveError, setFeishuSaveError] = useState<string | null>(null)
  const [feishuEnabled, setFeishuEnabled] = useState(false)
  const [feishuAppId, setFeishuAppId] = useState('')
  const [feishuAppSecret, setFeishuAppSecret] = useState('')
  const [feishuReceiveId, setFeishuReceiveId] = useState('')
  const [feishuReceiveIdType, setFeishuReceiveIdType] = useState<'open_id' | 'user_id' | 'union_id' | 'email' | 'chat_id'>('open_id')

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const nextStatus = await window.electronAPI.getAgentHookStatus()
      const nextConfig = await window.electronAPI.getConfig()
      setAgentHookConfig(nextConfig.agentHooks || null)
      setStatus(nextStatus)
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  useEffect(() => {
    const feishu = agentHookConfig?.feishu
    const transcriptImport = agentHookConfig?.transcriptImport
    setGatewayHost(normalizeGatewayHost(agentHookConfig?.host))
    setTranscriptImportEnabled(transcriptImport?.enabled ?? true)
    setTranscriptImportToken(transcriptImport?.token || '')
    setTranscriptImportOpenViewerByDefault(Boolean(transcriptImport?.openViewerByDefault))
    setFeishuEnabled(Boolean(feishu?.enabled))
    setFeishuAppId(feishu?.appId || '')
    setFeishuAppSecret(feishu?.appSecret || '')
    setFeishuReceiveId(feishu?.receiveId || '')
    setFeishuReceiveIdType(feishu?.receiveIdType || 'open_id')
  }, [agentHookConfig])

  const handleSaveGatewayHost = async () => {
    setSavingGatewayHost(true)
    setGatewayHostSaveError(null)
    try {
      const updated = await window.electronAPI.setConfig({
        agentHooks: {
          ...(agentHookConfig || {}),
          host: gatewayHost,
        },
      })
      setAgentHookConfig(updated.agentHooks || null)
      setStatus(await window.electronAPI.getAgentHookStatus())
    } catch (saveError) {
      setGatewayHostSaveError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setSavingGatewayHost(false)
    }
  }

  const handleCopySkillPrompt = async () => {
    const skillUrl = status?.transcriptSkillUrl || 'http://127.0.0.1:17373/transcripts/skill'
    const prompt = t('settings.agentHooks.agentSkillPrompt', { command: `curl -s ${skillUrl}` })
    try {
      await navigator.clipboard.writeText(prompt)
      setSkillPromptCopied(true)
      window.setTimeout(() => setSkillPromptCopied(false), 2000)
    } catch {
      // 剪贴板不可用时静默失败
    }
  }

  const handleSaveTranscriptImport = async () => {
    if (!agentHookConfig) return
    setSavingTranscriptImport(true)
    setTranscriptImportSaveError(null)
    try {
      const updated = await window.electronAPI.setConfig({
        agentHooks: {
          ...agentHookConfig,
          transcriptImport: {
            enabled: transcriptImportEnabled,
            token: transcriptImportToken.trim(),
            openViewerByDefault: transcriptImportOpenViewerByDefault,
          },
        },
      })
      setAgentHookConfig(updated.agentHooks || null)
      setStatus(await window.electronAPI.getAgentHookStatus())
    } catch (saveError) {
      setTranscriptImportSaveError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setSavingTranscriptImport(false)
    }
  }

  const handleSaveFeishu = async () => {
    if (!agentHookConfig) return
    setSavingFeishu(true)
    setFeishuSaveError(null)
    try {
      const updated = await window.electronAPI.setConfig({
        agentHooks: {
          ...agentHookConfig,
          feishu: {
            enabled: feishuEnabled,
            appId: feishuAppId.trim(),
            appSecret: feishuAppSecret.trim(),
            receiveId: feishuReceiveId.trim(),
            receiveIdType: feishuReceiveIdType,
            notifyOn: ['stop', 'permission-request'],
          },
        },
      })
      setAgentHookConfig(updated.agentHooks || null)
    } catch (saveError) {
      setFeishuSaveError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setSavingFeishu(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="section-label mb-3">{t('settings.agentHooks.sectionLabel')}</p>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">{t('settings.agentHooks.title')}</h2>
            <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2">{t('settings.agentHooks.description')}</p>
          </div>
          <Button onClick={() => void refresh()} loading={loading} className="rounded-full gap-2">
            <RefreshCw className="w-4 h-4" strokeWidth={1.8} />
            {t('settings.agentHooks.refresh')}
          </Button>
        </div>
      </div>

      <section className="quiet-control rounded-[22px] p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-xs font-medium uppercase text-[color:var(--color-muted-foreground)]">{t('settings.agentHooks.status')}</div>
            <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-[color:var(--color-foreground)]">
              <span className={`h-2.5 w-2.5 rounded-full ${status?.running ? 'bg-emerald-500' : 'bg-rose-500'}`} />
              {status?.running ? t('settings.agentHooks.running') : t('settings.agentHooks.stopped')}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase text-[color:var(--color-muted-foreground)]">{t('settings.agentHooks.endpoint')}</div>
            <div className="mt-2 truncate text-sm text-[color:var(--color-foreground)]">{status?.url || 'n/a'}</div>
            <div className="mt-1 truncate text-xs text-[color:var(--color-muted-foreground)]">{status?.url ? `${status.url}/transcripts/import` : 'n/a'}</div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase text-[color:var(--color-muted-foreground)]">{t('settings.agentHooks.token')}</div>
            <div className="mt-2 text-sm text-[color:var(--color-foreground)]">{status?.tokenConfigured ? t('settings.agentHooks.configured') : t('settings.agentHooks.notRequired')}</div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase text-[color:var(--color-muted-foreground)]">{t('settings.agentHooks.recentEvents')}</div>
            <div className="mt-2 text-sm text-[color:var(--color-foreground)]">{status?.recentEventCount ?? 0}</div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.agentHooks.listenScope')}</p>
            <div className="flex items-center gap-3">
              <Select
                ariaLabel={t('settings.agentHooks.listenScope')}
                value={gatewayHost}
                options={[
                  { value: GATEWAY_HOST_LAN, label: t('settings.agentHooks.listenScopeLan') },
                  { value: GATEWAY_HOST_LOCAL, label: t('settings.agentHooks.listenScopeLocal') },
                ]}
                onChange={(value) => setGatewayHost(normalizeGatewayHost(value))}
                triggerClassName="h-10 w-[240px]"
              />
              <Button onClick={() => void handleSaveGatewayHost()} loading={savingGatewayHost} className="rounded-full">
                {savingGatewayHost ? t('common.saving') : t('common.save')}
              </Button>
            </div>
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.agentHooks.listenScopeDescription')}</p>
          </div>
        </div>

        <div className="mt-4 rounded-[16px] bg-[color:var(--color-card)] px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.agentHooks.agentSkillPromptLabel')}</p>
              <p className="truncate text-sm text-[color:var(--color-foreground)]">{`curl -s ${status?.transcriptSkillUrl || 'http://127.0.0.1:17373/transcripts/skill'}`}</p>
            </div>
            <Button variant="outline" onClick={() => void handleCopySkillPrompt()} className="shrink-0 rounded-full gap-2">
              {skillPromptCopied ? <Check className="h-4 w-4 text-[color:var(--color-success)]" /> : <Copy className="h-4 w-4" />}
              {skillPromptCopied ? t('common.copied') : t('settings.agentHooks.copySkillPrompt')}
            </Button>
          </div>
        </div>
        {capability?.hostPlatform === 'windows' && <p className="mt-2 text-xs text-[color:var(--color-muted-foreground)]">{t('settings.agentHooks.agentSkillPromptGlobalHint')}</p>}

        {(gatewayHostSaveError || error || status?.error) && (
          <div className="mt-4 flex items-start gap-2 rounded-[14px] bg-rose-500/10 px-3 py-2 text-sm text-rose-600">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
            <span>{gatewayHostSaveError || error || status?.error}</span>
          </div>
        )}
      </section>

      <section className="quiet-control rounded-[22px] p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('settings.agentHooks.transcriptImportTitle')}</div>
            <div className="mt-1 text-sm text-[color:var(--color-muted-foreground)]">{t('settings.agentHooks.transcriptImportDescription')}</div>
          </div>
          <label className="flex items-center gap-2 text-sm text-[color:var(--color-foreground)]">
            <input type="checkbox" checked={transcriptImportEnabled} onChange={(event) => setTranscriptImportEnabled(event.target.checked)} />
            {t('settings.agentHooks.enabled')}
          </label>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.agentHooks.importEndpoint')}</p>
            <div className="quiet-control rounded-full px-4 py-3 text-sm text-[color:var(--color-foreground)]">{status?.transcriptImportUrl || 'n/a'}</div>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.agentHooks.projectsEndpoint')}</p>
            <div className="quiet-control rounded-full px-4 py-3 text-sm text-[color:var(--color-foreground)]">{status?.transcriptProjectsUrl || 'n/a'}</div>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.agentHooks.projectIdEndpoint')}</p>
            <div className="quiet-control rounded-full px-4 py-3 text-sm text-[color:var(--color-foreground)]">{status?.transcriptProjectIdUrl || 'n/a'}</div>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.agentHooks.skillEndpoint')}</p>
            <div className="quiet-control rounded-full px-4 py-3 text-sm text-[color:var(--color-foreground)]">{status?.transcriptSkillUrl || 'n/a'}</div>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.agentHooks.dedicatedToken')}</p>
            <Input type="password" value={transcriptImportToken} onChange={(event) => setTranscriptImportToken(event.target.value)} className="h-11" placeholder="optional transcript import token" />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.agentHooks.defaultViewerBehavior')}</p>
            <label className="quiet-control flex h-11 items-center gap-2 rounded-full px-4 text-sm text-[color:var(--color-foreground)]">
              <input type="checkbox" checked={transcriptImportOpenViewerByDefault} onChange={(event) => setTranscriptImportOpenViewerByDefault(event.target.checked)} />
              {t('settings.agentHooks.openTranscriptViewerByDefault')}
            </label>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-[16px] bg-[color:var(--color-card)] px-4 py-3">
            <div className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.agentHooks.routeStatus')}</div>
            <div className="mt-1 text-sm font-medium text-[color:var(--color-foreground)]">{status?.transcriptImportEnabled ? t('settings.agentHooks.enabled') : t('settings.agentHooks.stopped')}</div>
          </div>
          <div className="rounded-[16px] bg-[color:var(--color-card)] px-4 py-3">
            <div className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.agentHooks.dedicatedToken')}</div>
            <div className="mt-1 text-sm font-medium text-[color:var(--color-foreground)]">{status?.transcriptImportTokenConfigured ? t('settings.agentHooks.configured') : t('settings.agentHooks.notRequired')}</div>
          </div>
          <div className="rounded-[16px] bg-[color:var(--color-card)] px-4 py-3">
            <div className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.agentHooks.discoveryApi')}</div>
            <div className="mt-1 text-sm font-medium text-[color:var(--color-foreground)]">`GET /transcripts/projects`</div>
          </div>
        </div>

        {(transcriptImportSaveError || error) && (
          <div className="mt-4 flex items-start gap-2 rounded-[14px] bg-rose-500/10 px-3 py-2 text-sm text-rose-600">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
            <span>{transcriptImportSaveError || error}</span>
          </div>
        )}

        <div className="mt-5 flex items-center justify-between gap-4">
          <div className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.agentHooks.authHeaders')}: `Authorization: Bearer ...` or `x-ide-electron-transcript-token`</div>
          <Button onClick={() => void handleSaveTranscriptImport()} loading={savingTranscriptImport}>
            {savingTranscriptImport ? t('common.saving') : t('settings.agentHooks.saveTranscriptImportConfig')}
          </Button>
        </div>
      </section>

      <section className="quiet-control rounded-[22px] p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('settings.agentHooks.feishuTitle')}</div>
            <div className="mt-1 text-sm text-[color:var(--color-muted-foreground)]" dangerouslySetInnerHTML={tHtml('settings.agentHooks.feishuDescription')} />
          </div>
          <label className="flex items-center gap-2 text-sm text-[color:var(--color-foreground)]">
            <input type="checkbox" checked={feishuEnabled} onChange={(event) => setFeishuEnabled(event.target.checked)} />
            {t('settings.agentHooks.enabled')}
          </label>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.agentHooks.appId')}</p>
            <Input value={feishuAppId} onChange={(event) => setFeishuAppId(event.target.value)} className="h-11" placeholder="cli_..." />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.agentHooks.appSecret')}</p>
            <Input type="password" value={feishuAppSecret} onChange={(event) => setFeishuAppSecret(event.target.value)} className="h-11" placeholder="app secret" />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.agentHooks.receiveId')}</p>
            <Input value={feishuReceiveId} onChange={(event) => setFeishuReceiveId(event.target.value)} className="h-11" placeholder="open_id / chat_id / email" />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.agentHooks.receiveIdType')}</p>
            <Select ariaLabel={t('settings.agentHooks.receiveIdType')} value={feishuReceiveIdType} options={feishuReceiveIdTypeOptions} onChange={(value) => setFeishuReceiveIdType(value as typeof feishuReceiveIdType)} triggerClassName="h-11" />
          </div>
        </div>

        {(feishuSaveError || error) && (
          <div className="mt-4 flex items-start gap-2 rounded-[14px] bg-rose-500/10 px-3 py-2 text-sm text-rose-600">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
            <span>{feishuSaveError || error}</span>
          </div>
        )}

        <div className="mt-5 flex items-center justify-between gap-4">
          <div className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.agentHooks.currentTriggers')}: `Stop`, `PermissionRequest`</div>
          <Button onClick={() => void handleSaveFeishu()} loading={savingFeishu}>
            {savingFeishu ? t('common.saving') : t('settings.agentHooks.saveFeishuConfig')}
          </Button>
        </div>
      </section>
    </div>
  )
}
