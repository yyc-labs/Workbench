import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowLeft,
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  Pencil,
  FolderPlus,
  NotebookPen,
  Plus,
  Save,
  Search,
  Tags,
  Trash2,
  X,
} from 'lucide-react'
import type { LearningCategory, LearningNote, LearningNoteStatus, LearningNoteSummary } from '../../shared/types'
import { ModalShell } from '../components/ModalShell'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Combobox, type ComboboxOption } from '../components/ui/combobox'
import { Input } from '../components/ui/input'
import { ScrollArea } from '../components/ui/scroll-area'
import { Select, type SelectOption } from '../components/ui/select'
import { useI18n } from '../i18n'
import {
  createMarkdownComponents,
  shouldDisableMarkdownSyntaxHighlight,
} from './code/code.markdown'
import { remarkBoxDrawingTables } from './code/code.markdownBoxTables'
import { LearningMarkdownContextMenu } from './learning/LearningMarkdownContextMenu'
import {
  createLearningEditorHistoryState,
  pushLearningEditorSnapshot,
  updateLearningEditorSnapshotSelection,
  type LearningEditorSnapshot,
} from './learning/learningEditorHistory'
import {
  applyLearningMarkdownInsert,
  type LearningMarkdownInsertRequest,
} from './learning/learningMarkdownTemplates'
import {
  continueMarkdownList,
  indentMarkdownLines,
  outdentMarkdownLines,
} from './learning/learningMarkdownEditor'

type SaveState = 'idle' | 'saved' | 'error'
type GesturePoint = { x: number; y: number }

type FrontmatterDialogMode = 'create' | 'edit'
type LearningEditorDisplayMode = 'split' | 'preview'
type LearningEditorContextMenuState = {
  x: number
  y: number
  selectionStart: number
  selectionEnd: number
}
type LearningSidebarGestureOverlayState = {
  visible: boolean
  status: 'pending' | 'ready' | 'invalid'
  action: 'left' | 'right' | null
  points: GesturePoint[]
  cursor: GesturePoint | null
}

const LEARNING_LEFT_SIDEBAR_COLLAPSED_STORAGE_KEY = 'app:learning-left-sidebar-collapsed'
const LEARNING_RIGHT_SIDEBAR_COLLAPSED_STORAGE_KEY = 'app:learning-right-sidebar-collapsed'
const LEARNING_EDITOR_DISPLAY_MODE_STORAGE_KEY = 'app:learning-editor-display-mode'
const LEARNING_EDITOR_HISTORY_LIMIT = 200
const LEARNING_SIDEBAR_GESTURE_ACTIVATE_DISTANCE = 8
const LEARNING_SIDEBAR_GESTURE_SAMPLE_MIN_DISTANCE = 6
const LEARNING_SIDEBAR_GESTURE_MAX_POINTS = 96
const LEARNING_SIDEBAR_GESTURE_HORIZONTAL_THRESHOLD = 72
const LEARNING_SIDEBAR_GESTURE_ANGLE_RATIO = 1.25
const LEARNING_GESTURE_ACTIVE_CLASS_NAME = 'gesture-active'
const EMPTY_LEARNING_SIDEBAR_GESTURE_OVERLAY: LearningSidebarGestureOverlayState = {
  visible: false,
  status: 'pending',
  action: null,
  points: [],
  cursor: null,
}

function normalizeTagInput(value: string): string[] {
  return [...new Set(
    value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
  )]
}

function findCategoryByName(categories: LearningCategory[], name: string): LearningCategory | undefined {
  const normalizedName = name.trim().toLowerCase()
  if (!normalizedName) return undefined
  return categories.find((category) => category.name.trim().toLowerCase() === normalizedName)
}

function emptySelectionState(): LearningNote | null {
  return null
}

function defaultNoteContent(title: string): string {
  const normalizedTitle = title.trim() || '新学习记录'
  return [
    `# ${normalizedTitle}`,
    '',
    '今天学习到：',
    '',
    '1. ',
    '2. ',
    '3. ',
  ].join('\n')
}

function resolveLearningSidebarGestureOverlay(dx: number, dy: number): Pick<LearningSidebarGestureOverlayState, 'status' | 'action'> {
  const absX = Math.abs(dx)
  const absY = Math.abs(dy)

  if (absX >= LEARNING_SIDEBAR_GESTURE_HORIZONTAL_THRESHOLD && absX >= absY * LEARNING_SIDEBAR_GESTURE_ANGLE_RATIO) {
    return {
      status: 'ready',
      action: dx < 0 ? 'right' : 'left',
    }
  }

  if (absY > absX * 1.05 && absY >= LEARNING_SIDEBAR_GESTURE_ACTIVATE_DISTANCE * 2) {
    return {
      status: 'invalid',
      action: null,
    }
  }

  if (absX < LEARNING_SIDEBAR_GESTURE_HORIZONTAL_THRESHOLD * 0.45) {
    return {
      status: 'pending',
      action: dx < 0 ? 'right' : 'left',
    }
  }

  return {
    status: 'invalid',
    action: dx < 0 ? 'right' : 'left',
  }
}

function LearningSidebarRailButton({
  side,
  collapsed,
  onClick,
  className,
}: {
  side: 'left' | 'right'
  collapsed: boolean
  onClick: () => void
  className: string
}) {
  const label = side === 'left'
    ? (collapsed ? '展开左侧学习目录' : '收起左侧学习目录')
    : (collapsed ? '展开右侧笔记信息' : '收起右侧笔记信息')
  const Icon = side === 'left'
    ? (collapsed ? ChevronRight : ChevronLeft)
    : (collapsed ? ChevronLeft : ChevronRight)

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={`h-8 w-8 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-card)]/96 shadow-[0_8px_20px_rgba(15,23,42,0.10)] backdrop-blur-md ${className}`}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <Icon className="h-3.5 w-3.5" />
    </Button>
  )
}

