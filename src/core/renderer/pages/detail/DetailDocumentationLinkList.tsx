import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useMemo } from 'react'
import { useI18n } from '../../i18n'
import type { UseDetailDocumentationCardStateResult } from './useDetailDocumentationCardState'
import { DetailDocumentationLinkItem } from './DetailDocumentationLinkItem'

type DetailDocumentationLinkListProps = {
  links: UseDetailDocumentationCardStateResult['links']
  editing: UseDetailDocumentationCardStateResult['editing']
  docTagOptions: UseDetailDocumentationCardStateResult['tags']['options']
}

function DetailDocumentationLinkList({
  links,
  editing,
  docTagOptions,
}: DetailDocumentationLinkListProps) {
  const { t } = useI18n()
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  )
  const sortableItems = useMemo(
    () => links.filteredLinks.map((link) => link.id),
    [links.filteredLinks]
  )
  const draggingLink = useMemo(
    () => (
      links.draggingLinkId
        ? links.filteredLinks.find((link) => link.id === links.draggingLinkId) ?? null
        : null
    ),
    [links.draggingLinkId, links.filteredLinks]
  )

  if (links.filteredLinks.length === 0) {
    return (
      <div className="rounded-[16px] border border-dashed border-[color:var(--color-border)] px-5 py-5 text-xs text-[color:var(--color-muted-foreground)]">
        {links.allCount === 0 ? t('documentation.noDocsYet') : t('documentation.noDocsInCategory')}
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={links.startDrag}
      onDragCancel={links.cancelDrag}
      onDragEnd={links.endDrag}
    >
      <SortableContext
        items={sortableItems}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-2.5">
          {links.filteredLinks.map((link) => {
            const isEditing = editing.linkId === link.id
            const copiedAccount = links.copiedFieldKey === `${link.id}:account`
            const copiedSecret = links.copiedFieldKey === `${link.id}:secret`
            return (
              <DetailDocumentationLinkItem
                key={link.id}
                link={link}
                isDefault={links.defaultLinkId === link.id}
                isEditing={isEditing}
                isExpanded={links.expandedLinkId === link.id}
                isSorting={links.draggingLinkId !== null}
                dragDisabled={links.dragDisabled}
                editing={editing}
                copiedAccount={copiedAccount}
                copiedSecret={copiedSecret}
                secretPreview={
                  Object.prototype.hasOwnProperty.call(links.secretPreviewMap, link.id)
                    ? (links.secretPreviewMap[link.id] ?? null)
                    : null
                }
                secretPreviewLoading={Boolean(links.secretPreviewLoadingMap[link.id])}
                docTagOptions={docTagOptions}
                onCopyAccount={links.copyAccount}
                onCopySecret={links.copySecret}
                onRevealSecret={links.revealSecret}
                onToggleExpand={links.toggleExpand}
                onSetDefaultDocLink={links.setDefault}
                onRemoveDocLink={links.remove}
              />
            )
          })}
        </div>
      </SortableContext>
      <DragOverlay>
        {draggingLink ? (
          <div className="quiet-control w-[min(620px,calc(100vw-96px))] rounded-[16px] px-4 py-3 shadow-lg">
            <p className="truncate text-sm text-[color:var(--color-foreground)]">{draggingLink.title}</p>
            <p className="truncate text-[11px] text-[color:var(--color-muted-foreground)]">
              {draggingLink.url.replace(/^https?:\/\//, '')}
            </p>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

export { DetailDocumentationLinkList }
