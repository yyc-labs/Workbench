import { CheckCircle2, FolderPlus, Link2, NotebookPen, Pencil, Tags, Trash2 } from 'lucide-react'
import type { LearningCategory, LearningNote, LearningNoteStatus, LearningNoteSummary } from '../../../../shared/types'
import { Button } from '../../../components/ui/button'
import { Card } from '../../../components/ui/card'
import { useI18n } from '../../../i18n'
import { LearningSidebarRailButton } from './LearningSidebarRailButton'
import type { SaveState } from './learningCenterTypes'
import { normalizeTagInput } from './learningCenterUtils'

type LearningNoteInfoSidebarProps = {
  categories: LearningCategory[]
  editorCategoryId: string
  editorStatus: LearningNoteStatus
  editorTags: string
  editorTitle: string
  hasUnsavedChanges: boolean
  saveError: string | null
  saveState: SaveState
  selectedNote: LearningNote | null
  selectedNoteId: string | null
  linkedNotes: LearningNoteSummary[]
  backlinks: LearningNoteSummary[]
  onCollapse: () => void
  onOpenDeleteConfirm: () => void
  onOpenEditDialog: () => void
  onSelectLinkedNote: (noteId: string) => void
  onMarkReviewed: () => void
}

export function LearningNoteInfoSidebar({
  categories,
  editorCategoryId,
  editorStatus,
  editorTags,
  editorTitle,
  hasUnsavedChanges,
  saveError,
  saveState,
  selectedNote,
  selectedNoteId,
  linkedNotes,
  backlinks,
  onCollapse,
  onOpenDeleteConfirm,
  onOpenEditDialog,
  onSelectLinkedNote,
  onMarkReviewed,
}: LearningNoteInfoSidebarProps) {
  const { t, formatDateTime } = useI18n()
  const selectedCategoryName = categories.find((item) => item.id === editorCategoryId)?.name ?? t('common.uncategorized')
  const tags = normalizeTagInput(editorTags)

  return (
    <div className="learning-note-info-sidebar relative flex h-full min-h-0">
      <Card className="h-full min-h-0 w-full overflow-hidden border-[color:var(--color-border)]/80 bg-[color:var(--color-card)]/92">
        <div className="border-b border-[color:var(--color-border)] px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('learning.info.title')}</div>
              <div className="text-xs text-[color:var(--color-muted-foreground)]">{t('learning.info.subtitle')}</div>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={onOpenEditDialog} disabled={!selectedNote}>
              <Pencil className="h-3.5 w-3.5" />
              {t('learning.info.editInfo')}
            </Button>
          </div>
        </div>
        <div className="space-y-5 p-5">
          <section className="space-y-2">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-[color:var(--color-muted-foreground)]">
              <NotebookPen className="h-3.5 w-3.5" />
              {t('learning.info.sectionTitle')}
            </div>
            <div className="text-sm font-medium text-[color:var(--color-foreground)]">{editorTitle || selectedNote?.title || t('learning.editor.untitledNote')}</div>
          </section>

          <Button variant="outline" className="w-full gap-1.5" onClick={onMarkReviewed} disabled={!selectedNote}>
            <CheckCircle2 className="h-4 w-4" />
            {t('learning.info.markReviewed')}
          </Button>

          <section className="space-y-2">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-[color:var(--color-muted-foreground)]">
              <Link2 className="h-3.5 w-3.5" />
              {t('learning.info.links')}
            </div>
            <div className="space-y-2">
              <div className="text-xs text-[color:var(--color-muted-foreground)]">{t('learning.info.outgoingLinks')}</div>
              {linkedNotes.length ? (
                linkedNotes.map((note) => (
                  <button key={note.id} type="button" className="block text-left text-sm text-[color:var(--color-primary)] hover:underline" onClick={() => onSelectLinkedNote(note.id)}>
                    {note.title}
                  </button>
                ))
              ) : (
                <div className="text-sm text-[color:var(--color-muted-foreground)]">{t('learning.info.noLinks')}</div>
              )}
              <div className="pt-1 text-xs text-[color:var(--color-muted-foreground)]">{t('learning.info.backlinks')}</div>
              {backlinks.length ? (
                backlinks.map((note) => (
                  <button key={note.id} type="button" className="block text-left text-sm text-[color:var(--color-primary)] hover:underline" onClick={() => onSelectLinkedNote(note.id)}>
                    {note.title}
                  </button>
                ))
              ) : (
                <div className="text-sm text-[color:var(--color-muted-foreground)]">{t('learning.info.noBacklinks')}</div>
              )}
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-[color:var(--color-muted-foreground)]">
              <FolderPlus className="h-3.5 w-3.5" />
              {t('learning.info.category')}
            </div>
            <div className="text-sm text-[color:var(--color-foreground)]">{selectedCategoryName}</div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-[color:var(--color-muted-foreground)]">
              <Tags className="h-3.5 w-3.5" />
              {t('learning.info.tags')}
            </div>
            <div className="flex flex-wrap gap-2">
              {tags.length > 0 ? (
                tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-[color:var(--color-accent)] px-2.5 py-1 text-xs text-[color:var(--color-foreground)]">
                    {tag}
                  </span>
                ))
              ) : (
                <span className="text-sm text-[color:var(--color-muted-foreground)]">{t('learning.info.noTags')}</span>
              )}
            </div>
          </section>

          <section className="space-y-2">
            <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--color-muted-foreground)]">{t('learning.info.status')}</div>
            <div className="text-sm text-[color:var(--color-foreground)]">{editorStatus === 'organized' ? t('learning.info.statusOrganized') : t('learning.info.statusDraft')}</div>
          </section>

          <section className="space-y-2">
            <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--color-muted-foreground)]">{t('learning.info.dates')}</div>
            <div className="space-y-1 text-sm text-[color:var(--color-foreground)]">
              <div>{t('learning.info.createdAt', { value: selectedNote ? formatDateTime(selectedNote.createdAt) : '--' })}</div>
              <div>{t('learning.info.updatedAt', { value: selectedNote ? formatDateTime(selectedNote.updatedAt) : '--' })}</div>
            </div>
          </section>

          <section className="space-y-2">
            <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--color-muted-foreground)]">{t('learning.info.saveState')}</div>
            <div className={`text-sm ${saveState === 'error' ? 'text-[color:var(--color-destructive)]' : saveState === 'saved' ? 'text-[color:var(--color-success)]' : 'text-[color:var(--color-muted-foreground)]'}`}>
              {saveState === 'error' ? saveError || t('learning.info.saveFailed') : saveState === 'saved' ? t('learning.info.saved') : hasUnsavedChanges ? t('learning.info.unsavedChanges') : t('learning.info.unchanged')}
            </div>
          </section>

          <Button variant="destructive" className="mt-4 w-full gap-1.5" onClick={onOpenDeleteConfirm} loading={false} disabled={!selectedNoteId}>
            <Trash2 className="h-4 w-4" />
            {t('learning.info.deleteNote')}
          </Button>
        </div>
      </Card>
      <LearningSidebarRailButton side="right" collapsed={false} onClick={onCollapse} className="absolute -left-4 top-1/2 z-20 -translate-y-1/2" />
    </div>
  )
}
