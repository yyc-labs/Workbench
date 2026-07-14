import { FolderPlus, Pencil, Search, Trash2, X } from 'lucide-react'
import type { LearningCategory, LearningNoteSummary } from '../../../../shared/types'
import { Button } from '../../../components/ui/button'
import { Card } from '../../../components/ui/card'
import { Input } from '../../../components/ui/input'
import { ScrollArea } from '../../../components/ui/scroll-area'
import { useI18n } from '../../../i18n'
import { LearningSidebarRailButton } from './LearningSidebarRailButton'

type LearningNotesSidebarProps = {
  categories: LearningCategory[]
  categoryCreateError: string | null
  categoryEditError: string | null
  categoryEditInput: string
  categoryInput: string
  filteredNotes: LearningNoteSummary[]
  isCreatingCategory: boolean
  isDeletingCategory: boolean
  isUpdatingCategory: boolean
  loading: boolean
  searchQuery: string
  selectedCategoryId: string
  selectedManageCategory: LearningCategory | null
  selectedNoteId: string | null
  onCategoryEditInputChange: (value: string) => void
  onCategoryInputChange: (value: string) => void
  onClearSearch: () => void
  onCollapse: () => void
  onCreateCategory: () => void | Promise<void>
  onDeleteCategory: () => void | Promise<void>
  onRenameCategory: () => void | Promise<void>
  onSearchQueryChange: (value: string) => void
  onSelectCategory: (categoryId: string) => void
  onSelectNote: (noteId: string) => void
}

