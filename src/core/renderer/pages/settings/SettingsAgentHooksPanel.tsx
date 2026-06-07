import { useEffect, useMemo, useState } from 'react'
import { Activity, CircleAlert, RefreshCw } from 'lucide-react'
import type { AgentHookEnvelope, AgentHookGatewayStatus } from '../../../shared/types'
import { Button } from '../../components/ui/button'

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
  const [status, setStatus] = useState<AgentHookGatewayStatus | null>(null)
  const [events, setEvents] = useState<AgentHookEnvelope[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)

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
              Local ingress for Claude Code and Codex CLI lifecycle events.
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
