import { FolderPlus, NotebookPen, Pencil, Tags, Trash2 } from 'lucide-react'
import type { LearningCategory, LearningNote, LearningNoteStatus } from '../../../shared/types'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { useI18n } from '../../i18n'
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
  onCollapse: () => void
  onOpenDeleteConfirm: () => void
  onOpenEditDialog: () => void
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
  onCollapse,
  onOpenDeleteConfirm,
  onOpenEditDialog,
}: LearningNoteInfoSidebarProps) {
  const { t, formatDateTime } = useI18n()
  const selectedCategoryName = categories.find((item) => item.id === editorCategoryId)?.name ?? t('common.uncategorized')
  const tags = normalizeTagInput(editorTags)

  return (
    <div className="relative flex h-full min-h-0">
      <Card className="h-full min-h-0 w-full overflow-hidden border-[color:var(--color-border)]/80 bg-[color:var(--color-card)]/92">
        <div className="border-b border-[color:var(--color-border)] px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-[color:var(--color-foreground)]">笔记信息</div>
              <div className="text-xs text-[color:var(--color-muted-foreground)]">frontmatter、状态和保存状态</div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={onOpenEditDialog}
              disabled={!selectedNote}
            >
              <Pencil className="h-3.5 w-3.5" />
              编辑信息
            </Button>
          </div>
        </div>
        <div className="space-y-5 p-5">
          <section className="space-y-2">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-[color:var(--color-muted-foreground)]">
              <NotebookPen className="h-3.5 w-3.5" />
              标题
            </div>
            <div className="text-sm font-medium text-[color:var(--color-foreground)]">
              {editorTitle || selectedNote?.title || '未命名笔记'}
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-[color:var(--color-muted-foreground)]">
              <FolderPlus className="h-3.5 w-3.5" />
              分类
            </div>
            <div className="text-sm text-[color:var(--color-foreground)]">{selectedCategoryName}</div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-[color:var(--color-muted-foreground)]">
              <Tags className="h-3.5 w-3.5" />
              标签
            </div>
            <div className="flex flex-wrap gap-2">
              {tags.length > 0 ? tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-[color:var(--color-accent)] px-2.5 py-1 text-xs text-[color:var(--color-foreground)]"
                >
                  {tag}
                </span>
              )) : (
                <span className="text-sm text-[color:var(--color-muted-foreground)]">暂无标签</span>
              )}
            </div>
          </section>

          <section className="space-y-2">
            <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--color-muted-foreground)]">状态</div>
            <div className="text-sm text-[color:var(--color-foreground)]">{editorStatus === 'organized' ? '已整理' : '草稿'}</div>
          </section>

          <section className="space-y-2">
            <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--color-muted-foreground)]">时间</div>
            <div className="space-y-1 text-sm text-[color:var(--color-foreground)]">
              <div>创建：{selectedNote ? formatDateTime(selectedNote.createdAt) : '--'}</div>
              <div>更新：{selectedNote ? formatDateTime(selectedNote.updatedAt) : '--'}</div>
            </div>
          </section>

          <section className="space-y-2">
            <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--color-muted-foreground)]">保存状态</div>
            <div className={`text-sm ${
              saveState === 'error'
                ? 'text-[color:var(--color-destructive)]'
                : saveState === 'saved'
                  ? 'text-[color:var(--color-success)]'
                  : 'text-[color:var(--color-muted-foreground)]'
            }`}>
              {saveState === 'error'
                ? (saveError || '保存失败')
                : saveState === 'saved'
                  ? '已保存'
                  : hasUnsavedChanges
                    ? '有未保存修改'
                    : '未修改'}
            </div>
          </section>

          <Button
            variant="destructive"
            className="mt-4 w-full gap-1.5"
            onClick={onOpenDeleteConfirm}
            loading={false}
            disabled={!selectedNoteId}
          >
            <Trash2 className="h-4 w-4" />
            删除笔记
          </Button>
        </div>
      </Card>
      <LearningSidebarRailButton
        side="right"
        collapsed={false}
        onClick={onCollapse}
        className="absolute -left-4 top-1/2 z-20 -translate-y-1/2"
      />
    </div>
  )
}
