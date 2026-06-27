import type { LearningNote } from '../../../shared/types'
import { ModalShell } from '../../components/ModalShell'
import { Button } from '../../components/ui/button'

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
  return (
    <ModalShell
      open={open}
      onClose={() => {
        if (isDeleting) return
        onClose()
      }}
      widthClassName="max-w-[420px]"
      ariaLabel="删除学习记录"
    >
      <div className="space-y-5">
        <div>
          <div className="text-base font-semibold text-[color:var(--color-foreground)]">删除这篇学习记录？</div>
          <div className="mt-2 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
            删除后不可恢复。当前笔记：
            <span className="ml-1 font-medium text-[color:var(--color-foreground)]">
              {selectedNote?.title || '未命名笔记'}
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
            取消
          </Button>
          <Button
            variant="destructive"
            className="rounded-full"
            onClick={() => void onDelete()}
            loading={isDeleting}
          >
            删除
          </Button>
        </div>
      </div>
    </ModalShell>
  )
}
