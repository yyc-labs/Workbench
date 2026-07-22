import { FolderPlus, Pencil, Search, Settings2, Trash2, X } from 'lucide-react'
import type { LearningCategory, LearningNoteSummary, LearningSearchResult } from '../../../../shared/types'
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
  categoryManagerOpen: boolean
  filteredNotes: Array<LearningNoteSummary | LearningSearchResult>
  isCreatingCategory: boolean
  isDeletingCategory: boolean
  isUpdatingCategory: boolean
  loading: boolean
  searching: boolean
  searchError: string | null
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
  onSelectNote: (noteId: string, matchOffset?: number) => void
  onToggleCategoryManager: () => void
}

export function LearningNotesSidebar({
  categories,
  categoryCreateError,
  categoryEditError,
  categoryEditInput,
  categoryInput,
  categoryManagerOpen,
  filteredNotes,
  isCreatingCategory,
  isDeletingCategory,
  isUpdatingCategory,
  loading,
  searching,
  searchError,
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
  onToggleCategoryManager,
}: LearningNotesSidebarProps) {
  const { t, formatDateTime } = useI18n()

  return (
    <div className="learning-notes-sidebar relative flex h-full min-h-0">
      <Card className="surface-card flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[18px] border-[color:var(--color-border)]/80 bg-[color:var(--color-card)]/92 shadow-none">
        <div className="border-b border-[color:var(--color-border)] px-3 py-3 sm:px-4">
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
        <div className="border-b border-[color:var(--color-border)] px-3 py-3 sm:px-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-xs font-medium text-[color:var(--color-muted-foreground)]">{t('learning.notes.categoriesTitle')}</div>
            <Button type="button" variant={categoryManagerOpen ? 'secondary' : 'ghost'} size="icon" className="h-8 w-8" onClick={onToggleCategoryManager} aria-label={t('learning.notes.manageCategory')} title={t('learning.notes.manageCategory')}>
              <Settings2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-pressed={selectedCategoryId === 'all'}
              className={`rounded-full px-2.5 py-1 text-xs transition-colors ${selectedCategoryId === 'all' ? 'bg-[color:var(--color-primary)] text-primary-foreground' : 'bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]'}`}
              onClick={() => onSelectCategory('all')}
            >
              {t('learning.notes.all')}
            </button>
            <button
              type="button"
              aria-pressed={selectedCategoryId === 'inbox'}
              className={`rounded-full px-2.5 py-1 text-xs transition-colors ${selectedCategoryId === 'inbox' ? 'bg-[color:var(--color-primary)] text-primary-foreground' : 'bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]'}`}
              onClick={() => onSelectCategory('inbox')}
            >
              {t('learning.notes.inbox')}
            </button>
            <button
              type="button"
              aria-pressed={selectedCategoryId === 'drafts'}
              className={`rounded-full px-2.5 py-1 text-xs transition-colors ${selectedCategoryId === 'drafts' ? 'bg-[color:var(--color-primary)] text-primary-foreground' : 'bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]'}`}
              onClick={() => onSelectCategory('drafts')}
            >
              {t('learning.notes.drafts')}
            </button>
            <button
              type="button"
              aria-pressed={selectedCategoryId === 'review'}
              className={`rounded-full px-2.5 py-1 text-xs transition-colors ${selectedCategoryId === 'review' ? 'bg-[color:var(--color-primary)] text-primary-foreground' : 'bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]'}`}
              onClick={() => onSelectCategory('review')}
            >
              {t('learning.notes.review')}
            </button>
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                aria-pressed={selectedCategoryId === category.id}
                className={`rounded-full px-2.5 py-1 text-xs transition-colors ${selectedCategoryId === category.id ? 'bg-[color:var(--color-primary)] text-primary-foreground' : 'bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]'}`}
                onClick={() => onSelectCategory(category.id)}
              >
                {category.name}
              </button>
            ))}
          </div>
          {categoryManagerOpen ? (
            <div className="mt-3 space-y-3 rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-accent)]/35 p-3">
              {selectedManageCategory ? (
                <div className="space-y-2">
                  <div className="text-[11px] text-[color:var(--color-muted-foreground)]">{t('learning.notes.manageCategory')}</div>
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
                    <Button type="button" size="icon" variant="outline" className="h-9 w-9 shrink-0" onClick={() => void onRenameCategory()} loading={isUpdatingCategory} disabled={isDeletingCategory} title={t('learning.notes.renameCategory')}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button type="button" size="icon" variant="destructive" className="h-9 w-9 shrink-0" onClick={() => void onDeleteCategory()} loading={isDeletingCategory} disabled={isUpdatingCategory} title={t('learning.notes.deleteCategory')}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {categoryEditError ? <div className="text-xs text-[color:var(--color-destructive)]">{categoryEditError}</div> : null}
                </div>
              ) : null}
              <div className="flex gap-2">
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
                <Button type="button" size="icon" variant="outline" className="h-9 w-9 shrink-0" onClick={() => void onCreateCategory()} loading={isCreatingCategory} title={t('learning.notes.addCategory')}>
                  <FolderPlus className="h-4 w-4" />
                </Button>
              </div>
              {categoryCreateError ? <div className="text-xs text-[color:var(--color-destructive)]">{categoryCreateError}</div> : null}
            </div>
          ) : null}
        </div>
        <div className="px-4 pb-2 pt-3">
          <div className="text-xs font-medium text-[color:var(--color-muted-foreground)]">{t('learning.notes.notesTitle')}</div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-2 p-3">
            {loading || searching ? (
              <div className="px-3 py-4 text-xs text-[color:var(--color-muted-foreground)]">{t('common.loading')}</div>
            ) : filteredNotes.length > 0 ? (
              filteredNotes.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  className={`flex w-full flex-col gap-1 rounded-[14px] border px-3 py-3 text-left transition-colors ${
                    selectedNoteId === note.id ? 'border-[color:var(--color-primary)]/50 bg-[color:var(--color-primary)]/8' : 'border-transparent bg-[color:var(--color-accent)]/55 hover:border-[color:var(--color-border)]'
                  }`}
                  onClick={() => onSelectNote(note.id, 'matchOffset' in note ? note.matchOffset : undefined)}
                >
                  <div className="line-clamp-1 text-sm font-medium text-[color:var(--color-foreground)]">{note.title}</div>
                  <div className="line-clamp-2 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{'matchExcerpt' in note ? note.matchExcerpt : note.excerpt || t('learning.notes.emptyExcerpt')}</div>
                  <div className="flex items-center justify-between gap-2 text-[11px] text-[color:var(--color-muted-foreground)]">
                    <span>{formatDateTime(note.updatedAt)}</span>
                    <span>{note.status === 'organized' ? t('learning.notes.statusOrganized') : t('learning.notes.statusDraft')}</span>
                  </div>
                </button>
              ))
            ) : searchError ? (
              <div className="px-3 py-4 text-xs text-[color:var(--color-destructive)]">{searchError}</div>
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
