import { ListChecks, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { BrowserAiTaskRecordSummary } from '../../../../shared/types'
import { ModalShell } from '../../../components/ModalShell'
import { Button } from '../../../components/ui/button'
import { Checkbox } from '../../../components/ui/checkbox'
import { Input } from '../../../components/ui/input'
import { Select } from '../../../components/ui/select'
import { useI18n } from '../../../i18n'
import { useAppStore } from '../../../stores/appStore'
import { filterBrowserAiHistoryRecords, type LearningBrowserAiHistoryTimeFilter } from './learningBrowserAiHistory'

type LearningBrowserAiHistoryPickerDialogProps = {
  open: boolean
  selectedRecordIds: string[]
  onClose: () => void
  onApply: (recordIds: string[]) => void
}

const timeFilterOptions: Array<{
  value: LearningBrowserAiHistoryTimeFilter
  labelKey: string
}> = [
  { value: 'all', labelKey: 'learning.browserAi.historyTimeAll' },
  { value: 'today', labelKey: 'learning.browserAi.historyTimeToday' },
  { value: 'this-week', labelKey: 'learning.browserAi.historyTimeThisWeek' },
  { value: 'this-month', labelKey: 'learning.browserAi.historyTimeThisMonth' },
  { value: 'last-7-days', labelKey: 'learning.browserAi.historyTimeLast7Days' },
  { value: 'last-30-days', labelKey: 'learning.browserAi.historyTimeLast30Days' },
  { value: 'last-90-days', labelKey: 'learning.browserAi.historyTimeLast90Days' },
]

function statusLabelKey(status: BrowserAiTaskRecordSummary['status']): string {
  return `learning.browserAi.historyStatus.${status}`
}

export function LearningBrowserAiHistoryPickerDialog({ open, selectedRecordIds, onClose, onApply }: LearningBrowserAiHistoryPickerDialogProps) {
  const { t, formatDateTime } = useI18n()
  const records = useAppStore((state) => state.browserAiTaskRecords)
  const loadRecords = useAppStore((state) => state.loadBrowserAiTaskRecords)
  const [draftRecordIds, setDraftRecordIds] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [timeFilter, setTimeFilter] = useState<LearningBrowserAiHistoryTimeFilter>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setDraftRecordIds(selectedRecordIds)
    setQuery('')
    setTimeFilter('all')
    setError(null)
    setLoading(true)
    void loadRecords()
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : t('learning.browserAi.historyLoadFailed'))
      })
      .finally(() => setLoading(false))
  }, [loadRecords, open, selectedRecordIds, t])

  const filteredRecords = useMemo(() => filterBrowserAiHistoryRecords(records, query, timeFilter), [query, records, timeFilter])
  const visibleIds = filteredRecords.map((record) => record.id)
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => draftRecordIds.includes(id))

  const toggleRecord = (recordId: string, checked: boolean) => {
    setDraftRecordIds((current) => (checked ? Array.from(new Set([...current, recordId])) : current.filter((id) => id !== recordId)))
  }

  const toggleAllVisible = () => {
    setDraftRecordIds((current) => (allVisibleSelected ? current.filter((id) => !visibleIds.includes(id)) : Array.from(new Set([...current, ...visibleIds]))))
  }

  if (!open) return null

  return (
    <ModalShell open={open} onClose={onClose} widthClassName="max-w-3xl" baseZIndex={1100} panelClassName="!p-0 flex max-h-[calc(100vh-3rem)] flex-col overflow-hidden" ariaLabel={t('learning.browserAi.historyPickerTitle')}>
      <div className="flex items-start justify-between gap-4 border-b p-5" style={{ borderColor: 'var(--color-border)' }}>
        <div>
          <p className="section-label mb-2">{t('learning.browserAi.historyPickerKicker')}</p>
          <h2 className="text-lg font-semibold text-[color:var(--color-foreground)]">{t('learning.browserAi.historyPickerTitle')}</h2>
          <p className="mt-1 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('learning.browserAi.historyPickerDescription')}</p>
        </div>
        <Button variant="ghost" size="icon" title={t('common.close')} onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="min-h-0 space-y-4 overflow-y-auto p-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--color-muted-foreground)]" />
            <Input className="h-9 pl-9 text-xs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('learning.browserAi.historyPickerSearchPlaceholder')} aria-label={t('learning.browserAi.historyPickerSearchPlaceholder')} />
          </div>
          <Select ariaLabel={t('learning.browserAi.historyPickerTimeFilter')} value={timeFilter} options={timeFilterOptions.map((option) => ({ value: option.value, label: t(option.labelKey as never) }))} onChange={(value) => setTimeFilter(value as LearningBrowserAiHistoryTimeFilter)} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-[color:var(--color-muted-foreground)]">{t('learning.browserAi.selectedHistoryCount', { value: String(draftRecordIds.length) })}</span>
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={toggleAllVisible} disabled={visibleIds.length === 0}>
            <ListChecks className="h-3.5 w-3.5" />
            {allVisibleSelected ? t('learning.browserAi.clearHistoryResults') : t('learning.browserAi.selectHistoryResults')}
          </Button>
        </div>

        <div className="max-h-[min(52vh,30rem)] min-h-40 space-y-1 overflow-y-auto rounded-[12px] border p-1.5" style={{ borderColor: 'var(--color-border)' }}>
          {loading ? (
            <p className="px-3 py-10 text-center text-xs text-[color:var(--color-muted-foreground)]">{t('learning.browserAi.historyLoading')}</p>
          ) : filteredRecords.length > 0 ? (
            filteredRecords.map((record) => {
              const checked = draftRecordIds.includes(record.id)
              return (
                <label key={record.id} className={`flex cursor-pointer items-start gap-2 rounded-[10px] px-2.5 py-2.5 text-xs transition-colors ${checked ? 'bg-[color:var(--color-primary)]/10' : 'hover:bg-[color:var(--color-accent)]'}`}>
                  <Checkbox checked={checked} onChange={(event) => toggleRecord(record.id, event.target.checked)} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <span className="min-w-0 truncate font-medium text-[color:var(--color-foreground)]">{record.title}</span>
                      <span className="shrink-0 text-[10px] text-[color:var(--color-muted-foreground)]">{formatDateTime(record.updatedAt)}</span>
                    </span>
                    <span className="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-[11px] text-[color:var(--color-muted-foreground)]">
                      <span>{record.siteName}</span>
                      <span>{t(statusLabelKey(record.status) as never)}</span>
                    </span>
                    {record.taskExcerpt ? <span className="mt-1 block truncate text-[11px] text-[color:var(--color-foreground)]">{record.taskExcerpt}</span> : null}
                    {record.answerExcerpt ? <span className="mt-0.5 block truncate text-[11px] text-[color:var(--color-muted-foreground)]">{record.answerExcerpt}</span> : null}
                    {record.sourceLabels.length > 0 ? <span className="mt-1 block truncate text-[10px] text-[color:var(--color-muted-foreground)]">{record.sourceLabels.join(' · ')}</span> : null}
                  </span>
                </label>
              )
            })
          ) : (
            <p className="px-3 py-10 text-center text-xs text-[color:var(--color-muted-foreground)]">{records.length === 0 ? t('learning.browserAi.historyNoRecords') : t('learning.browserAi.historyNoMatchingRecords')}</p>
          )}
        </div>
        {error ? <p className="text-sm text-[color:var(--color-destructive)]">{error}</p> : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t p-4" style={{ borderColor: 'var(--color-border)' }}>
        <span className="min-w-0 text-xs text-[color:var(--color-muted-foreground)]">{t('learning.browserAi.historyPickerSelected', { value: String(draftRecordIds.length) })}</span>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => onApply(draftRecordIds)}>{t('learning.browserAi.historyPickerApply')}</Button>
        </div>
      </div>
    </ModalShell>
  )
}
