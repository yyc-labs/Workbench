import type { DragCancelEvent, DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { ProjectDocLink, ProjectDocLinkKind, ProjectDocLinkSshRoute, ProjectDocTagOption } from '../../../shared/types'
import { useI18n } from '../../i18n'
import {
  PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS,
  normalizeProjectDocLinkTag,
  normalizeProjectDocLinkKind,
} from '../../lib/projectDocLinks'
import { buildSshDocLinkTarget, parseSshShortcutInput } from './detail.aiFlow'
import type {
  DetailDocumentationCardProps,
  DetailDocumentationEditState,
  DetailDocumentationTagFilter,
} from './detail.documentationCard.types'

type UseDetailDocumentationCardStateOptions = Pick<
  DetailDocumentationCardProps,
  | 'docLinks'
  | 'docTagOptions'
  | 'docTagInput'
  | 'setDocTagInput'
  | 'setDocError'
  | 'onAddDocTag'
  | 'onRenameDocTag'
  | 'onRemoveDocTag'
  | 'onUpdateDocLink'
  | 'onSetDefaultDocLink'
  | 'onReorderDocLinks'
  | 'onRemoveDocLink'
  | 'onCopyDocLinkAccount'
  | 'onCopyDocLinkSecret'
  | 'onGetDocLinkSecret'
  | 'onOpenDocLink'
  | 'settingsOpen'
  | 'setSettingsOpen'
>

export type UseDetailDocumentationCardStateResult = {
  settings: {
    open: boolean
    setOpen: Dispatch<SetStateAction<boolean>>
    close: () => void
    addDialogOpen: boolean
    openAddDialog: () => void
    closeAddDialog: () => void
  }
  tags: {
    options: ReadonlyArray<ProjectDocTagOption>
    activeFilter: DetailDocumentationTagFilter
    selectFilter: (tag: DetailDocumentationTagFilter) => void
    newLabel: string
    setNewLabel: Dispatch<SetStateAction<string>>
    renamingValue: string | null
    renamingLabel: string
    setRenamingLabel: Dispatch<SetStateAction<string>>
    saving: boolean
    beginRename: (option: ProjectDocTagOption) => void
    cancelRename: () => void
    create: () => Promise<void>
    saveRename: () => Promise<void>
    remove: (value: string) => Promise<void>
  }
  links: {
    allCount: number
    defaultLink: ProjectDocLink | undefined
    defaultLinkId: string | null
    filteredLinks: ProjectDocLink[]
    expandedLinkId: string | null
    draggingLinkId: string | null
    dragDisabled: boolean
    copiedFieldKey: string | null
    secretPreviewMap: Record<string, string | null>
    secretPreviewLoadingMap: Record<string, boolean>
    copyAccount: (linkId: string) => Promise<void>
    copySecret: (linkId: string) => Promise<void>
    revealSecret: (linkId: string) => Promise<void>
    toggleExpand: (linkId: string) => void
    open: (link: ProjectDocLink) => Promise<void>
    startDrag: (event: DragStartEvent) => void
    cancelDrag: (event: DragCancelEvent) => void
    endDrag: (event: DragEndEvent) => void
    setDefault: (linkId: string) => Promise<void>
    remove: (linkId: string) => Promise<void>
  }
  editing: DetailDocumentationEditState
}

function useDetailDocumentationCardState({
  docLinks,
  docTagOptions,
  docTagInput,
  setDocTagInput,
  setDocError,
  onAddDocTag,
  onRenameDocTag,
  onRemoveDocTag,
  onUpdateDocLink,
  onSetDefaultDocLink,
  onReorderDocLinks,
  onRemoveDocLink,
  onCopyDocLinkAccount,
  onCopyDocLinkSecret,
  onGetDocLinkSecret,
  onOpenDocLink,
  settingsOpen: settingsOpenProp,
  setSettingsOpen: setSettingsOpenProp,
}: UseDetailDocumentationCardStateOptions): UseDetailDocumentationCardStateResult {
  const { t } = useI18n()
  const safeTagOptions = useMemo(
    () => (docTagOptions.length > 0 ? docTagOptions : PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS),
    [docTagOptions]
  )
  const [settingsOpenState, setSettingsOpenState] = useState(false)
  const settingsOpen = settingsOpenProp ?? settingsOpenState
  const setSettingsOpen = setSettingsOpenProp ?? setSettingsOpenState
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null)
  const [editingKind, setEditingKind] = useState<ProjectDocLinkKind>('url')
  const [editingTitle, setEditingTitle] = useState('')
  const [editingUrl, setEditingUrl] = useState('')
  const [editingTag, setEditingTag] = useState('')
  const [editingNote, setEditingNote] = useState('')
  const [editingAccount, setEditingAccount] = useState('')
  const [editingSshHost, setEditingSshHost] = useState('')
  const [editingSshPort, setEditingSshPort] = useState('22')
  const [editingSshUsername, setEditingSshUsername] = useState('')
  const [editingSshShortcut, setEditingSshShortcut] = useState('')
  const [editingSshRoute, setEditingSshRoute] = useState<ProjectDocLinkSshRoute>('wsl')
  const [editingSecret, setEditingSecret] = useState('')
  const [editingSecretLoading, setEditingSecretLoading] = useState(false)
  const [expandedLinkId, setExpandedLinkId] = useState<string | null>(null)
  const [draggingLinkId, setDraggingLinkId] = useState<string | null>(null)
  const [clearEditingSecret, setClearEditingSecret] = useState(false)
  const [copiedFieldKey, setCopiedFieldKey] = useState<string | null>(null)
  const [secretPreviewMap, setSecretPreviewMap] = useState<Record<string, string | null>>({})
  const [secretPreviewLoadingMap, setSecretPreviewLoadingMap] = useState<Record<string, boolean>>({})
  const [activeTagFilter, setActiveTagFilter] = useState<DetailDocumentationTagFilter>('all')
  const [newTagLabel, setNewTagLabel] = useState('')
  const [renamingTagValue, setRenamingTagValue] = useState<string | null>(null)
  const [renamingTagLabel, setRenamingTagLabel] = useState('')
  const [tagSaving, setTagSaving] = useState(false)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const editSecretRequestRef = useRef(0)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>()

  const selectTagFilter = useCallback((tag: DetailDocumentationTagFilter) => {
    setActiveTagFilter(tag)
  }, [])

  const filteredDocLinks = useMemo(
    () => (
      activeTagFilter === 'all'
        ? docLinks
        : docLinks.filter((link) => normalizeProjectDocLinkTag(link.tag, safeTagOptions) === activeTagFilter)
    ),
    [activeTagFilter, docLinks, safeTagOptions]
  )

  useEffect(() => {
    return () => {
      clearTimeout(copiedTimerRef.current)
    }
  }, [])

  const startEdit = useCallback(async (link: ProjectDocLink) => {
    const requestId = ++editSecretRequestRef.current
    const normalizedKind = normalizeProjectDocLinkKind(link.kind)
    setEditingLinkId(link.id)
    setExpandedLinkId(link.id)
    setEditingKind(normalizedKind)
    setEditingTitle(link.title)
    setEditingUrl(link.url ?? '')
    setEditingTag(normalizeProjectDocLinkTag(link.tag, safeTagOptions))
    setEditingNote(link.note ?? '')
    setEditingAccount(link.account ?? '')
    setEditingSshHost(link.sshHost ?? '')
    setEditingSshPort(String(link.sshPort ?? 22))
    setEditingSshUsername(link.sshUsername ?? link.account ?? '')
    setEditingSshRoute(link.sshRoute === 'windows' ? 'windows' : 'wsl')
    const username = link.sshUsername ?? link.account ?? ''
    const target = buildSshDocLinkTarget(link.sshHost ?? '', link.sshPort)
    setEditingSshShortcut(username && target ? `${username}@${target}` : '')
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
  }, [onGetDocLinkSecret, safeTagOptions])

  const cancelEdit = useCallback(() => {
    editSecretRequestRef.current += 1
    setEditingLinkId(null)
    setEditingKind('url')
    setEditingTitle('')
    setEditingUrl('')
    setEditingTag('')
    setEditingNote('')
    setEditingAccount('')
    setEditingSshHost('')
    setEditingSshPort('22')
    setEditingSshUsername('')
    setEditingSshShortcut('')
    setEditingSshRoute('wsl')
    setEditingSecret('')
    setEditingSecretLoading(false)
    setClearEditingSecret(false)
    selectTagFilter('all')
  }, [safeTagOptions, selectTagFilter])

  useEffect(() => {
    if (editingKind !== 'ssh') return
    const parsed = parseSshShortcutInput(editingSshShortcut)
    if (!parsed) return
    if (parsed.username !== editingSshUsername) setEditingSshUsername(parsed.username)
    if (parsed.host !== editingSshHost) setEditingSshHost(parsed.host)
    const nextPort = String(parsed.port)
    if (nextPort !== editingSshPort) setEditingSshPort(nextPort)
  }, [editingKind, editingSshHost, editingSshPort, editingSshShortcut, editingSshUsername])

  const saveEdit = useCallback(async () => {
    if (!editingLinkId) return
    const ok = await onUpdateDocLink(
      editingLinkId,
      editingKind,
      editingTitle,
      editingUrl,
      editingTag,
      editingNote,
      editingAccount,
      editingSshHost,
      editingSshPort,
      editingSshUsername,
      editingSshRoute,
      editingSecret,
      clearEditingSecret
    )
    if (ok) {
      cancelEdit()
    }
  }, [
    cancelEdit,
    clearEditingSecret,
    editingAccount,
    editingKind,
    editingLinkId,
    editingNote,
    editingSecret,
    editingSshHost,
    editingSshPort,
    editingSshRoute,
    editingSshUsername,
    editingTag,
    editingTitle,
    editingUrl,
    onUpdateDocLink,
  ])

  const closeSettings = useCallback(() => {
    setSettingsOpen(false)
    setAddDialogOpen(false)
    cancelEdit()
  }, [cancelEdit, setSettingsOpen])

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

  const handleOpenLink = useCallback(async (link: ProjectDocLink) => {
    await onOpenDocLink(link)
  }, [onOpenDocLink])

  const handleCreateTag = useCallback(async () => {
    if (tagSaving) return
    setTagSaving(true)
    try {
      const result = await onAddDocTag(newTagLabel)
      if (!result.ok) {
        setDocError(result.message ?? t('documentation.addCategoryFailed'))
        return
      }
      setNewTagLabel('')
      setDocError(null)
    } finally {
      setTagSaving(false)
    }
  }, [newTagLabel, onAddDocTag, setDocError, t, tagSaving])

  const beginRenameTag = useCallback((option: ProjectDocTagOption) => {
    setRenamingTagValue(option.value)
    setRenamingTagLabel(option.label)
  }, [])

  const cancelRenameTag = useCallback(() => {
    setRenamingTagValue(null)
    setRenamingTagLabel('')
  }, [])

  const handleSaveRenameTag = useCallback(async () => {
    if (!renamingTagValue || tagSaving) return
    setTagSaving(true)
    try {
      const result = await onRenameDocTag(renamingTagValue, renamingTagLabel)
      if (!result.ok) {
        setDocError(result.message ?? t('documentation.renameCategoryFailed'))
        return
      }
      cancelRenameTag()
      setDocError(null)
    } finally {
      setTagSaving(false)
    }
  }, [cancelRenameTag, onRenameDocTag, renamingTagLabel, renamingTagValue, setDocError, t, tagSaving])

  const handleDeleteTag = useCallback(async (value: string) => {
    if (tagSaving) return
    setTagSaving(true)
    try {
      const result = await onRemoveDocTag(value)
      if (!result.ok) {
        setDocError(result.message ?? t('documentation.removeCategoryFailed'))
        return
      }
      if (activeTagFilter === value) {
        selectTagFilter('all')
      }
      if (docTagInput === value) {
        setDocTagInput('')
      }
      if (editingTag === value) {
        setEditingTag('')
      }
      setDocError(null)
    } finally {
      setTagSaving(false)
    }
  }, [
    activeTagFilter,
    docTagInput,
    editingTag,
    onRemoveDocTag,
    selectTagFilter,
    setDocError,
    setDocTagInput,
    t,
    tagSaving,
  ])

  useEffect(() => {
    if (!settingsOpen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (addDialogOpen) {
          setAddDialogOpen(false)
          return
        }
        closeSettings()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [addDialogOpen, closeSettings, settingsOpen])

  useEffect(() => {
    if (settingsOpen) return
    setAddDialogOpen(false)
  }, [settingsOpen])

  useEffect(() => {
    if (activeTagFilter === 'all') return
    const hasTagOption = safeTagOptions.some((option) => option.value === activeTagFilter)
    if (!hasTagOption) {
      selectTagFilter('all')
    }
  }, [activeTagFilter, safeTagOptions, selectTagFilter])

  useEffect(() => {
    if (renamingTagValue && !safeTagOptions.some((item) => item.value === renamingTagValue)) {
      cancelRenameTag()
    }
  }, [cancelRenameTag, renamingTagValue, safeTagOptions])

  return {
    settings: {
      open: settingsOpen,
      setOpen: setSettingsOpen,
      close: closeSettings,
      addDialogOpen,
      openAddDialog: () => setAddDialogOpen(true),
      closeAddDialog: () => setAddDialogOpen(false),
    },
    tags: {
      options: safeTagOptions,
      activeFilter: activeTagFilter,
      selectFilter: selectTagFilter,
      newLabel: newTagLabel,
      setNewLabel: setNewTagLabel,
      renamingValue: renamingTagValue,
      renamingLabel: renamingTagLabel,
      setRenamingLabel: setRenamingTagLabel,
      saving: tagSaving,
      beginRename: beginRenameTag,
      cancelRename: cancelRenameTag,
      create: handleCreateTag,
      saveRename: handleSaveRenameTag,
      remove: handleDeleteTag,
    },
    links: {
      allCount: docLinks.length,
      defaultLink: docLinks[0],
      defaultLinkId: docLinks[0]?.id ?? null,
      filteredLinks: filteredDocLinks,
      expandedLinkId,
      draggingLinkId,
      dragDisabled: editingLinkId !== null,
      copiedFieldKey,
      secretPreviewMap,
      secretPreviewLoadingMap,
      copyAccount: handleCopyAccount,
      copySecret: handleCopySecret,
      revealSecret: handleRevealSecret,
      toggleExpand: handleToggleExpand,
      open: handleOpenLink,
      startDrag: handleDragStart,
      cancelDrag: handleDragCancel,
      endDrag: handleDragEnd,
      setDefault: onSetDefaultDocLink,
      remove: onRemoveDocLink,
    },
    editing: {
      linkId: editingLinkId,
      kind: editingKind,
      setKind: setEditingKind,
      title: editingTitle,
      setTitle: setEditingTitle,
      url: editingUrl,
      setUrl: setEditingUrl,
      tag: editingTag,
      setTag: setEditingTag,
      note: editingNote,
      setNote: setEditingNote,
      account: editingAccount,
      setAccount: setEditingAccount,
      sshHost: editingSshHost,
      setSshHost: setEditingSshHost,
      sshPort: editingSshPort,
      setSshPort: setEditingSshPort,
      sshUsername: editingSshUsername,
      setSshUsername: setEditingSshUsername,
      sshShortcut: editingSshShortcut,
      setSshShortcut: setEditingSshShortcut,
      sshRoute: editingSshRoute,
      setSshRoute: setEditingSshRoute,
      secret: editingSecret,
      setSecret: setEditingSecret,
      secretLoading: editingSecretLoading,
      clearSecret: clearEditingSecret,
      setClearSecret: setClearEditingSecret,
      start: startEdit,
      cancel: cancelEdit,
      save: saveEdit,
    },
  }
}

export { useDetailDocumentationCardState }
