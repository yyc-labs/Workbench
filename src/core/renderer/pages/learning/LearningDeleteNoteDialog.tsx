import type { LearningNote } from '../../../shared/types'
import { ModalShell } from '../../components/ModalShell'
import { Button } from '../../components/ui/button'
import { useI18n } from '../../i18n'

type LearningDeleteNoteDialogProps = {
  isDeleting: boolean
  open: boolean
  selectedNote: LearningNote | null
  onClose: () => void
  onDelete: () => void | Promise<void>
}

export function LearningDeleteNoteDialog({
  isDeleting,
  open,
  selectedNote,
  onClose,
  onDelete,
}: LearningDeleteNoteDialogProps) {
  const { t } = useI18n()
  return (
    <ModalShell
      open={open}
      onClose={() => {
        if (isDeleting) return
        onClose()
      }}
      widthClassName="max-w-[420px]"
      ariaLabel={t('learning.delete.modalAria')}
    >
      <div className="space-y-5">
        <div>
          <div className="text-base font-semibold text-[color:var(--color-foreground)]">{t('learning.delete.title')}</div>
          <div className="mt-2 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
            {t('learning.delete.description')}
            <span className="ml-1 font-medium text-[color:var(--color-foreground)]">
              {selectedNote?.title || t('learning.editor.untitledNote')}
            </span>
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            className="rounded-full"
            onClick={onClose}
            disabled={isDeleting}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            className="rounded-full"
            onClick={() => void onDelete()}
            loading={isDeleting}
          >
            {t('common.delete')}
          </Button>
        </div>
      </div>
    </ModalShell>
  )
}
