import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from '@dnd-kit/core'
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Check, FolderTree, GripVertical, Hash, Pin, PlayCircle, Tag } from 'lucide-react'
import type { ProjectFolder, ProjectTag } from '../../shared/types'

export type ClassifierFilter =
  | { type: 'all' }
  | { type: 'pinned' }
  | { type: 'running' }
  | { type: 'uncategorized' }
  | { type: 'folder'; folderId: string }
  | { type: 'tag'; tagId: string }

interface WorkspaceClassifierPanelProps {
  folders: ProjectFolder[]
  tags: ProjectTag[]
  activeFilter: ClassifierFilter
  counts: {
    all: number
    pinned: number
    running: number
    uncategorized: number
    byFolder: Record<string, number>
    byTag: Record<string, number>
  }
  onChangeFilter: (filter: ClassifierFilter) => void
  onReorderFolders: (activeFolderId: string, overFolderId: string) => Promise<void> | void
  onReorderTags: (activeTagId: string, overTagId: string) => Promise<void> | void
  startupDefaultFilter?: ClassifierFilter
  onSetStartupDefaultFilter: (filter?: ClassifierFilter) => Promise<void> | void
}

function isActiveFilter(active: ClassifierFilter, target: ClassifierFilter): boolean {
  if (active.type !== target.type) return false
  if (active.type === 'folder' && target.type === 'folder') return active.folderId === target.folderId
  if (active.type === 'tag' && target.type === 'tag') return active.tagId === target.tagId
  return true
}

