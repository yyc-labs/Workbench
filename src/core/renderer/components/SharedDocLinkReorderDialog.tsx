import { closestCenter, DndContext, type DragCancelEvent, type DragEndEvent, DragOverlay, type DragStartEvent, MeasuringStrategy, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { memo, useMemo, useState } from 'react'
import type { SharedDocLink } from '../../shared/types'
import { useI18n } from '../i18n'
import { isSshProjectDocLink, projectDocLinkTarget } from '../lib/projectDocLinks'
import { useAppStore } from '../stores/appStore'
import { ModalShell } from './ModalShell'

type SharedDocLinkReorderDialogProps = {
  open: boolean
  groupId: string
  groupName: string
  onClose: () => void
}

/**
 * 排序行：memo 化——DndContext 拖拽期间高频重渲染，未拖动的行必须跳过，否则长列表明显卡顿。
 */
const ReorderRow = memo(function ReorderRow({ link, isDragging, dragDisabled }: { link: SharedDocLink; isDragging: boolean; dragDisabled: boolean }) {
  const { t } = useI18n()
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging: sortableIsDragging } = useSortable({ id: link.id, disabled: dragDisabled })
  // 被拖行原位留坑：浮层唯一跟随鼠标，transform 不越界（与项目资料夹/共享库主弹窗一致）。
  const style = {
    transform: sortableIsDragging ? undefined : CSS.Translate.toString(transform),
    transition,
  }

  return (
    <div ref={setNodeRef} style={style} className={`flex items-center gap-1.5 rounded-[12px] border border-[color:var(--color-border)] px-2.5 py-2 ${isDragging || sortableIsDragging ? 'opacity-45 will-change-transform' : ''}`}>
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="inline-flex h-7 w-7 touch-none shrink-0 cursor-grab items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] active:cursor-grabbing"
        title={t('documentation.dragToReorder')}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-[color:var(--color-foreground)]">{link.title}</p>
        <p className="truncate text-[11px] text-[color:var(--color-muted-foreground)]">
          {isSshProjectDocLink(link) ? t('documentation.kindSsh') : t('documentation.kindUrl')} · {projectDocLinkTarget(link)}
        </p>
      </div>
    </div>
  )
})

/** 组内链接排序弹窗：设置页内嵌管理器不做行内拖拽，排序统一收口到这里（portal 到 body，不受页面滚动影响）。 */
export function SharedDocLinkReorderDialog({ open, groupId, groupName, onClose }: SharedDocLinkReorderDialogProps) {
  const { t } = useI18n()
  const [draggingLinkId, setDraggingLinkId] = useState<string | null>(null)
  const links = useAppStore((s) => s.sharedDocLinks)
  const reorderSharedDocLinks = useAppStore((s) => s.reorderSharedDocLinks)

  const groupLinks = useMemo(() => links.filter((link) => link.groupId === groupId), [groupId, links])
  const draggingLink = draggingLinkId ? (groupLinks.find((link) => link.id === draggingLinkId) ?? null) : null

  const dragSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  )

  const handleDragStart = ({ active }: DragStartEvent) => {
    setDraggingLinkId(String(active.id))
  }

  const handleDragCancel = (_event: DragCancelEvent) => {
    setDraggingLinkId(null)
  }

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setDraggingLinkId(null)
    if (!over || active.id === over.id) return
    const ids = groupLinks.map((link) => link.id)
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
    void reorderSharedDocLinks(groupId, arrayMove(ids, oldIndex, newIndex))
  }

  return (
    <ModalShell open={open} onClose={onClose} baseZIndex={1300} widthClassName="max-w-[520px]" ariaLabel={t('documentation.reorderLinks')}>
      <div className="mb-4">
        <p className="section-label mb-1 text-base">{t('documentation.reorderLinks')}</p>
        <p className="text-xs text-[color:var(--color-muted-foreground)]">
          {groupName} · {t('documentation.dragToReorder')}
        </p>
      </div>
      <DndContext sensors={dragSensors} collisionDetection={closestCenter} measuring={{ droppable: { strategy: MeasuringStrategy.BeforeDragging } }} onDragStart={handleDragStart} onDragCancel={handleDragCancel} onDragEnd={handleDragEnd}>
        <SortableContext items={groupLinks.map((link) => link.id)} strategy={verticalListSortingStrategy}>
          <div className="max-h-[52vh] space-y-1.5 overflow-y-auto pr-1">
            {groupLinks.map((link) => (
              <ReorderRow key={link.id} link={link} isDragging={draggingLinkId === link.id} dragDisabled={false} />
            ))}
            {groupLinks.length === 0 && <p className="px-1 py-2 text-[11px] text-[color:var(--color-muted-foreground)]">{t('documentation.noLinksInGroup')}</p>}
          </div>
        </SortableContext>
        <DragOverlay>
          {draggingLink ? (
            <div className="quiet-control w-full rounded-[12px] border border-[color:var(--color-border)] px-3 py-2 shadow-lg">
              <p className="truncate text-xs text-[color:var(--color-foreground)]">{draggingLink.title}</p>
              <p className="truncate text-[11px] text-[color:var(--color-muted-foreground)]">{projectDocLinkTarget(draggingLink)}</p>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <div className="mt-4 flex items-center justify-end">
        <button type="button" className="inline-flex h-9 items-center rounded-full border border-[color:var(--color-border)] px-4 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </ModalShell>
  )
}