export function LearningNotesSidebar({
  categories,
  categoryCreateError,
  categoryEditError,
  categoryEditInput,
  categoryInput,
  filteredNotes,
  isCreatingCategory,
  isDeletingCategory,
  isUpdatingCategory,
  loading,
  searchQuery,
  selectedCategoryId,
  selectedManageCategory,
  selectedNoteId,
  onCategoryEditInputChange,
  onCategoryInputChange,
  onClearSearch,
  onCollapse,
  onCreateCategory,
  onDeleteCategory,
  onRenameCategory,
  onSearchQueryChange,
  onSelectCategory,
  onSelectNote,
}: LearningNotesSidebarProps) {
  const { t, formatDateTime } = useI18n()

  return (
    <div className="relative flex h-full min-h-0">
      <Card className="flex h-full min-h-0 w-full flex-col overflow-hidden border-[color:var(--color-border)]/80 bg-[color:var(--color-card)]/92">
        <div className="border-b border-[color:var(--color-border)] px-4 py-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--color-muted-foreground)]" />
            <Input value={searchQuery} onChange={(event) => onSearchQueryChange(event.target.value)} placeholder={t('learning.notes.searchPlaceholder')} className="h-10 rounded-full pl-11 pr-10" />
            <button
              type="button"
              className={`absolute right-3 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-opacity ${
                searchQuery ? 'hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]' : 'pointer-events-none opacity-0'
              }`}
              onClick={onClearSearch}
              aria-label={t('common.clearSearch')}
              title={t('common.clearSearch')}
              tabIndex={searchQuery ? 0 : -1}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="border-b border-[color:var(--color-border)] px-4 py-4">
          <div className="mb-3 text-xs font-medium text-[color:var(--color-muted-foreground)]">{t('learning.notes.categoriesTitle')}</div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`rounded-full px-3 py-1.5 text-xs transition-colors ${selectedCategoryId === 'all' ? 'bg-[color:var(--color-primary)] text-white' : 'bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]'}`} onClick={() => onSelectCategory('all')}>
              {t('learning.notes.all')}
            </button>
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                className={`rounded-full px-3 py-1.5 text-xs transition-colors ${selectedCategoryId === category.id ? 'bg-[color:var(--color-primary)] text-white' : 'bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]'}`}
                onClick={() => onSelectCategory(category.id)}
              >
                {category.name}
              </button>
            ))}
          </div>
          {selectedManageCategory ? (
            <div className="mt-3 rounded-[18px] border border-[color:var(--color-border)] bg-[color:var(--color-accent)]/40 p-3">
              <div className="mb-2 text-xs text-[color:var(--color-muted-foreground)]">{t('learning.notes.manageCategory')}</div>
              <div className="flex gap-2">
                <Input
                  value={categoryEditInput}
                  onChange={(event) => onCategoryEditInputChange(event.target.value)}
                  placeholder={t('learning.notes.categoryNamePlaceholder')}
                  className="h-9"
                  disabled={isUpdatingCategory || isDeletingCategory}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void onRenameCategory()
                    }
                  }}
                />
                <Button type="button" size="icon" variant="outline" className="h-9 w-9 rounded-full" onClick={() => void onRenameCategory()} loading={isUpdatingCategory} disabled={isDeletingCategory} title={t('learning.notes.renameCategory')}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button type="button" size="icon" variant="destructive" className="h-9 w-9 rounded-full" onClick={() => void onDeleteCategory()} loading={isDeletingCategory} disabled={isUpdatingCategory} title={t('learning.notes.deleteCategory')}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              {categoryEditError ? <div className="mt-2 text-xs text-[color:var(--color-destructive)]">{categoryEditError}</div> : null}
            </div>
          ) : null}
          <div className="mt-3 flex gap-2">
            <Input
              value={categoryInput}
              onChange={(event) => onCategoryInputChange(event.target.value)}
              placeholder={t('learning.notes.newCategoryPlaceholder')}
              className="h-9"
              disabled={isCreatingCategory}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void onCreateCategory()
                }
              }}
            />
            <Button type="button" size="icon" variant="outline" className="h-9 w-9 rounded-full" onClick={() => void onCreateCategory()} loading={isCreatingCategory} title={t('learning.notes.addCategory')}>
              <FolderPlus className="h-4 w-4" />
            </Button>
          </div>
          {categoryCreateError ? <div className="mt-2 text-xs text-[color:var(--color-destructive)]">{categoryCreateError}</div> : null}
        </div>
        <div className="px-4 pb-2 pt-4">
          <div className="text-xs font-medium text-[color:var(--color-muted-foreground)]">{t('learning.notes.notesTitle')}</div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-2 p-3">
            {loading ? (
              <div className="px-3 py-4 text-xs text-[color:var(--color-muted-foreground)]">{t('common.loading')}</div>
            ) : filteredNotes.length > 0 ? (
              filteredNotes.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  className={`flex w-full flex-col gap-1 rounded-[18px] border px-3 py-3 text-left transition-colors ${
                    selectedNoteId === note.id ? 'border-[color:var(--color-primary)]/50 bg-[color:var(--color-primary)]/8' : 'border-transparent bg-[color:var(--color-accent)]/55 hover:border-[color:var(--color-border)]'
                  }`}
                  onClick={() => onSelectNote(note.id)}
                >
                  <div className="line-clamp-1 text-sm font-medium text-[color:var(--color-foreground)]">{note.title}</div>
                  <div className="line-clamp-2 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{note.excerpt || t('learning.notes.emptyExcerpt')}</div>
                  <div className="flex items-center justify-between gap-2 text-[11px] text-[color:var(--color-muted-foreground)]">
                    <span>{formatDateTime(note.updatedAt)}</span>
                    <span>{note.status === 'organized' ? t('learning.notes.statusOrganized') : t('learning.notes.statusDraft')}</span>
                  </div>
                </button>
              ))
            ) : (
              <div className="px-3 py-4 text-xs text-[color:var(--color-muted-foreground)]">{t('learning.notes.emptyNotes')}</div>
            )}
          </div>
        </ScrollArea>
      </Card>
      <LearningSidebarRailButton side="left" collapsed={false} onClick={onCollapse} className="absolute -right-4 top-1/2 z-20 -translate-y-1/2" />
    </div>
  )
}
