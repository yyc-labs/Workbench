import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, FolderTree, Tag, X } from 'lucide-react'
import type { ProjectFolder, ProjectInfo, ProjectTag } from '../../shared/types'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { projectDisplayName, projectDisplayType } from '../lib/projectDisplay'

interface ProjectMetaDialogProps {
  project: ProjectInfo
  folders: ProjectFolder[]
  tags: ProjectTag[]
  onClose: () => void
  onAssignFolder: (projectId: string, folderId?: string) => Promise<void>
  onSetProjectTags: (projectId: string, tagIds: string[]) => Promise<void>
  onSetProjectCustomName: (projectId: string, customName?: string) => Promise<void>
  onSetProjectCustomType: (projectId: string, customType?: string) => Promise<void>
}

export function ProjectMetaDialog({
  project,
  folders,
  tags,
  onClose,
  onAssignFolder,
  onSetProjectTags,
  onSetProjectCustomName,
  onSetProjectCustomType,
}: ProjectMetaDialogProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string | undefined>(project.folderId)
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(project.tagIds ?? [])
  const [customName, setCustomName] = useState(project.customName ?? '')
  const [customType, setCustomType] = useState(project.customType ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const selectedFolderName = useMemo(() => {
    if (!selectedFolderId) return 'Uncategorized'
    return folders.find((folder) => folder.id === selectedFolderId)?.name ?? 'Uncategorized'
  }, [folders, selectedFolderId])

  const handleToggleTag = (tagId: string) => {
    setSelectedTagIds((prev) => (
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
    ))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSetProjectCustomName(project.id, customName)
      await onSetProjectCustomType(project.id, customType)
      await onAssignFolder(project.id, selectedFolderId)
      await onSetProjectTags(project.id, selectedTagIds)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center px-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/25 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div
        className="relative z-[1001] w-full max-w-[520px] rounded-[20px] border p-5"
        style={{
          background: 'var(--color-popover)',
          borderColor: 'var(--color-border)',
          boxShadow: 'var(--shadow-popover)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="section-label mb-1">Project Metadata</p>
            <h2 className="truncate text-lg font-semibold text-[color:var(--color-foreground)]">
              {projectDisplayName(project)}
            </h2>
            <p className="mt-1 truncate text-xs text-[color:var(--color-muted-foreground)]">{project.path}</p>
          </div>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
            onClick={onClose}
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <section className="mb-5 space-y-3">
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-[12px] font-medium text-[color:var(--color-muted-foreground)]">Title</p>
              <button
                type="button"
                className="text-[11px] text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]"
                onClick={() => setCustomName('')}
              >
                Use default ({project.name})
              </button>
            </div>
            <Input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder={project.name}
              className="h-9 rounded-[12px] px-3 text-sm"
              disabled={saving}
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-[12px] font-medium text-[color:var(--color-muted-foreground)]">Project Type</p>
              <button
                type="button"
                className="text-[11px] text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]"
                onClick={() => setCustomType('')}
              >
                Use default ({project.type || 'unknown'})
              </button>
            </div>
            <Input
              value={customType}
              onChange={(e) => setCustomType(e.target.value)}
              placeholder={projectDisplayType(project) || 'unknown'}
              className="h-9 rounded-[12px] px-3 text-sm"
              disabled={saving}
            />
            <p className="mt-1 text-[11px] text-[color:var(--color-muted-foreground)]">
              Auto-detected type falls back to <span className="font-mono">unknown</span>.
            </p>
          </div>
        </section>

        <section className="mb-5">
          <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-[color:var(--color-muted-foreground)]">
            <FolderTree className="h-3.5 w-3.5" />
            Folder
          </div>
          <div className="rounded-[14px] border p-2" style={{ borderColor: 'var(--color-border)' }}>
            <button
              type="button"
              className={`flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left text-sm transition-colors ${
                !selectedFolderId
                  ? 'bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]'
                  : 'text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)]'
              }`}
              onClick={() => setSelectedFolderId(undefined)}
            >
              <span>Uncategorized</span>
              {!selectedFolderId && <Check className="h-4 w-4 text-primary" />}
            </button>
            {folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                className={`mt-1 flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left text-sm transition-colors ${
                  selectedFolderId === folder.id
                    ? 'bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]'
                    : 'text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)]'
                }`}
                onClick={() => setSelectedFolderId(folder.id)}
              >
                <span className="inline-flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: folder.color || 'var(--color-primary)' }}
                  />
                  {folder.name}
                </span>
                {selectedFolderId === folder.id && <Check className="h-4 w-4 text-primary" />}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-[color:var(--color-muted-foreground)]">
            Current: {selectedFolderName}
          </p>
        </section>

        <section>
          <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-[color:var(--color-muted-foreground)]">
            <Tag className="h-3.5 w-3.5" />
            Tags
          </div>
          {tags.length > 0 ? (
            <div className="flex flex-wrap gap-2 rounded-[14px] border p-2" style={{ borderColor: 'var(--color-border)' }}>
              {tags.map((tag) => {
                const active = selectedTagIds.includes(tag.id)
                return (
                  <button
                    key={tag.id}
                    type="button"
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      active
                        ? 'text-[color:var(--color-foreground)]'
                        : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
                    }`}
                    style={{
                      borderColor: active
                        ? 'color-mix(in srgb, var(--color-primary) 40%, transparent)'
                        : 'var(--color-border)',
                      background: active
                        ? 'color-mix(in srgb, var(--color-primary) 12%, transparent)'
                        : 'transparent',
                    }}
                    onClick={() => handleToggleTag(tag.id)}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: tag.color || 'var(--color-primary)' }}
                    />
                    {tag.name}
                    {active && <Check className="h-3.5 w-3.5 text-primary" />}
                  </button>
                )
              })}
            </div>
          ) : (
            <div
              className="rounded-[14px] border px-3 py-4 text-sm text-[color:var(--color-muted-foreground)]"
              style={{ borderColor: 'var(--color-border)' }}
            >
              No tags yet. Create tags in workspace manager first.
            </div>
          )}
        </section>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" className="h-9 rounded-full px-4" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button className="h-9 rounded-full px-4" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

interface WorkspaceManagerDialogProps {
  folders: ProjectFolder[]
  tags: ProjectTag[]
  onClose: () => void
  onCreateFolder: (name: string, color?: string) => Promise<void>
  onRenameFolder: (folderId: string, name: string) => Promise<void>
  onRemoveFolder: (folderId: string) => Promise<void>
  onCreateTag: (name: string, color?: string) => Promise<void>
  onRenameTag: (tagId: string, name: string) => Promise<void>
  onRemoveTag: (tagId: string) => Promise<void>
}

function ManagerRow({
  id,
  name,
  color,
  onRename,
  onRemove,
}: {
  id: string
  name: string
  color?: string
  onRename: (id: string, name: string) => Promise<void>
  onRemove: (id: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [nextName, setNextName] = useState(name)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    const trimmed = nextName.trim()
    if (!trimmed || trimmed === name) {
      setEditing(false)
      setNextName(name)
      return
    }
    setSaving(true)
    try {
      await onRename(id, trimmed)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-[12px] px-2 py-1.5 hover:bg-[color:var(--color-accent)]">
      <span
        className="h-2 w-2 rounded-full shrink-0"
        style={{ background: color || 'var(--color-primary)' }}
      />
      {editing ? (
        <Input
          value={nextName}
          onChange={(e) => setNextName(e.target.value)}
          className="h-8 rounded-[10px] px-2 text-sm"
          disabled={saving}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSave()
            if (e.key === 'Escape') {
              setEditing(false)
              setNextName(name)
            }
          }}
          autoFocus
        />
      ) : (
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-sm text-[color:var(--color-foreground)]"
          onClick={() => setEditing(true)}
          title="Rename"
        >
          {name}
        </button>
      )}
      {editing ? (
        <Button size="sm" className="h-7 rounded-full px-2.5 text-xs" onClick={() => void handleSave()} disabled={saving}>
          Save
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 rounded-full px-2.5 text-xs text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-background)]"
          onClick={() => void onRemove(id)}
        >
          Delete
        </Button>
      )}
    </div>
  )
}

function CreateRow({
  placeholder,
  buttonLabel,
  onCreate,
}: {
  placeholder: string
  buttonLabel: string
  onCreate: (name: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setCreating(true)
    try {
      await onCreate(trimmed)
      setName('')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-8 rounded-[10px] px-3 text-sm"
        placeholder={placeholder}
        disabled={creating}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void handleCreate()
        }}
      />
      <Button size="sm" className="h-8 rounded-full px-3" onClick={() => void handleCreate()} disabled={creating}>
        {buttonLabel}
      </Button>
    </div>
  )
}

export function WorkspaceManagerDialog({
  folders,
  tags,
  onClose,
  onCreateFolder,
  onRenameFolder,
  onRemoveFolder,
  onCreateTag,
  onRenameTag,
  onRemoveTag,
}: WorkspaceManagerDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center px-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/25 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div
        className="relative z-[1001] w-full max-w-[720px] rounded-[20px] border p-5"
        style={{
          background: 'var(--color-popover)',
          borderColor: 'var(--color-border)',
          boxShadow: 'var(--shadow-popover)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="section-label mb-1">Workspace</p>
            <h2 className="text-lg font-semibold text-[color:var(--color-foreground)]">Manage Folders & Tags</h2>
          </div>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
            onClick={onClose}
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-[16px] border p-3" style={{ borderColor: 'var(--color-border)' }}>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[color:var(--color-foreground)]">
              <FolderTree className="h-4 w-4 text-primary" />
              Folders
            </div>
            <div className="max-h-[280px] space-y-1 overflow-auto pr-1">
              {folders.map((folder) => (
                <ManagerRow
                  key={folder.id}
                  id={folder.id}
                  name={folder.name}
                  color={folder.color}
                  onRename={onRenameFolder}
                  onRemove={onRemoveFolder}
                />
              ))}
              {folders.length === 0 && (
                <p className="px-2 py-3 text-sm text-[color:var(--color-muted-foreground)]">No folders yet.</p>
              )}
            </div>
            <CreateRow
              placeholder="New folder name"
              buttonLabel="Add"
              onCreate={(name) => onCreateFolder(name)}
            />
          </section>

          <section className="rounded-[16px] border p-3" style={{ borderColor: 'var(--color-border)' }}>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[color:var(--color-foreground)]">
              <Tag className="h-4 w-4 text-primary" />
              Tags
            </div>
            <div className="max-h-[280px] space-y-1 overflow-auto pr-1">
              {tags.map((tag) => (
                <ManagerRow
                  key={tag.id}
                  id={tag.id}
                  name={tag.name}
                  color={tag.color}
                  onRename={onRenameTag}
                  onRemove={onRemoveTag}
                />
              ))}
              {tags.length === 0 && (
                <p className="px-2 py-3 text-sm text-[color:var(--color-muted-foreground)]">No tags yet.</p>
              )}
            </div>
            <CreateRow
              placeholder="New tag name"
              buttonLabel="Add"
              onCreate={(name) => onCreateTag(name)}
            />
          </section>
        </div>
      </div>
    </div>,
    document.body,
  )
}
