import { useEffect, useMemo, useState } from 'react'
import { Activity, CircleAlert, RefreshCw } from 'lucide-react'
import type { AgentHookEnvelope, AgentHookGatewayStatus, AppConfig } from '../../../shared/types'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatRawPreview(raw: unknown): string {
  try {
    return JSON.stringify(raw, null, 2)
  } catch {
    return String(raw)
  }
}

function providerLabel(provider: AgentHookEnvelope['provider']): string {
  if (provider === 'claude-code') return 'Claude Code'
  if (provider === 'codex-cli') return 'Codex CLI'
  return 'Unknown'
}

export function SettingsAgentHooksPanel() {
  const [agentHookConfig, setAgentHookConfig] = useState<NonNullable<AppConfig['agentHooks']> | null>(null)
  const [status, setStatus] = useState<AgentHookGatewayStatus | null>(null)
  const [events, setEvents] = useState<AgentHookEnvelope[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
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

  const selectedEvent = useMemo(
    () => events.find((event) => event.eventId === selectedEventId) || events[0],
    [events, selectedEventId],
  )

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextStatus, nextEvents] = await Promise.all([
        window.electronAPI.getAgentHookStatus(),
        window.electronAPI.getAgentHookRecentEvents(),
      ])
      const nextConfig = await window.electronAPI.getConfig()
      setAgentHookConfig(nextConfig.agentHooks || null)
      setStatus(nextStatus)
      setEvents(nextEvents)
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    const unsubscribe = window.electronAPI.onAgentHookEvent((event) => {
      setEvents((current) => [event, ...current.filter((item) => item.eventId !== event.eventId)].slice(0, 200))
      setSelectedEventId(event.eventId)
      void window.electronAPI.getAgentHookStatus().then(setStatus)
    })
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    const feishu = agentHookConfig?.feishu
    const transcriptImport = agentHookConfig?.transcriptImport
    setTranscriptImportEnabled(transcriptImport?.enabled ?? true)
    setTranscriptImportToken(transcriptImport?.token || '')
    setTranscriptImportOpenViewerByDefault(Boolean(transcriptImport?.openViewerByDefault))
    setFeishuEnabled(Boolean(feishu?.enabled))
    setFeishuAppId(feishu?.appId || '')
    setFeishuAppSecret(feishu?.appSecret || '')
    setFeishuReceiveId(feishu?.receiveId || '')
    setFeishuReceiveIdType(feishu?.receiveIdType || 'open_id')
  }, [agentHookConfig])

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
        <p className="section-label mb-3">Agent Hooks</p>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">
              Hook Gateway
            </h2>
            <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2">
              Local ingress for Claude Code, Codex CLI lifecycle events, and external transcript imports.
            </p>
          </div>
          <Button onClick={() => void refresh()} disabled={loading} className="rounded-full gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.8} />
            Refresh
          </Button>
        </div>
      </div>

      <section className="quiet-control rounded-[22px] p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-xs font-medium uppercase text-[color:var(--color-muted-foreground)]">Status</div>
            <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-[color:var(--color-foreground)]">
              <span className={`h-2.5 w-2.5 rounded-full ${status?.running ? 'bg-emerald-500' : 'bg-rose-500'}`} />
              {status?.running ? 'Running' : 'Stopped'}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase text-[color:var(--color-muted-foreground)]">Endpoint</div>
            <div className="mt-2 truncate text-sm text-[color:var(--color-foreground)]">{status?.url || 'n/a'}</div>
            <div className="mt-1 truncate text-xs text-[color:var(--color-muted-foreground)]">
              {status?.url ? `${status.url}/transcripts/import` : 'n/a'}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase text-[color:var(--color-muted-foreground)]">Token</div>
            <div className="mt-2 text-sm text-[color:var(--color-foreground)]">
              {status?.tokenConfigured ? 'Configured' : 'Not required'}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase text-[color:var(--color-muted-foreground)]">Recent Events</div>
            <div className="mt-2 text-sm text-[color:var(--color-foreground)]">{status?.recentEventCount ?? events.length}</div>
          </div>
        </div>
        {(error || status?.error) && (
          <div className="mt-4 flex items-start gap-2 rounded-[14px] bg-rose-500/10 px-3 py-2 text-sm text-rose-600">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
            <span>{error || status?.error}</span>
          </div>
        )}
      </section>

      <section className="quiet-control rounded-[22px] p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-[color:var(--color-foreground)]">Transcript Import API</div>
            <div className="mt-1 text-sm text-[color:var(--color-muted-foreground)]">
              Receive transcript text from other local applications and expose a project discovery endpoint.
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-[color:var(--color-foreground)]">
            <input
              type="checkbox"
              checked={transcriptImportEnabled}
              onChange={(event) => setTranscriptImportEnabled(event.target.checked)}
            />
            Enabled
          </label>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">Import Endpoint</p>
            <div className="quiet-control rounded-full px-4 py-3 text-sm text-[color:var(--color-foreground)]">
              {status?.transcriptImportUrl || 'n/a'}
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">Projects Endpoint</p>
            <div className="quiet-control rounded-full px-4 py-3 text-sm text-[color:var(--color-foreground)]">
              {status?.transcriptProjectsUrl || 'n/a'}
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">Dedicated Token</p>
            <Input
              type="password"
              value={transcriptImportToken}
              onChange={(event) => setTranscriptImportToken(event.target.value)}
              className="h-11"
              placeholder="optional transcript import token"
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">Default Viewer Behavior</p>
            <label className="quiet-control flex h-11 items-center gap-2 rounded-full px-4 text-sm text-[color:var(--color-foreground)]">
              <input
                type="checkbox"
                checked={transcriptImportOpenViewerByDefault}
                onChange={(event) => setTranscriptImportOpenViewerByDefault(event.target.checked)}
              />
              Open Transcript Viewer by default
            </label>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-[16px] bg-[color:var(--color-card)] px-4 py-3">
            <div className="text-xs text-[color:var(--color-muted-foreground)]">Route Status</div>
            <div className="mt-1 text-sm font-medium text-[color:var(--color-foreground)]">
              {status?.transcriptImportEnabled ? 'Enabled' : 'Disabled'}
            </div>
          </div>
          <div className="rounded-[16px] bg-[color:var(--color-card)] px-4 py-3">
            <div className="text-xs text-[color:var(--color-muted-foreground)]">Dedicated Token</div>
            <div className="mt-1 text-sm font-medium text-[color:var(--color-foreground)]">
              {status?.transcriptImportTokenConfigured ? 'Configured' : 'Not required'}
            </div>
          </div>
          <div className="rounded-[16px] bg-[color:var(--color-card)] px-4 py-3">
            <div className="text-xs text-[color:var(--color-muted-foreground)]">Discovery API</div>
            <div className="mt-1 text-sm font-medium text-[color:var(--color-foreground)]">
              `GET /transcripts/projects`
            </div>
          </div>
        </div>

        {(transcriptImportSaveError || error) && (
          <div className="mt-4 flex items-start gap-2 rounded-[14px] bg-rose-500/10 px-3 py-2 text-sm text-rose-600">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
            <span>{transcriptImportSaveError || error}</span>
          </div>
        )}

        <div className="mt-5 flex items-center justify-between gap-4">
          <div className="text-xs text-[color:var(--color-muted-foreground)]">
            Auth headers: `Authorization: Bearer ...` or `x-ide-electron-transcript-token`
          </div>
          <Button onClick={() => void handleSaveTranscriptImport()} disabled={savingTranscriptImport}>
            {savingTranscriptImport ? 'Saving...' : 'Save Transcript Import Config'}
          </Button>
        </div>
      </section>

      <section className="quiet-control rounded-[22px] p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-[color:var(--color-foreground)]">Feishu Notification</div>
            <div className="mt-1 text-sm text-[color:var(--color-muted-foreground)]">
              Send a message when an AI turn finishes on `Stop` or needs approval on `PermissionRequest`.
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-[color:var(--color-foreground)]">
            <input
              type="checkbox"
              checked={feishuEnabled}
              onChange={(event) => setFeishuEnabled(event.target.checked)}
            />
            Enabled
          </label>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">App ID</p>
            <Input
              value={feishuAppId}
              onChange={(event) => setFeishuAppId(event.target.value)}
              className="h-11"
              placeholder="cli_..."
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">App Secret</p>
            <Input
              type="password"
              value={feishuAppSecret}
              onChange={(event) => setFeishuAppSecret(event.target.value)}
              className="h-11"
              placeholder="app secret"
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">Receive ID</p>
            <Input
              value={feishuReceiveId}
              onChange={(event) => setFeishuReceiveId(event.target.value)}
              className="h-11"
              placeholder="open_id / chat_id / email"
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">Receive ID Type</p>
            <select
              value={feishuReceiveIdType}
              onChange={(event) => setFeishuReceiveIdType(event.target.value as typeof feishuReceiveIdType)}
              className="quiet-control h-11 w-full rounded-full border-0 px-4 text-sm text-[color:var(--color-foreground)] focus-visible:outline-none"
            >
              <option value="open_id">open_id</option>
              <option value="user_id">user_id</option>
              <option value="union_id">union_id</option>
              <option value="email">email</option>
              <option value="chat_id">chat_id</option>
            </select>
          </div>
        </div>

        {(feishuSaveError || error) && (
          <div className="mt-4 flex items-start gap-2 rounded-[14px] bg-rose-500/10 px-3 py-2 text-sm text-rose-600">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
            <span>{feishuSaveError || error}</span>
          </div>
        )}

        <div className="mt-5 flex items-center justify-between gap-4">
          <div className="text-xs text-[color:var(--color-muted-foreground)]">
            Current triggers: `Stop`, `PermissionRequest`
          </div>
          <Button onClick={() => void handleSaveFeishu()} disabled={savingFeishu}>
            {savingFeishu ? 'Saving...' : 'Save Feishu Config'}
          </Button>
        </div>
      </section>

      <section className="grid min-h-[420px] gap-4 lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.15fr)]">
        <div className="quiet-control min-h-0 rounded-[22px] p-3">
          <div className="flex items-center gap-2 px-2 py-2 text-sm font-semibold text-[color:var(--color-foreground)]">
            <Activity className="h-4 w-4" strokeWidth={1.8} />
            Events
          </div>
          <div className="mt-1 max-h-[520px] space-y-2 overflow-y-auto pr-1">
            {events.length === 0 ? (
              <div className="px-2 py-8 text-center text-sm text-[color:var(--color-muted-foreground)]">
                No hook events received yet.
              </div>
            ) : events.map((event) => (
              <button
                key={event.eventId}
                onClick={() => setSelectedEventId(event.eventId)}
                className={`w-full rounded-[16px] px-3 py-3 text-left transition-colors ${
                  selectedEvent?.eventId === event.eventId
                    ? 'bg-[color:var(--color-card)] shadow-sm'
                    : 'hover:bg-[color:var(--color-accent)]/70'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-semibold text-[color:var(--color-foreground)]">
                    {event.providerEvent}
                  </span>
                  <span className="shrink-0 text-xs text-[color:var(--color-muted-foreground)]">
                    {formatTime(event.receivedAt)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[color:var(--color-muted-foreground)]">
                  <span>{providerLabel(event.provider)}</span>
                  <span>{event.canonicalEvent}</span>
                  {event.toolName && <span>{event.toolName}</span>}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="quiet-control min-h-0 rounded-[22px] p-4">
          {selectedEvent ? (
            <div className="space-y-4">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-lg font-semibold tracking-[-0.02em] text-[color:var(--color-foreground)]">
                    {selectedEvent.providerEvent}
                  </h3>
                  <span className="rounded-full bg-[color:var(--color-accent)] px-3 py-1 text-xs text-[color:var(--color-muted-foreground)]">
                    {providerLabel(selectedEvent.provider)}
                  </span>
                </div>
                <div className="mt-2 grid gap-2 text-sm text-[color:var(--color-muted-foreground)] sm:grid-cols-2">
                  <div>Canonical: {selectedEvent.canonicalEvent}</div>
                  <div>Received: {new Date(selectedEvent.receivedAt).toLocaleString()}</div>
                  <div className="truncate">CWD: {selectedEvent.cwd || 'n/a'}</div>
                  <div>Tool: {selectedEvent.toolName || 'n/a'}</div>
                </div>
              </div>
              <pre className="max-h-[420px] overflow-auto rounded-[16px] bg-[color:var(--color-card)] p-4 text-xs leading-5 text-[color:var(--color-foreground)]">
                {formatRawPreview(selectedEvent.raw)}
              </pre>
            </div>
          ) : (
            <div className="flex min-h-[360px] items-center justify-center text-sm text-[color:var(--color-muted-foreground)]">
              Select an event to inspect the raw payload.
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
