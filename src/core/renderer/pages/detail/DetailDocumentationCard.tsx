import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useEffect, useState } from 'react'
import { ExternalLink, GripVertical, Pencil, Plus, Settings2, Trash2, X } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import type { ProjectDocLink } from '../../../shared/types'
import { ModalShell } from '../../components/ModalShell'

type DetailDocumentationCardProps = {
  docLinks: ProjectDocLink[]
  docTitleInput: string
  setDocTitleInput: Dispatch<SetStateAction<string>>
  docUrlInput: string
  setDocUrlInput: Dispatch<SetStateAction<string>>
  docError: string | null
  onAddDocLink: () => Promise<void>
  onUpdateDocLink: (linkId: string, title: string, url: string) => Promise<boolean>
  onSetDefaultDocLink: (linkId: string) => Promise<void>
  onReorderDocLinks: (activeLinkId: string, overLinkId: string) => Promise<void>
  onRemoveDocLink: (linkId: string) => Promise<void>
  settingsOpen?: boolean
  setSettingsOpen?: Dispatch<SetStateAction<boolean>>
  hideCard?: boolean
}

type SortableDocLinkItemProps = {
  link: ProjectDocLink
  isDefault: boolean
  isEditing: boolean
  dragDisabled: boolean
  editingTitle: string
  setEditingTitle: Dispatch<SetStateAction<string>>
  editingUrl: string
  setEditingUrl: Dispatch<SetStateAction<string>>
  onStartEdit: (link: ProjectDocLink) => void
  onCancelEdit: () => void
  onSaveEdit: () => Promise<void>
  onSetDefaultDocLink: (linkId: string) => Promise<void>
  onRemoveDocLink: (linkId: string) => Promise<void>
}

