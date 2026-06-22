import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { shallow } from 'zustand/shallow'
import type { ProjectFileNodeKind, ProjectFileReadResult, TranscriptReference } from '../../../shared/types'
import type { ProjectPanePreload, ProjectPaneTab } from '../../components/ProjectPaneTabs'
import { openUrlPopoverItem, type UrlPopoverItem } from '../../components/UrlPopover'
import { useAppStore } from '../../stores/appStore'
import { CodeContentSearchTree, type CodeContentSearchTreeHandle } from './CodeContentSearchTree'
import { CodeWorkspaceChrome } from './CodeWorkspaceChrome'
import { CodeWorkspaceEditorPane } from './CodeWorkspaceEditorPane'
import { CodeFileQuickDrawer } from './CodeFileQuickDrawer'
import type { MonacoCodeEditorHandle } from './MonacoCodeEditor'
import { CodeWorkspaceSidebar } from './CodeWorkspaceSidebar'
import { useCodeFileState } from './useCodeFileState'
import { useCodeWorkspaceRestoreState } from './useCodeWorkspaceRestoreState'
import { useCodeWorkspaceScrollSync } from './useCodeWorkspaceScrollSync'
import { useMarkdownPreviewSearch } from './useMarkdownPreviewSearch'
import { useMarkdownPreviewModeState } from './useMarkdownPreviewModeState'
import {
  inferLanguageFromRelativePath,
  pushRecentCodeFilePath,
  removeCodeFilePathFromDrawerState,
  toggleFavoriteCodeFilePath,
} from './code.helpers'
import { copyTextToClipboard } from './code.clipboard'
import { revealMarkdownPreviewSourceLine } from './code.markdownShared'
import {
  joinProjectPath,
  normalizeRelativePathForCopy,
  removeRelativePathSlashes,
  resolveTreeNodeFolderPath,
} from './code.pathActions'
import { buildKnownFilePathSet } from './code.tree'
import { useProjectCodeSessionState } from './useProjectCodeSessionState'
import { type ContentSearchScopePreset, useCodeWorkspaceExplorerState } from './useCodeWorkspaceExplorerState'
import {
  CODE_FILE_DRAWER_SECTION_LIMIT,
  MAX_PROJECT_CODE_SESSION_CURSOR_POSITIONS,
  MAX_PROJECT_CODE_SESSION_TABS,
  normalizeProjectCodeSession,
} from './useProjectCodeSession'

const NARROW_VIEWPORT_QUERY = '(max-width: 960px)'
const CONTENT_SEARCH_AUTO_COLLAPSE_MATCH_THRESHOLD = 10
const MAX_PRELOADED_TRANSCRIPT_SESSIONS = 4
const TRANSCRIPT_SUMMARY_LOAD_DELAY_MS = 160
const TRANSCRIPT_SESSION_PRELOAD_DELAY_MS = 320
const SMART_EMPTY_FILE_CANDIDATES = [
  'README.md',
  'readme.md',
  'AGENTS.md',
  'AGENT.md',
  'package.json',
  'src/main.tsx',
  'src/main.ts',
  'src/index.tsx',
  'src/index.ts',
  'src/App.tsx',
  'src/App.ts',
  'app/page.tsx',
  'pages/index.tsx',
  'main.py',
]
type CodeWorkspacePanelProps = {
  projectId: string
  projectPath: string
  themeMode: 'system' | 'light' | 'dark'
  projectHeaderCollapsed?: boolean
  projectName?: string
  projectLinkItems?: UrlPopoverItem[]
  hasProjectDocLinks?: boolean
  projectLinkTagOptions?: ReadonlyArray<{ value: string; label: string }>
  projectDevUrlActionVisible?: boolean
  projectDevUrlPending?: boolean
  projectDevUrlReady?: boolean
  activePane?: 'code' | 'aicommit'
  onPreloadPane?: ProjectPanePreload
  onSwitchPane?: (pane: 'code' | 'aicommit') => void
  onStartAndOpenDevUrl?: () => void | Promise<unknown>
  onOpenTranscript?: () => void
  onOpenProjectLinksManager?: () => void
}

type CodeViewMode = 'files' | 'search'

type EditorSearchMode = 'find' | 'replace'

type CodeTranscriptReferenceItem = {
  transcriptId: string
  transcriptTitle: string
  reference: TranscriptReference
}