export function LearningCenterPage() {
  const navigate = useNavigate()
  const { t, formatDateTime } = useI18n()
  const [notes, setNotes] = useState<LearningNoteSummary[]>([])
  const [categories, setCategories] = useState<LearningCategory[]>([])
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all')
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [selectedNote, setSelectedNote] = useState<LearningNote | null>(emptySelectionState)
  const [editorTitle, setEditorTitle] = useState('')
  const [editorTags, setEditorTags] = useState('')
  const [editorCategoryId, setEditorCategoryId] = useState<string>('')
  const [editorStatus, setEditorStatus] = useState<LearningNoteStatus>('draft')
  const [editorContent, setEditorContent] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [categoryInput, setCategoryInput] = useState('')
  const [categoryCreateError, setCategoryCreateError] = useState<string | null>(null)
  const [isCreatingCategory, setIsCreatingCategory] = useState(false)
  const [categoryEditInput, setCategoryEditInput] = useState('')
  const [categoryEditError, setCategoryEditError] = useState<string | null>(null)
  const [isUpdatingCategory, setIsUpdatingCategory] = useState(false)
  const [isDeletingCategory, setIsDeletingCategory] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [frontmatterDialogOpen, setFrontmatterDialogOpen] = useState(false)
  const [frontmatterDialogMode, setFrontmatterDialogMode] = useState<FrontmatterDialogMode>('create')
  const [frontmatterTitle, setFrontmatterTitle] = useState('')
  const [frontmatterTags, setFrontmatterTags] = useState('')
  const [frontmatterCategoryInput, setFrontmatterCategoryInput] = useState('')
  const [frontmatterStatus, setFrontmatterStatus] = useState<LearningNoteStatus>('draft')
  const [frontmatterSubmitting, setFrontmatterSubmitting] = useState(false)
  const [frontmatterError, setFrontmatterError] = useState<string | null>(null)
  const [editorContextMenu, setEditorContextMenu] = useState<LearningEditorContextMenuState | null>(null)
  const [sidebarGestureOverlay, setSidebarGestureOverlay] = useState<LearningSidebarGestureOverlayState>(
    EMPTY_LEARNING_SIDEBAR_GESTURE_OVERLAY
  )
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(LEARNING_LEFT_SIDEBAR_COLLAPSED_STORAGE_KEY) === '1'
  })
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(LEARNING_RIGHT_SIDEBAR_COLLAPSED_STORAGE_KEY) === '1'
  })
  const [editorDisplayMode, setEditorDisplayMode] = useState<LearningEditorDisplayMode>(() => {
    if (typeof window === 'undefined') return 'split'
    return window.localStorage.getItem(LEARNING_EDITOR_DISPLAY_MODE_STORAGE_KEY) === 'preview'
      ? 'preview'
      : 'split'
  })
  const pageRootRef = useRef<HTMLDivElement | null>(null)
  const editorTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const editorHistoryRef = useRef<LearningEditorSnapshot[]>([])
  const editorHistoryIndexRef = useRef(-1)
  const sidebarGestureRef = useRef({
    tracking: false,
    activated: false,
    moved: false,
    startX: 0,
    startY: 0,
    lastDx: 0,
    lastDy: 0,
    lastSampleX: 0,
    lastSampleY: 0,
    points: [] as GesturePoint[],
  })
  const suppressSidebarGestureContextMenuRef = useRef(false)
  const suppressSidebarGestureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sidebarGestureFrameRef = useRef<number | null>(null)
  const nextSidebarGestureOverlayRef = useRef<LearningSidebarGestureOverlayState>(
    EMPTY_LEARNING_SIDEBAR_GESTURE_OVERLAY
  )

  const enableMarkdownSyntaxHighlight = useMemo(
    () => !shouldDisableMarkdownSyntaxHighlight(editorContent),
    [editorContent]
  )

  const markdownComponents = useMemo(() => createMarkdownComponents({
    activeRelativePath: null,
    enableMarkdownSyntaxHighlight,
    projectPath: '',
    themeMode: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
  }), [enableMarkdownSyntaxHighlight])

  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return notes.filter((note) => {
      if (selectedCategoryId !== 'all' && note.categoryId !== selectedCategoryId) return false
      if (!q) return true
      const haystack = [
        note.title,
        note.excerpt,
        note.tags.join(' '),
      ].join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [notes, searchQuery, selectedCategoryId])

  const selectedManageCategory = useMemo(
    () => categories.find((item) => item.id === selectedCategoryId) ?? null,
    [categories, selectedCategoryId]
  )

  const hasUnsavedChanges = useMemo(() => {
    if (!selectedNote) return false
    return (
      editorTitle !== selectedNote.title
      || editorContent !== selectedNote.contentMd
      || editorCategoryId !== (selectedNote.categoryId ?? '')
      || editorStatus !== selectedNote.status
      || editorTags !== selectedNote.tags.join(', ')
    )
  }, [editorCategoryId, editorContent, editorStatus, editorTags, editorTitle, selectedNote])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const [nextCategories, nextNotes] = await Promise.all([
          window.electronAPI.listLearningCategories(),
          window.electronAPI.listLearningNotes(),
        ])
        setCategories(nextCategories)
        setNotes(nextNotes)
        const firstNoteId = nextNotes[0]?.id ?? null
        setSelectedNoteId(firstNoteId)
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [])

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
    const isEventInsidePage = (target: EventTarget | null) => (
      target instanceof Node
      && pageRootRef.current?.contains(target)
    )

    const setGestureActive = (active: boolean) => {
      document.body.classList.toggle(LEARNING_GESTURE_ACTIVE_CLASS_NAME, active)
    }

    const hideOverlayImmediately = () => {
      nextSidebarGestureOverlayRef.current = EMPTY_LEARNING_SIDEBAR_GESTURE_OVERLAY
      if (sidebarGestureFrameRef.current !== null) {
        window.cancelAnimationFrame(sidebarGestureFrameRef.current)
        sidebarGestureFrameRef.current = null
      }
      setSidebarGestureOverlay(EMPTY_LEARNING_SIDEBAR_GESTURE_OVERLAY)
    }

    const flushOverlay = () => {
      sidebarGestureFrameRef.current = null
      setSidebarGestureOverlay(nextSidebarGestureOverlayRef.current)
    }

    const scheduleOverlay = (next: LearningSidebarGestureOverlayState) => {
      nextSidebarGestureOverlayRef.current = next
      if (sidebarGestureFrameRef.current !== null) return
      sidebarGestureFrameRef.current = window.requestAnimationFrame(flushOverlay)
    }

    const clearSuppressTimer = () => {
      if (suppressSidebarGestureTimerRef.current) {
        window.clearTimeout(suppressSidebarGestureTimerRef.current)
        suppressSidebarGestureTimerRef.current = null
      }
    }

    const armSuppressContextMenu = () => {
      suppressSidebarGestureContextMenuRef.current = true
      clearSuppressTimer()
      suppressSidebarGestureTimerRef.current = window.setTimeout(() => {
        suppressSidebarGestureContextMenuRef.current = false
      }, 450)
    }

    const resetGesture = () => {
      sidebarGestureRef.current.tracking = false
      sidebarGestureRef.current.activated = false
      sidebarGestureRef.current.moved = false
      sidebarGestureRef.current.startX = 0
      sidebarGestureRef.current.startY = 0
      sidebarGestureRef.current.lastDx = 0
      sidebarGestureRef.current.lastDy = 0
      sidebarGestureRef.current.lastSampleX = 0
      sidebarGestureRef.current.lastSampleY = 0
      sidebarGestureRef.current.points = []
    }

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 2) return
      if (!(event.ctrlKey || event.metaKey) || !isEventInsidePage(event.target)) return

      setGestureActive(true)
      sidebarGestureRef.current.tracking = true
      sidebarGestureRef.current.activated = false
      sidebarGestureRef.current.moved = false
      sidebarGestureRef.current.startX = event.clientX
      sidebarGestureRef.current.startY = event.clientY
      sidebarGestureRef.current.lastDx = 0
      sidebarGestureRef.current.lastDy = 0
      sidebarGestureRef.current.lastSampleX = event.clientX
      sidebarGestureRef.current.lastSampleY = event.clientY
      sidebarGestureRef.current.points = []

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }

    const handleMouseMove = (event: MouseEvent) => {
      const gesture = sidebarGestureRef.current
      if (!gesture.tracking) return

      if ((event.buttons & 2) === 0) {
        setGestureActive(false)
        resetGesture()
        hideOverlayImmediately()
        return
      }

      gesture.lastDx = event.clientX - gesture.startX
      gesture.lastDy = event.clientY - gesture.startY

      if (!gesture.activated) {
        const movedDistance = Math.hypot(gesture.lastDx, gesture.lastDy)
        if (movedDistance < LEARNING_SIDEBAR_GESTURE_ACTIVATE_DISTANCE) return
        gesture.activated = true
        gesture.moved = true
        gesture.points = [
          { x: gesture.startX, y: gesture.startY },
          { x: event.clientX, y: event.clientY },
        ]
        gesture.lastSampleX = event.clientX
        gesture.lastSampleY = event.clientY
      } else {
        const deltaSinceSample = Math.hypot(
          event.clientX - gesture.lastSampleX,
          event.clientY - gesture.lastSampleY
        )
        if (deltaSinceSample >= LEARNING_SIDEBAR_GESTURE_SAMPLE_MIN_DISTANCE) {
          gesture.points.push({ x: event.clientX, y: event.clientY })
          if (gesture.points.length > LEARNING_SIDEBAR_GESTURE_MAX_POINTS) {
            gesture.points.splice(0, gesture.points.length - LEARNING_SIDEBAR_GESTURE_MAX_POINTS)
          }
          gesture.lastSampleX = event.clientX
          gesture.lastSampleY = event.clientY
        }
      }

      if (gesture.activated) {
        const preview = resolveLearningSidebarGestureOverlay(gesture.lastDx, gesture.lastDy)
        scheduleOverlay({
          visible: true,
          status: preview.status,
          action: preview.action,
          points: [...gesture.points],
          cursor: { x: event.clientX, y: event.clientY },
        })
      }

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }

    const handleMouseUp = (event: MouseEvent) => {
      if (event.button !== 2) return
      const gesture = sidebarGestureRef.current
      if (!gesture.tracking) return

      const dx = gesture.lastDx
      const dy = gesture.lastDy
      const absX = Math.abs(dx)
      const absY = Math.abs(dy)
      const passedHorizontal = absX >= LEARNING_SIDEBAR_GESTURE_HORIZONTAL_THRESHOLD
        && absX >= absY * LEARNING_SIDEBAR_GESTURE_ANGLE_RATIO

      setGestureActive(false)
      if (gesture.moved) {
        armSuppressContextMenu()
      }

      resetGesture()
      hideOverlayImmediately()

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()

      if (!passedHorizontal) return

      closeEditorContextMenu()
      if (dx < 0) {
        setRightSidebarCollapsed((current) => !current)
        return
      }
      setLeftSidebarCollapsed((current) => !current)
    }

    const handleContextMenu = (event: MouseEvent) => {
      if (
        !isEventInsidePage(event.target)
        || (!suppressSidebarGestureContextMenuRef.current && !sidebarGestureRef.current.tracking)
      ) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      suppressSidebarGestureContextMenuRef.current = false
      clearSuppressTimer()
    }

    const handleWindowBlur = () => {
      setGestureActive(false)
      resetGesture()
      hideOverlayImmediately()
      suppressSidebarGestureContextMenuRef.current = false
      clearSuppressTimer()
    }

    document.addEventListener('mousedown', handleMouseDown, true)
    document.addEventListener('mousemove', handleMouseMove, true)
    document.addEventListener('mouseup', handleMouseUp, true)
    document.addEventListener('contextmenu', handleContextMenu, true)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true)
      document.removeEventListener('mousemove', handleMouseMove, true)
      document.removeEventListener('mouseup', handleMouseUp, true)
      document.removeEventListener('contextmenu', handleContextMenu, true)
      window.removeEventListener('blur', handleWindowBlur)
      if (sidebarGestureFrameRef.current !== null) {
        window.cancelAnimationFrame(sidebarGestureFrameRef.current)
        sidebarGestureFrameRef.current = null
      }
      clearSuppressTimer()
      suppressSidebarGestureContextMenuRef.current = false
      nextSidebarGestureOverlayRef.current = EMPTY_LEARNING_SIDEBAR_GESTURE_OVERLAY
      setGestureActive(false)
      resetGesture()
    }
  }, [])

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
    }

    void loadNote()
    return () => {
      active = false
    }
  }, [selectedNoteId])

  useEffect(() => {
    setCategoryEditInput(selectedManageCategory?.name ?? '')
    setCategoryEditError(null)
  }, [selectedManageCategory])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const activeElement = document.activeElement
      const isTextEntryTarget = activeElement instanceof HTMLInputElement
        || activeElement instanceof HTMLTextAreaElement
        || activeElement instanceof HTMLSelectElement
        || Boolean(activeElement?.closest('[contenteditable="true"]'))

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
      setFrontmatterError('标题不能为空')
      return
    }

    setFrontmatterSubmitting(true)
    setFrontmatterError(null)
    try {
      const resolvedCategoryId = await resolveFrontmatterCategoryId()
      if (frontmatterDialogMode === 'create') {
        const created = await window.electronAPI.createLearningNote({
          title: nextTitle,
          categoryId: resolvedCategoryId,
          tags: normalizeTagInput(frontmatterTags),
          status: frontmatterStatus,
          contentMd: defaultNoteContent(nextTitle),
        })
        setNotes((current) => [created, ...current.filter((item) => item.id !== created.id)])
        setSelectedNoteId(created.id)
        resetFrontmatterDialog()
        return
      }

      if (!selectedNoteId) return
      const updated = await window.electronAPI.updateLearningNote({
        noteId: selectedNoteId,
        title: nextTitle,
        categoryId: resolvedCategoryId,
        tags: normalizeTagInput(frontmatterTags),
        status: frontmatterStatus,
        contentMd: editorContent,
      })
      syncUpdatedNote(updated)
      setSaveState('saved')
      resetFrontmatterDialog()
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存失败'
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
    setSaving(true)
    setSaveError(null)
    try {
      const updated = await window.electronAPI.updateLearningNote({
        noteId: selectedNoteId,
        title: editorTitle,
        categoryId: editorCategoryId || undefined,
        tags: normalizeTagInput(editorTags),
        status: editorStatus,
        contentMd: editorContent,
      })
      syncUpdatedNote(updated)
      setSaveState('saved')
    } catch (error) {
      setSaveState('error')
      setSaveError(error instanceof Error ? error.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

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
      setCategoryCreateError(error instanceof Error ? error.message : '新增分类失败')
    } finally {
      setIsCreatingCategory(false)
    }
  }

  const handleRenameCategory = async () => {
    if (!selectedManageCategory) return
    const name = categoryEditInput.trim()
    if (!name) {
      setCategoryEditError('分类名称不能为空')
      return
    }
    setIsUpdatingCategory(true)
    setCategoryEditError(null)
    try {
      const next = await window.electronAPI.updateLearningCategory({
        categoryId: selectedManageCategory.id,
        name,
      })
      setCategories(next)
    } catch (error) {
      setCategoryEditError(error instanceof Error ? error.message : '重命名分类失败')
    } finally {
      setIsUpdatingCategory(false)
    }
  }

  const handleDeleteCategory = async () => {
    if (!selectedManageCategory) return
    const shouldDelete = window.confirm(`确定删除分类“${selectedManageCategory.name}”吗？使用该分类的笔记会变为未分类。`)
    if (!shouldDelete) return

    setIsDeletingCategory(true)
    setCategoryEditError(null)
    try {
      const deletedCategoryId = selectedManageCategory.id
      const next = await window.electronAPI.deleteLearningCategory(deletedCategoryId)
      setCategories(next)
      setSelectedCategoryId('all')
      setNotes((current) => current.map((note) => (
        note.categoryId === deletedCategoryId
          ? { ...note, categoryId: undefined }
          : note
      )))
      setSelectedNote((current) => (
        current && current.categoryId === deletedCategoryId
          ? { ...current, categoryId: undefined }
          : current
      ))
      setEditorCategoryId((current) => (current === deletedCategoryId ? '' : current))
      setFrontmatterCategoryInput((current) => (
        current.trim().toLowerCase() === selectedManageCategory.name.trim().toLowerCase() ? '' : current
      ))
    } catch (error) {
      setCategoryEditError(error instanceof Error ? error.message : '删除分类失败')
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
      const nextNotes = notes.filter((item) => item.id !== selectedNoteId)
      setNotes(nextNotes)
      setSelectedNoteId(nextNotes[0]?.id ?? null)
      setDeleteConfirmOpen(false)
    } finally {
      setIsDeleting(false)
    }
  }

  const closeEditorContextMenu = () => {
    setEditorContextMenu(null)
  }

  const pushEditorSnapshot = (snapshot: LearningEditorSnapshot) => {
    const nextHistoryState = pushLearningEditorSnapshot(
      {
        history: editorHistoryRef.current,
        index: editorHistoryIndexRef.current,
      },
      snapshot,
      LEARNING_EDITOR_HISTORY_LIMIT
    )
    editorHistoryRef.current = nextHistoryState.history
    editorHistoryIndexRef.current = nextHistoryState.index
  }

  const syncEditorSnapshotSelection = (selectionStart: number, selectionEnd: number) => {
    const nextHistoryState = updateLearningEditorSnapshotSelection(
      {
        history: editorHistoryRef.current,
        index: editorHistoryIndexRef.current,
      },
      selectionStart,
      selectionEnd
    )
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

  const applyEditorEdit = (
    textarea: HTMLTextAreaElement,
    previousValue: string,
    nextValue: string,
    nextSelectionStart: number,
    nextSelectionEnd: number
  ) => {
    let prefixLength = 0
    const maxPrefixLength = Math.min(previousValue.length, nextValue.length)
    while (
      prefixLength < maxPrefixLength
      && previousValue[prefixLength] === nextValue[prefixLength]
    ) {
      prefixLength += 1
    }

    let previousSuffixLength = previousValue.length
    let nextSuffixLength = nextValue.length
    while (
      previousSuffixLength > prefixLength
      && nextSuffixLength > prefixLength
      && previousValue[previousSuffixLength - 1] === nextValue[nextSuffixLength - 1]
    ) {
      previousSuffixLength -= 1
      nextSuffixLength -= 1
    }

    const replacement = nextValue.slice(prefixLength, nextSuffixLength)
    textarea.setRangeText(replacement, prefixLength, previousSuffixLength, 'preserve')
    textarea.setSelectionRange(nextSelectionStart, nextSelectionEnd)
    setEditorContent(textarea.value)
    pushEditorSnapshot({
      value: textarea.value,
      selectionStart: nextSelectionStart,
      selectionEnd: nextSelectionEnd,
    })
  }

  const handleEditorContextMenu = (event: React.MouseEvent<HTMLTextAreaElement>) => {
    event.preventDefault()
    const target = event.currentTarget
    setEditorContextMenu({
      x: event.clientX,
      y: event.clientY,
      selectionStart: target.selectionStart ?? 0,
      selectionEnd: target.selectionEnd ?? 0,
    })
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
    const result = applyLearningMarkdownInsert(editorContent, selectionStart, selectionEnd, request)
    applyEditorEdit(textarea, editorContent, result.value, result.selectionStart, result.selectionEnd)
    closeEditorContextMenu()
    textarea.focus()
  }

  const handleEditorSelectionSync = (event: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget
    syncEditorSnapshotSelection(
      textarea.selectionStart ?? 0,
      textarea.selectionEnd ?? textarea.selectionStart ?? 0
    )
  }

  const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

    if (
      (isModKey && event.key.toLowerCase() === 'y')
      || (isModKey && event.shiftKey && event.key.toLowerCase() === 'z')
    ) {
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
      const result = event.shiftKey
        ? outdentMarkdownLines(editorContent, selectionStart, selectionEnd)
        : indentMarkdownLines(editorContent, selectionStart, selectionEnd)
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

  const handleEditorChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget
    setEditorContent(textarea.value)
    pushEditorSnapshot({
      value: textarea.value,
      selectionStart: textarea.selectionStart ?? textarea.value.length,
      selectionEnd: textarea.selectionEnd ?? textarea.value.length,
    })
  }

  const selectedCategoryName = categories.find((item) => item.id === editorCategoryId)?.name ?? t('common.uncategorized')
  const saveButtonVariant = saveState === 'error'
    ? 'destructive'
    : hasUnsavedChanges
      ? 'default'
      : 'outline'
  const saveButtonLabel = saving
    ? t('common.saving')
    : saveState === 'error'
      ? '重试保存'
      : hasUnsavedChanges
        ? '保存修改'
        : '已保存'
  const saveButtonDisabled = saving || (!hasUnsavedChanges && saveState !== 'error')
  const statusOptions: SelectOption[] = useMemo(
    () => [
      { value: 'draft', label: '草稿' },
      { value: 'organized', label: '已整理' },
    ],
    []
  )
  const categoryOptions: ComboboxOption[] = useMemo(
    () => categories.map((category) => ({
      value: category.name,
      label: category.name,
    })),
    [categories]
  )
  const uncategorizedOption = useMemo<ComboboxOption[]>(
    () => [{ value: '', label: '未分类' }],
    []
  )
  const layoutGridColumns = useMemo(() => {
    if (!leftSidebarCollapsed && !rightSidebarCollapsed) return '280px minmax(0,1fr) 340px'
    if (!leftSidebarCollapsed && rightSidebarCollapsed) return '280px minmax(0,1fr)'
    if (leftSidebarCollapsed && !rightSidebarCollapsed) return 'minmax(0,1fr) 340px'
    return 'minmax(0,1fr)'
  }, [leftSidebarCollapsed, rightSidebarCollapsed])
  const editorPreviewGridColumns = editorDisplayMode === 'preview'
    ? 'minmax(0,1fr)'
    : 'minmax(0,1fr) minmax(0,1fr)'
  const bothSidebarsCollapsed = leftSidebarCollapsed && rightSidebarCollapsed
  const sidebarGesturePathPoints = sidebarGestureOverlay.cursor
    ? [...sidebarGestureOverlay.points, sidebarGestureOverlay.cursor]
    : sidebarGestureOverlay.points
  const sidebarGesturePolylinePoints = sidebarGesturePathPoints.map((point) => `${point.x},${point.y}`).join(' ')
  const sidebarGestureStartPoint = sidebarGesturePathPoints[0]
  const sidebarGestureEndPoint = sidebarGesturePathPoints[sidebarGesturePathPoints.length - 1]
  const sidebarGestureStrokeColor = sidebarGestureOverlay.status === 'ready'
    ? 'var(--color-success)'
    : sidebarGestureOverlay.status === 'invalid'
      ? 'var(--color-destructive)'
      : 'var(--color-muted-foreground)'

  return (
    <div ref={pageRootRef} className="flex h-full min-h-0 flex-col px-6 pb-6 pt-5 sm:px-8">
      {sidebarGestureOverlay.visible ? (
        <div className="pointer-events-none fixed inset-0 z-[10000]">
          <svg className="h-full w-full">
            {sidebarGesturePolylinePoints.length > 0 ? (
              <polyline
                points={sidebarGesturePolylinePoints}
                fill="none"
                stroke={sidebarGestureStrokeColor}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ opacity: 0.82 }}
              />
            ) : null}
            {sidebarGestureStartPoint ? (
              <circle
                cx={sidebarGestureStartPoint.x}
                cy={sidebarGestureStartPoint.y}
                r={4}
                fill={sidebarGestureStrokeColor}
                style={{ opacity: 0.75 }}
              />
            ) : null}
            {sidebarGestureEndPoint ? (
              <circle
                cx={sidebarGestureEndPoint.x}
                cy={sidebarGestureEndPoint.y}
                r={5}
                fill={sidebarGestureStrokeColor}
              />
            ) : null}
          </svg>
        </div>
      ) : null}
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1480px] flex-col gap-4">
        <header className="quiet-control flex items-center gap-3 rounded-[24px] px-5 py-4">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full"
            onClick={() => navigate('/')}
            title={t('common.projects')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[color:var(--color-primary)]/12 text-[color:var(--color-primary)]">
            <BookOpenText className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-[color:var(--color-foreground)]">{t('common.learningCenter')}</div>
            <div className="text-xs text-[color:var(--color-muted-foreground)]">
              用 Markdown 长期保存和整理你的学习记录
            </div>
          </div>
          <Button size="sm" className="gap-1.5" onClick={openCreateDialog}>
            <Plus className="h-4 w-4" />
            新建笔记
          </Button>
        </header>

        <div
          className="relative grid h-full min-h-0 gap-4 transition-[grid-template-columns] duration-200"
          style={{ gridTemplateColumns: layoutGridColumns }}
        >
          {leftSidebarCollapsed ? (
            <LearningSidebarRailButton
              side="left"
              collapsed
              onClick={() => setLeftSidebarCollapsed(false)}
              className="absolute left-0 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2"
            />
          ) : null}
          {rightSidebarCollapsed ? (
            <LearningSidebarRailButton
              side="right"
              collapsed
              onClick={() => setRightSidebarCollapsed(false)}
              className="absolute right-0 top-1/2 z-20 translate-x-1/2 -translate-y-1/2"
            />
          ) : null}

          {!leftSidebarCollapsed ? (
            <div className="relative flex h-full min-h-0">
              <Card className="flex h-full min-h-0 w-full flex-col overflow-hidden border-[color:var(--color-border)]/80 bg-[color:var(--color-card)]/92">
                <div className="border-b border-[color:var(--color-border)] px-4 py-4">
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--color-muted-foreground)]"
                    />
                    <Input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="搜索学习记录..."
                      className="h-10 rounded-full pl-11 pr-10"
                    />
                    <button
                      type="button"
                      className={`absolute right-3 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-opacity ${
                        searchQuery
                          ? 'hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
                          : 'pointer-events-none opacity-0'
                      }`}
                      onClick={() => setSearchQuery('')}
                      aria-label={t('common.clearSearch')}
                      title={t('common.clearSearch')}
                      tabIndex={searchQuery ? 0 : -1}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="border-b border-[color:var(--color-border)] px-4 py-4">
                  <div className="mb-3 text-xs font-medium text-[color:var(--color-muted-foreground)]">分类</div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                        selectedCategoryId === 'all'
                          ? 'bg-[color:var(--color-primary)] text-white'
                          : 'bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]'
                      }`}
                      onClick={() => setSelectedCategoryId('all')}
                    >
                      全部
                    </button>
                    {categories.map((category) => (
                      <button
                        key={category.id}
                        type="button"
                        className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                          selectedCategoryId === category.id
                            ? 'bg-[color:var(--color-primary)] text-white'
                            : 'bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]'
                        }`}
                        onClick={() => setSelectedCategoryId(category.id)}
                      >
                        {category.name}
                      </button>
                    ))}
                  </div>
                  {selectedManageCategory ? (
                    <div className="mt-3 rounded-[18px] border border-[color:var(--color-border)] bg-[color:var(--color-accent)]/40 p-3">
                      <div className="mb-2 text-xs text-[color:var(--color-muted-foreground)]">管理当前分类</div>
                      <div className="flex gap-2">
                        <Input
                          value={categoryEditInput}
                          onChange={(event) => setCategoryEditInput(event.target.value)}
                          placeholder="分类名称"
                          className="h-9"
                          disabled={isUpdatingCategory || isDeletingCategory}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              void handleRenameCategory()
                            }
                          }}
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="h-9 w-9 rounded-full"
                          onClick={() => void handleRenameCategory()}
                          loading={isUpdatingCategory}
                          disabled={isDeletingCategory}
                          title="重命名分类"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="destructive"
                          className="h-9 w-9 rounded-full"
                          onClick={() => void handleDeleteCategory()}
                          loading={isDeletingCategory}
                          disabled={isUpdatingCategory}
                          title="删除分类"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      {categoryEditError ? (
                        <div className="mt-2 text-xs text-[color:var(--color-destructive)]">{categoryEditError}</div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="mt-3 flex gap-2">
                    <Input
                      value={categoryInput}
                      onChange={(event) => setCategoryInput(event.target.value)}
                      placeholder="新分类"
                      className="h-9"
                      disabled={isCreatingCategory}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          void handleCreateCategory()
                        }
                      }}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-9 w-9 rounded-full"
                      onClick={() => void handleCreateCategory()}
                      loading={isCreatingCategory}
                      title="新增分类"
                    >
                      <FolderPlus className="h-4 w-4" />
                    </Button>
                  </div>
                  {categoryCreateError ? (
                    <div className="mt-2 text-xs text-[color:var(--color-destructive)]">{categoryCreateError}</div>
                  ) : null}
                </div>
                <div className="px-4 pb-2 pt-4">
                  <div className="text-xs font-medium text-[color:var(--color-muted-foreground)]">笔记</div>
                </div>
                <ScrollArea className="min-h-0 flex-1">
                  <div className="space-y-2 p-3">
                    {loading ? (
                      <div className="px-3 py-4 text-xs text-[color:var(--color-muted-foreground)]">{t('common.loading')}</div>
                    ) : filteredNotes.length > 0 ? (
                      filteredNotes.map((note) => (
                        <button
                          key={note.id}
                          type="button"
                          className={`flex w-full flex-col gap-1 rounded-[18px] border px-3 py-3 text-left transition-colors ${
                            selectedNoteId === note.id
                              ? 'border-[color:var(--color-primary)]/50 bg-[color:var(--color-primary)]/8'
                              : 'border-transparent bg-[color:var(--color-accent)]/55 hover:border-[color:var(--color-border)]'
                          }`}
                          onClick={() => setSelectedNoteId(note.id)}
                        >
                          <div className="line-clamp-1 text-sm font-medium text-[color:var(--color-foreground)]">{note.title}</div>
                          <div className="line-clamp-2 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{note.excerpt || '暂无摘要'}</div>
                          <div className="flex items-center justify-between gap-2 text-[11px] text-[color:var(--color-muted-foreground)]">
                            <span>{formatDateTime(note.updatedAt)}</span>
                            <span>{note.status === 'organized' ? '已整理' : '草稿'}</span>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-4 text-xs text-[color:var(--color-muted-foreground)]">还没有学习记录</div>
                    )}
                  </div>
                </ScrollArea>
              </Card>
              <LearningSidebarRailButton
                side="left"
                collapsed={false}
                onClick={() => setLeftSidebarCollapsed(true)}
                className="absolute -right-4 top-1/2 z-20 -translate-y-1/2"
              />
            </div>
          ) : null}

          <Card className={`min-h-0 overflow-hidden border-[color:var(--color-border)]/80 bg-[color:var(--color-card)]/94 ${
            bothSidebarsCollapsed ? 'mx-auto w-full max-w-[1360px]' : ''
          }`}>
            {selectedNote ? (
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--color-border)] px-5 py-4">
                  <div className="min-w-0">
                    <div className="line-clamp-1 text-sm font-semibold text-[color:var(--color-foreground)]">
                      {editorTitle || '未命名笔记'}
                    </div>
                    <div className="text-xs text-[color:var(--color-muted-foreground)]">
                      {editorDisplayMode === 'preview'
                        ? '纯预览模式，专注查看 Markdown 渲染结果'
                        : '分栏模式，左侧编辑正文，右侧实时预览'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="quiet-control inline-flex items-center gap-1 rounded-full border border-[color:var(--color-border)]/80 bg-[color:var(--color-accent)]/55 p-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className={editorDisplayMode === 'split'
                          ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm'
                          : 'text-[color:var(--color-muted-foreground)]'}
                        onClick={() => setEditorDisplayMode('split')}
                      >
                        分栏
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className={editorDisplayMode === 'preview'
                          ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm'
                          : 'text-[color:var(--color-muted-foreground)]'}
                        onClick={() => setEditorDisplayMode('preview')}
                      >
                        纯预览
                      </Button>
                    </div>
                    <Button
                      size="sm"
                      variant={saveButtonVariant}
                      className={`min-w-[104px] justify-center gap-1.5 ${
                        hasUnsavedChanges && !saving
                          ? 'shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-primary)_14%,transparent)]'
                          : ''
                      }`}
                      onClick={() => void handleSave()}
                      loading={saving}
                      disabled={saveButtonDisabled}
                    >
                      <Save className="h-4 w-4" />
                      {saveButtonLabel}
                    </Button>
                  </div>
                </div>

                <div
                  className="grid h-full min-h-0"
                  style={{ gridTemplateColumns: editorPreviewGridColumns }}
                >
                  {editorDisplayMode === 'split' ? (
                    <div className="flex min-h-0 flex-col border-r border-[color:var(--color-border)]">
                      <div className="border-b border-[color:var(--color-border)] px-5 py-4">
                        <div className="text-sm font-semibold text-[color:var(--color-foreground)]">编辑</div>
                        <div className="text-xs text-[color:var(--color-muted-foreground)]">
                          Markdown 正文编辑区
                        </div>
                      </div>
                      <div className="min-h-0 flex-1 px-5 py-4">
                        <textarea
                          ref={editorTextareaRef}
                          value={editorContent}
                          onChange={handleEditorChange}
                          onKeyDown={handleEditorKeyDown}
                          onKeyUp={handleEditorSelectionSync}
                          onMouseUp={handleEditorSelectionSync}
                          onContextMenu={handleEditorContextMenu}
                          className="h-full min-h-[420px] w-full resize-none rounded-[22px] border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-4 py-4 font-['JetBrains_Mono','SFMono-Regular',monospace] text-sm leading-6 text-[color:var(--color-foreground)] outline-none"
                          placeholder="开始记录今天学习到的内容... 右键可快速插入标题、列表、表格等 Markdown 格式"
                        />
                      </div>
                    </div>
                  ) : null}

                  <div className="flex min-h-0 flex-col">
                    <div className="border-b border-[color:var(--color-border)] px-5 py-4">
                      <div className="text-sm font-semibold text-[color:var(--color-foreground)]">预览</div>
                      <div className="text-xs text-[color:var(--color-muted-foreground)]">
                        {editorDisplayMode === 'preview'
                          ? '完整宽度显示 Markdown 渲染结果'
                          : 'Markdown 渲染结果'}
                      </div>
                    </div>
                    <ScrollArea
                      className="min-h-0 flex-1"
                      viewportClassName="h-full w-full code-markdown-preview-scroll-root"
                      horizontalScrollbar
                      horizontalScrollbarClassName="absolute left-[var(--scrollbar-edge-gap)] right-[var(--scrollbar-edge-gap)] bottom-[var(--scrollbar-edge-gap)] z-10 h-[var(--scrollbar-size)] rounded-full border-t-0 bg-[var(--scrollbar-track)]/92 backdrop-blur-md"
                    >
                      <article
                        className={`code-markdown-content code-markdown-content--viewport-scroll ${
                          editorDisplayMode === 'preview' ? 'px-5 py-5 sm:px-6' : 'px-3 py-4 sm:px-4'
                        }`}
                        style={{ margin: 0, maxWidth: 'none', minWidth: 0, width: '100%' }}
                      >
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkBoxDrawingTables]}
                          components={markdownComponents}
                        >
                          {editorContent}
                        </ReactMarkdown>
                      </article>
                    </ScrollArea>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-[color:var(--color-muted-foreground)]">
                先新建一篇学习记录
              </div>
            )}
          </Card>

          {!rightSidebarCollapsed ? (
            <div className="relative flex h-full min-h-0">
              <Card className="h-full min-h-0 w-full overflow-hidden border-[color:var(--color-border)]/80 bg-[color:var(--color-card)]/92">
                <div className="border-b border-[color:var(--color-border)] px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[color:var(--color-foreground)]">笔记信息</div>
                      <div className="text-xs text-[color:var(--color-muted-foreground)]">frontmatter、状态和保存状态</div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={openEditDialog}
                      disabled={!selectedNote}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      编辑信息
                    </Button>
                  </div>
                </div>
                <div className="space-y-5 p-5">
                  <section className="space-y-2">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-[color:var(--color-muted-foreground)]">
                      <NotebookPen className="h-3.5 w-3.5" />
                      标题
                    </div>
                    <div className="text-sm font-medium text-[color:var(--color-foreground)]">
                      {editorTitle || selectedNote?.title || '未命名笔记'}
                    </div>
                  </section>

                  <section className="space-y-2">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-[color:var(--color-muted-foreground)]">
                      <FolderPlus className="h-3.5 w-3.5" />
                      分类
                    </div>
                    <div className="text-sm text-[color:var(--color-foreground)]">{selectedCategoryName}</div>
                  </section>

                  <section className="space-y-2">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-[color:var(--color-muted-foreground)]">
                      <Tags className="h-3.5 w-3.5" />
                      标签
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {normalizeTagInput(editorTags).length > 0 ? normalizeTagInput(editorTags).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-[color:var(--color-accent)] px-2.5 py-1 text-xs text-[color:var(--color-foreground)]"
                        >
                          {tag}
                        </span>
                      )) : (
                        <span className="text-sm text-[color:var(--color-muted-foreground)]">暂无标签</span>
                      )}
                    </div>
                  </section>

                  <section className="space-y-2">
                    <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--color-muted-foreground)]">状态</div>
                    <div className="text-sm text-[color:var(--color-foreground)]">{editorStatus === 'organized' ? '已整理' : '草稿'}</div>
                  </section>

                  <section className="space-y-2">
                    <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--color-muted-foreground)]">时间</div>
                    <div className="space-y-1 text-sm text-[color:var(--color-foreground)]">
                      <div>创建：{selectedNote ? formatDateTime(selectedNote.createdAt) : '--'}</div>
                      <div>更新：{selectedNote ? formatDateTime(selectedNote.updatedAt) : '--'}</div>
                    </div>
                  </section>

                  <section className="space-y-2">
                    <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--color-muted-foreground)]">保存状态</div>
                    <div className={`text-sm ${
                      saveState === 'error'
                        ? 'text-[color:var(--color-destructive)]'
                        : saveState === 'saved'
                          ? 'text-[color:var(--color-success)]'
                          : 'text-[color:var(--color-muted-foreground)]'
                    }`}>
                      {saveState === 'error'
                        ? (saveError || '保存失败')
                        : saveState === 'saved'
                          ? '已保存'
                          : hasUnsavedChanges
                            ? '有未保存修改'
                            : '未修改'}
                    </div>
                  </section>

                  <Button
                    variant="destructive"
                    className="mt-4 w-full gap-1.5"
                    onClick={() => setDeleteConfirmOpen(true)}
                    loading={false}
                    disabled={!selectedNoteId}
                  >
                    <Trash2 className="h-4 w-4" />
                    删除笔记
                  </Button>
                </div>
              </Card>
              <LearningSidebarRailButton
                side="right"
                collapsed={false}
                onClick={() => setRightSidebarCollapsed(true)}
                className="absolute -left-4 top-1/2 z-20 -translate-y-1/2"
              />
            </div>
          ) : null}
        </div>
      </div>
      {editorContextMenu ? (
        <LearningMarkdownContextMenu
          x={editorContextMenu.x}
          y={editorContextMenu.y}
          onApply={handleApplyMarkdownInsert}
          onClose={closeEditorContextMenu}
        />
      ) : null}
      <ModalShell
        open={frontmatterDialogOpen}
        onClose={() => {
          if (frontmatterSubmitting) return
          resetFrontmatterDialog()
        }}
        widthClassName="max-w-[640px]"
        ariaLabel={frontmatterDialogMode === 'create' ? '新建学习记录' : '编辑笔记信息'}
        panelClassName="p-0 overflow-hidden"
      >
        <div className="flex flex-col">
          <div className="border-b border-[color:var(--color-border)] px-5 py-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-base font-semibold text-[color:var(--color-foreground)]">
                  {frontmatterDialogMode === 'create' ? '先填写 frontmatter' : '编辑 frontmatter'}
                </div>
                <div className="mt-1 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
                  {frontmatterDialogMode === 'create'
                    ? '先确定标题、分类、标签和状态，再进入正文编辑与预览分栏。'
                    : '元信息单独维护，主区域继续专注 Markdown 正文。'}
                </div>
              </div>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => resetFrontmatterDialog()}
                title={t('common.close')}
                disabled={frontmatterSubmitting}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <div className="mb-1.5 text-xs text-[color:var(--color-muted-foreground)]">标题</div>
              <Input
                value={frontmatterTitle}
                onChange={(event) => setFrontmatterTitle(event.target.value)}
                placeholder="例如：DNS 与 Nginx 基础整理"
                disabled={frontmatterSubmitting}
              />
            </div>
            <div>
              <div className="mb-1.5 text-xs text-[color:var(--color-muted-foreground)]">分类</div>
              <Combobox
                ariaLabel="learning-frontmatter-category"
                value={frontmatterCategoryInput}
                options={categoryOptions}
                pinnedOptions={uncategorizedOption}
                onChange={setFrontmatterCategoryInput}
                placeholder="可直接输入新分类"
                allowCreate
                toggleAriaLabel={frontmatterCategoryInput.trim() ? '收起分类建议' : '展开分类建议'}
                emptyText="还没有分类"
                isOptionSelected={(option, currentValue) => option.value === currentValue.trim()}
                createIcon={<FolderPlus className="h-4 w-4 shrink-0 text-[color:var(--color-primary)]" />}
                createLabel={(nextValue) => (
                  <span className="flex min-w-0 items-center gap-2">
                    <FolderPlus className="h-4 w-4 shrink-0 text-[color:var(--color-primary)]" />
                    <span className="truncate">新建分类 “{nextValue}”</span>
                  </span>
                )}
                filterOption={(option, query) => {
                  const normalizedQuery = query.trim().toLowerCase()
                  if (!normalizedQuery) return option.value !== ''
                  return option.label.toLowerCase().includes(normalizedQuery)
                }}
                disabled={frontmatterSubmitting}
              />
              <div className="mt-2 text-xs text-[color:var(--color-muted-foreground)]">
                可直接输入新分类，会自动创建。
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-xs text-[color:var(--color-muted-foreground)]">状态</div>
              <Select
                ariaLabel="learning-frontmatter-status"
                value={frontmatterStatus}
                options={statusOptions}
                onChange={(value) => setFrontmatterStatus(value as LearningNoteStatus)}
                disabled={frontmatterSubmitting}
              />
            </div>
            <div className="sm:col-span-2">
              <div className="mb-1.5 text-xs text-[color:var(--color-muted-foreground)]">标签</div>
              <Input
                value={frontmatterTags}
                onChange={(event) => setFrontmatterTags(event.target.value)}
                placeholder="例如：dns, nginx, web"
                disabled={frontmatterSubmitting}
              />
              <div className="mt-2 text-xs text-[color:var(--color-muted-foreground)]">
                使用逗号分隔，会写入 Markdown frontmatter。
              </div>
            </div>
            {frontmatterError ? (
              <div className="sm:col-span-2 text-sm text-[color:var(--color-destructive)]">{frontmatterError}</div>
            ) : null}
          </div>

          <div className="flex justify-end gap-3 border-t border-[color:var(--color-border)] px-5 py-4">
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => resetFrontmatterDialog()}
              disabled={frontmatterSubmitting}
            >
              取消
            </Button>
            <Button
              className="rounded-full"
              onClick={() => void handleSubmitFrontmatter()}
              loading={frontmatterSubmitting}
            >
              {frontmatterDialogMode === 'create' ? '创建并开始编辑' : '保存 frontmatter'}
            </Button>
          </div>
        </div>
      </ModalShell>
      <ModalShell
        open={deleteConfirmOpen}
        onClose={() => {
          if (isDeleting) return
          setDeleteConfirmOpen(false)
        }}
        widthClassName="max-w-[420px]"
        ariaLabel="删除学习记录"
      >
        <div className="space-y-5">
          <div>
            <div className="text-base font-semibold text-[color:var(--color-foreground)]">删除这篇学习记录？</div>
            <div className="mt-2 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
              删除后不可恢复。当前笔记：
              <span className="ml-1 font-medium text-[color:var(--color-foreground)]">
                {selectedNote?.title || '未命名笔记'}
              </span>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => setDeleteConfirmOpen(false)}
              disabled={isDeleting}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              className="rounded-full"
              onClick={() => void handleDelete()}
              loading={isDeleting}
            >
              删除
            </Button>
          </div>
        </div>
      </ModalShell>
    </div>
  )
}
