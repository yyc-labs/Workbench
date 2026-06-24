import { Check } from 'lucide-react'
import { useMemo } from 'react'
import type { ProjectDocLinkTag, ProjectDocTagOption } from '../../../shared/types'
import { Select, type SelectOption } from '../../components/ui/select'
import { normalizeProjectDocLinkTag, projectDocLinkTagLabel } from '../../lib/projectDocLinks'
import { useI18n } from '../../i18n'

type DetailDocumentationTagSelectProps = {
  value: ProjectDocLinkTag
  onChange: (tag: ProjectDocLinkTag) => void
  options: ReadonlyArray<ProjectDocTagOption>
  compact?: boolean
}

function DetailDocumentationTagSelect({
  value,
  onChange,
  options,
  compact = false,
}: DetailDocumentationTagSelectProps) {
  const { t } = useI18n()
  const safeOptions = useMemo(() => options, [options])
  const normalizedValue = useMemo(
    () => normalizeProjectDocLinkTag(value, safeOptions),
    [safeOptions, value]
  )
  const currentLabel = useMemo(
    () => projectDocLinkTagLabel(normalizedValue, safeOptions),
    [normalizedValue, safeOptions]
  )
  const selectOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: t('common.uncategorized') },
      ...safeOptions.map((option) => ({
        value: option.value,
        label: option.label,
      })),
    ],
    [safeOptions, t]
  )

  return (
    <Select
      ariaLabel={t('documentation.categoriesTitle')}
      value={normalizedValue}
      options={selectOptions}
      onChange={(nextValue) => onChange(nextValue)}
      triggerClassName={
        compact
          ? 'h-9 rounded-full px-3 text-xs hover:border-[color:var(--color-border-hover)]'
          : 'h-10 rounded-full px-4 text-sm hover:border-[color:var(--color-border-hover)]'
      }
      contentClassName="rounded-[14px] p-1 surface-card"
      optionClassName={compact ? 'rounded-[10px] px-2.5 py-1.5 text-xs' : 'rounded-[10px] px-2.5 py-1.5 text-sm'}
      renderValue={() => currentLabel}
      renderOption={(option, state) => (
        <>
          <span>{option.label}</span>
          {state.selected ? (
            <Check className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
          ) : null}
        </>
      )}
    />
  )
}

export { DetailDocumentationTagSelect }
