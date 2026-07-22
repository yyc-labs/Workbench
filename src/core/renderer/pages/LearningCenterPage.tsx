import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent as ReactChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type SyntheticEvent as ReactSyntheticEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { BrowserAiTaskRecord, LearningCategory, LearningNote, LearningNoteStatus, LearningNoteSummary, LearningSearchResult } from '../../shared/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useI18n } from '../i18n'
import { useAppStore } from '../stores/appStore'
import { LearningBrowserAiDialog } from './learning/browser-ai/LearningBrowserAiDialog'
import { LearningBrowserAiHistoryView } from './learning/browser-ai/LearningBrowserAiHistoryView'
import { LearningBrowserAiPreferencesDialog } from './learning/browser-ai/LearningBrowserAiPreferencesDialog'
import { LearningCenterHeader } from './learning/layout/LearningCenterHeader'
import { LearningSidebarGestureController } from './learning/layout/LearningSidebarGestureController'
import { LearningDeleteNoteDialog } from './learning/notes/LearningDeleteNoteDialog'
import { LearningEditorPanel } from './learning/notes/LearningEditorPanel'
import { LearningFrontmatterDialog } from './learning/notes/LearningFrontmatterDialog'
import { LearningMarkdownContextMenu } from './learning/notes/LearningMarkdownContextMenu'
import { LearningNoteInfoSidebar } from './learning/notes/LearningNoteInfoSidebar'
import { LearningNotesSidebar } from './learning/notes/LearningNotesSidebar'
import { LearningSidebarRailButton } from './learning/notes/LearningSidebarRailButton'
import { SkillManagementView } from './learning/skills/SkillManagementView'
import { createLearningEditorHistoryState, pushLearningEditorSnapshot, updateLearningEditorSnapshotSelection, type LearningEditorSnapshot } from './learning/notes/learningEditorHistory'
import { continueMarkdownList, indentMarkdownLines, outdentMarkdownLines } from './learning/notes/learningMarkdownEditor'
import { applyLearningMarkdownInsert, type LearningMarkdownInsertRequest } from './learning/notes/learningMarkdownTemplates'
import { type FrontmatterDialogMode, type LearningEditorContextMenuState, type LearningEditorDisplayMode, type SaveState } from './learning/notes/learningCenterTypes'
import { defaultNoteContent, emptySelectionState, findCategoryByName, normalizeTagInput } from './learning/notes/learningCenterUtils'
import { resolveLearningNoteLinks } from './learning/notes/learningNoteLinks'

const LEARNING_LEFT_SIDEBAR_COLLAPSED_STORAGE_KEY = 'app:learning-left-sidebar-collapsed'
const LEARNING_RIGHT_SIDEBAR_COLLAPSED_STORAGE_KEY = 'app:learning-right-sidebar-collapsed'
const LEARNING_EDITOR_DISPLAY_MODE_STORAGE_KEY = 'app:learning-editor-display-mode'
const LEARNING_EDITOR_HISTORY_LIMIT = 200
const LEARNING_DRAFT_STORAGE_PREFIX = 'app:learning-draft:'

type LearningDraft = Pick<LearningNote, 'title' | 'categoryId' | 'tags' | 'status' | 'contentMd'> & { savedAt: number }

function readLearningDraft(noteId: string): LearningDraft | null {
  try {
    const value = window.localStorage.getItem(`${LEARNING_DRAFT_STORAGE_PREFIX}${noteId}`)
    if (!value) return null
    const draft = JSON.parse(value) as Partial<LearningDraft>
    if (typeof draft.title !== 'string' || typeof draft.contentMd !== 'string' || !Array.isArray(draft.tags) || typeof draft.savedAt !== 'number') return null
    return { title: draft.title, categoryId: typeof draft.categoryId === 'string' ? draft.categoryId : undefined, tags: draft.tags.filter((tag): tag is string => typeof tag === 'string'), status: draft.status === 'organized' ? 'organized' : 'draft', contentMd: draft.contentMd, savedAt: draft.savedAt }
  } catch {
    return null
  }
}

