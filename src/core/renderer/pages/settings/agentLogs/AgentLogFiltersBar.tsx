import { Filter, RefreshCw, Search } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
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
        <Button
          variant="outline"
          className="h-10 justify-self-start rounded-full px-4 text-sm lg:justify-self-end"
          onClick={onRefresh}
          loading={loading}
        >
          <RefreshCw className="h-4 w-4" />
          {t('settings.agentLogs.refresh')}
        </Button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(240px,1fr)_150px_150px] 2xl:grid-cols-[minmax(320px,1fr)_170px_170px]">
        <label className="quiet-control flex h-11 items-center gap-3 rounded-full px-4">
          <Search className="h-4 w-4 text-[color:var(--color-muted-foreground)]" strokeWidth={1.8} />
          <Input
            value={filters.query}
            onChange={(event) => onChange({ ...filters, query: event.target.value })}
            placeholder={t('settings.agentLogs.searchPlaceholder')}
            className="h-auto border-0 bg-transparent px-0 py-0"
          />
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
