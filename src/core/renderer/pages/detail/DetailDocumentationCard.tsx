import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragCancelEvent,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  Copy,
  ExternalLink,
  GripVertical,
  KeyRound,
  Pencil,
  Plus,
  Settings2,
  StickyNote,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import type { ProjectDocLink } from '../../../shared/types'
import { ModalShell } from '../../components/ModalShell'

type DetailDocumentationCardProps = {
  docLinks: ProjectDocLink[]
  docTitleInput: string
  setDocTitleInput: Dispatch<SetStateAction<string>>
  docUrlInput: string
  setDocUrlInput: Dispatch<SetStateAction<string>>
  docNoteInput: string
  setDocNoteInput: Dispatch<SetStateAction<string>>
  docAccountInput: string
  setDocAccountInput: Dispatch<SetStateAction<string>>
  docSecretInput: string
  setDocSecretInput: Dispatch<SetStateAction<string>>
  docError: string | null
  onAddDocLink: () => Promise<void>
  onUpdateDocLink: (
    linkId: string,
    title: string,
    url: string,
    note: string,
    account: string,
    secret: string,
    clearSecret: boolean
  ) => Promise<boolean>
  onSetDefaultDocLink: (linkId: string) => Promise<void>
  onReorderDocLinks: (activeLinkId: string, overLinkId: string) => Promise<void>
  onRemoveDocLink: (linkId: string) => Promise<void>
  onCopyDocLinkAccount: (linkId: string) => Promise<boolean>
  onCopyDocLinkSecret: (linkId: string) => Promise<boolean>
  onGetDocLinkSecret: (linkId: string) => Promise<string | null>
  settingsOpen?: boolean
  setSettingsOpen?: Dispatch<SetStateAction<boolean>>
  hideCard?: boolean
}

type SortableDocLinkItemProps = {
  link: ProjectDocLink
  isDefault: boolean
  isEditing: boolean
  isExpanded: boolean
  isSorting: boolean
  dragDisabled: boolean
  editingTitle: string
  setEditingTitle: Dispatch<SetStateAction<string>>
  editingUrl: string
  setEditingUrl: Dispatch<SetStateAction<string>>
  editingNote: string
  setEditingNote: Dispatch<SetStateAction<string>>
  editingAccount: string
  setEditingAccount: Dispatch<SetStateAction<string>>
  editingSecret: string
  setEditingSecret: Dispatch<SetStateAction<string>>
  editingSecretLoading: boolean
  clearEditingSecret: boolean
  setClearEditingSecret: Dispatch<SetStateAction<boolean>>
  copiedAccount: boolean
  copiedSecret: boolean
  secretPreview: string | null
  secretPreviewLoading: boolean
  onCopyAccount: (linkId: string) => Promise<void>
  onCopySecret: (linkId: string) => Promise<void>
  onRevealSecret: (linkId: string) => Promise<void>
  onStartEdit: (link: ProjectDocLink) => Promise<void>
  onCancelEdit: () => void
  onSaveEdit: () => Promise<void>
  onToggleExpand: (linkId: string) => void
  onSetDefaultDocLink: (linkId: string) => Promise<void>
  onRemoveDocLink: (linkId: string) => Promise<void>
}

