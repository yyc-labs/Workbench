import { closestCenter, DndContext, type DragCancelEvent, type DragEndEvent, DragOverlay, type DragStartEvent, MeasuringStrategy, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowUpDown, GripVertical, KeyRound, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { memo, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import type { ProjectDocLinkKind, ProjectDocLinkSshRoute, ProjectDocLinkTag, SharedDocLink } from '../../shared/types'
import { useI18n } from '../i18n'
import { isSshProjectDocLink, normalizeProjectDocLinkTag, projectDocLinkTarget } from '../lib/projectDocLinks'
import { DetailDocumentationTagSelect } from '../pages/detail/DetailDocumentationTagSelect'
import { useAppStore } from '../stores/appStore'
import { ModalShell } from './ModalShell'
import { SharedDocLinkGroupBindingDialog } from './SharedDocLinkGroupBindingDialog'
import { SharedDocLinkReorderDialog } from './SharedDocLinkReorderDialog'

type SharedDocLinkLibraryDialogProps = {
  open: boolean
  onClose: () => void
  /** 从设置弹窗打开时传 1100；从设置页面板内打开时传 1000。 */
  baseZIndex?: number
  /** 打开时选中的组（设置页按组管理入口用）。 */
  initialGroupId?: string
}

type LinkFormState = {
  linkId: string | null
  title: string
  kind: ProjectDocLinkKind
  url: string
  tag: ProjectDocLinkTag
  note: string
  account: string
  sshHost: string
  sshPort: string
  sshUsername: string
  sshRoute: ProjectDocLinkSshRoute
  password: string
  passwordSaved: boolean
}

function createEmptyLinkForm(): LinkFormState {
  return {
    linkId: null,
    title: '',
    kind: 'url',
    url: '',
    tag: '',
    note: '',
    account: '',
    sshHost: '',
    sshPort: '22',
    sshUsername: '',
    sshRoute: 'wsl',
    password: '',
    passwordSaved: false,
  }
}

function linkFormFrom(link: SharedDocLink): LinkFormState {
  return {
    linkId: link.id,
    title: link.title,
    kind: link.kind ?? 'url',
    url: link.url ?? '',
    tag: link.tag ?? '',
    note: link.note ?? '',
    account: link.account ?? '',
    sshHost: link.sshHost ?? '',
    sshPort: String(link.sshPort ?? 22),
    sshUsername: link.sshUsername ?? '',
    sshRoute: link.sshRoute ?? 'wsl',
    password: '',
    passwordSaved: Boolean(link.hasSecret),
  }
}

type SharedDocLinkRowProps = {
  link: SharedDocLink
  dragDisabled: boolean
  /** 行内不允许排序时隐藏拖拽把手（设置页面板：排序走弹窗）。 */
  hideGrip: boolean
  onStartEdit: (link: SharedDocLink) => void
  onRemove: (linkId: string) => void
}

/**
 * 共享库链接行：拖拽把手排序，交互与项目资料夹弹窗一致。
 * memo 化：DndContext 拖拽期间高频重渲染，未拖动的行必须跳过，否则长列表明显卡顿。
 */
const SharedDocLinkRow = memo(function SharedDocLinkRow({ link, dragDisabled, hideGrip, onStartEdit, onRemove }: SharedDocLinkRowProps) {
  const { t } = useI18n()
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging: sortableIsDragging } = useSortable({ id: link.id, disabled: dragDisabled })
  // 被拖行原位留坑（只降透明度）：浮层唯一跟随鼠标；transform 不越界，容器不会因此出现滚动条。
  const style = {
    transform: sortableIsDragging ? undefined : CSS.Translate.toString(transform),
    transition,
  }

  return (
    <div ref={setNodeRef} style={style} className={`rounded-[12px] border border-[color:var(--color-border)] px-2.5 py-2 ${sortableIsDragging ? 'opacity-45 will-change-transform' : ''}`}>
      <div className="flex items-center gap-1.5">
        {!hideGrip && (
          <button
            type="button"
            ref={setActivatorNodeRef}
            className={`inline-flex h-7 w-7 touch-none shrink-0 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors ${
              dragDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-grab hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] active:cursor-grabbing'
            }`}
            title={dragDisabled ? t('documentation.dragDisabled') : t('documentation.dragToReorder')}
            disabled={dragDisabled}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-[color:var(--color-foreground)]">{link.title}</p>
          <p className="truncate text-[11px] text-[color:var(--color-muted-foreground)]">
            {isSshProjectDocLink(link) ? t('documentation.kindSsh') : t('documentation.kindUrl')} · {projectDocLinkTarget(link)}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
          onClick={() => {
            onStartEdit(link)
          }}
          title={t('documentation.editSharedLink')}
        >
          <Pencil className="h-3 w-3" />
        </button>
        <button
          type="button"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-destructive-background)] hover:text-[color:var(--color-destructive)]"
          onClick={() => {
            onRemove(link.id)
          }}
          title={t('common.delete')}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
})

type SharedDocLinkLibraryContentProps = {
  /** 打开时选中的组。 */
  initialGroupId?: string
  /** 渲染场景：'dialog'（默认）行内拖拽 + 行内表单；'panel'（设置页）编辑/新增/排序均走弹窗。 */
  variant?: 'dialog' | 'panel'
}

/** 共享库管理内容：设置页面板与弹窗共用（store 直连）。 */
export function SharedDocLinkLibraryContent({ initialGroupId, variant = 'dialog' }: SharedDocLinkLibraryContentProps) {
  const { t } = useI18n()
  const groups = useAppStore((s) => s.sharedDocLinkGroups)
  const links = useAppStore((s) => s.sharedDocLinks)
  const error = useAppStore((s) => s.docLinkLibraryError)
  const createDocLinkGroup = useAppStore((s) => s.createDocLinkGroup)
  const renameDocLinkGroup = useAppStore((s) => s.renameDocLinkGroup)
  const removeDocLinkGroup = useAppStore((s) => s.removeDocLinkGroup)
  const upsertSharedDocLink = useAppStore((s) => s.upsertSharedDocLink)
  const removeSharedDocLink = useAppStore((s) => s.removeSharedDocLink)
  const reorderSharedDocLinks = useAppStore((s) => s.reorderSharedDocLinks)
  const setSharedDocLinkSecret = useAppStore((s) => s.setSharedDocLinkSecret)
  const clearSharedDocLinkSecret = useAppStore((s) => s.clearSharedDocLinkSecret)
  const getSharedDocLinkSecret = useAppStore((s) => s.getSharedDocLinkSecret)
  const docLinkTags = useAppStore((s) => s.config.docLinkTags ?? [])

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(initialGroupId ?? null)
  const [newGroupName, setNewGroupName] = useState('')
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null)
  const [renamingGroupName, setRenamingGroupName] = useState('')
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null)
  const [bindingGroupId, setBindingGroupId] = useState<string | null>(null)
  const [reorderDialogOpen, setReorderDialogOpen] = useState(false)
  const [formDialogOpen, setFormDialogOpen] = useState(false)
  const [draggingLinkId, setDraggingLinkId] = useState<string | null>(null)
  const [linkForm, setLinkForm] = useState<LinkFormState | null>(null)
  const [busy, setBusy] = useState(false)

  const isPanel = variant === 'panel'
  const canReorderInline = !isPanel

  const dragSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  )

  const orderedGroups = useMemo(() => [...groups].sort((a, b) => a.sortOrder - b.sortOrder), [groups])
  const activeGroupId = selectedGroupId && orderedGroups.some((group) => group.id === selectedGroupId) ? selectedGroupId : (orderedGroups[0]?.id ?? null)
  const groupLinks = useMemo(() => (activeGroupId ? links.filter((link) => link.groupId === activeGroupId) : []), [activeGroupId, links])

  useEffect(() => {
    if (renamingGroupId && !orderedGroups.some((group) => group.id === renamingGroupId)) {
      setRenamingGroupId(null)
      setRenamingGroupName('')
    }
    if (deletingGroupId && !orderedGroups.some((group) => group.id === deletingGroupId)) {
      setDeletingGroupId(null)
    }
  }, [deletingGroupId, orderedGroups, renamingGroupId])

  const handleCreateGroup = async () => {
    const trimmed = newGroupName.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      await createDocLinkGroup(trimmed)
      setNewGroupName('')
    } finally {
      setBusy(false)
    }
  }

  const handleRenameGroup = async (groupId: string) => {
    const trimmed = renamingGroupName.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      await renameDocLinkGroup(groupId, trimmed)
      setRenamingGroupId(null)
      setRenamingGroupName('')
    } finally {
      setBusy(false)
    }
  }

  const handleRemoveGroup = async (groupId: string) => {
    if (busy) return
    setBusy(true)
    try {
      await removeDocLinkGroup(groupId)
      setDeletingGroupId(null)
    } finally {
      setBusy(false)
    }
  }

  // 稳定回调：行组件已 memo 化，拖拽期间 DndContext 高频重渲染时跳过未变动行。
  const startEditLink = useCallback(
    async (link: SharedDocLink) => {
      setLinkForm(linkFormFrom(link))
      if (isPanel) setFormDialogOpen(true)
      if (!link.hasSecret) return
      const secret = await getSharedDocLinkSecret(link.id)
      setLinkForm((current) => (current && current.linkId === link.id ? { ...current, passwordSaved: Boolean(secret) } : current))
    },
    [getSharedDocLinkSecret, isPanel],
  )

  const openAddLink = useCallback(() => {
    setLinkForm(createEmptyLinkForm())
    if (isPanel) setFormDialogOpen(true)
  }, [isPanel])

  const closeFormDialog = useCallback(() => {
    setFormDialogOpen(false)
    setLinkForm(null)
  }, [])

  const handleSaveLink = async () => {
    if (!linkForm || !activeGroupId || busy) return
    const title = linkForm.title.trim()
    if (!title) return
    if (linkForm.kind === 'ssh' && !linkForm.sshHost.trim()) return
    if (linkForm.kind === 'url' && !linkForm.url.trim()) return
    setBusy(true)
    try {
      const savedId = linkForm.linkId
      const file = await upsertSharedDocLink({
        ...(savedId ? { id: savedId } : {}),
        groupId: activeGroupId,
        title,
        kind: linkForm.kind,
        ...(linkForm.kind === 'url' ? { url: linkForm.url.trim() } : {}),
        tag: normalizeProjectDocLinkTag(linkForm.tag, docLinkTags),
        ...(linkForm.note.trim() ? { note: linkForm.note.trim() } : {}),
        ...(linkForm.account.trim() ? { account: linkForm.account.trim() } : {}),
        ...(linkForm.kind === 'ssh'
          ? {
              sshHost: linkForm.sshHost.trim(),
              sshPort: Number.parseInt(linkForm.sshPort, 10) || 22,
              sshUsername: linkForm.sshUsername.trim(),
              sshRoute: linkForm.sshRoute,
            }
          : {}),
        hasSecret: savedId ? (links.find((link) => link.id === savedId)?.hasSecret ?? false) : false,
      })
      const secretTargetId = savedId ?? file?.links.find((link) => link.groupId === activeGroupId && !links.some((prev) => prev.id === link.id))?.id
      if (secretTargetId && linkForm.password.trim()) {
        await setSharedDocLinkSecret(secretTargetId, linkForm.password.trim())
      }
      setLinkForm(null)
    } finally {
      setBusy(false)
    }
  }

  const handleSavePassword = async () => {
    if (!linkForm?.linkId || !linkForm.password.trim() || busy) return
    setBusy(true)
    try {
      await setSharedDocLinkSecret(linkForm.linkId, linkForm.password.trim())
      setLinkForm((current) => (current ? { ...current, password: '', passwordSaved: true } : current))
    } finally {
      setBusy(false)
    }
  }

  const handleClearPassword = async () => {
    if (!linkForm?.linkId || busy) return
    setBusy(true)
    try {
      await clearSharedDocLinkSecret(linkForm.linkId)
      setLinkForm((current) => (current ? { ...current, password: '', passwordSaved: false } : current))
    } finally {
      setBusy(false)
    }
  }

  const handleRemoveLink = useCallback(
    async (linkId: string) => {
      if (busy) return
      setBusy(true)
      try {
        await removeSharedDocLink(linkId)
        setLinkForm((current) => (current?.linkId === linkId ? null : current))
      } finally {
        setBusy(false)
      }
    },
    [busy, removeSharedDocLink],
  )

  const handleRowStartEdit = useCallback(
    (link: SharedDocLink) => {
      void startEditLink(link)
    },
    [startEditLink],
  )

  const handleRowRemove = useCallback(
    (linkId: string) => {
      void handleRemoveLink(linkId)
    },
    [handleRemoveLink],
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
    if (!activeGroupId || busy) return
    const ids = groupLinks.map((link) => link.id)
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
    void reorderSharedDocLinks(activeGroupId, arrayMove(ids, oldIndex, newIndex))
  }

  const linkFormPanel: ReactNode = linkForm && (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={`inline-flex h-8 items-center rounded-full px-3 text-xs transition-colors ${linkForm.kind === 'url' ? 'bg-primary text-white' : 'border border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)]'}`}
          onClick={() => setLinkForm((current) => (current ? { ...current, kind: 'url' } : current))}
        >
          {t('documentation.kindUrl')}
        </button>
        <button
          type="button"
          className={`inline-flex h-8 items-center rounded-full px-3 text-xs transition-colors ${linkForm.kind === 'ssh' ? 'bg-primary text-white' : 'border border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)]'}`}
          onClick={() => setLinkForm((current) => (current ? { ...current, kind: 'ssh' } : current))}
        >
          {t('documentation.kindSsh')}
        </button>
      </div>
      <input
        type="text"
        value={linkForm.title}
        onChange={(event) => setLinkForm((current) => (current ? { ...current, title: event.target.value } : current))}
        placeholder={t('documentation.namePlaceholder')}
        className="quiet-control block h-9 w-full rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {linkForm.kind === 'ssh' ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_104px]">
          <input
            type="text"
            value={linkForm.sshUsername}
            onChange={(event) => setLinkForm((current) => (current ? { ...current, sshUsername: event.target.value } : current))}
            placeholder={t('documentation.sshUsernamePlaceholder')}
            className="quiet-control block h-9 w-full rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <input
            type="text"
            value={linkForm.sshHost}
            onChange={(event) => setLinkForm((current) => (current ? { ...current, sshHost: event.target.value } : current))}
            placeholder={t('documentation.sshHostPlaceholder')}
            className="quiet-control block h-9 w-full rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <input
            type="text"
            value={linkForm.sshPort}
            onChange={(event) => setLinkForm((current) => (current ? { ...current, sshPort: event.target.value } : current))}
            placeholder={t('documentation.sshPortPlaceholder')}
            className="quiet-control block h-9 w-full rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      ) : (
        <input
          type="text"
          value={linkForm.url}
          onChange={(event) => setLinkForm((current) => (current ? { ...current, url: event.target.value } : current))}
          placeholder={t('documentation.urlPlaceholder')}
          className="quiet-control block h-9 w-full rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      )}
      <DetailDocumentationTagSelect value={linkForm.tag} onChange={(tag) => setLinkForm((current) => (current ? { ...current, tag } : current))} options={docLinkTags} compact />
      <textarea
        value={linkForm.note}
        onChange={(event) => setLinkForm((current) => (current ? { ...current, note: event.target.value } : current))}
        rows={2}
        placeholder={t('documentation.notePlaceholder')}
        className="quiet-control block min-h-[56px] w-full rounded-[12px] border-0 px-3 py-2 text-xs text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <input
        type="text"
        value={linkForm.account}
        onChange={(event) => setLinkForm((current) => (current ? { ...current, account: event.target.value } : current))}
        placeholder={t('documentation.accountPlaceholder')}
        className="quiet-control block h-9 w-full rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          type="text"
          value={linkForm.password}
          onChange={(event) => setLinkForm((current) => (current ? { ...current, password: event.target.value } : current))}
          placeholder={linkForm.passwordSaved ? t('documentation.passwordSaved') : t('documentation.secretPlaceholder')}
          className="quiet-control block h-9 min-w-0 flex-1 rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="button"
          className="quiet-control inline-flex h-8 shrink-0 items-center gap-1 rounded-full border-0 px-2.5 text-[11px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:opacity-60"
          onClick={() => {
            void handleSavePassword()
          }}
          disabled={!linkForm.linkId || !linkForm.password.trim() || busy}
        >
          <KeyRound className="h-3 w-3" />
          {t('documentation.savePassword')}
        </button>
        {linkForm.passwordSaved && (
          <button
            type="button"
            className="quiet-control inline-flex h-8 shrink-0 items-center rounded-full border-0 px-2.5 text-[11px] text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:opacity-60"
            onClick={() => {
              void handleClearPassword()
            }}
            disabled={!linkForm.linkId || busy}
          >
            {t('documentation.clearPassword')}
          </button>
        )}
      </div>
      <p className="px-1 text-[10.5px] text-[color:var(--color-muted-foreground)]">{t('documentation.sharedSecretHint')}</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="inline-flex h-8 items-center rounded-full bg-primary px-3 text-xs font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
          onClick={() => {
            void handleSaveLink()
          }}
          disabled={busy}
        >
          {t('common.save')}
        </button>
        <button type="button" className="inline-flex h-8 items-center rounded-full border border-[color:var(--color-border)] px-3 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]" onClick={() => setLinkForm(null)}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        {error && <p className="mb-3 shrink-0 text-xs text-[color:var(--color-destructive)]">{error}</p>}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="flex min-h-0 flex-col rounded-[14px] border border-[color:var(--color-border)] p-3">
            <p className="section-label mb-2">{t('documentation.sharedLibrary')}</p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newGroupName}
                onChange={(event) => setNewGroupName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleCreateGroup()
                }}
                placeholder={t('documentation.groupNamePlaceholder')}
                disabled={busy}
                className="quiet-control block h-9 w-full rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <button
                type="button"
                className="inline-flex h-9 shrink-0 items-center justify-center rounded-full bg-primary px-3 text-xs font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
                onClick={() => {
                  void handleCreateGroup()
                }}
                disabled={!newGroupName.trim() || busy}
              >
                {t('documentation.newGroup')}
              </button>
            </div>
            <div className={`mt-2 flex-1 space-y-1 overflow-y-auto ${isPanel ? 'min-h-0' : 'max-h-[280px]'}`}>
              {orderedGroups.length === 0 ? (
                <p className="px-1 py-2 text-[11px] text-[color:var(--color-muted-foreground)]">{t('documentation.sharedGroupsEmpty')}</p>
              ) : (
                orderedGroups.map((group) => {
                  const isActive = group.id === activeGroupId
                  const isRenaming = renamingGroupId === group.id
                  const isDeleting = deletingGroupId === group.id
                  const count = links.filter((link) => link.groupId === group.id).length
                  return (
                    <div key={group.id} className={`rounded-[12px] px-2 py-1.5 transition-colors ${isActive ? 'bg-[color:var(--color-accent)]' : 'hover:bg-[color:var(--color-accent)]/70'}`}>
                      {isRenaming ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={renamingGroupName}
                            onChange={(event) => setRenamingGroupName(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') void handleRenameGroup(group.id)
                              if (event.key === 'Escape') {
                                setRenamingGroupId(null)
                                setRenamingGroupName('')
                              }
                            }}
                            className="quiet-control h-7 min-w-0 flex-1 rounded-full border-0 px-2 text-[11px] text-[color:var(--color-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            autoFocus
                          />
                          <button
                            type="button"
                            className="rounded-full px-1.5 py-0.5 text-[11px] text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]"
                            onClick={() => {
                              void handleRenameGroup(group.id)
                            }}
                            disabled={busy}
                          >
                            {t('common.save')}
                          </button>
                          <button
                            type="button"
                            className="rounded-full px-1.5 py-0.5 text-[11px] text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)]"
                            onClick={() => {
                              setRenamingGroupId(null)
                              setRenamingGroupName('')
                            }}
                          >
                            {t('common.cancel')}
                          </button>
                        </div>
                      ) : isDeleting ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="min-w-0 flex-1 text-[11px] text-[color:var(--color-destructive)]">{t('documentation.deleteGroupConfirm')}</span>
                          <button
                            type="button"
                            className="rounded-full bg-[color:var(--color-destructive-background)] px-2 py-0.5 text-[11px] text-[color:var(--color-destructive)]"
                            onClick={() => {
                              void handleRemoveGroup(group.id)
                            }}
                            disabled={busy}
                          >
                            {t('common.delete')}
                          </button>
                          <button type="button" className="rounded-full px-2 py-0.5 text-[11px] text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)]" onClick={() => setDeletingGroupId(null)}>
                            {t('common.cancel')}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <button type="button" className="min-w-0 flex-1 truncate text-left text-xs text-[color:var(--color-foreground)]" onClick={() => setSelectedGroupId(group.id)}>
                            {group.name}
                            <span className="ml-1.5 text-[10px] text-[color:var(--color-muted-foreground)]">{t('documentation.sharedLinksCount', { count })}</span>
                          </button>
                          <button
                            type="button"
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                            onClick={() => {
                              setRenamingGroupId(group.id)
                              setRenamingGroupName(group.name)
                            }}
                            title={t('common.rename')}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                            onClick={() => setBindingGroupId(group.id)}
                            title={t('documentation.bindProjects')}
                          >
                            <Users className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-destructive-background)] hover:text-[color:var(--color-destructive)]"
                            onClick={() => setDeletingGroupId(group.id)}
                            title={t('common.delete')}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-col rounded-[14px] border border-[color:var(--color-border)] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="section-label">{t('documentation.linksInGroup')}</p>
              <div className="flex items-center gap-1.5">
                {!canReorderInline && (
                  <button
                    type="button"
                    className="quiet-control inline-flex h-8 items-center gap-1 rounded-full border-0 px-2.5 text-[11px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:opacity-60"
                    onClick={() => setReorderDialogOpen(true)}
                    disabled={!activeGroupId || busy}
                  >
                    <ArrowUpDown className="h-3.5 w-3.5" />
                    {t('documentation.reorderLinks')}
                  </button>
                )}
                <button type="button" className="quiet-control inline-flex h-8 items-center gap-1 rounded-full border-0 px-2.5 text-[11px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:opacity-60" onClick={openAddLink} disabled={!activeGroupId || busy}>
                  <Plus className="h-3.5 w-3.5" />
                  {t('documentation.addSharedLink')}
                </button>
              </div>
            </div>
            <DndContext sensors={dragSensors} collisionDetection={closestCenter} measuring={{ droppable: { strategy: MeasuringStrategy.BeforeDragging } }} onDragStart={handleDragStart} onDragCancel={handleDragCancel} onDragEnd={handleDragEnd}>
              <SortableContext items={groupLinks.map((link) => link.id)} strategy={verticalListSortingStrategy}>
                <div className={`flex-1 space-y-1.5 overflow-y-auto ${isPanel ? 'min-h-0' : 'max-h-[280px]'}`}>
                  {!activeGroupId ? (
                    <p className="px-1 py-2 text-[11px] text-[color:var(--color-muted-foreground)]">{t('documentation.sharedGroupsEmpty')}</p>
                  ) : (
                    <>
                      {groupLinks.map((link) =>
                        linkForm?.linkId === link.id && !isPanel ? (
                          <div key={link.id} className="rounded-[12px] border border-[color:var(--color-border)] px-2.5 py-2">
                            {linkFormPanel}
                          </div>
                        ) : (
                          <SharedDocLinkRow key={link.id} link={link} dragDisabled={busy || linkForm !== null} hideGrip={!canReorderInline} onStartEdit={handleRowStartEdit} onRemove={handleRowRemove} />
                        ),
                      )}
                      {linkForm?.linkId === null && !isPanel && <div className="rounded-[12px] border border-dashed border-[color:var(--color-border)] px-2.5 py-2">{linkFormPanel}</div>}
                      {groupLinks.length === 0 && linkForm?.linkId !== null && <p className="px-1 py-2 text-[11px] text-[color:var(--color-muted-foreground)]">{t('documentation.noLinksInGroup')}</p>}
                    </>
                  )}
                </div>
              </SortableContext>
              <DragOverlay>
                {draggingLinkId
                  ? groupLinks
                      .filter((link) => link.id === draggingLinkId)
                      .map((link) => (
                        <div key={link.id} className="quiet-control w-full rounded-[12px] border border-[color:var(--color-border)] px-3 py-2 shadow-lg">
                          <p className="truncate text-xs text-[color:var(--color-foreground)]">{link.title}</p>
                          <p className="truncate text-[11px] text-[color:var(--color-muted-foreground)]">{projectDocLinkTarget(link)}</p>
                        </div>
                      ))
                  : null}
              </DragOverlay>
            </DndContext>
          </div>
        </div>
      </div>
      {bindingGroupId && <SharedDocLinkGroupBindingDialog open groupId={bindingGroupId} groupName={orderedGroups.find((group) => group.id === bindingGroupId)?.name ?? ''} onClose={() => setBindingGroupId(null)} />}
      {reorderDialogOpen && activeGroupId && <SharedDocLinkReorderDialog open groupId={activeGroupId} groupName={orderedGroups.find((group) => group.id === activeGroupId)?.name ?? ''} onClose={() => setReorderDialogOpen(false)} />}
      {formDialogOpen && linkForm && (
        <ModalShell open onClose={closeFormDialog} baseZIndex={1300} widthClassName="max-w-[560px]" ariaLabel={linkForm.linkId ? t('documentation.editSharedLink') : t('documentation.addSharedLink')}>
          <div className="mb-4">
            <p className="section-label mb-1 text-base">{linkForm.linkId ? t('documentation.editSharedLink') : t('documentation.addSharedLink')}</p>
          </div>
          <div className="max-h-[62vh] overflow-y-auto pr-1">{linkFormPanel}</div>
        </ModalShell>
      )}
    </>
  )
}

export function SharedDocLinkLibraryDialog({ open, onClose, baseZIndex = 1100, initialGroupId }: SharedDocLinkLibraryDialogProps) {
  const { t } = useI18n()
  return (
    <ModalShell open={open} onClose={onClose} baseZIndex={baseZIndex} widthClassName="max-w-[860px]" ariaLabel={t('documentation.sharedLibrary')}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="section-label mb-1 text-base">{t('documentation.sharedLibrary')}</p>
          <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('documentation.sharedLibraryDescription')}</p>
        </div>
      </div>
      <SharedDocLinkLibraryContent initialGroupId={initialGroupId} />
    </ModalShell>
  )
}