export function CodeWorkspacePanel({
  projectId,
  projectPath,
  themeMode,
  projectHeaderCollapsed = false,
  projectName,
  projectLinkItems = [],
  hasProjectDocLinks = false,
  projectLinkTagOptions = [],
  projectDevUrlActionVisible = false,
  projectDevUrlPending = false,
  projectDevUrlReady = false,
  activePane = 'code',
  onPreloadPane,
  onSwitchPane,
  onStartAndOpenDevUrl,
  onOpenTranscript,
  onOpenProjectLinksManager,
}: CodeWorkspacePanelProps) {
  const projectCodeMeta = useAppStore((s) => {
    const found = s.projects.find((p) => p.id === projectId)
    return found
      ? {
        lastCodeFile: found.lastCodeFile,
        codeSession: found.codeSession,
        lastMarkdownPreviewMode: found.lastMarkdownPreviewMode,
        codeFileDrawerState: found.codeFileDrawerState,
      }
      : undefined
  }, shallow)
  const persistedLastCodeFile = projectCodeMeta?.lastCodeFile
  const rawPersistedProjectCodeSession = projectCodeMeta?.codeSession
  const persistedProjectCodeSession = useMemo(
    () => normalizeProjectCodeSession(rawPersistedProjectCodeSession),
    [rawPersistedProjectCodeSession]
  )
  const persistedLastMarkdownPreviewMode = projectCodeMeta?.lastMarkdownPreviewMode
  const persistedCodeFileDrawerState = projectCodeMeta?.codeFileDrawerState
  const setProjectCodeSession = useAppStore((s) => s.setProjectCodeSession)
  const setProjectLastCodeFile = useAppStore((s) => s.setProjectLastCodeFile)
  const setProjectLastMarkdownPreviewMode = useAppStore((s) => s.setProjectLastMarkdownPreviewMode)
  const setProjectCodeFileDrawerState = useAppStore((s) => s.setProjectCodeFileDrawerState)
  const transcriptSummaries = useAppStore((s) => s.transcriptSummariesByProjectId[projectId] ?? [], shallow)
  const transcriptSessions = useAppStore((s) => s.transcriptSessions)
  const transcriptListStatus = useAppStore((s) => s.transcriptListStatusByProjectId[projectId] ?? 'idle')
  const loadProjectTranscripts = useAppStore((s) => s.loadProjectTranscripts)
  const loadTranscriptSession = useAppStore((s) => s.loadTranscriptSession)
  const openTranscript = useAppStore((s) => s.openTranscript)
  const openTranscriptReference = useAppStore((s) => s.openTranscriptReference)
  const [isNarrowViewport, setIsNarrowViewport] = useState(() => window.matchMedia(NARROW_VIEWPORT_QUERY).matches)
  const [isExplorerOpen, setIsExplorerOpen] = useState(() => !window.matchMedia(NARROW_VIEWPORT_QUERY).matches)
  const [isQuickDrawerOpen, setIsQuickDrawerOpen] = useState(false)
  const [viewMode, setViewMode] = useState<CodeViewMode>('files')
  const [contentSearchScopeInput, setContentSearchScopeInput] = useState(
    () => persistedProjectCodeSession?.contentSearchScope ?? ''
  )
  const [activeContentSearchLocation, setActiveContentSearchLocation] = useState<{
    relativePath: string
    lineNumber: number
    column: number
  } | null>(null)
  const [locateRequestToken, setLocateRequestToken] = useState(0)
  const editorRef = useRef<MonacoCodeEditorHandle | null>(null)
  const contentSearchTreeRef = useRef<CodeContentSearchTreeHandle | null>(null)
  const previewScrollRef = useRef<HTMLDivElement | null>(null)
  const fileSearchInputRef = useRef<HTMLInputElement | null>(null)
  const contentSearchInputRef = useRef<HTMLInputElement | null>(null)
  const captureCurrentModeScrollRef = useRef<() => void>(() => {})
  const markOpenedFileInExplorerRef = useRef<(relativePath: string) => void>(() => {})
  const handleOpenedCodeFileRef = useRef<(relativePath: string) => void>(() => {})
  const resetScrollSyncStateRef = useRef<() => void>(() => {})
  const pendingLocateAfterTreeReloadRef = useRef<string | null>(null)
  const pushOpenTabPath = useCallback((tabs: string[], relativePath: string): string[] => {
    const normalizedPath = relativePath.trim()
    if (!normalizedPath) return tabs
    if (tabs.includes(normalizedPath)) return tabs
    return [...tabs, normalizedPath].slice(-MAX_PROJECT_CODE_SESSION_TABS)
  }, [])
  const handleBeforeOpenCodeFile = useCallback(() => {
    captureCurrentModeScrollRef.current()
  }, [])
  const handleDidOpenCodeFile = useCallback((result: ProjectFileReadResult) => {
    const nextPath = result.relativePath.trim()
    if (nextPath) {
      setOpenTabPaths((prev) => pushOpenTabPath(prev, nextPath))
      handleOpenedCodeFileRef.current(nextPath)
    }

    resetScrollSyncStateRef.current()
    markOpenedFileInExplorerRef.current(result.relativePath)
    setCodeFileDrawerState((prev) => pushRecentCodeFilePath(prev, result.relativePath))
  }, [pushOpenTabPath])
  const {
    activeFile,
    editorValue,
    setEditorValue,
    activeRelativePath,
    isReading,
    readError,
    saveStatus,
    saveError,
    hasExternalChange,
    setHasExternalChange,
    isReloadingFromDisk,
    discardUnsavedConfirm,
    resolveDiscardUnsavedConfirm,
    isDirty,
    openFile,
    handleSave,
    saveText,
    saveIndicatorText,
    saveIndicatorToneClass,
  } = useCodeFileState({
    projectId,
    projectPath,
    persistedLastCodeFile,
    onBeforeOpenFile: handleBeforeOpenCodeFile,
    onDidOpenFile: handleDidOpenCodeFile,
  })
  const {
    activeContentSearchScopeKey,
    activeContentSearchScopeLabel,
    canToggleContentSearchTree,
    contentSearchCaseSensitive,
    contentSearchError,
    contentSearchQuery,
    contentSearchResult,
    contentSearchScopeGlobs,
    contentSearchScopePresets,
    contentSearchScopeSummary,
    contentSearchToggleLabel,
    ensureTreePathLoaded,
    expandedDirectories,
    fileSearchError,
    hasContentSearchScope,
    hasSearchQuery,
    isContentSearchAdvancedOpen,
    isContentSearchAllExpanded,
    isSearchingContent,
    isSearchingFiles,
    loadDirectory,
    loadTree,
    markFilePathKnown,
    setContentSearchCaseSensitive,
    setContentSearchQuery,
    setExpandedDirectories,
    setFileSearchQuery,
    setIsContentSearchAdvancedOpen,
    setIsContentSearchAllExpanded,
    tree,
    treeNodesForView,
  } = useCodeWorkspaceExplorerState({
    activePane,
    activeRelativePath,
    contentSearchScopeInput,
    projectPath,
  })
  const {
    closeCodePreview,
    closeStructuredPreview,
    codePreview,
    effectiveMarkdownPreviewMode,
    handlePasteImage,
    isMarkdownFile,
    isMdcFile,
    isShowingEditor,
    isShowingPreview,
    markdownComponents,
    markdownPreviewContent,
    monacoTheme,
    parsedMarkdownDoc,
    setMarkdownPreviewMode,
    structuredPreview,
    structuredPreviewComponents,
    shouldHandleFindInPreview,
  } = useMarkdownPreviewModeState({
    activeRelativePath,
    editorValue,
    isNarrowViewport,
    persistedLastMarkdownPreviewMode,
    projectId,
    projectPath,
    setProjectLastMarkdownPreviewMode,
    themeMode,
  })
  const activeLanguage = activeFile?.language ?? inferLanguageFromRelativePath(activeRelativePath ?? '')
  const activeFileSize = activeFile?.size ?? 0
  const {
    previewSearchVisible,
    previewSearchQuery,
    setPreviewSearchQuery,
    activePreviewSearchMatchIndex,
    setActivePreviewSearchMatchIndex,
    previewSearchMatches,
    previewSearchInputRef,
    closePreviewSearch,
    openPreviewSearch,
    goToNextPreviewSearchMatch,
    goToPreviousPreviewSearchMatch,
  } = useMarkdownPreviewSearch(previewScrollRef, shouldHandleFindInPreview, markdownPreviewContent)
  const {
    codeFileDrawerState,
    cursorPositionsByPath,
    isRestoringCodeSessionRef,
    openTabPaths,
    setCodeFileDrawerState,
    setCursorPositionsByPath,
    setOpenTabPaths,
    visibleOpenTabs,
  } = useProjectCodeSessionState({
    projectId,
    persistedProjectCodeSession,
    persistedCodeFileDrawerState,
    persistedLastCodeFile,
    activeRelativePath,
    contentSearchScopeInput,
    setContentSearchScopeInput,
    knownFilePaths: tree.knownFilePaths,
    treeStatus: tree.status,
    setProjectCodeSession,
    setProjectCodeFileDrawerState,
    setProjectLastCodeFile,
  })
  const allProjectFilePathSet = useMemo(() => (
    buildKnownFilePathSet(
      tree.knownFilePaths,
      openTabPaths,
      activeRelativePath,
      codeFileDrawerState,
      persistedProjectCodeSession,
      persistedLastCodeFile,
    )
  ), [
    activeRelativePath,
    codeFileDrawerState,
    openTabPaths,
    persistedLastCodeFile,
    persistedProjectCodeSession,
    tree.knownFilePaths,
  ])
  const smartEmptyFiles = useMemo(() => {
    const available = new Set(allProjectFilePathSet)
    const candidates = SMART_EMPTY_FILE_CANDIDATES.filter((path) => available.has(path))
    const fallback = Array.from(available)
      .filter((path) => /\.(md|mdx|json|tsx?|jsx?|py|yml|yaml)$/i.test(path))
      .sort((a, b) => a.length - b.length || a.localeCompare(b))
    return Array.from(new Set([...candidates, ...fallback])).slice(0, 4)
  }, [allProjectFilePathSet])
  const transcriptReferencesByPath = useMemo(() => {
    const map = new Map<string, CodeTranscriptReferenceItem[]>()
    for (const summary of transcriptSummaries) {
      const session = transcriptSessions[summary.id]
      if (!session) continue
      for (const reference of session.references) {
        const relativePath = reference.relativePath.trim()
        if (!relativePath) continue
        const items = map.get(relativePath) ?? []
        items.push({
          transcriptId: session.id,
          transcriptTitle: session.title,
          reference,
        })
        map.set(relativePath, items)
      }
    }
    return map
  }, [transcriptSessions, transcriptSummaries])
  const activeTranscriptReferences = useMemo(() => (
    activeRelativePath ? transcriptReferencesByPath.get(activeRelativePath) ?? [] : []
  ), [activeRelativePath, transcriptReferencesByPath])
  const locateFileInTree = useCallback(async (relativePath: string) => {
    const normalizedPath = relativePath.trim()
    if (!normalizedPath) return
    await ensureTreePathLoaded(normalizedPath)
    setLocateRequestToken((prev) => prev + 1)
  }, [ensureTreePathLoaded])
  const openFileWithTreeLocate = useCallback(async (relativePath: string, forceReload = false): Promise<boolean> => {
    const normalizedPath = relativePath.trim()
    if (!normalizedPath) return false

    const opened = await openFile(normalizedPath, forceReload)
    if (!opened) return false

    await locateFileInTree(normalizedPath)
    return true
  }, [locateFileInTree, openFile])
  const {
    captureCurrentModeScroll,
    handleEditorScrollStateChange,
    handlePreviewScroll,
    resetScrollSyncState,
  } = useCodeWorkspaceScrollSync({
    activeRelativePath,
    editorRef,
    isMarkdownFile,
    isShowingEditor,
    isShowingPreview,
    markdownPreviewContent,
    previewMode: effectiveMarkdownPreviewMode,
    previewScrollRef,
  })
  const {
    handleOpenedCodeFile,
    isRestoringCodeSession,
    openContentSearchMatch,
  } = useCodeWorkspaceRestoreState({
    activeRelativePath,
    allProjectFilePathSet,
    editorRef,
    editorValue,
    ensureTreePathLoaded,
    isShowingPreview,
    isShowingEditor,
    isRestoringCodeSessionRef,
    openFile: openFileWithTreeLocate,
    persistedLastCodeFile,
    persistedProjectCodeSession,
    projectId,
    revealPreviewPosition: (lineNumber: number) => {
      const preview = previewScrollRef.current
      if (!preview) return false
      return revealMarkdownPreviewSourceLine(preview, lineNumber)
    },
    treeStatus: tree.status,
  })
  const hasRestorableCodeSession = useMemo(() => {
    const persistedTabs = persistedProjectCodeSession?.tabs ?? []
    return Boolean(
      persistedLastCodeFile?.trim()
      || persistedProjectCodeSession?.activePath?.trim()
      || persistedTabs.some((path) => path.trim().length > 0)
    )
  }, [persistedLastCodeFile, persistedProjectCodeSession])
  const isInitialRestoring = !activeRelativePath && (
    isReading
    || (tree.status !== 'error' && (tree.status !== 'ready' || (isRestoringCodeSession && hasRestorableCodeSession)))
  )
  captureCurrentModeScrollRef.current = captureCurrentModeScroll
  markOpenedFileInExplorerRef.current = markFilePathKnown
  handleOpenedCodeFileRef.current = handleOpenedCodeFile
  resetScrollSyncStateRef.current = resetScrollSyncState
  const quickDrawerFavorites = useMemo(
    () => codeFileDrawerState.favorites.filter((path) => allProjectFilePathSet.has(path)).slice(0, CODE_FILE_DRAWER_SECTION_LIMIT),
    [allProjectFilePathSet, codeFileDrawerState.favorites]
  )
  const quickDrawerRecents = useMemo(
    () => codeFileDrawerState.recents.filter((path) => allProjectFilePathSet.has(path)).slice(0, CODE_FILE_DRAWER_SECTION_LIMIT),
    [allProjectFilePathSet, codeFileDrawerState.recents]
  )
  useEffect(() => {
    const media = window.matchMedia(NARROW_VIEWPORT_QUERY)
    const handleChange = (event: MediaQueryListEvent) => {
      setIsNarrowViewport(event.matches)
      if (!event.matches) {
        setIsExplorerOpen(true)
      }
      if (!event.matches) {
        setIsQuickDrawerOpen(false)
      }
    }

    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => {
    if (activePane !== 'code') return
    if (transcriptListStatus === 'loading' || transcriptListStatus === 'ready') return

    const timer = window.setTimeout(() => {
      void loadProjectTranscripts(projectId)
    }, TRANSCRIPT_SUMMARY_LOAD_DELAY_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [activePane, loadProjectTranscripts, projectId, transcriptListStatus])

  useEffect(() => {
    if (activePane !== 'code') return
    if (transcriptListStatus !== 'ready') return

    const timer = window.setTimeout(() => {
      let loadedCount = 0
      for (const summary of transcriptSummaries) {
        if (loadedCount >= MAX_PRELOADED_TRANSCRIPT_SESSIONS) break
        if (summary.referenceCount <= 0) continue
        if (transcriptSessions[summary.id]) continue
        loadedCount += 1
        void loadTranscriptSession(projectId, summary.id)
      }
    }, TRANSCRIPT_SESSION_PRELOAD_DELAY_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [activePane, loadTranscriptSession, projectId, transcriptListStatus, transcriptSessions, transcriptSummaries])

  useEffect(() => {
    const pendingPath = pendingLocateAfterTreeReloadRef.current
    if (!pendingPath) return

    if (tree.status === 'error') {
      pendingLocateAfterTreeReloadRef.current = null
      return
    }

    if (tree.status !== 'ready') return
    pendingLocateAfterTreeReloadRef.current = null
    void locateFileInTree(pendingPath)
  }, [locateFileInTree, tree.status])

  const toggleFavoriteForPath = useCallback((relativePath: string) => {
    setCodeFileDrawerState((prev) => toggleFavoriteCodeFilePath(prev, relativePath))
  }, [])

  const removePathFromQuickDrawer = useCallback((relativePath: string) => {
    setCodeFileDrawerState((prev) => removeCodeFilePathFromDrawerState(prev, relativePath))
  }, [])
  const handleReloadTree = useCallback(() => {
    const normalizedPath = activeRelativePath?.trim() ?? ''
    pendingLocateAfterTreeReloadRef.current = normalizedPath || null
    void loadTree()
  }, [activeRelativePath, loadTree])
  const isActiveFileFavorite = Boolean(activeRelativePath && codeFileDrawerState.favorites.includes(activeRelativePath))
  const handleFileSearchQueryChange = useCallback((nextValue: string) => {
    setFileSearchQuery(nextValue)
  }, [])
  const handleContentSearchQueryChange = useCallback((nextValue: string) => {
    setContentSearchQuery(nextValue)
  }, [])
  const applyContentSearchScopePreset = useCallback((preset: ContentSearchScopePreset) => {
    setContentSearchScopeInput(preset.scopeInput)
    if (!preset.scopeInput) {
      setIsContentSearchAdvancedOpen(false)
    }
  }, [])
  const focusSearchInputByMode = useCallback(() => {
    const focusTarget = () => {
      const target = viewMode === 'search' ? contentSearchInputRef.current : fileSearchInputRef.current
      if (!target) return
      target.focus()
      target.select()
    }

    if (isNarrowViewport && !isExplorerOpen) {
      setIsExplorerOpen(true)
      window.setTimeout(() => {
        focusTarget()
      }, 0)
      return
    }

    focusTarget()
  }, [isExplorerOpen, isNarrowViewport, viewMode])

  const openEditorSearchByMode = useCallback((mode: EditorSearchMode = 'find') => {
    if (!activeRelativePath || !isShowingEditor) {
      focusSearchInputByMode()
      return
    }

    const trigger = () => {
      const editorHandle = editorRef.current
      if (!editorHandle) {
        focusSearchInputByMode()
        return
      }
      editorHandle.openSearch(mode)
    }

    if (isNarrowViewport && isExplorerOpen) {
      setIsExplorerOpen(false)
      window.setTimeout(trigger, 0)
      return
    }

    trigger()
  }, [activeRelativePath, focusSearchInputByMode, isExplorerOpen, isNarrowViewport, isShowingEditor])

  const toggleCodeViewMode = useCallback(() => {
    setViewMode((prev) => (prev === 'files' ? 'search' : 'files'))
    if (isNarrowViewport && !isExplorerOpen) {
      setIsExplorerOpen(true)
    }
  }, [isExplorerOpen, isNarrowViewport])

  useEffect(() => {
    if (activePane !== 'code') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      const isGlobalSearchShortcut = key === 'f' && (event.shiftKey || event.altKey)
      if (isGlobalSearchShortcut) {
        event.preventDefault()
        focusSearchInputByMode()
        return
      }
      if (key === 'f' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        if (shouldHandleFindInPreview) {
          openPreviewSearch()
          return
        }
        openEditorSearchByMode('find')
        return
      }
      if (key === 'h' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        openEditorSearchByMode('replace')
        return
      }
      if (key !== 's') return
      event.preventDefault()
      void handleSave()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activePane, focusSearchInputByMode, handleSave, openEditorSearchByMode, openPreviewSearch, shouldHandleFindInPreview])

  useEffect(() => {
    if (activePane !== 'code') return
    let timer: number | null = null
    const off = window.electronAPI.onCodeFocusSearch(() => {
      if (timer != null) {
        window.clearTimeout(timer)
      }
      timer = window.setTimeout(() => {
        focusSearchInputByMode()
        timer = null
      }, 16)
    })
    return () => {
      off()
      if (timer != null) {
        window.clearTimeout(timer)
      }
    }
  }, [activePane, focusSearchInputByMode])

  useEffect(() => {
    if (activePane !== 'code') return
    return window.electronAPI.onCodeToggleViewMode(() => {
      toggleCodeViewMode()
    })
  }, [activePane, toggleCodeViewMode])

  const showExplorerPanel = !isNarrowViewport || isExplorerOpen
  const showEditorPanel = !isNarrowViewport || !isExplorerOpen
  const showExplorerPanelForMode = viewMode === 'files' ? showExplorerPanel : true
  const showEditorPanelForMode = viewMode === 'files' ? showEditorPanel : true
  const handleToggleTreeDirectory = useCallback((relativePath: string) => {
    if (hasSearchQuery) return
    const isExpanded = expandedDirectories.has(relativePath)
    if (isExpanded) {
      setExpandedDirectories((prev) => {
        const next = new Set(prev)
        next.delete(relativePath)
        return next
      })
      return
    }
    setExpandedDirectories((prev) => {
      if (prev.has(relativePath)) return prev
      const next = new Set(prev)
      next.add(relativePath)
      return next
    })
    void loadDirectory(relativePath)
  }, [expandedDirectories, hasSearchQuery, loadDirectory])
  const handleSelectTreeFile = useCallback((relativePath: string) => {
    void openFile(relativePath)
    if (isNarrowViewport) {
      setIsExplorerOpen(false)
    }
  }, [isNarrowViewport, openFile])
  const handleOpenTreeNodeFolder = useCallback(async (relativePath: string, nodeKind: ProjectFileNodeKind) => {
    const folderPath = resolveTreeNodeFolderPath(projectPath, relativePath, nodeKind)
    const revealPath = nodeKind === 'file'
      ? joinProjectPath(projectPath, relativePath)
      : undefined
    await window.electronAPI.openFolder(folderPath, revealPath)
  }, [projectPath])
  const handleCopyTreeNodeName = useCallback((nodeName: string) => {
    void copyTextToClipboard(nodeName)
  }, [])
  const handleCopyTreeNodeRelativePath = useCallback((relativePath: string) => {
    void copyTextToClipboard(normalizeRelativePathForCopy(relativePath))
  }, [])
  const handleCopyTreeNodeRelativePathWithoutSlashes = useCallback((relativePath: string) => {
    void copyTextToClipboard(removeRelativePathSlashes(relativePath))
  }, [])

  const openFileFromQuickDrawer = useCallback((relativePath: string) => {
    void openFileWithTreeLocate(relativePath)
    if (isNarrowViewport) {
      setIsExplorerOpen(false)
    }
    setIsQuickDrawerOpen(false)
  }, [isNarrowViewport, openFileWithTreeLocate])

  const handleOpenContentSearchResult = useCallback((relativePath: string, lineNumber: number, column: number) => {
    void openContentSearchMatch(relativePath, lineNumber, column)
    setActiveContentSearchLocation({ relativePath, lineNumber, column })
    if (isNarrowViewport) {
      setIsExplorerOpen(false)
    }
  }, [isNarrowViewport, openContentSearchMatch])

  const handleOpenSmartEmptyFile = useCallback((relativePath: string) => {
    void openFileWithTreeLocate(relativePath)
    if (isNarrowViewport) {
      setIsExplorerOpen(false)
    }
  }, [isNarrowViewport, openFileWithTreeLocate])

  const handleOpenTranscriptReference = useCallback((item: CodeTranscriptReferenceItem) => {
    void openTranscript({
      projectId,
      transcriptId: item.transcriptId,
      initialMode: 'preview',
    }).then(() => {
      openTranscriptReference(item.transcriptId, item.reference.id)
    })
    onOpenTranscript?.()
  }, [onOpenTranscript, openTranscript, openTranscriptReference, projectId])

  const handleToggleContentSearchTree = useCallback(() => {
    const tree = contentSearchTreeRef.current
    if (!tree) return

    if (isContentSearchAllExpanded) {
      tree.collapseAll()
      setIsContentSearchAllExpanded(false)
      return
    }

    tree.expandAll()
    setIsContentSearchAllExpanded(true)
  }, [isContentSearchAllExpanded])

  const handleSelectOpenTab = useCallback((relativePath: string) => {
    void openFileWithTreeLocate(relativePath)
  }, [openFileWithTreeLocate])

  const handleCloseOpenTab = useCallback((relativePath: string) => {
    const normalizedPath = relativePath.trim()
    if (!normalizedPath) return

    const nextTabs = openTabPaths.filter((item) => item !== normalizedPath)
    setOpenTabPaths(nextTabs)
    setCursorPositionsByPath((prev) => {
      if (!(normalizedPath in prev)) return prev
      const next = { ...prev }
      delete next[normalizedPath]
      return next
    })

    if (activeRelativePath !== normalizedPath) return
    const nextActivePath = nextTabs[0]
    if (nextActivePath) {
      void openFileWithTreeLocate(nextActivePath)
    }
  }, [activeRelativePath, openFileWithTreeLocate, openTabPaths])
  const handleEditorCursorPositionChange = useCallback((position: { lineNumber: number; column: number }) => {
    if (!activeRelativePath) return
    setCursorPositionsByPath((prev) => {
      const current = prev[activeRelativePath]
      if (current && current.lineNumber === position.lineNumber && current.column === position.column) {
        return prev
      }

      const nextEntries = [
        [activeRelativePath, position],
        ...Object.entries(prev).filter(([pathKey]) => pathKey !== activeRelativePath),
      ].slice(0, MAX_PROJECT_CODE_SESSION_CURSOR_POSITIONS)

      return Object.fromEntries(nextEntries)
    })
  }, [activeRelativePath])

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <CodeWorkspaceChrome
        activeLanguage={activeLanguage}
        activeRelativePath={activeRelativePath}
        activePane={activePane}
        discardUnsavedConfirm={discardUnsavedConfirm}
        hasExternalChange={hasExternalChange}
        isActiveFileFavorite={isActiveFileFavorite}
        isDirty={isDirty}
        isExplorerOpen={isExplorerOpen}
        isNarrowViewport={isNarrowViewport}
        isReading={isReading}
        isReloadingFromDisk={isReloadingFromDisk}
        onCloseOpenTab={handleCloseOpenTab}
        onHandleSave={() => {
          void handleSave()
        }}
        onKeepMyChanges={() => {
          setHasExternalChange(false)
        }}
        onOpenEditorSearch={openEditorSearchByMode}
        onOpenFileFromTab={handleSelectOpenTab}
        onOpenFirstProjectLink={() => {
          if (!hasProjectDocLinks) return
          const firstDocLink = projectLinkItems.find((item) => item.kind === 'url' || item.kind === 'ssh')
          if (!firstDocLink) return
          void openUrlPopoverItem(firstDocLink)
        }}
        onPreloadPane={onPreloadPane}
        onStartAndOpenDevUrl={onStartAndOpenDevUrl}
        onOpenTranscript={onOpenTranscript}
        onOpenProjectLinksManager={onOpenProjectLinksManager}
        onReloadFromDisk={() => {
          if (!activeRelativePath) return
          void openFile(activeRelativePath, true)
        }}
        onResolveDiscardUnsavedConfirm={resolveDiscardUnsavedConfirm}
        onSetExplorerOpen={setIsExplorerOpen}
        onSetQuickDrawerOpen={setIsQuickDrawerOpen}
        onSetViewMode={setViewMode}
        onSwitchPane={onSwitchPane}
        onToggleFavorite={toggleFavoriteForPath}
        openTabs={visibleOpenTabs}
        projectFileSize={activeFileSize}
        projectHeaderCollapsed={projectHeaderCollapsed}
        projectDevUrlActionVisible={projectDevUrlActionVisible}
        projectDevUrlPending={projectDevUrlPending}
        projectDevUrlReady={projectDevUrlReady}
        projectLinkItems={projectLinkItems}
        hasProjectDocLinks={hasProjectDocLinks}
        projectLinkTagOptions={projectLinkTagOptions}
        projectName={projectName}
        readError={readError}
        saveError={saveError}
        saveIndicatorText={saveIndicatorText}
        saveIndicatorToneClass={saveIndicatorToneClass}
        saveStatus={saveStatus}
        saveText={saveText}
        showEditorSearchActions={isShowingEditor}
        skippedDirectories={tree.skippedDirectories}
        skippedFiles={tree.skippedFiles}
        viewMode={viewMode}
      />

      <CodeFileQuickDrawer
        open={isQuickDrawerOpen}
        activeRelativePath={activeRelativePath}
        favorites={quickDrawerFavorites}
        recents={quickDrawerRecents}
        onClose={() => setIsQuickDrawerOpen(false)}
        onOpenFile={openFileFromQuickDrawer}
        onToggleFavorite={toggleFavoriteForPath}
        onRemovePath={removePathFromQuickDrawer}
      />

      <div className="min-h-0 flex-1">
        <div className="code-layout-grid h-full" style={isNarrowViewport ? { gridTemplateColumns: 'minmax(0, 1fr)' } : undefined}>
          {showExplorerPanelForMode && (
            <CodeWorkspaceSidebar
              activeContentSearchLocation={activeContentSearchLocation}
              activeContentSearchScopeKey={activeContentSearchScopeKey}
              activeContentSearchScopeLabel={activeContentSearchScopeLabel}
              activeRelativePath={activeRelativePath}
              autoCollapseMatchThreshold={CONTENT_SEARCH_AUTO_COLLAPSE_MATCH_THRESHOLD}
              canToggleContentSearchTree={canToggleContentSearchTree}
              contentSearchCaseSensitive={contentSearchCaseSensitive}
              contentSearchError={contentSearchError}
              contentSearchInputRef={contentSearchInputRef}
              contentSearchQuery={contentSearchQuery}
              contentSearchResult={contentSearchResult}
              contentSearchScopeGlobs={contentSearchScopeGlobs}
              contentSearchScopeInput={contentSearchScopeInput}
              contentSearchScopePresets={contentSearchScopePresets}
              contentSearchScopeSummary={contentSearchScopeSummary}
              contentSearchToggleLabel={contentSearchToggleLabel}
              contentSearchTreeRef={contentSearchTreeRef}
              expandedDirectories={expandedDirectories}
              fileSearchError={fileSearchError}
              fileSearchInputRef={fileSearchInputRef}
              hasContentSearchScope={hasContentSearchScope}
              hasSearchQuery={hasSearchQuery}
              isContentSearchAdvancedOpen={isContentSearchAdvancedOpen}
              isSearchingContent={isSearchingContent}
              isSearchingFiles={isSearchingFiles}
              locateRequestToken={locateRequestToken}
              onApplyContentSearchScopePreset={applyContentSearchScopePreset}
              onChangeContentSearchQuery={handleContentSearchQueryChange}
              onChangeFileSearchQuery={handleFileSearchQueryChange}
              onCopyTreeNodeName={handleCopyTreeNodeName}
              onCopyTreeNodeRelativePath={handleCopyTreeNodeRelativePath}
              onCopyTreeNodeRelativePathWithoutSlashes={handleCopyTreeNodeRelativePathWithoutSlashes}
              onOpenContentSearchResult={handleOpenContentSearchResult}
              onOpenTreeNodeFolder={handleOpenTreeNodeFolder}
              onReloadTree={handleReloadTree}
              onSelectTreeFile={handleSelectTreeFile}
              onSetContentSearchAdvancedOpen={setIsContentSearchAdvancedOpen}
              onSetContentSearchCaseSensitive={setContentSearchCaseSensitive}
              onSetContentSearchScopeInput={setContentSearchScopeInput}
              onToggleContentSearchTree={handleToggleContentSearchTree}
              onToggleTreeDirectory={handleToggleTreeDirectory}
              onLocateFileInTree={locateFileInTree}
              tree={tree}
              treeNodesForView={treeNodesForView}
              viewMode={viewMode}
            />
          )}

          {showEditorPanelForMode && (
            <section className="code-editor-panel surface-card">
              <CodeWorkspaceEditorPane
                activeLanguage={activeLanguage}
                activeRelativePath={activeRelativePath}
                closeCodePreview={closeCodePreview}
                closeStructuredPreview={closeStructuredPreview}
                codePreview={codePreview}
                editorRef={editorRef}
                editorValue={editorValue}
                effectiveMarkdownPreviewMode={effectiveMarkdownPreviewMode}
                handlePasteImage={handlePasteImage}
                isInitialRestoring={isInitialRestoring}
                isMdcFile={isMdcFile}
                isMarkdownFile={isMarkdownFile}
                isNarrowViewport={isNarrowViewport}
                markdownComponents={markdownComponents}
                markdownPreviewContent={markdownPreviewContent}
                monacoTheme={monacoTheme}
                onCaptureCurrentModeScroll={captureCurrentModeScroll}
                onChangeEditorValue={setEditorValue}
                onClosePreviewSearch={closePreviewSearch}
                onEditorScrollStateChange={handleEditorScrollStateChange}
                onFocusSearch={focusSearchInputByMode}
                onGoToNextPreviewSearchMatch={goToNextPreviewSearchMatch}
                onGoToPreviousPreviewSearchMatch={goToPreviousPreviewSearchMatch}
                onHandleSave={() => {
                  void handleSave()
                }}
                onPreviewScroll={handlePreviewScroll}
                onSetActivePreviewSearchMatchIndex={setActivePreviewSearchMatchIndex}
                onSetCursorPosition={handleEditorCursorPositionChange}
                onSetMarkdownPreviewMode={setMarkdownPreviewMode}
                onSetPreviewSearchQuery={setPreviewSearchQuery}
                onOpenSmartEmptyFile={handleOpenSmartEmptyFile}
                onOpenTranscriptReference={handleOpenTranscriptReference}
                parsedMarkdownDoc={parsedMarkdownDoc}
                previewScrollRef={previewScrollRef}
                previewSearchInputRef={previewSearchInputRef}
                previewSearchMatches={previewSearchMatches}
                previewSearchQuery={previewSearchQuery}
                previewSearchVisible={previewSearchVisible}
                previewSearchMatchIndex={activePreviewSearchMatchIndex}
                structuredPreview={structuredPreview}
                structuredPreviewComponents={structuredPreviewComponents}
                smartEmptyFiles={smartEmptyFiles}
                transcriptReferences={activeTranscriptReferences}
                viewMode={viewMode}
              />
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