function SortableDocLinkItem({
  link,
  isDefault,
  isEditing,
  dragDisabled,
  editingTitle,
  setEditingTitle,
  editingUrl,
  setEditingUrl,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onSetDefaultDocLink,
  onRemoveDocLink,
}: SortableDocLinkItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: link.id,
    disabled: dragDisabled,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`quiet-control rounded-[16px] px-4 py-3 ${isDragging ? 'opacity-75' : ''}`}
    >
      {isEditing ? (
        <div className="grid grid-cols-1 gap-2">
          <input
            type="text"
            value={editingTitle}
            onChange={(e) => setEditingTitle(e.target.value)}
            placeholder="Title"
            className="quiet-control h-9 rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)]"
          />
          <input
            type="text"
            value={editingUrl}
            onChange={(e) => setEditingUrl(e.target.value)}
            placeholder="https://..."
            className="quiet-control h-9 rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)]"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onSaveEdit()
            }}
          />
          <div className="flex items-center gap-2">
            <button
              className="inline-flex h-8 items-center gap-1 rounded-full bg-primary px-3 text-xs font-medium text-white hover:bg-primary-hover"
              onClick={() => {
                void onSaveEdit()
              }}
            >
              Save
            </button>
            <button
              className="inline-flex h-8 items-center gap-1 rounded-full border border-[color:var(--color-border)] px-3 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
              onClick={onCancelEdit}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            ref={setActivatorNodeRef}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors ${
              dragDisabled
                ? 'cursor-not-allowed opacity-50'
                : 'cursor-grab active:cursor-grabbing hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
            }`}
            title={dragDisabled ? 'Cannot drag while editing' : 'Drag to reorder'}
            disabled={dragDisabled}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          <button
            className="min-w-0 flex-1 text-left"
            onClick={() => window.electronAPI.openExternal(link.url)}
            title={link.url}
          >
            <p className="truncate text-sm text-[color:var(--color-foreground)]">{link.title}</p>
            <p className="truncate text-[11px] text-[color:var(--color-muted-foreground)]">{link.url}</p>
          </button>
          <button
            className="inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-primary"
            onClick={() => window.electronAPI.openExternal(link.url)}
          >
            <ExternalLink className="h-3 w-3" />
            Open
          </button>
          <button
            className="inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
            onClick={() => onStartEdit(link)}
            title="Edit"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </button>
          <button
            className="inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => {
              void onSetDefaultDocLink(link.id)
            }}
            disabled={isDefault}
            title={isDefault ? 'Default link' : 'Set as default'}
          >
            {isDefault ? 'Default' : 'Set Default'}
          </button>
          <button
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-destructive-background)] hover:text-[color:var(--color-destructive)]"
            onClick={() => {
              if (isEditing) onCancelEdit()
              void onRemoveDocLink(link.id)
            }}
            title="Remove"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

function DetailDocumentationCard({
  docLinks,
  docTitleInput,
  setDocTitleInput,
  docUrlInput,
  setDocUrlInput,
  docError,
  onAddDocLink,
  onUpdateDocLink,
  onSetDefaultDocLink,
  onReorderDocLinks,
  onRemoveDocLink,
  settingsOpen: settingsOpenProp,
  setSettingsOpen: setSettingsOpenProp,
  hideCard = false,
}: DetailDocumentationCardProps) {
  const [settingsOpenState, setSettingsOpenState] = useState(false)
  const settingsOpen = settingsOpenProp ?? settingsOpenState
  const setSettingsOpen = setSettingsOpenProp ?? setSettingsOpenState
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [editingUrl, setEditingUrl] = useState('')
  const defaultLink = docLinks[0]
  const dragDisabled = editingLinkId !== null
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  )

  useEffect(() => {
    if (!settingsOpen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsOpen(false)
        setEditingLinkId(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [settingsOpen])

  const startEdit = (link: ProjectDocLink) => {
    setEditingLinkId(link.id)
    setEditingTitle(link.title)
    setEditingUrl(link.url)
  }

  const cancelEdit = () => {
    setEditingLinkId(null)
    setEditingTitle('')
    setEditingUrl('')
  }

  const saveEdit = async () => {
    if (!editingLinkId) return
    const ok = await onUpdateDocLink(editingLinkId, editingTitle, editingUrl)
    if (ok) {
      cancelEdit()
    }
  }

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    void onReorderDocLinks(String(active.id), String(over.id))
  }

  return (
    <>
      {!hideCard && (
        <div className="rounded-[24px] p-5 surface-card">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="section-label">Documentation</p>
              <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
                Project links for docs, specs and references
              </p>
            </div>
            <span className="rounded-full px-2.5 py-1 text-[11px] text-[color:var(--color-muted-foreground)] quiet-control">
              {docLinks.length}
            </span>
          </div>

          <div className="space-y-2.5">
            {defaultLink ? (
              <button
                className="quiet-control flex w-full min-w-0 items-center gap-2 rounded-[16px] px-4 py-3 text-left"
                onClick={() => window.electronAPI.openExternal(defaultLink.url)}
                title={defaultLink.url}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-[color:var(--color-foreground)]">{defaultLink.title}</p>
                  <p className="truncate text-[11px] text-[color:var(--color-muted-foreground)]">{defaultLink.url}</p>
                </div>
                <span className="rounded-full bg-[color:var(--color-accent)] px-2 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">
                  Default
                </span>
                <ExternalLink className="h-3.5 w-3.5 text-[color:var(--color-muted-foreground)]" />
              </button>
            ) : (
              <div className="rounded-[16px] border border-dashed border-[color:var(--color-border)] px-4 py-4 text-xs text-[color:var(--color-muted-foreground)]">
                No default documentation link.
              </div>
            )}
            <button
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-3 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 className="h-3.5 w-3.5" />
              Link Settings
            </button>
          </div>
        </div>
      )}

      <ModalShell
        open={settingsOpen}
        baseZIndex={1000}
        widthClassName="max-w-[760px]"
        ariaLabel="Documentation Links"
        onClose={() => {
          setSettingsOpen(false)
          cancelEdit()
        }}
      >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="section-label mb-1">Documentation Links</p>
                <p className="text-xs text-[color:var(--color-muted-foreground)]">
                  Add, edit and manage default documentation link
                </p>
              </div>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                onClick={() => {
                  setSettingsOpen(false)
                  cancelEdit()
                }}
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-4 space-y-2">
              <input
                type="text"
                value={docTitleInput}
                onChange={(e) => setDocTitleInput(e.target.value)}
                placeholder="Title (optional)"
                className="quiet-control h-10 rounded-full border-0 px-4 text-sm text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={docUrlInput}
                  onChange={(e) => setDocUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void onAddDocLink()
                  }}
                  placeholder="docs.example.com / https://..."
                  className="quiet-control h-10 min-w-0 flex-1 rounded-full border-0 px-4 text-sm text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <button
                  className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
                  onClick={() => {
                    void onAddDocLink()
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Link
                </button>
              </div>
            </div>

            {docLinks.length === 0 ? (
              <div className="rounded-[16px] border border-dashed border-[color:var(--color-border)] px-5 py-5 text-xs text-[color:var(--color-muted-foreground)]">
                No documentation links yet.
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext
                  items={docLinks.map((link) => link.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2.5">
                    {docLinks.map((link) => (
                      <SortableDocLinkItem
                        key={link.id}
                        link={link}
                        isDefault={docLinks[0]?.id === link.id}
                        isEditing={editingLinkId === link.id}
                        dragDisabled={dragDisabled}
                        editingTitle={editingTitle}
                        setEditingTitle={setEditingTitle}
                        editingUrl={editingUrl}
                        setEditingUrl={setEditingUrl}
                        onStartEdit={startEdit}
                        onCancelEdit={cancelEdit}
                        onSaveEdit={saveEdit}
                        onSetDefaultDocLink={onSetDefaultDocLink}
                        onRemoveDocLink={onRemoveDocLink}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}

            {docError && (
              <p className="mt-3 text-xs text-[color:var(--color-destructive)]">
                {docError}
              </p>
            )}
      </ModalShell>
    </>
  )
}

export { DetailDocumentationCard }
