import { Check, ListChecks, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { LearningCategory, LearningNoteSummary } from '../../../shared/types'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import { Input } from '../../components/ui/input'
import { Select } from '../../components/ui/select'
import { useI18n } from '../../i18n'

type LearningBrowserAiSourceSelectorProps = {
  notes: LearningNoteSummary[]
  categories: LearningCategory[]
  selectedNoteIds: string[]
  onSelectedNoteIdsChange: (ids: string[]) => void
}

export function LearningBrowserAiSourceSelector({
  notes,
  categories,
  selectedNoteIds,
  onSelectedNoteIdsChange,
}: LearningBrowserAiSourceSelectorProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState('all')
  const categoryNames = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  )
  const filteredNotes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return notes.filter((note) => {
      if (categoryId !== 'all' && note.categoryId !== categoryId) return false
      if (!normalizedQuery) return true
      return [note.title, note.excerpt, note.tags.join(' ')].join(' ').toLowerCase().includes(normalizedQuery)
    })
  }, [categoryId, notes, query])
  const visibleIds = filteredNotes.map((note) => note.id)
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedNoteIds.includes(id))
  const selectedNotes = notes.filter((note) => selectedNoteIds.includes(note.id))

  const toggleNote = (noteId: string, checked: boolean) => {
    onSelectedNoteIdsChange(checked
      ? Array.from(new Set([...selectedNoteIds, noteId]))
      : selectedNoteIds.filter((id) => id !== noteId))
  }

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      onSelectedNoteIdsChange(selectedNoteIds.filter((id) => !visibleIds.includes(id)))
      return
    }
    onSelectedNoteIdsChange(Array.from(new Set([...selectedNoteIds, ...visibleIds])))
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--color-muted-foreground)]" />
          <Input
            className="h-9 pl-9 text-xs"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('learning.browserAi.noteSearchPlaceholder')}
            aria-label={t('learning.browserAi.noteSearchPlaceholder')}
          />
        </div>
        <Select
          ariaLabel={t('learning.browserAi.noteCategoryFilter')}
          className="min-w-[150px] flex-1 sm:flex-none"
          value={categoryId}
          options={[
            { value: 'all', label: t('learning.browserAi.allCategories') },
            ...categories.map((category) => ({ value: category.id, label: category.name })),
          ]}
          onChange={setCategoryId}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-[color:var(--color-muted-foreground)]">
          {t('learning.browserAi.selectedNotesCount', { value: String(selectedNoteIds.length) })}
        </span>
        <div className="flex flex-wrap gap-1.5">
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={toggleAllVisible} disabled={visibleIds.length === 0}>
            <ListChecks className="h-3.5 w-3.5" />
            {allVisibleSelected ? t('learning.browserAi.clearCurrentResults') : t('learning.browserAi.selectCurrentResults')}
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={() => onSelectedNoteIdsChange([])} disabled={selectedNoteIds.length === 0}>
            <X className="h-3.5 w-3.5" />
            {t('learning.browserAi.clearSelectedNotes')}
          </Button>
        </div>
      </div>
      {selectedNotes.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selectedNotes.map((note) => (
            <span key={note.id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-[color:var(--color-primary)]/10 px-2.5 py-1 text-[11px] text-[color:var(--color-foreground)]">
              <Check className="h-3 w-3 shrink-0 text-[color:var(--color-primary)]" />
              <span className="truncate">{note.title}</span>
              <span className="shrink-0 text-[color:var(--color-muted-foreground)]">{t('learning.browserAi.learningNoteTag')}</span>
            </span>
          ))}
        </div>
      ) : null}
      <div className="max-h-52 space-y-1 overflow-y-auto rounded-[12px] border p-1.5" style={{ borderColor: 'var(--color-border)' }}>
        {filteredNotes.length > 0 ? filteredNotes.map((note) => {
          const checked = selectedNoteIds.includes(note.id)
          return (
            <label key={note.id} className="flex cursor-pointer items-start gap-2 rounded-[10px] px-2.5 py-2 text-xs transition-colors hover:bg-[color:var(--color-accent)]">
              <Checkbox checked={checked} onChange={(event) => toggleNote(note.id, event.target.checked)} className="mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[color:var(--color-foreground)]">{note.title}</span>
                  {note.categoryId && categoryNames.get(note.categoryId) ? <span className="shrink-0 text-[10px] text-[color:var(--color-muted-foreground)]">{categoryNames.get(note.categoryId)}</span> : null}
                </span>
                <span className="mt-0.5 block truncate text-[color:var(--color-muted-foreground)]">{note.excerpt || t('learning.browserAi.emptyExcerpt')}</span>
              </span>
            </label>
          )
        }) : <p className="px-2.5 py-5 text-center text-xs text-[color:var(--color-muted-foreground)]">{t('learning.browserAi.noMatchingNotes')}</p>}
      </div>
    </div>
  )
}