const SortableDocLinkItem = memo(function SortableDocLinkItem({
  link,
  isDefault,
  isEditing,
  isExpanded,
  isSorting,
  dragDisabled,
  editingTitle,
  setEditingTitle,
  editingUrl,
  setEditingUrl,
  editingNote,
  setEditingNote,
  editingAccount,
  setEditingAccount,
  editingSecret,
  setEditingSecret,
  editingSecretLoading,
  clearEditingSecret,
  setClearEditingSecret,
  copiedAccount,
  copiedSecret,
  secretPreview,
  secretPreviewLoading,
  onCopyAccount,
  onCopySecret,
  onRevealSecret,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onToggleExpand,
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
      className={`quiet-control rounded-[16px] px-4 py-3 ${isDragging ? 'opacity-45 will-change-transform' : ''}`}
    >
      {isEditing ? (
        <div className="grid grid-cols-1 gap-2">
          <input
            type="text"
            value={editingTitle}
            onChange={(e) => setEditingTitle(e.target.value)}
            placeholder="Title"
            className="quiet-control block h-9 w-full rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)]"
          />
          <input
            type="text"
            value={editingUrl}
            onChange={(e) => setEditingUrl(e.target.value)}
            placeholder="https://..."
            className="quiet-control block h-9 w-full rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)]"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onSaveEdit()
            }}
          />
          <textarea
            value={editingNote}
            onChange={(e) => setEditingNote(e.target.value)}
            placeholder="Note (optional)"
            rows={2}
            className="quiet-control block min-h-[64px] w-full rounded-[14px] border-0 px-3 py-2 text-xs text-[color:var(--color-foreground)]"
          />
          <input
            type="text"
            value={editingAccount}
            onChange={(e) => setEditingAccount(e.target.value)}
            placeholder="Account / username (optional)"
            className="quiet-control block h-9 w-full rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)]"
          />
          <input
            type="text"
            value={editingSecret}
            onChange={(e) => {
              setEditingSecret(e.target.value)
              if (e.target.value.trim()) setClearEditingSecret(false)
            }}
            placeholder={editingSecretLoading ? 'Loading password...' : 'Password / token'}
            disabled={editingSecretLoading}
            className="quiet-control block h-9 w-full rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)]"
          />
          {link.hasSecret && (
            <label className="inline-flex items-center gap-2 text-xs text-[color:var(--color-muted-foreground)]">
              <input
                type="checkbox"
                checked={clearEditingSecret}
                disabled={editingSecretLoading}
                onChange={(e) => {
                  setClearEditingSecret(e.target.checked)
                  if (e.target.checked) setEditingSecret('')
                }}
              />
              Clear saved password
            </label>
          )}
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
        <div className="flex items-start gap-2">
          <button
            type="button"
            ref={setActivatorNodeRef}
            className={`inline-flex h-8 w-8 touch-none items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors ${
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
          <div className="min-w-0 flex-1">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-[10px] px-1 py-1 text-left transition-colors hover:bg-[color:var(--color-accent)]"
              onClick={() => onToggleExpand(link.id)}
              aria-expanded={isExpanded}
              title={link.title}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-[color:var(--color-foreground)]">{link.title}</p>
                <p className="truncate text-[11px] text-[color:var(--color-muted-foreground)]">
                  {isExpanded ? link.url : link.url.replace(/^https?:\/\//, '')}
                </p>
              </div>
              <div className="inline-flex items-center gap-1">
                {isDefault && (
                  <span className="rounded-full bg-[color:var(--color-accent)] px-2 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">
                    Default
                  </span>
                )}
                <ChevronDown
                  className={`h-4 w-4 text-[color:var(--color-muted-foreground)] transition-transform ${
                    isExpanded ? 'rotate-180' : ''
                  }`}
                />
              </div>
            </button>

            {!isSorting && (
              <div className="mt-1 space-y-1.5 px-1">
                {link.note?.trim() && (
                  <div className="flex items-start gap-1.5 text-[11px] text-[color:var(--color-muted-foreground)]">
                    <StickyNote className="mt-0.5 h-3 w-3 shrink-0" />
                    <p className="line-clamp-2 break-words">{link.note}</p>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-1.5">
                  {link.account?.trim() && (
                    <>
                      <span className="inline-flex max-w-[320px] items-center gap-1 rounded-full bg-[color:var(--color-accent)] px-2 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">
                        <UserRound className="h-2.5 w-2.5 shrink-0" />
                        <span className="truncate">Account: {link.account}</span>
                      </span>
                      <button
                        className={`inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11px] transition-all ${
                          copiedAccount
                            ? 'scale-105 bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]'
                            : 'text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
                        }`}
                        onClick={() => {
                          void onCopyAccount(link.id)
                        }}
                        title="Copy account"
                      >
                        <Copy className="h-3 w-3" />
                        {copiedAccount ? 'Copied' : 'Copy Account'}
                      </button>
                    </>
                  )}
                  {link.hasSecret && (
                    <>
                      <span className="inline-flex max-w-[320px] items-center gap-1 rounded-full bg-[color:var(--color-accent)] px-2 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">
                        <KeyRound className="h-2.5 w-2.5 shrink-0" />
                        <span className="truncate">
                          Password: {secretPreviewLoading ? 'Loading...' : (secretPreview ?? '******')}
                        </span>
                      </span>
                      {!secretPreview && !secretPreviewLoading && (
                        <button
                          className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11px] text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                          onClick={() => {
                            void onRevealSecret(link.id)
                          }}
                          title="Show password"
                        >
                          Show
                        </button>
                      )}
                      <button
                        className={`inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11px] transition-all ${
                          copiedSecret
                            ? 'scale-105 bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]'
                            : 'text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
                        }`}
                        onClick={() => {
                          void onCopySecret(link.id)
                        }}
                        title="Copy password"
                      >
                        <Copy className="h-3 w-3" />
                        {copiedSecret ? 'Copied' : 'Copy Password'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {isExpanded && !isSorting && (
              <div className="mt-2 space-y-2 rounded-[12px] border border-[color:var(--color-border)] bg-[color:var(--color-background)]/50 p-2.5">
                {(link.note?.trim() || link.account?.trim() || link.hasSecret) && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {link.note?.trim() && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-accent)] px-2 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">
                        <StickyNote className="h-2.5 w-2.5" />
                        Note
                      </span>
                    )}
                    {link.account?.trim() && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-accent)] px-2 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">
                        <UserRound className="h-2.5 w-2.5" />
                        Account
                      </span>
                    )}
                    {link.hasSecret && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-accent)] px-2 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">
                        <KeyRound className="h-2.5 w-2.5" />
                        Password
                      </span>
                    )}
                  </div>
                )}
                {link.note?.trim() && (
                  <p className="text-xs text-[color:var(--color-muted-foreground)]">{link.note}</p>
                )}
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    className="inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-primary"
                    onClick={() => window.electronAPI.openExternal(link.url)}
                  >
                    <ExternalLink className="h-3 w-3" />
                    Open
                  </button>
                  {link.account?.trim() && (
                    <button
                      className={`inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs transition-all ${
                        copiedAccount
                          ? 'scale-105 bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]'
                          : 'text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
                      }`}
                      onClick={() => {
                        void onCopyAccount(link.id)
                      }}
                      title="Copy account"
                    >
                      <Copy className="h-3 w-3" />
                      {copiedAccount ? 'Copied' : 'Account'}
                    </button>
                  )}
                  {link.hasSecret && (
                    <button
                      className={`inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs transition-all ${
                        copiedSecret
                          ? 'scale-105 bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]'
                          : 'text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
                      }`}
                      onClick={() => {
                        void onCopySecret(link.id)
                      }}
                      title="Copy password"
                    >
                      <KeyRound className="h-3 w-3" />
                      {copiedSecret ? 'Copied' : 'Password'}
                    </button>
                  )}
                  <button
                    className="inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                    onClick={() => {
                      void onStartEdit(link)
                    }}
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
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}, (prev, next) => {
  return (
    prev.link === next.link &&
    prev.isDefault === next.isDefault &&
    prev.isEditing === next.isEditing &&
    prev.isExpanded === next.isExpanded &&
    prev.isSorting === next.isSorting &&
    prev.dragDisabled === next.dragDisabled &&
    prev.editingTitle === next.editingTitle &&
    prev.editingUrl === next.editingUrl &&
    prev.editingNote === next.editingNote &&
    prev.editingAccount === next.editingAccount &&
    prev.editingSecret === next.editingSecret &&
    prev.editingSecretLoading === next.editingSecretLoading &&
    prev.clearEditingSecret === next.clearEditingSecret &&
    prev.copiedAccount === next.copiedAccount &&
    prev.copiedSecret === next.copiedSecret &&
    prev.secretPreview === next.secretPreview &&
    prev.secretPreviewLoading === next.secretPreviewLoading
  )
})

function DetailDocumentationCard({
  docLinks,
  docTitleInput,
  setDocTitleInput,
  docUrlInput,
  setDocUrlInput,
  docNoteInput,
  setDocNoteInput,
  docAccountInput,
  setDocAccountInput,
  docSecretInput,
  setDocSecretInput,
  docError,
  onAddDocLink,
  onUpdateDocLink,
  onSetDefaultDocLink,
  onReorderDocLinks,
  onRemoveDocLink,
  onCopyDocLinkAccount,
  onCopyDocLinkSecret,
  onGetDocLinkSecret,
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
  const [editingNote, setEditingNote] = useState('')
  const [editingAccount, setEditingAccount] = useState('')
  const [editingSecret, setEditingSecret] = useState('')
  const [editingSecretLoading, setEditingSecretLoading] = useState(false)
  const [expandedLinkId, setExpandedLinkId] = useState<string | null>(null)
  const [draggingLinkId, setDraggingLinkId] = useState<string | null>(null)
  const [clearEditingSecret, setClearEditingSecret] = useState(false)
  const [copiedFieldKey, setCopiedFieldKey] = useState<string | null>(null)
  const [secretPreviewMap, setSecretPreviewMap] = useState<Record<string, string | null>>({})
  const [secretPreviewLoadingMap, setSecretPreviewLoadingMap] = useState<Record<string, boolean>>({})
  const editSecretRequestRef = useRef(0)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const defaultLink = docLinks[0]
  const dragDisabled = editingLinkId !== null
  const sortableItems = useMemo(() => docLinks.map((link) => link.id), [docLinks])
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
  }, [settingsOpen, setSettingsOpen])

  useEffect(() => {
    return () => {
      clearTimeout(copiedTimerRef.current)
    }
  }, [])

  const startEdit = useCallback(async (link: ProjectDocLink) => {
    const requestId = ++editSecretRequestRef.current
    setEditingLinkId(link.id)
    setExpandedLinkId(link.id)
    setEditingTitle(link.title)
    setEditingUrl(link.url)
    setEditingNote(link.note ?? '')
    setEditingAccount(link.account ?? '')
    setEditingSecret('')
    setClearEditingSecret(false)
    if (!link.hasSecret) {
      setEditingSecretLoading(false)
      return
    }
    setEditingSecretLoading(true)
    try {
      const secret = await onGetDocLinkSecret(link.id)
      if (editSecretRequestRef.current !== requestId) return
      setEditingSecret(secret ?? '')
    } finally {
      if (editSecretRequestRef.current === requestId) {
        setEditingSecretLoading(false)
      }
    }
  }, [onGetDocLinkSecret])

  const cancelEdit = useCallback(() => {
    editSecretRequestRef.current += 1
    setEditingLinkId(null)
    setEditingTitle('')
    setEditingUrl('')
    setEditingNote('')
    setEditingAccount('')
    setEditingSecret('')
    setEditingSecretLoading(false)
    setClearEditingSecret(false)
  }, [])

  const saveEdit = useCallback(async () => {
    if (!editingLinkId) return
    const ok = await onUpdateDocLink(
      editingLinkId,
      editingTitle,
      editingUrl,
      editingNote,
      editingAccount,
      editingSecret,
      clearEditingSecret
    )
    if (ok) {
      cancelEdit()
    }
  }, [onUpdateDocLink, editingLinkId, editingTitle, editingUrl, editingNote, editingAccount, editingSecret, clearEditingSecret, cancelEdit])

  const markCopied = useCallback((key: string) => {
    setCopiedFieldKey(key)
    clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => {
      setCopiedFieldKey((current) => (current === key ? null : current))
    }, 800)
  }, [])

  const handleCopyAccount = useCallback(async (linkId: string) => {
    const copied = await onCopyDocLinkAccount(linkId)
    if (copied) markCopied(`${linkId}:account`)
  }, [markCopied, onCopyDocLinkAccount])

  const handleCopySecret = useCallback(async (linkId: string) => {
    const copied = await onCopyDocLinkSecret(linkId)
    if (copied) markCopied(`${linkId}:secret`)
  }, [markCopied, onCopyDocLinkSecret])

  const handleRevealSecret = useCallback(async (linkId: string) => {
    if (secretPreviewLoadingMap[linkId]) return
    if (Object.prototype.hasOwnProperty.call(secretPreviewMap, linkId) && secretPreviewMap[linkId]) return
    setSecretPreviewLoadingMap((current) => ({ ...current, [linkId]: true }))
    try {
      const secret = await onGetDocLinkSecret(linkId)
      setSecretPreviewMap((current) => ({ ...current, [linkId]: secret }))
    } finally {
      setSecretPreviewLoadingMap((current) => ({ ...current, [linkId]: false }))
    }
  }, [onGetDocLinkSecret, secretPreviewLoadingMap, secretPreviewMap])

  const handleDragEnd = useCallback(({ active, over }: DragEndEvent) => {
    setDraggingLinkId(null)
    if (!over || active.id === over.id) return
    void onReorderDocLinks(String(active.id), String(over.id))
  }, [onReorderDocLinks])

  const handleDragStart = useCallback(({ active }: DragStartEvent) => {
    setDraggingLinkId(String(active.id))
    setExpandedLinkId(null)
  }, [])

  const handleDragCancel = useCallback((_event: DragCancelEvent) => {
    setDraggingLinkId(null)
  }, [])

  const handleToggleExpand = useCallback((linkId: string) => {
    setExpandedLinkId((current) => (current === linkId ? null : linkId))
  }, [])

  const draggingLink = draggingLinkId ? docLinks.find((link) => link.id === draggingLinkId) ?? null : null

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
        <div className="flex h-[78vh] max-h-[780px] flex-col">
          <div className="mb-4 flex shrink-0 items-start justify-between gap-4">
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

          <div className="mb-4 shrink-0 space-y-2.5">
            <input
              type="text"
              value={docTitleInput}
              onChange={(e) => setDocTitleInput(e.target.value)}
              placeholder="Title (optional)"
              className="quiet-control block h-10 w-full rounded-full border-0 px-4 text-sm text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="text"
                value={docUrlInput}
                onChange={(e) => setDocUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void onAddDocLink()
                }}
                placeholder="docs.example.com / https://..."
                className="quiet-control block h-10 w-full min-w-0 rounded-full border-0 px-4 text-sm text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-1"
              />
              <button
                className="inline-flex h-10 w-full shrink-0 items-center justify-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary-hover sm:w-auto"
                onClick={() => {
                  void onAddDocLink()
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                Add Link
              </button>
            </div>
            <textarea
              value={docNoteInput}
              onChange={(e) => setDocNoteInput(e.target.value)}
              rows={2}
              placeholder="Note (optional)"
              className="quiet-control block min-h-[72px] w-full rounded-[14px] border-0 px-4 py-2 text-sm text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                type="text"
                value={docAccountInput}
                onChange={(e) => setDocAccountInput(e.target.value)}
                placeholder="Account / username (optional)"
                className="quiet-control block h-10 w-full rounded-full border-0 px-4 text-sm text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <input
                type="text"
                value={docSecretInput}
                onChange={(e) => setDocSecretInput(e.target.value)}
                placeholder="Password / token (optional, stored securely)"
                className="quiet-control block h-10 w-full rounded-full border-0 px-4 text-sm text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
            {docLinks.length === 0 ? (
              <div className="rounded-[16px] border border-dashed border-[color:var(--color-border)] px-5 py-5 text-xs text-[color:var(--color-muted-foreground)]">
                No documentation links yet.
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragCancel={handleDragCancel}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={sortableItems}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2.5">
                    {docLinks.map((link) => {
                      const isEditing = editingLinkId === link.id
                      const copiedAccount = copiedFieldKey === `${link.id}:account`
                      const copiedSecret = copiedFieldKey === `${link.id}:secret`
                      return (
                        <SortableDocLinkItem
                          key={link.id}
                          link={link}
                          isDefault={docLinks[0]?.id === link.id}
                          isEditing={isEditing}
                          isExpanded={expandedLinkId === link.id}
                          isSorting={draggingLinkId !== null}
                          dragDisabled={dragDisabled}
                          editingTitle={isEditing ? editingTitle : ''}
                          setEditingTitle={setEditingTitle}
                          editingUrl={isEditing ? editingUrl : ''}
                          setEditingUrl={setEditingUrl}
                          editingNote={isEditing ? editingNote : ''}
                          setEditingNote={setEditingNote}
                          editingAccount={isEditing ? editingAccount : ''}
                          setEditingAccount={setEditingAccount}
                          editingSecret={isEditing ? editingSecret : ''}
                          setEditingSecret={setEditingSecret}
                          editingSecretLoading={isEditing ? editingSecretLoading : false}
                          clearEditingSecret={isEditing ? clearEditingSecret : false}
                          setClearEditingSecret={setClearEditingSecret}
                          copiedAccount={copiedAccount}
                          copiedSecret={copiedSecret}
                          secretPreview={
                            Object.prototype.hasOwnProperty.call(secretPreviewMap, link.id)
                              ? (secretPreviewMap[link.id] ?? null)
                              : null
                          }
                          secretPreviewLoading={Boolean(secretPreviewLoadingMap[link.id])}
                          onCopyAccount={handleCopyAccount}
                          onCopySecret={handleCopySecret}
                          onRevealSecret={handleRevealSecret}
                          onStartEdit={startEdit}
                          onCancelEdit={cancelEdit}
                          onSaveEdit={saveEdit}
                          onToggleExpand={handleToggleExpand}
                          onSetDefaultDocLink={onSetDefaultDocLink}
                          onRemoveDocLink={onRemoveDocLink}
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
            )}
          </div>

          {docError && (
            <p className="mt-3 shrink-0 text-xs text-[color:var(--color-destructive)]">
              {docError}
            </p>
          )}
        </div>
      </ModalShell>
    </>
  )
}

export { DetailDocumentationCard }
