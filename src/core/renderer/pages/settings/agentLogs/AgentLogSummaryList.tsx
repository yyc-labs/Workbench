import { Bot, RadioTower } from 'lucide-react'
import type { AgentLogSummary } from '../../../../shared/types'
import { useI18n } from '../../../i18n'
import { agentLogKey } from './agentLogs.helpers'

type AgentLogSummaryListProps = {
  items: AgentLogSummary[]
  selectedKey: string | null
  emptyReason: 'none' | 'filtered'
  onSelect: (item: AgentLogSummary) => void
}

function levelClassName(level: AgentLogSummary['level']): string {
  if (level === 'error') return 'text-[color:var(--color-destructive)]'
  if (level === 'warn') return 'text-amber-600 dark:text-amber-400'
  return 'text-[color:var(--color-muted-foreground)]'
}

function MetaBadge({ value }: { value: string | number }) {
  return (
    <span
      className="max-w-full truncate rounded-full bg-[color:var(--color-background-sunken)]/55 px-2.5 py-1"
      title={String(value)}
    >
      {value}
    </span>
  )
}

export function AgentLogSummaryList({
  items,
  selectedKey,
  emptyReason,
  onSelect,
}: AgentLogSummaryListProps) {
  const { t, formatDateTime } = useI18n()

  return (
    <div className="quiet-control min-h-[460px] rounded-[24px] p-3">
      <div className="flex items-center justify-between gap-3 px-2 py-2">
        <div className="text-sm font-semibold text-[color:var(--color-foreground)]">
          {t('settings.agentLogs.listTitle')}
        </div>
        <span className="rounded-full bg-[color:var(--color-card)] px-3 py-1 text-xs text-[color:var(--color-muted-foreground)]">
          {items.length}
        </span>
      </div>

      <div className="mt-2 max-h-[640px] space-y-2 overflow-y-auto pr-1 lg:max-h-[calc(100vh-360px)]">
        {items.length === 0 ? (
          <div className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-10 text-center text-sm text-[color:var(--color-muted-foreground)]">
            {emptyReason === 'filtered'
              ? t('settings.agentLogs.noFilteredLogs')
              : t('settings.agentLogs.noLogs')}
          </div>
        ) : items.map((item) => {
          const key = agentLogKey(item)
          const Icon = item.source === 'ai-gateway' ? Bot : RadioTower
          const isActive = key === selectedKey

          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(item)}
              className={`button-interactive w-full rounded-[18px] px-3.5 py-3 text-left transition-colors ${
                isActive
                  ? 'bg-[color:var(--color-card)] shadow-sm'
                  : 'hover:bg-[color:var(--color-accent)]/70'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <div className={`shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] ${levelClassName(item.level)}`}>
                    {item.level}
                  </div>
                  <div className="truncate text-sm font-semibold text-[color:var(--color-foreground)]">
                    {item.title}
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs text-[color:var(--color-muted-foreground)]">
                  {formatDateTime(item.timestamp, {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </div>
              </div>

              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-[color:var(--color-muted-foreground)]">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--color-background-sunken)]/70 px-2.5 py-1">
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                  {item.source === 'ai-gateway'
                    ? t('settings.agentLogs.sourceGateway')
                    : t('settings.agentLogs.sourceHooks')}
                </span>
                {item.route && <MetaBadge value={item.route} />}
                {item.providerName && <MetaBadge value={item.providerName} />}
                {item.providerEvent && <MetaBadge value={item.providerEvent} />}
                {item.canonicalEvent && <MetaBadge value={item.canonicalEvent} />}
                {item.model && <MetaBadge value={item.model} />}
                {typeof item.statusCode === 'number' && <MetaBadge value={item.statusCode} />}
                {typeof item.durationMs === 'number' && <MetaBadge value={`${item.durationMs}ms`} />}
                {item.stream && <MetaBadge value={t('settings.agentLogs.requestedStream')} />}
                {item.truncated && <MetaBadge value={t('settings.agentLogs.truncated')} />}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