function NavItem({
  icon,
  label,
  count,
  active,
  onClick,
  colorDot,
  dragAttributes,
  dragListeners,
  isDragging = false,
  onContextMenu,
}: {
  icon: React.ReactNode
  label: string
  count: number
  active: boolean
  onClick: () => void
  colorDot?: string
  dragAttributes?: DraggableAttributes
  dragListeners?: DraggableSyntheticListeners
  isDragging?: boolean
  onContextMenu?: (e: React.MouseEvent<HTMLButtonElement>) => void
}) {
  const isDraggable = Boolean(dragListeners)

  return (
    <button
      type="button"
      className={`flex w-full items-center gap-2 rounded-[12px] px-2.5 py-2 text-left text-sm transition-colors ${
        active
          ? 'bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]'
          : 'text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
      } ${isDraggable ? 'cursor-grab active:cursor-grabbing' : ''} ${isDragging ? 'opacity-75' : ''}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      {...dragAttributes}
      {...dragListeners}
    >
      <span className="shrink-0">{icon}</span>
      {colorDot && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: colorDot }} />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-[11px] text-[color:var(--color-muted-foreground)]">{count}</span>
      {isDraggable && <GripVertical className="h-3.5 w-3.5 shrink-0 opacity-65" />}
    </button>
  )
}

interface SidebarDefaultContextMenuState {
  x: number
  y: number
  label: string
  filter: ClassifierFilter
}

function SidebarDefaultContextMenu({
  x,
  y,
  label,
  isDefault,
  onSetDefault,
  onClearDefault,
  onClose,
}: {
  x: number
  y: number
  label: string
  isDefault: boolean
  onSetDefault: () => void | Promise<void>
  onClearDefault: () => void | Promise<void>
  onClose: () => void
}) {
  const handleClick = useCallback(
    async (action: () => void | Promise<void>) => {
      await action()
      onClose()
    },
    [onClose]
  )

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    const timer = setTimeout(() => {
      const onDocClick = () => onClose()
      document.addEventListener('click', onDocClick)
      return () => document.removeEventListener('click', onDocClick)
    }, 0)
    return () => clearTimeout(timer)
  }, [onClose])

  const width = 248
  const adjustedX = Math.min(Math.max(8, x), window.innerWidth - width - 8)
  const adjustedY = Math.min(Math.max(8, y), window.innerHeight - 160)

  return createPortal(
    <div
      className="fixed z-[9998] min-w-[248px] rounded-[18px] p-2"
      style={{
        top: adjustedY,
        left: adjustedX,
        background: 'var(--color-popover)',
        border: '1px solid var(--color-border)',
        backdropFilter: 'saturate(165%) blur(22px)',
        WebkitBackdropFilter: 'saturate(165%) blur(22px)',
        boxShadow: 'var(--shadow-popover)',
      }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-3 py-2 text-xs text-[color:var(--color-muted-foreground)]">
        侧边栏: <span className="text-[color:var(--color-foreground)]">{label}</span>
      </div>
      <button
        className="group flex w-full items-center gap-2.5 rounded-[14px] px-3 py-2 text-left text-[13px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]/70"
        onClick={() => { void handleClick(onSetDefault) }}
      >
        <Check className={`h-4 w-4 ${isDefault ? 'text-primary' : 'text-[color:var(--color-muted-foreground)]'}`} />
        <span className={isDefault ? 'text-primary font-medium' : ''}>
          设为默认启动标签
        </span>
      </button>
      {isDefault && (
        <button
          className="group mt-1 flex w-full items-center gap-2.5 rounded-[14px] px-3 py-2 text-left text-[13px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]/70"
          onClick={() => { void handleClick(onClearDefault) }}
        >
          <span className="h-4 w-4" />
          <span>取消默认选择</span>
        </button>
      )}
    </div>,
    document.body
  )
}

function SortableFolderNavItem({
  folder,
  count,
  active,
  onClick,
  onContextMenu,
}: {
  folder: ProjectFolder
  count: number
  active: boolean
  onClick: () => void
  onContextMenu?: (e: React.MouseEvent<HTMLButtonElement>) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: folder.id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <NavItem
        icon={<FolderTree className="h-4 w-4" />}
        label={folder.name}
        count={count}
        active={active}
        onClick={onClick}
        onContextMenu={onContextMenu}
        colorDot={folder.color || 'var(--color-primary)'}
        dragAttributes={attributes}
        dragListeners={listeners}
        isDragging={isDragging}
      />
    </div>
  )
}

function SortableTagNavItem({
  tag,
  count,
  active,
  onClick,
  onContextMenu,
}: {
  tag: ProjectTag
  count: number
  active: boolean
  onClick: () => void
  onContextMenu?: (e: React.MouseEvent<HTMLButtonElement>) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tag.id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <NavItem
        icon={<Tag className="h-4 w-4" />}
        label={tag.name}
        count={count}
        active={active}
        onClick={onClick}
        onContextMenu={onContextMenu}
        colorDot={tag.color || 'var(--color-primary)'}
        dragAttributes={attributes}
        dragListeners={listeners}
        isDragging={isDragging}
      />
    </div>
  )
}

export function WorkspaceClassifierPanel({
  folders,
  tags,
  activeFilter,
  counts,
  onChangeFilter,
  onReorderFolders,
  onReorderTags,
  startupDefaultFilter,
  onSetStartupDefaultFilter,
}: WorkspaceClassifierPanelProps) {
  const [defaultContextMenu, setDefaultContextMenu] = useState<SidebarDefaultContextMenuState | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  )

  const handleFolderDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    void onReorderFolders(String(active.id), String(over.id))
  }

  const handleTagDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    void onReorderTags(String(active.id), String(over.id))
  }

  const openDefaultContextMenu = (
    label: string,
    filter: ClassifierFilter,
    e: React.MouseEvent<HTMLButtonElement>
  ) => {
    e.preventDefault()
    e.stopPropagation()
    setDefaultContextMenu({
      x: e.clientX,
      y: e.clientY,
      label,
      filter,
    })
  }

  const isSameDefaultFilter = (target: ClassifierFilter): boolean => {
    if (!startupDefaultFilter || startupDefaultFilter.type !== target.type) return false
    if (target.type === 'folder' && startupDefaultFilter.type === 'folder') {
      return startupDefaultFilter.folderId === target.folderId
    }
    if (target.type === 'tag' && startupDefaultFilter.type === 'tag') {
      return startupDefaultFilter.tagId === target.tagId
    }
    return true
  }

  return (
    <aside className="surface-card w-full rounded-[16px] p-3 md:w-[260px] md:min-w-[260px]">
      <div className="mb-3">
        <p className="section-label mb-1">Workspace</p>
        <h2 className="text-sm font-medium text-[color:var(--color-foreground)]">Project Views</h2>
      </div>

      <div className="space-y-1">
        <NavItem
          icon={<FolderTree className="h-4 w-4" />}
          label="All Projects"
          count={counts.all}
          active={isActiveFilter(activeFilter, { type: 'all' })}
          onClick={() => onChangeFilter({ type: 'all' })}
          onContextMenu={(e) => openDefaultContextMenu('All Projects', { type: 'all' }, e)}
        />
        <NavItem
          icon={<Pin className="h-4 w-4" />}
          label="Pinned"
          count={counts.pinned}
          active={isActiveFilter(activeFilter, { type: 'pinned' })}
          onClick={() => onChangeFilter({ type: 'pinned' })}
          onContextMenu={(e) => openDefaultContextMenu('Pinned', { type: 'pinned' }, e)}
        />
        <NavItem
          icon={<PlayCircle className="h-4 w-4" />}
          label="Running"
          count={counts.running}
          active={isActiveFilter(activeFilter, { type: 'running' })}
          onClick={() => onChangeFilter({ type: 'running' })}
          onContextMenu={(e) => openDefaultContextMenu('Running', { type: 'running' }, e)}
        />
        <NavItem
          icon={<Hash className="h-4 w-4" />}
          label="Uncategorized"
          count={counts.uncategorized}
          active={isActiveFilter(activeFilter, { type: 'uncategorized' })}
          onClick={() => onChangeFilter({ type: 'uncategorized' })}
          onContextMenu={(e) => openDefaultContextMenu('Uncategorized', { type: 'uncategorized' }, e)}
        />
      </div>

      <div className="mt-4">
        <div className="mb-1.5 px-2 text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">
          Folders
        </div>
        <div className="space-y-1">
          {folders.length > 0 ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleFolderDragEnd}
            >
              <SortableContext
                items={folders.map((folder) => folder.id)}
                strategy={verticalListSortingStrategy}
              >
                {folders.map((folder) => (
                  <SortableFolderNavItem
                    key={folder.id}
                    folder={folder}
                    count={counts.byFolder[folder.id] ?? 0}
                    active={isActiveFilter(activeFilter, { type: 'folder', folderId: folder.id })}
                    onClick={() => onChangeFilter({ type: 'folder', folderId: folder.id })}
                    onContextMenu={(e) =>
                      openDefaultContextMenu(folder.name, { type: 'folder', folderId: folder.id }, e)
                    }
                  />
                ))}
              </SortableContext>
            </DndContext>
          ) : (
            <p className="px-2 py-1 text-xs text-[color:var(--color-muted-foreground)]">No folders</p>
          )}
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 px-2 text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">
          Tags
        </div>
        <div className="space-y-1">
          {tags.length > 0 ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleTagDragEnd}
            >
              <SortableContext
                items={tags.map((tag) => tag.id)}
                strategy={verticalListSortingStrategy}
              >
                {tags.map((tag) => (
                  <SortableTagNavItem
                    key={tag.id}
                    tag={tag}
                    count={counts.byTag[tag.id] ?? 0}
                    active={isActiveFilter(activeFilter, { type: 'tag', tagId: tag.id })}
                    onClick={() => onChangeFilter({ type: 'tag', tagId: tag.id })}
                    onContextMenu={(e) =>
                      openDefaultContextMenu(tag.name, { type: 'tag', tagId: tag.id }, e)
                    }
                  />
                ))}
              </SortableContext>
            </DndContext>
          ) : (
            <p className="px-2 py-1 text-xs text-[color:var(--color-muted-foreground)]">No tags</p>
          )}
        </div>
      </div>

      {defaultContextMenu && (
        <SidebarDefaultContextMenu
          x={defaultContextMenu.x}
          y={defaultContextMenu.y}
          label={defaultContextMenu.label}
          isDefault={isSameDefaultFilter(defaultContextMenu.filter)}
          onSetDefault={() => onSetStartupDefaultFilter(defaultContextMenu.filter)}
          onClearDefault={() => onSetStartupDefaultFilter(undefined)}
          onClose={() => setDefaultContextMenu(null)}
        />
      )}
    </aside>
  )
}
