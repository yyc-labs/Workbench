import { useI18n } from '../../../i18n'

export type QuickActionFilter = 'all' | 'project' | 'task' | 'other'

type QuickActionFiltersProps = {
  value: QuickActionFilter
  onChange: (filter: QuickActionFilter) => void
  counts: Record<QuickActionFilter, number>
}

export function QuickActionFilters({ value, onChange, counts }: QuickActionFiltersProps) {
  const { t } = useI18n()
  const filters: Array<{ key: QuickActionFilter; label: string }> = [
    { key: 'all', label: t('quickActions.filter.all') },
    { key: 'project', label: t('quickActions.filter.project') },
    { key: 'task', label: t('quickActions.filter.task') },
    { key: 'other', label: t('quickActions.filter.other') },
  ]

  return (
    <div className="quiet-control flex flex-wrap gap-1 rounded-full p-1">
      {filters.map((filter) => {
        const selected = value === filter.key
        return (
          <button
            key={filter.key}
            type="button"
            onClick={() => onChange(filter.key)}
            aria-pressed={selected}
            className={`button-interactive rounded-full px-3.5 py-2 text-sm transition-colors ${selected ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm' : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'}`}
          >
            {filter.label}
            <span className="ml-1.5 text-xs text-[color:var(--color-muted-foreground)]">{counts[filter.key]}</span>
          </button>
        )
      })}
    </div>
  )
}
