import { FolderTree, Hash, Pin, PlayCircle, Tag } from 'lucide-react'
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
}: {
  icon: React.ReactNode
  label: string
  count: number
  active: boolean
  onClick: () => void
  colorDot?: string
}) {
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-2 rounded-[12px] px-2.5 py-2 text-left text-sm transition-colors ${
        active
          ? 'bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]'
          : 'text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
      }`}
      onClick={onClick}
    >
      <span className="shrink-0">{icon}</span>
      {colorDot && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: colorDot }} />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-[11px] text-[color:var(--color-muted-foreground)]">{count}</span>
    </button>
  )
}

export function WorkspaceClassifierPanel({
  folders,
  tags,
  activeFilter,
  counts,
  onChangeFilter,
}: WorkspaceClassifierPanelProps) {
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
        />
        <NavItem
          icon={<Pin className="h-4 w-4" />}
          label="Pinned"
          count={counts.pinned}
          active={isActiveFilter(activeFilter, { type: 'pinned' })}
          onClick={() => onChangeFilter({ type: 'pinned' })}
        />
        <NavItem
          icon={<PlayCircle className="h-4 w-4" />}
          label="Running"
          count={counts.running}
          active={isActiveFilter(activeFilter, { type: 'running' })}
          onClick={() => onChangeFilter({ type: 'running' })}
        />
        <NavItem
          icon={<Hash className="h-4 w-4" />}
          label="Uncategorized"
          count={counts.uncategorized}
          active={isActiveFilter(activeFilter, { type: 'uncategorized' })}
          onClick={() => onChangeFilter({ type: 'uncategorized' })}
        />
      </div>

      <div className="mt-4">
        <div className="mb-1.5 px-2 text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">
          Folders
        </div>
        <div className="space-y-1">
          {folders.length > 0 ? (
            folders.map((folder) => (
              <NavItem
                key={folder.id}
                icon={<FolderTree className="h-4 w-4" />}
                label={folder.name}
                count={counts.byFolder[folder.id] ?? 0}
                active={isActiveFilter(activeFilter, { type: 'folder', folderId: folder.id })}
                onClick={() => onChangeFilter({ type: 'folder', folderId: folder.id })}
                colorDot={folder.color || 'var(--color-primary)'}
              />
            ))
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
            tags.map((tag) => (
              <NavItem
                key={tag.id}
                icon={<Tag className="h-4 w-4" />}
                label={tag.name}
                count={counts.byTag[tag.id] ?? 0}
                active={isActiveFilter(activeFilter, { type: 'tag', tagId: tag.id })}
                onClick={() => onChangeFilter({ type: 'tag', tagId: tag.id })}
                colorDot={tag.color || 'var(--color-primary)'}
              />
            ))
          ) : (
            <p className="px-2 py-1 text-xs text-[color:var(--color-muted-foreground)]">No tags</p>
          )}
        </div>
      </div>
    </aside>
  )
}