export function LearningCenterPage() {
  const navigate = useNavigate()
  const { locale, t } = useI18n()
  const skills = useAppStore((state) => state.skills)
  const loadSkills = useAppStore((state) => state.loadSkills)
  const [notes, setNotes] = useState<LearningNoteSummary[]>([])
  const [categories, setCategories] = useState<LearningCategory[]>([])
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all')
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [selectedNote, setSelectedNote] = useState<LearningNote | null>(emptySelectionState)
  const [linkedNotes, setLinkedNotes] = useState<LearningNoteSummary[]>([])
  const [backlinks, setBacklinks] = useState<LearningNoteSummary[]>([])
  const [editorTitle, setEditorTitle] = useState('')
  const [editorTags, setEditorTags] = useState('')
  const [editorCategoryId, setEditorCategoryId] = useState<string>('')
  const [editorStatus, setEditorStatus] = useState<LearningNoteStatus>('draft')
  const [editorContent, setEditorContent] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<LearningSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [pendingDraft, setPendingDraft] = useState<{ note: LearningNote; draft: LearningDraft } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [categoryInput, setCategoryInput] = useState('')
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false)
  const [categoryCreateError, setCategoryCreateError] = useState<string | null>(null)
  const [isCreatingCategory, setIsCreatingCategory] = useState(false)
  const [categoryEditInput, setCategoryEditInput] = useState('')
  const [categoryEditError, setCategoryEditError] = useState<string | null>(null)
  const [isUpdatingCategory, setIsUpdatingCategory] = useState(false)
  const [isDeletingCategory, setIsDeletingCategory] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [categoryDeleteConfirm, setCategoryDeleteConfirm] = useState<{ id: string; name: string } | null>(null)
  const [frontmatterDialogOpen, setFrontmatterDialogOpen] = useState(false)
  const [frontmatterDialogMode, setFrontmatterDialogMode] = useState<FrontmatterDialogMode>('create')
  const [frontmatterTitle, setFrontmatterTitle] = useState('')
  const [frontmatterTags, setFrontmatterTags] = useState('')
  const [frontmatterCategoryInput, setFrontmatterCategoryInput] = useState('')
  const [frontmatterStatus, setFrontmatterStatus] = useState<LearningNoteStatus>('draft')
  const [frontmatterSubmitting, setFrontmatterSubmitting] = useState(false)
  const [frontmatterError, setFrontmatterError] = useState<string | null>(null)
  const [browserAiOpen, setBrowserAiOpen] = useState(false)
  const [browserAiPreferencesOpen, setBrowserAiPreferencesOpen] = useState(false)
  const [browserAiInitialRecord, setBrowserAiInitialRecord] = useState<BrowserAiTaskRecord | null>(null)
  const [activeView, setActiveView] = useState<'notes' | 'skills' | 'browser-tasks'>('notes')
  const [skillCreateRequest, setSkillCreateRequest] = useState(0)
  const [editorContextMenu, setEditorContextMenu] = useState<LearningEditorContextMenuState | null>(null)
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(LEARNING_LEFT_SIDEBAR_COLLAPSED_STORAGE_KEY) === '1'
  })
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    const stored = window.localStorage.getItem(LEARNING_RIGHT_SIDEBAR_COLLAPSED_STORAGE_KEY)
    return stored === null ? window.innerWidth < 1280 : stored === '1'
  })
  const [editorDisplayMode, setEditorDisplayMode] = useState<LearningEditorDisplayMode>(() => {
    if (typeof window === 'undefined') return 'split'
    const stored = window.localStorage.getItem(LEARNING_EDITOR_DISPLAY_MODE_STORAGE_KEY)
    return stored === 'edit' || stored === 'preview' ? stored : 'split'
  })
  const pageRootRef = useRef<HTMLDivElement | null>(null)
  const editorTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const editorHistoryRef = useRef<LearningEditorSnapshot[]>([])
  const editorHistoryIndexRef = useRef(-1)
  const saveVersionRef = useRef(0)
  const editorRevisionRef = useRef(0)
  const selectedMatchOffsetRef = useRef<number | undefined>()

  const closeEditorContextMenu = () => {
    setEditorContextMenu(null)
  }

  const filteredNotes = useMemo(() => {
    const searchMatches = searchQuery.trim() ? searchResults : notes
    return searchMatches.filter((note) => {
      if (selectedCategoryId === 'inbox') return !note.categoryId || note.status === 'draft'
      if (selectedCategoryId === 'drafts') return note.status === 'draft'
      if (selectedCategoryId === 'review') return note.status === 'draft' || note.updatedAt < Date.now() - 7 * 24 * 60 * 60 * 1000
      if (selectedCategoryId === 'recent') return true
      if (selectedCategoryId !== 'all' && note.categoryId !== selectedCategoryId) return false
      return true
    })
  }, [notes, searchQuery, searchResults, selectedCategoryId])

  const selectedManageCategory = useMemo(() => categories.find((item) => item.id === selectedCategoryId) ?? null, [categories, selectedCategoryId])

  const hasUnsavedChanges = useMemo(() => {
    if (!selectedNote) return false
    return editorTitle !== selectedNote.title || editorContent !== selectedNote.contentMd || editorCategoryId !== (selectedNote.categoryId ?? '') || editorStatus !== selectedNote.status || editorTags !== selectedNote.tags.join(', ')
  }, [editorCategoryId, editorContent, editorStatus, editorTags, editorTitle, selectedNote])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const [nextCategories, nextNotes] = await Promise.all([window.electronAPI.listLearningCategories(), window.electronAPI.listLearningNotes(), loadSkills()])
        setCategories(nextCategories)
        setNotes(nextNotes)
        const firstNoteId = nextNotes[0]?.id ?? null
        setSelectedNoteId(firstNoteId)
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [loadSkills])

  useEffect(() => {
    const query = searchQuery.trim()
    if (!query) {
      setSearchResults([])
      setSearchError(null)
      setSearching(false)
      return
    }
    let active = true
    const timeout = window.setTimeout(() => {
      setSearching(true)
      setSearchError(null)
      void window.electronAPI
        .searchLearningNotes(query)
        .then((results) => {
          if (active) setSearchResults(results)
        })
        .catch(() => {
          if (active) setSearchError(t('learning.notes.searchFailed'))
        })
        .finally(() => {
          if (active) setSearching(false)
        })
    }, 200)
    return () => {
      active = false
      window.clearTimeout(timeout)
    }
  }, [searchQuery, t])

  useEffect(() => {
    window.localStorage.setItem(LEARNING_LEFT_SIDEBAR_COLLAPSED_STORAGE_KEY, leftSidebarCollapsed ? '1' : '0')
  }, [leftSidebarCollapsed])

  useEffect(() => {
    window.localStorage.setItem(LEARNING_RIGHT_SIDEBAR_COLLAPSED_STORAGE_KEY, rightSidebarCollapsed ? '1' : '0')
  }, [rightSidebarCollapsed])

  useEffect(() => {
    window.localStorage.setItem(LEARNING_EDITOR_DISPLAY_MODE_STORAGE_KEY, editorDisplayMode)
  }, [editorDisplayMode])

  useEffect(() => {
    if (!selectedNoteId) {
      setSelectedNote(null)
      setEditorTitle('')
      setEditorTags('')
      setEditorCategoryId('')
      setEditorStatus('draft')
      setEditorContent('')
      const nextHistoryState = createLearningEditorHistoryState('')
      editorHistoryRef.current = nextHistoryState.history
      editorHistoryIndexRef.current = nextHistoryState.index
      return
    }

    let active = true
    const loadNote = async () => {
      const note = await window.electronAPI.getLearningNote(selectedNoteId)
      if (!active || !note) return
      setSelectedNote(note)
      setEditorTitle(note.title)
      setEditorTags(note.tags.join(', '))
      setEditorCategoryId(note.categoryId ?? '')
      setEditorStatus(note.status)
      setEditorContent(note.contentMd)
      setSaveState('idle')
      setSaveError(null)
      const nextHistoryState = createLearningEditorHistoryState(note.contentMd)
      editorHistoryRef.current = nextHistoryState.history
      editorHistoryIndexRef.current = nextHistoryState.index
      const draft = readLearningDraft(note.id)
      if (draft && draft.savedAt > note.updatedAt) setPendingDraft({ note, draft })
      const matchOffset = selectedMatchOffsetRef.current
      if (matchOffset !== undefined) {
        window.setTimeout(() => editorTextareaRef.current?.setSelectionRange(matchOffset, matchOffset + searchQuery.trim().length), 0)
      }
    }

    void loadNote()
    return () => {
      active = false
    }
  }, [selectedNoteId])

  useEffect(() => {
    if (!selectedNote) {
      setLinkedNotes([])
      setBacklinks([])
      return
    }
    let active = true
    setLinkedNotes(resolveLearningNoteLinks(editorContent, notes).filter((note) => note.id !== selectedNote.id))
    void Promise.all(notes.filter((note) => note.id !== selectedNote.id).map(async (summary) => ({ summary, note: await window.electronAPI.getLearningNote(summary.id) }))).then((candidates) => {
      if (!active) return
      setBacklinks(candidates.filter(({ note }) => note && resolveLearningNoteLinks(note.contentMd, [selectedNote]).length > 0).map(({ summary }) => summary))
    })
    return () => {
      active = false
    }
  }, [editorContent, notes, selectedNote])

  useEffect(() => {
    setCategoryEditInput(selectedManageCategory?.name ?? '')
    setCategoryEditError(null)
  }, [selectedManageCategory])

  useEffect(() => {
    if (!selectedNote || !hasUnsavedChanges) return
    if (saveState !== 'idle') {
      setSaveState('idle')
    }
    if (saveError) {
      setSaveError(null)
    }
  }, [hasUnsavedChanges, saveError, saveState, selectedNote])

  const syncUpdatedNote = (updated: LearningNote) => {
    setSelectedNote(updated)
    setEditorTitle(updated.title)
    setEditorTags(updated.tags.join(', '))
    setEditorCategoryId(updated.categoryId ?? '')
    setEditorStatus(updated.status)
    setEditorContent(updated.contentMd)
    setNotes((current) => [updated, ...current.filter((item) => item.id !== updated.id)])
  }

  useEffect(() => {
    editorRevisionRef.current += 1
  }, [editorCategoryId, editorContent, editorStatus, editorTags, editorTitle])

  const handleBrowserAiSaved = (saved: LearningNote) => {
    syncUpdatedNote(saved)
    setNotes((current) => [saved, ...current.filter((item) => item.id !== saved.id)])
    setSelectedNoteId(saved.id)
    setBrowserAiOpen(false)
  }

  const handleBrowserAiReload = (record: BrowserAiTaskRecord) => {
    setBrowserAiInitialRecord(record)
    setActiveView('notes')
    setBrowserAiOpen(true)
  }

  const handleSkillCreateRequestHandled = useCallback(() => {
    setSkillCreateRequest(0)
  }, [])

  const resetFrontmatterDialog = () => {
    setFrontmatterDialogOpen(false)
    setFrontmatterSubmitting(false)
    setFrontmatterError(null)
  }

  const openCreateDialog = () => {
    setFrontmatterDialogMode('create')
    setFrontmatterTitle('')
    setFrontmatterTags('')
    setFrontmatterCategoryInput(selectedManageCategory?.name ?? '')
    setFrontmatterStatus('draft')
    setFrontmatterError(null)
    setFrontmatterDialogOpen(true)
  }

  const openEditDialog = () => {
    if (!selectedNote) return
    setFrontmatterDialogMode('edit')
    setFrontmatterTitle(editorTitle)
    setFrontmatterTags(editorTags)
    setFrontmatterCategoryInput(categories.find((item) => item.id === editorCategoryId)?.name ?? '')
    setFrontmatterStatus(editorStatus)
    setFrontmatterError(null)
    setFrontmatterDialogOpen(true)
  }

  const resolveFrontmatterCategoryId = async (): Promise<string | undefined> => {
    const name = frontmatterCategoryInput.trim()
    if (!name) return undefined

    const existing = findCategoryByName(categories, name)
    if (existing) return existing.id

    const nextCategories = await window.electronAPI.createLearningCategory({ name })
    setCategories(nextCategories)
    return findCategoryByName(nextCategories, name)?.id
  }

  const handleSubmitFrontmatter = async () => {
    const nextTitle = frontmatterTitle.trim()
    if (!nextTitle) {
      setFrontmatterError(t('learning.page.titleRequired'))
      return
    }

    setFrontmatterSubmitting(true)
    setFrontmatterError(null)
    try {
      const resolvedCategoryId = await resolveFrontmatterCategoryId()
      if (frontmatterDialogMode === 'create') {
        const created = await window.electronAPI.createLearningNote({ title: nextTitle, categoryId: resolvedCategoryId, tags: normalizeTagInput(frontmatterTags), status: frontmatterStatus, contentMd: defaultNoteContent(nextTitle) })
        setNotes((current) => [created, ...current.filter((item) => item.id !== created.id)])
        setSelectedNoteId(created.id)
        resetFrontmatterDialog()
        return
      }

      if (!selectedNoteId) return
      const updated = await window.electronAPI.updateLearningNote({ noteId: selectedNoteId, title: nextTitle, categoryId: resolvedCategoryId, tags: normalizeTagInput(frontmatterTags), status: frontmatterStatus, contentMd: editorContent })
      syncUpdatedNote(updated)
      setSaveState('saved')
      resetFrontmatterDialog()
    } catch (error) {
      const message = error instanceof Error ? error.message : t('learning.page.saveFailed')
      setFrontmatterError(message)
      if (frontmatterDialogMode === 'edit') {
        setSaveState('error')
        setSaveError(message)
      }
    } finally {
      setFrontmatterSubmitting(false)
    }
  }

  const handleSave = async () => {
    if (!selectedNoteId) return
    const version = ++saveVersionRef.current
    const revision = editorRevisionRef.current
    const payload = { noteId: selectedNoteId, title: editorTitle, categoryId: editorCategoryId || undefined, tags: normalizeTagInput(editorTags), status: editorStatus, contentMd: editorContent }
    setSaving(true)
    setSaveError(null)
    try {
      const updated = await window.electronAPI.updateLearningNote(payload)
      if (version === saveVersionRef.current && revision === editorRevisionRef.current) {
        syncUpdatedNote(updated)
        window.localStorage.removeItem(`${LEARNING_DRAFT_STORAGE_PREFIX}${updated.id}`)
        setSaveState('saved')
      } else {
        setNotes((current) => [updated, ...current.filter((item) => item.id !== updated.id)])
      }
    } catch (error) {
      setSaveState('error')
      setSaveError(error instanceof Error ? error.message : t('learning.page.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleMarkReviewed = async () => {
    if (!selectedNoteId) return
    const updated = await window.electronAPI.updateLearningNote({ noteId: selectedNoteId, title: editorTitle, categoryId: editorCategoryId || undefined, tags: normalizeTagInput(editorTags), status: editorStatus, contentMd: editorContent })
    syncUpdatedNote(updated)
    setSaveState('saved')
  }

  useEffect(() => {
    if (!selectedNote || !hasUnsavedChanges) return
    const draft: LearningDraft = { title: editorTitle, categoryId: editorCategoryId || undefined, tags: normalizeTagInput(editorTags), status: editorStatus, contentMd: editorContent, savedAt: Date.now() }
    window.localStorage.setItem(`${LEARNING_DRAFT_STORAGE_PREFIX}${selectedNote.id}`, JSON.stringify(draft))
    const timeout = window.setTimeout(() => void handleSave(), 1000)
    return () => window.clearTimeout(timeout)
  }, [editorCategoryId, editorContent, editorStatus, editorTags, editorTitle, hasUnsavedChanges, selectedNote])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const activeElement = document.activeElement
      const isTextEntryTarget = activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement || activeElement instanceof HTMLSelectElement || Boolean(activeElement?.closest('[contenteditable="true"]'))

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (!selectedNoteId || !hasUnsavedChanges || saving) return
        void handleSave()
        return
      }

      if (isTextEntryTarget) return

      if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowLeft') {
        event.preventDefault()
        closeEditorContextMenu()
        setLeftSidebarCollapsed((current) => !current)
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowRight') {
        event.preventDefault()
        closeEditorContextMenu()
        setRightSidebarCollapsed((current) => !current)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hasUnsavedChanges, saving, selectedNoteId, editorTitle, editorContent, editorCategoryId, editorStatus, editorTags])

  const handleCreateCategory = async () => {
    const name = categoryInput.trim()
    if (!name) return
    setIsCreatingCategory(true)
    setCategoryCreateError(null)
    try {
      const next = await window.electronAPI.createLearningCategory({ name })
      setCategories(next)
      setCategoryInput('')
      if (!selectedManageCategory) {
        const created = findCategoryByName(next, name)
        if (created) {
          setSelectedCategoryId(created.id)
        }
      }
    } catch (error) {
      setCategoryCreateError(error instanceof Error ? error.message : t('learning.page.createCategoryFailed'))
    } finally {
      setIsCreatingCategory(false)
    }
  }

  const handleRenameCategory = async () => {
    if (!selectedManageCategory) return
    const name = categoryEditInput.trim()
    if (!name) {
      setCategoryEditError(t('learning.page.categoryNameRequired'))
      return
    }
    setIsUpdatingCategory(true)
    setCategoryEditError(null)
    try {
      const next = await window.electronAPI.updateLearningCategory({ categoryId: selectedManageCategory.id, name })
      setCategories(next)
    } catch (error) {
      setCategoryEditError(error instanceof Error ? error.message : t('learning.page.renameCategoryFailed'))
    } finally {
      setIsUpdatingCategory(false)
    }
  }

  const handleDeleteCategory = () => {
    if (!selectedManageCategory || isDeletingCategory) return
    setCategoryEditError(null)
    setCategoryDeleteConfirm({ id: selectedManageCategory.id, name: selectedManageCategory.name })
  }

  const confirmDeleteCategory = async () => {
    const pendingCategory = categoryDeleteConfirm
    if (!pendingCategory) return
    setIsDeletingCategory(true)
    setCategoryEditError(null)
    try {
      const next = await window.electronAPI.deleteLearningCategory(pendingCategory.id)
      setCategories(next)
      setSelectedCategoryId('all')
      setNotes((current) => current.map((note) => (note.categoryId === pendingCategory.id ? { ...note, categoryId: undefined } : note)))
      setSelectedNote((current) => (current && current.categoryId === pendingCategory.id ? { ...current, categoryId: undefined } : current))
      setEditorCategoryId((current) => (current === pendingCategory.id ? '' : current))
      setFrontmatterCategoryInput((current) => (current.trim().toLowerCase() === pendingCategory.name.trim().toLowerCase() ? '' : current))
      setCategoryDeleteConfirm(null)
    } catch (error) {
      setCategoryEditError(error instanceof Error ? error.message : t('learning.page.deleteCategoryFailed'))
    } finally {
      setIsDeletingCategory(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedNoteId) return
    setIsDeleting(true)
    try {
      const ok = await window.electronAPI.deleteLearningNote(selectedNoteId)
      if (!ok) return
      window.localStorage.removeItem(`${LEARNING_DRAFT_STORAGE_PREFIX}${selectedNoteId}`)
      const nextNotes = notes.filter((item) => item.id !== selectedNoteId)
      setNotes(nextNotes)
      setSelectedNoteId(nextNotes[0]?.id ?? null)
      setDeleteConfirmOpen(false)
    } finally {
      setIsDeleting(false)
    }
  }

  const pushEditorSnapshot = (snapshot: LearningEditorSnapshot) => {
    const nextHistoryState = pushLearningEditorSnapshot({ history: editorHistoryRef.current, index: editorHistoryIndexRef.current }, snapshot, LEARNING_EDITOR_HISTORY_LIMIT)
    editorHistoryRef.current = nextHistoryState.history
    editorHistoryIndexRef.current = nextHistoryState.index
  }

  const syncEditorSnapshotSelection = (selectionStart: number, selectionEnd: number) => {
    const nextHistoryState = updateLearningEditorSnapshotSelection({ history: editorHistoryRef.current, index: editorHistoryIndexRef.current }, selectionStart, selectionEnd)
    editorHistoryRef.current = nextHistoryState.history
    editorHistoryIndexRef.current = nextHistoryState.index
  }

  const restoreEditorSnapshot = (snapshot: LearningEditorSnapshot) => {
    const textarea = editorTextareaRef.current
    if (!textarea) return
    setEditorContent(snapshot.value)
    window.setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd)
    }, 0)
  }

  const applyEditorEdit = (textarea: HTMLTextAreaElement, previousValue: string, nextValue: string, nextSelectionStart: number, nextSelectionEnd: number) => {
    let prefixLength = 0
    const maxPrefixLength = Math.min(previousValue.length, nextValue.length)
    while (prefixLength < maxPrefixLength && previousValue[prefixLength] === nextValue[prefixLength]) {
      prefixLength += 1
    }

    let previousSuffixLength = previousValue.length
    let nextSuffixLength = nextValue.length
    while (previousSuffixLength > prefixLength && nextSuffixLength > prefixLength && previousValue[previousSuffixLength - 1] === nextValue[nextSuffixLength - 1]) {
      previousSuffixLength -= 1
      nextSuffixLength -= 1
    }

    const replacement = nextValue.slice(prefixLength, nextSuffixLength)
    textarea.setRangeText(replacement, prefixLength, previousSuffixLength, 'preserve')
    textarea.setSelectionRange(nextSelectionStart, nextSelectionEnd)
    setEditorContent(textarea.value)
    pushEditorSnapshot({ value: textarea.value, selectionStart: nextSelectionStart, selectionEnd: nextSelectionEnd })
  }

  const handleEditorContextMenu = (event: ReactMouseEvent<HTMLTextAreaElement>) => {
    event.preventDefault()
    const target = event.currentTarget
    setEditorContextMenu({ x: event.clientX, y: event.clientY, selectionStart: target.selectionStart ?? 0, selectionEnd: target.selectionEnd ?? 0 })
  }

  const handleApplyMarkdownInsert = (request: LearningMarkdownInsertRequest) => {
    const textarea = editorTextareaRef.current
    if (!textarea) {
      closeEditorContextMenu()
      return
    }

    const selectionStart = editorContextMenu?.selectionStart ?? textarea.selectionStart ?? 0
    const selectionEnd = editorContextMenu?.selectionEnd ?? textarea.selectionEnd ?? selectionStart
    syncEditorSnapshotSelection(selectionStart, selectionEnd)
    const result = applyLearningMarkdownInsert(editorContent, selectionStart, selectionEnd, request, locale)
    applyEditorEdit(textarea, editorContent, result.value, result.selectionStart, result.selectionEnd)
    closeEditorContextMenu()
    textarea.focus()
  }

  const handleEditorSelectionSync = (event: ReactSyntheticEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget
    syncEditorSnapshotSelection(textarea.selectionStart ?? 0, textarea.selectionEnd ?? textarea.selectionStart ?? 0)
  }

  const handleEditorKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget
    const selectionStart = textarea.selectionStart ?? 0
    const selectionEnd = textarea.selectionEnd ?? selectionStart
    const isModKey = event.metaKey || event.ctrlKey
    syncEditorSnapshotSelection(selectionStart, selectionEnd)

    if (isModKey && !event.shiftKey && event.key.toLowerCase() === 'z') {
      const nextIndex = editorHistoryIndexRef.current - 1
      if (nextIndex < 0) return
      event.preventDefault()
      editorHistoryIndexRef.current = nextIndex
      const snapshot = editorHistoryRef.current[nextIndex]
      if (snapshot) restoreEditorSnapshot(snapshot)
      return
    }

    if ((isModKey && event.key.toLowerCase() === 'y') || (isModKey && event.shiftKey && event.key.toLowerCase() === 'z')) {
      const nextIndex = editorHistoryIndexRef.current + 1
      if (nextIndex >= editorHistoryRef.current.length) return
      event.preventDefault()
      editorHistoryIndexRef.current = nextIndex
      const snapshot = editorHistoryRef.current[nextIndex]
      if (snapshot) restoreEditorSnapshot(snapshot)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      if (editorContextMenu) {
        closeEditorContextMenu()
        textarea.focus()
        return
      }
      textarea.blur()
      return
    }

    if (event.key === 'Tab') {
      event.preventDefault()
      const result = event.shiftKey ? outdentMarkdownLines(editorContent, selectionStart, selectionEnd) : indentMarkdownLines(editorContent, selectionStart, selectionEnd)
      applyEditorEdit(textarea, editorContent, result.value, result.selectionStart, result.selectionEnd)
      textarea.focus()
      return
    }

    if (event.key === 'Enter') {
      const result = continueMarkdownList(editorContent, selectionStart, selectionEnd)
      if (!result) return
      event.preventDefault()
      applyEditorEdit(textarea, editorContent, result.value, result.selectionStart, result.selectionEnd)
      textarea.focus()
    }
  }

  const handleEditorChange = (event: ReactChangeEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget
    setEditorContent(textarea.value)
    pushEditorSnapshot({ value: textarea.value, selectionStart: textarea.selectionStart ?? textarea.value.length, selectionEnd: textarea.selectionEnd ?? textarea.value.length })
  }

  const saveButtonVariant = saveState === 'error' ? 'destructive' : hasUnsavedChanges ? 'default' : 'outline'
  const saveButtonLabel = saving ? t('common.saving') : saveState === 'error' ? t('learning.page.retrySave') : hasUnsavedChanges ? t('learning.page.saveChanges') : t('learning.page.saved')
  const saveButtonDisabled = saving || (!hasUnsavedChanges && saveState !== 'error')
  const layoutGridColumns = useMemo(() => {
    if (!leftSidebarCollapsed && !rightSidebarCollapsed) return '284px minmax(0,1fr) 288px'
    if (!leftSidebarCollapsed && rightSidebarCollapsed) return '284px minmax(0,1fr)'
    if (leftSidebarCollapsed && !rightSidebarCollapsed) return 'minmax(0,1fr) 288px'
    return 'minmax(0,1fr)'
  }, [leftSidebarCollapsed, rightSidebarCollapsed])
  const bothSidebarsCollapsed = leftSidebarCollapsed && rightSidebarCollapsed
  const selectedCategoryName = categories.find((category) => category.id === (selectedNote?.categoryId ?? selectedCategoryId))?.name ?? t('common.uncategorized')

  return (
    <div ref={pageRootRef} className="flex h-full min-h-0 flex-col px-6 pb-6 pt-5 sm:px-8">
      <LearningSidebarGestureController pageRootRef={pageRootRef} onBeforeToggle={closeEditorContextMenu} onToggleLeftSidebar={() => setLeftSidebarCollapsed((current) => !current)} onToggleRightSidebar={() => setRightSidebarCollapsed((current) => !current)} />
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1480px] flex-col gap-4">
        <LearningCenterHeader
          onBack={() => navigate('/')}
          onCreateNote={openCreateDialog}
          onCreateSkill={() => {
            setActiveView('skills')
            setSkillCreateRequest((current) => current + 1)
          }}
          view={activeView}
          onViewChange={setActiveView}
          onOpenBrowserAi={() => {
            setBrowserAiInitialRecord(null)
            setBrowserAiOpen(true)
          }}
          onOpenBrowserAiPreferences={() => setBrowserAiPreferencesOpen(true)}
        />

        {activeView === 'skills' ? (
          <SkillManagementView createRequest={skillCreateRequest} onCreateRequestHandled={handleSkillCreateRequestHandled} />
        ) : activeView === 'browser-tasks' ? (
          <LearningBrowserAiHistoryView currentNote={selectedNote} onReload={handleBrowserAiReload} onSaved={handleBrowserAiSaved} />
        ) : (
          <div
            className={`learning-notes-grid relative grid min-h-0 flex-1 gap-3 transition-[grid-template-columns] duration-200 ${rightSidebarCollapsed ? 'learning-right-collapsed' : 'learning-right-open'}`}
            data-left-collapsed={leftSidebarCollapsed ? 'true' : 'false'}
            style={{ gridTemplateColumns: layoutGridColumns }}
          >
            {leftSidebarCollapsed ? <LearningSidebarRailButton side="left" collapsed onClick={() => setLeftSidebarCollapsed(false)} className="absolute left-0 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2" /> : null}
            {rightSidebarCollapsed ? <LearningSidebarRailButton side="right" collapsed onClick={() => setRightSidebarCollapsed(false)} className="absolute right-0 top-1/2 z-20 translate-x-1/2 -translate-y-1/2" /> : null}

            {!leftSidebarCollapsed ? (
              <LearningNotesSidebar
                categories={categories}
                categoryCreateError={categoryCreateError}
                categoryEditError={categoryEditError}
                categoryEditInput={categoryEditInput}
                categoryInput={categoryInput}
                categoryManagerOpen={categoryManagerOpen}
                filteredNotes={filteredNotes}
                isCreatingCategory={isCreatingCategory}
                isDeletingCategory={isDeletingCategory}
                isUpdatingCategory={isUpdatingCategory}
                loading={loading}
                searching={searching}
                searchError={searchError}
                searchQuery={searchQuery}
                selectedCategoryId={selectedCategoryId}
                selectedManageCategory={selectedManageCategory}
                selectedNoteId={selectedNoteId}
                onCategoryEditInputChange={setCategoryEditInput}
                onCategoryInputChange={setCategoryInput}
                onClearSearch={() => setSearchQuery('')}
                onCollapse={() => setLeftSidebarCollapsed(true)}
                onCreateCategory={handleCreateCategory}
                onDeleteCategory={handleDeleteCategory}
                onRenameCategory={handleRenameCategory}
                onSearchQueryChange={setSearchQuery}
                onSelectCategory={setSelectedCategoryId}
                onSelectNote={(noteId, matchOffset) => {
                  selectedMatchOffsetRef.current = matchOffset
                  setSelectedNoteId(noteId)
                }}
                onToggleCategoryManager={() => setCategoryManagerOpen((current) => !current)}
              />
            ) : null}

            <LearningEditorPanel
              bothSidebarsCollapsed={bothSidebarsCollapsed}
              editorContent={editorContent}
              editorDisplayMode={editorDisplayMode}
              editorTextareaRef={editorTextareaRef}
              editorTitle={editorTitle}
              hasUnsavedChanges={hasUnsavedChanges}
              loading={loading || Boolean(selectedNoteId && !selectedNote)}
              saveButtonDisabled={saveButtonDisabled}
              saveButtonLabel={saveButtonLabel}
              saveButtonVariant={saveButtonVariant}
              saveError={saveError}
              saveState={saveState}
              saving={saving}
              selectedNote={selectedNote}
              selectedCategoryName={selectedCategoryName}
              leftSidebarCollapsed={leftSidebarCollapsed}
              rightSidebarCollapsed={rightSidebarCollapsed}
              onEditorChange={handleEditorChange}
              onEditorContextMenu={handleEditorContextMenu}
              onEditorDisplayModeChange={setEditorDisplayMode}
              onEditorKeyDown={handleEditorKeyDown}
              onEditorSelectionSync={handleEditorSelectionSync}
              onEditorTitleChange={setEditorTitle}
              onCreateNote={openCreateDialog}
              onOpenNotesSidebar={() => setLeftSidebarCollapsed(false)}
              onToggleLeftSidebar={() => setLeftSidebarCollapsed((current) => !current)}
              onToggleRightSidebar={() => setRightSidebarCollapsed((current) => !current)}
              onOpenBrowserAiPreferences={() => setBrowserAiPreferencesOpen(true)}
              onSave={handleSave}
            />

            {!rightSidebarCollapsed ? (
              <LearningNoteInfoSidebar
                categories={categories}
                editorCategoryId={editorCategoryId}
                editorStatus={editorStatus}
                editorTags={editorTags}
                editorTitle={editorTitle}
                hasUnsavedChanges={hasUnsavedChanges}
                saveError={saveError}
                saveState={saveState}
                selectedNote={selectedNote}
                selectedNoteId={selectedNoteId}
                linkedNotes={linkedNotes}
                backlinks={backlinks}
                onCollapse={() => setRightSidebarCollapsed(true)}
                onOpenDeleteConfirm={() => setDeleteConfirmOpen(true)}
                onOpenEditDialog={openEditDialog}
                onMarkReviewed={() => void handleMarkReviewed()}
                onSelectLinkedNote={(noteId) => {
                  selectedMatchOffsetRef.current = undefined
                  setSelectedNoteId(noteId)
                }}
              />
            ) : null}
          </div>
        )}
      </div>

      {editorContextMenu ? <LearningMarkdownContextMenu x={editorContextMenu.x} y={editorContextMenu.y} onApply={handleApplyMarkdownInsert} onClose={closeEditorContextMenu} /> : null}

      <LearningFrontmatterDialog
        categories={categories}
        categoryInput={frontmatterCategoryInput}
        error={frontmatterError}
        mode={frontmatterDialogMode}
        open={frontmatterDialogOpen}
        status={frontmatterStatus}
        submitting={frontmatterSubmitting}
        tags={frontmatterTags}
        title={frontmatterTitle}
        onCategoryInputChange={setFrontmatterCategoryInput}
        onClose={resetFrontmatterDialog}
        onStatusChange={setFrontmatterStatus}
        onSubmit={handleSubmitFrontmatter}
        onTagsChange={setFrontmatterTags}
        onTitleChange={setFrontmatterTitle}
      />

      <LearningDeleteNoteDialog isDeleting={isDeleting} open={deleteConfirmOpen} selectedNote={selectedNote} onClose={() => setDeleteConfirmOpen(false)} onDelete={handleDelete} />

      <ConfirmDialog
        open={Boolean(pendingDraft)}
        onClose={() => {
          if (pendingDraft) {
            window.localStorage.removeItem(`${LEARNING_DRAFT_STORAGE_PREFIX}${pendingDraft.note.id}`)
            setPendingDraft(null)
          }
        }}
        onConfirm={() => {
          if (!pendingDraft) return
          const { draft } = pendingDraft
          setEditorTitle(draft.title)
          setEditorTags(draft.tags.join(', '))
          setEditorCategoryId(draft.categoryId ?? '')
          setEditorStatus(draft.status)
          setEditorContent(draft.contentMd)
          setPendingDraft(null)
        }}
        ariaLabel={t('learning.page.restoreDraftTitle')}
        title={t('learning.page.restoreDraftTitle')}
        description={t('learning.page.restoreDraftDescription')}
        confirmLabel={t('learning.page.restoreDraft')}
      />

      <ConfirmDialog
        open={Boolean(categoryDeleteConfirm)}
        onClose={() => setCategoryDeleteConfirm(null)}
        onConfirm={confirmDeleteCategory}
        ariaLabel={t('learning.notes.deleteCategory')}
        title={t('learning.notes.deleteCategory')}
        description={t('learning.page.deleteCategoryConfirm', { value: categoryDeleteConfirm?.name ?? '' })}
        confirmLabel={t('common.delete')}
        confirmVariant="destructive"
        busy={isDeletingCategory}
      >
        {categoryEditError ? <p className="text-sm text-[color:var(--color-destructive)]">{categoryEditError}</p> : null}
      </ConfirmDialog>

      <LearningBrowserAiDialog categories={categories} currentNote={selectedNote} skills={skills} notes={notes} initialRecord={browserAiInitialRecord} onClose={() => setBrowserAiOpen(false)} onSaved={handleBrowserAiSaved} open={browserAiOpen} />

      <LearningBrowserAiPreferencesDialog categories={categories} notes={notes} skills={skills} onClose={() => setBrowserAiPreferencesOpen(false)} open={browserAiPreferencesOpen} />
    </div>
  )
}
