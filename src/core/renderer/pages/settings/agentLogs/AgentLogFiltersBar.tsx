import { Filter, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Select, type SelectOption } from '../../../components/ui/select'
import { useI18n } from '../../../i18n'
import type { AgentLogFilterLevel, AgentLogFilterRoute, AgentLogFilterSource, AgentLogFilters } from './agentLogs.types'

type AgentLogFiltersBarProps = {
  filters: AgentLogFilters
  loading: boolean
  total: number
  filtered: number
  onChange: (next: AgentLogFilters) => void
  onRefresh: () => void
  onClear: () => void
  clearing: boolean
  clearDisabled: boolean
  logCaptureEnabled: boolean
  logCaptureSaving: boolean
  onLogCaptureToggle: (enabled: boolean) => void
}

const LEVEL_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All levels' },
  { value: 'info', label: 'info' },
  { value: 'warn', label: 'warn' },
  { value: 'error', label: 'error' },
]

const ROUTE_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All routes' },
  { value: 'anthropic', label: 'anthropic' },
  { value: 'responses', label: 'responses' },
  { value: 'chat', label: 'chat' },
]

function SourceButton({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`button-interactive rounded-full px-4 py-2 text-sm transition-colors ${
        active
          ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm'
          : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
      } whitespace-nowrap`}
    >
      {label}
    </button>
  )
}

export function AgentLogFiltersBar({
  filters,
  loading,
  total,
  filtered,
  onChange,
  onRefresh,
  onClear,
  clearing,
  clearDisabled,
  logCaptureEnabled,
  logCaptureSaving,
  onLogCaptureToggle,
}: AgentLogFiltersBarProps) {
  const { t } = useI18n()

  const setSource = (source: AgentLogFilterSource) => onChange({ ...filters, source })
  const setLevel = (level: AgentLogFilterLevel) => onChange({ ...filters, level })
  const setRoute = (route: AgentLogFilterRoute) => onChange({ ...filters, route })

  return (
    <div className="rounded-[24px] border px-4 py-4 surface-card md:px-5" style={{ borderColor: 'var(--color-border)' }}>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[color:var(--color-muted-foreground)]">
            <Filter className="h-3.5 w-3.5" strokeWidth={1.8} />
            <span>{t('settings.agentLogs.filtersLabel')}</span>
            <span className="rounded-full bg-[color:var(--color-card)] px-2.5 py-1 font-normal tracking-normal">
              {filtered} / {total}
            </span>
          </div>

          <label className="quiet-control flex h-10 items-center gap-2 rounded-full px-4 text-sm text-[color:var(--color-foreground)]">
            <input
              type="checkbox"
              className="checkbox"
              checked={logCaptureEnabled}
              disabled={logCaptureSaving}
              onChange={(event) => onLogCaptureToggle(event.target.checked)}
            />
            <span>
              {logCaptureEnabled
                ? t('settings.agentLogs.captureEnabled')
                : t('settings.agentLogs.captureDisabled')}
            </span>
          </label>

          <div className="quiet-control inline-flex max-w-full flex-wrap gap-1 rounded-full p-1">
            <SourceButton
              active={filters.source === 'all'}
              label={t('settings.agentLogs.sourceAll')}
              onClick={() => setSource('all')}
            />
            <SourceButton
              active={filters.source === 'ai-gateway'}
              label={t('settings.agentLogs.sourceGateway')}
              onClick={() => setSource('ai-gateway')}
            />
            <SourceButton
              active={filters.source === 'agent-hooks'}
              label={t('settings.agentLogs.sourceHooks')}
              onClick={() => setSource('agent-hooks')}
            />
          </div>
        </div>
        <div className="flex flex-wrap justify-self-start gap-2 lg:justify-self-end">
          <Button
            variant="outline"
            className="h-10 rounded-full px-4 text-sm text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-background)] hover:text-[color:var(--color-destructive)]"
            onClick={onClear}
            loading={clearing}
            disabled={clearDisabled}
          >
            <Trash2 className="h-4 w-4" />
            {t('settings.agentLogs.clear')}
          </Button>
          <Button
            variant="outline"
            className="h-10 rounded-full px-4 text-sm"
            onClick={onRefresh}
            loading={loading}
          >
            <RefreshCw className="h-4 w-4" />
            {t('settings.agentLogs.refresh')}
          </Button>
        </div>
      </div>

      {!logCaptureEnabled && (
        <div className="mt-4 rounded-[18px] px-4 py-3 text-sm leading-6" style={{
          background: 'var(--color-warning-background)',
          color: 'var(--color-warning)',
        }}>
          {t('settings.agentLogs.captureDisabledHint')}
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(240px,1fr)_150px_150px] 2xl:grid-cols-[minmax(320px,1fr)_170px_170px]">
        <label className="quiet-control relative flex h-11 items-center rounded-full px-4 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-0">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--color-muted-foreground)]"
            strokeWidth={1.8}
          />
          <input
            type="text"
            value={filters.query}
            onChange={(event) => onChange({ ...filters, query: event.target.value })}
            placeholder={t('settings.agentLogs.searchPlaceholder')}
            className="h-full min-w-0 w-full bg-transparent pl-8 pr-10 text-base text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] focus:outline-none md:text-sm"
          />
          <button
            type="button"
            className={`button-interactive absolute right-3 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-opacity ${
              filters.query
                ? 'hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
                : 'pointer-events-none opacity-0'
            }`}
            onClick={() => onChange({ ...filters, query: '' })}
            aria-label={t('common.clearSearch')}
            title={t('common.clearSearch')}
            tabIndex={filters.query ? 0 : -1}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </label>

        <Select
          ariaLabel={t('settings.agentLogs.level')}
          value={filters.level}
          options={[
            { ...LEVEL_OPTIONS[0], label: t('settings.agentLogs.levelAll') },
            LEVEL_OPTIONS[1],
            LEVEL_OPTIONS[2],
            LEVEL_OPTIONS[3],
          ]}
          onChange={(value) => setLevel(value as AgentLogFilterLevel)}
          triggerClassName="h-11"
        />

        <Select
          ariaLabel={t('settings.agentLogs.route')}
          value={filters.route}
          options={[
            { ...ROUTE_OPTIONS[0], label: t('settings.agentLogs.routeAll') },
            ROUTE_OPTIONS[1],
            ROUTE_OPTIONS[2],
            ROUTE_OPTIONS[3],
          ]}
          onChange={(value) => setRoute(value as AgentLogFilterRoute)}
          triggerClassName="h-11"
        />
      </div>
    </div>
  )
}
