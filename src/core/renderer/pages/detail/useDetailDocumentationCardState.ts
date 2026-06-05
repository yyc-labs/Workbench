import type { DragCancelEvent, DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { ProjectDocLink, ProjectDocTagOption } from '../../../shared/types'
import {
  PROJECT_DOC_LINK_DEFAULT_TAG,
  PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS,
  PROJECT_DOC_LINK_FALLBACK_TAG,
  normalizeProjectDocLinkTag,
} from '../../lib/projectDocLinks'
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
  | 'settingsOpen'
  | 'setSettingsOpen'
>

export type UseDetailDocumentationCardStateResult = {
  settings: {
    open: boolean
    setOpen: Dispatch<SetStateAction<boolean>>
    close: () => void
    advancedOptionsOpen: boolean
    toggleAdvancedOptions: () => void
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
  settingsOpen: settingsOpenProp,
  setSettingsOpen: setSettingsOpenProp,
}: UseDetailDocumentationCardStateOptions): UseDetailDocumentationCardStateResult {
  const safeTagOptions = useMemo(
    () => (docTagOptions.length > 0 ? docTagOptions : PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS),
    [docTagOptions]
  )
  const [settingsOpenState, setSettingsOpenState] = useState(false)
  const settingsOpen = settingsOpenProp ?? settingsOpenState
  const setSettingsOpen = setSettingsOpenProp ?? setSettingsOpenState
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [editingUrl, setEditingUrl] = useState('')
  const [editingTag, setEditingTag] = useState(PROJECT_DOC_LINK_DEFAULT_TAG)
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
  const [activeTagFilter, setActiveTagFilter] = useState<DetailDocumentationTagFilter>('all')
  const [newTagLabel, setNewTagLabel] = useState('')
  const [renamingTagValue, setRenamingTagValue] = useState<string | null>(null)
  const [renamingTagLabel, setRenamingTagLabel] = useState('')
  const [tagSaving, setTagSaving] = useState(false)
  const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false)
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
    setEditingLinkId(link.id)
    setExpandedLinkId(link.id)
    setEditingTitle(link.title)
    setEditingUrl(link.url)
    setEditingTag(normalizeProjectDocLinkTag(link.tag, safeTagOptions))
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
  }, [onGetDocLinkSecret, safeTagOptions])

  const cancelEdit = useCallback(() => {
    editSecretRequestRef.current += 1
    setEditingLinkId(null)
    setEditingTitle('')
    setEditingUrl('')
    setEditingTag(normalizeProjectDocLinkTag(PROJECT_DOC_LINK_DEFAULT_TAG, safeTagOptions))
    setEditingNote('')
    setEditingAccount('')
    setEditingSecret('')
    setEditingSecretLoading(false)
    setClearEditingSecret(false)
    selectTagFilter('all')
  }, [safeTagOptions, selectTagFilter])

  const saveEdit = useCallback(async () => {
    if (!editingLinkId) return
    const ok = await onUpdateDocLink(
      editingLinkId,
      editingTitle,
      editingUrl,
      editingTag,
      editingNote,
      editingAccount,
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
    editingLinkId,
    editingNote,
    editingSecret,
    editingTag,
    editingTitle,
    editingUrl,
    onUpdateDocLink,
  ])

  const closeSettings = useCallback(() => {
    setSettingsOpen(false)
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

  const handleCreateTag = useCallback(async () => {
    if (tagSaving) return
    setTagSaving(true)
    try {
      const result = await onAddDocTag(newTagLabel)
      if (!result.ok) {
        setDocError(result.message ?? '新增分类失败')
        return
      }
      setNewTagLabel('')
      setDocError(null)
    } finally {
      setTagSaving(false)
    }
  }, [newTagLabel, onAddDocTag, setDocError, tagSaving])

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
        setDocError(result.message ?? '重命名分类失败')
        return
      }
      cancelRenameTag()
      setDocError(null)
    } finally {
      setTagSaving(false)
    }
  }, [cancelRenameTag, onRenameDocTag, renamingTagLabel, renamingTagValue, setDocError, tagSaving])

  const handleDeleteTag = useCallback(async (value: string) => {
    if (tagSaving) return
    setTagSaving(true)
    try {
      const result = await onRemoveDocTag(value)
      if (!result.ok) {
        setDocError(result.message ?? '删除分类失败')
        return
      }
      if (activeTagFilter === value) {
        selectTagFilter('all')
      }
      if (docTagInput === value) {
        setDocTagInput(PROJECT_DOC_LINK_FALLBACK_TAG)
      }
      if (editingTag === value) {
        setEditingTag(PROJECT_DOC_LINK_FALLBACK_TAG)
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
    tagSaving,
  ])

  useEffect(() => {
    if (!settingsOpen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeSettings()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [closeSettings, settingsOpen])

  useEffect(() => {
    if (settingsOpen) return
    setAdvancedOptionsOpen(false)
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
      advancedOptionsOpen,
      toggleAdvancedOptions: () => setAdvancedOptionsOpen((prev) => !prev),
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
      startDrag: handleDragStart,
      cancelDrag: handleDragCancel,
      endDrag: handleDragEnd,
      setDefault: onSetDefaultDocLink,
      remove: onRemoveDocLink,
    },
    editing: {
      linkId: editingLinkId,
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
