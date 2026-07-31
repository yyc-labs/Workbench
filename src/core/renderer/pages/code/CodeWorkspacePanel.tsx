import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { shallow } from 'zustand/shallow'
import type { ProjectFileReadResult, TranscriptFileReference } from '../../../shared/types'
import type { ProjectPanePreload } from '../../components/ProjectPaneTabs'
import { SidebarGestureOverlay } from '../../components/SidebarGestureOverlay'
import { openUrlPopoverItem, type UrlPopoverItem } from '../../components/UrlPopover'
import { useSidebarGesture } from '../../hooks/useSidebarGesture'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { CodeContentSearchTree, type CodeContentSearchTreeHandle } from './CodeContentSearchTree'
import { CodeFileQuickDrawer } from './CodeFileQuickDrawer'
import { CodeSidebarRailButton } from './CodeSidebarRailButton'
import { CodeWorkspaceChrome } from './CodeWorkspaceChrome'
import { CodeWorkspaceEditorPane } from './CodeWorkspaceEditorPane'
import { CodeWorkspaceSidebar } from './CodeWorkspaceSidebar'
import { inferLanguageFromRelativePath, pushRecentCodeFilePath, removeCodeFilePathFromDrawerState, toggleFavoriteCodeFilePath } from './code.helpers'
import { revealMarkdownPreviewSourceLine } from './code.markdownShared'
import type { CodeWorkspaceNavigationState } from './code.navigation'
import { buildKnownFilePathSet } from './code.tree'
import type { MonacoCodeEditorHandle } from './MonacoCodeEditor'
import { useCodeFileState } from './useCodeFileState'
import { useCodeTreePathActions } from './useCodeTreePathActions'
import { type ContentSearchScopePreset, useCodeWorkspaceExplorerState } from './useCodeWorkspaceExplorerState'
import { useCodeWorkspaceRestoreState } from './useCodeWorkspaceRestoreState'
import { useCodeWorkspaceScrollSync } from './useCodeWorkspaceScrollSync'
import { useMarkdownPreviewModeState } from './useMarkdownPreviewModeState'
import { useMarkdownPreviewSearch } from './useMarkdownPreviewSearch'
import { appendProjectCodeTab, CODE_FILE_DRAWER_SECTION_LIMIT, MAX_PROJECT_CODE_SESSION_CURSOR_POSITIONS, normalizeProjectCodeSession } from './useProjectCodeSession'
import { useProjectCodeSessionState } from './useProjectCodeSessionState'
import { useTranscriptFileReferences } from './useTranscriptFileReferences'

const NARROW_VIEWPORT_QUERY = '(max-width: 960px)'
const CONTENT_SEARCH_AUTO_COLLAPSE_MATCH_THRESHOLD = 10
const TRANSCRIPT_SUMMARY_LOAD_DELAY_MS = 160
const CODE_LEFT_SIDEBAR_COLLAPSED_STORAGE_KEY = 'app:code-left-sidebar-collapsed'
const SMART_EMPTY_FILE_CANDIDATES = ['README.md', 'readme.md', 'AGENTS.md', 'AGENT.md', 'package.json', 'src/main.tsx', 'src/main.ts', 'src/index.tsx', 'src/index.ts', 'src/App.tsx', 'src/App.ts', 'app/page.tsx', 'pages/index.tsx', 'main.py']
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
  const { t } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
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
  const persistedProjectCodeSession = useMemo(() => normalizeProjectCodeSession(rawPersistedProjectCodeSession), [rawPersistedProjectCodeSession])
  const persistedLastMarkdownPreviewMode = projectCodeMeta?.lastMarkdownPreviewMode
  const persistedCodeFileDrawerState = projectCodeMeta?.codeFileDrawerState
  const setProjectCodeSession = useAppStore((s) => s.setProjectCodeSession)
  const setProjectLastCodeFile = useAppStore((s) => s.setProjectLastCodeFile)
  const setProjectLastMarkdownPreviewMode = useAppStore((s) => s.setProjectLastMarkdownPreviewMode)
  const setProjectCodeFileDrawerState = useAppStore((s) => s.setProjectCodeFileDrawerState)
  const transcriptSummaries = useAppStore((s) => s.transcriptSummariesByProjectId[projectId] ?? [], shallow)
  const transcriptListStatus = useAppStore((s) => s.transcriptListStatusByProjectId[projectId] ?? 'idle')
  const loadProjectTranscripts = useAppStore((s) => s.loadProjectTranscripts)
  const openTranscript = useAppStore((s) => s.openTranscript)
  const openTranscriptReference = useAppStore((s) => s.openTranscriptReference)
  const [isNarrowViewport, setIsNarrowViewport] = useState(() => window.matchMedia(NARROW_VIEWPORT_QUERY).matches)
  const [isExplorerOpen, setIsExplorerOpen] = useState(() => !window.matchMedia(NARROW_VIEWPORT_QUERY).matches)
  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(CODE_LEFT_SIDEBAR_COLLAPSED_STORAGE_KEY) === '1'
  })
  const [isQuickDrawerOpen, setIsQuickDrawerOpen] = useState(false)
  const [viewMode, setViewMode] = useState<CodeViewMode>('files')
  const [contentSearchScopeInput, setContentSearchScopeInput] = useState(() => persistedProjectCodeSession?.contentSearchScope ?? '')
  const [activeContentSearchLocation, setActiveContentSearchLocation] = useState<{
    relativePath: string
    lineNumber: number
    column: number
  } | null>(null)
  const [locateRequestToken, setLocateRequestToken] = useState(0)
  const editorRef = useRef<MonacoCodeEditorHandle | null>(null)
  const contentSearchTreeRef = useRef<CodeContentSearchTreeHandle | null>(null)
  const previewScrollRef = useRef<HTMLDivElement | null>(null)
  const pageRootRef = useRef<HTMLDivElement | null>(null)
  const fileSearchInputRef = useRef<HTMLInputElement | null>(null)
  const contentSearchInputRef = useRef<HTMLInputElement | null>(null)
  const captureCurrentModeScrollRef = useRef<() => void>(() => {})
  const markOpenedFileInExplorerRef = useRef<(relativePath: string) => void>(() => {})
  const handleOpenedCodeFileRef = useRef<(relativePath: string) => void>(() => {})
  const resetScrollSyncStateRef = useRef<() => void>(() => {})
  const pendingLocateAfterTreeReloadRef = useRef<string | null>(null)
  const handleBeforeOpenCodeFile = useCallback(() => {
    captureCurrentModeScrollRef.current()
  }, [])
  const handleDidOpenCodeFile = useCallback((result: ProjectFileReadResult) => {
    const nextPath = result.relativePath.trim()
    if (nextPath) {
      setOpenTabPaths((prev) => appendProjectCodeTab(prev, nextPath))
      handleOpenedCodeFileRef.current(nextPath)
    }

    resetScrollSyncStateRef.current()
    markOpenedFileInExplorerRef.current(result.relativePath)
    setCodeFileDrawerState((prev) => pushRecentCodeFilePath(prev, result.relativePath))
  }, [])
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
    navigateFileHistory,
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
  const handleMarkdownProjectFileLinkClick = useCallback(
    (relativePath: string) => {
      void openFile(relativePath)
    },
    [openFile],
  )
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
    refreshRootIfStale,
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
    treeAutoLoadPaused: !isNarrowViewport && isLeftSidebarCollapsed,
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
    isMarkdownPreviewStale,
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
    onProjectFileLinkClick: handleMarkdownProjectFileLinkClick,
    setProjectLastMarkdownPreviewMode,
    themeMode,
  })
  const activeLanguage = activeFile?.language ?? inferLanguageFromRelativePath(activeRelativePath ?? '')
  const activeFileSize = activeFile?.size ?? 0
  const { previewSearchVisible, previewSearchQuery, setPreviewSearchQuery, activePreviewSearchMatchIndex, setActivePreviewSearchMatchIndex, previewSearchMatches, previewSearchInputRef, closePreviewSearch, openPreviewSearch, goToNextPreviewSearchMatch, goToPreviousPreviewSearchMatch } = useMarkdownPreviewSearch(
    previewScrollRef,
    shouldHandleFindInPreview,
    markdownPreviewContent,
  )
  const { codeFileDrawerState, cursorPositionsByPath, isRestoringCodeSessionRef, openTabPaths, setCodeFileDrawerState, setCursorPositionsByPath, setOpenTabPaths, visibleOpenTabs } = useProjectCodeSessionState({
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
  const allProjectFilePathSet = useMemo(
    () => buildKnownFilePathSet(tree.knownFilePaths, openTabPaths, activeRelativePath, codeFileDrawerState, persistedProjectCodeSession, persistedLastCodeFile),
    [activeRelativePath, codeFileDrawerState, openTabPaths, persistedLastCodeFile, persistedProjectCodeSession, tree.knownFilePaths],
  )
  const smartEmptyFiles = useMemo(() => {
    const available = new Set(allProjectFilePathSet)
    const candidates = SMART_EMPTY_FILE_CANDIDATES.filter((path) => available.has(path))
    const fallback = Array.from(available)
      .filter((path) => /\.(md|mdx|json|tsx?|jsx?|py|yml|yaml)$/i.test(path))
      .sort((a, b) => a.length - b.length || a.localeCompare(b))
    return Array.from(new Set([...candidates, ...fallback])).slice(0, 4)
  }, [allProjectFilePathSet])
  const activeTranscriptReferences = useTranscriptFileReferences({
    activePane,
    projectId,
    relativePath: activeRelativePath,
    transcriptListStatus,
    transcriptSummaries,
  })
  const locateFileInTree = useCallback(
    async (relativePath: string) => {
      if (tree.autoLoadBlocked) return
      const normalizedPath = relativePath.trim()
      if (!normalizedPath) return
      await ensureTreePathLoaded(normalizedPath)
      setLocateRequestToken((prev) => prev + 1)
    },
    [ensureTreePathLoaded, tree.autoLoadBlocked],
  )
  const openFileWithTreeLocate = useCallback(
    async (relativePath: string, forceReload = false): Promise<boolean> => {
      const normalizedPath = relativePath.trim()
      if (!normalizedPath) return false

      const opened = await openFile(normalizedPath, forceReload)
      if (!opened) return false

      await locateFileInTree(normalizedPath)
      return true
    },
    [locateFileInTree, openFile],
  )
  const { captureCurrentModeScroll, handleEditorScrollStateChange, handlePreviewScroll, resetScrollSyncState } = useCodeWorkspaceScrollSync({
    activeRelativePath,
    editorRef,
    isMarkdownFile,
    isShowingEditor,
    isShowingPreview,
    markdownPreviewContent,
    previewMode: effectiveMarkdownPreviewMode,
    previewScrollRef,
  })
  const { handleOpenedCodeFile, isRestoringCodeSession, openContentSearchMatch } = useCodeWorkspaceRestoreState({
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
    treeStatus: tree.status === 'ready' || tree.autoLoadBlocked || (!isNarrowViewport && isLeftSidebarCollapsed) ? 'ready' : tree.status,
  })
  const hasRestorableCodeSession = useMemo(() => {
    const persistedTabs = persistedProjectCodeSession?.tabs ?? []
    return Boolean(persistedLastCodeFile?.trim() || persistedProjectCodeSession?.activePath?.trim() || persistedTabs.some((path) => path.trim().length > 0))
  }, [persistedLastCodeFile, persistedProjectCodeSession])
  const isTreeReadyForRestore = tree.status === 'ready' || tree.autoLoadBlocked || (!isNarrowViewport && isLeftSidebarCollapsed)
  const isInitialRestoring = !activeRelativePath && (isReading || (tree.status !== 'error' && (!isTreeReadyForRestore || (isRestoringCodeSession && hasRestorableCodeSession))))
  captureCurrentModeScrollRef.current = captureCurrentModeScroll
  markOpenedFileInExplorerRef.current = markFilePathKnown
  handleOpenedCodeFileRef.current = handleOpenedCodeFile
  resetScrollSyncStateRef.current = resetScrollSyncState
  const quickDrawerFavorites = useMemo(() => codeFileDrawerState.favorites.filter((path) => allProjectFilePathSet.has(path)).slice(0, CODE_FILE_DRAWER_SECTION_LIMIT), [allProjectFilePathSet, codeFileDrawerState.favorites])
  const quickDrawerRecents = useMemo(() => codeFileDrawerState.recents.filter((path) => allProjectFilePathSet.has(path)).slice(0, CODE_FILE_DRAWER_SECTION_LIMIT), [allProjectFilePathSet, codeFileDrawerState.recents])
  const quickDrawerFilePaths = useMemo(() => Array.from(allProjectFilePathSet).sort((left, right) => left.localeCompare(right)), [allProjectFilePathSet])
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
    const pendingPath = pendingLocateAfterTreeReloadRef.current
    if (!pendingPath) return

    if (tree.status === 'error') {
      pendingLocateAfterTreeReloadRef.current = null
      return
    }

    if (tree.status !== 'ready' || tree.isRefreshingRoot) return
    pendingLocateAfterTreeReloadRef.current = null
    void locateFileInTree(pendingPath)
  }, [locateFileInTree, tree.isRefreshingRoot, tree.lastRootLoadedAtMs, tree.status])

  const toggleFavoriteForPath = useCallback((relativePath: string) => {
    setCodeFileDrawerState((prev) => toggleFavoriteCodeFilePath(prev, relativePath))
  }, [])

  const removePathFromQuickDrawer = useCallback((relativePath: string) => {
    setCodeFileDrawerState((prev) => removeCodeFilePathFromDrawerState(prev, relativePath))
  }, [])
  const handleReloadTree = useCallback(() => {
    const normalizedPath = activeRelativePath?.trim() ?? ''
    pendingLocateAfterTreeReloadRef.current = normalizedPath || null
    void loadTree({ reason: 'manual-refresh' })
  }, [activeRelativePath, loadTree])
  const handleExpandSidebar = useCallback(() => {
    setIsLeftSidebarCollapsed(false)
    refreshRootIfStale()
  }, [refreshRootIfStale])
  const sidebarGestureOverlay = useSidebarGesture({
    pageRootRef,
    onToggleLeftSidebar: () => {
      if (isNarrowViewport) {
        setIsExplorerOpen((current) => !current)
        return
      }
      if (isLeftSidebarCollapsed) {
        handleExpandSidebar()
        return
      }
      setIsLeftSidebarCollapsed(true)
    },
  })
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

  useEffect(() => {
    window.localStorage.setItem(CODE_LEFT_SIDEBAR_COLLAPSED_STORAGE_KEY, isLeftSidebarCollapsed ? '1' : '0')
  }, [isLeftSidebarCollapsed])

  const focusSearchInputByMode = useCallback(() => {
    const focusTarget = () => {
      const target = viewMode === 'search' ? contentSearchInputRef.current : fileSearchInputRef.current
      if (!target) return
      target.focus()
      target.select()
    }

    if (!isNarrowViewport && isLeftSidebarCollapsed) {
      setIsLeftSidebarCollapsed(false)
      refreshRootIfStale()
      window.setTimeout(() => {
        focusTarget()
      }, 0)
      return
    }

    if (isNarrowViewport && !isExplorerOpen) {
      setIsExplorerOpen(true)
      window.setTimeout(() => {
        focusTarget()
      }, 0)
      return
    }

    focusTarget()
  }, [contentSearchInputRef, fileSearchInputRef, isExplorerOpen, isLeftSidebarCollapsed, isNarrowViewport, refreshRootIfStale, viewMode])

  const openEditorSearchByMode = useCallback(
    (mode: EditorSearchMode = 'find') => {
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
    },
    [activeRelativePath, focusSearchInputByMode, isExplorerOpen, isNarrowViewport, isShowingEditor],
  )

  const toggleCodeViewMode = useCallback(() => {
    setViewMode((prev) => (prev === 'files' ? 'search' : 'files'))
    if (isNarrowViewport && !isExplorerOpen) {
      setIsExplorerOpen(true)
    }
  }, [isExplorerOpen, isNarrowViewport])

  useEffect(() => {
    if (activePane !== 'code') return
    const onFileHistoryKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      event.stopPropagation()
      void navigateFileHistory(event.key === 'ArrowLeft' ? -1 : 1)
    }
    window.addEventListener('keydown', onFileHistoryKeyDown, true)
    return () => window.removeEventListener('keydown', onFileHistoryKeyDown, true)
  }, [activePane, navigateFileHistory])

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

  const showExplorerPanel = isNarrowViewport ? isExplorerOpen : !isLeftSidebarCollapsed
  const showEditorPanel = !isNarrowViewport || !isExplorerOpen
  const showExplorerPanelForMode = viewMode === 'files' ? showExplorerPanel : isNarrowViewport ? true : !isLeftSidebarCollapsed
  const showEditorPanelForMode = viewMode === 'files' ? showEditorPanel : true
  const layoutGridStyle = isNarrowViewport ? { gridTemplateColumns: 'minmax(0, 1fr)' } : isLeftSidebarCollapsed ? { gridTemplateColumns: '44px minmax(0, 1fr)' } : undefined
  const handleToggleTreeDirectory = useCallback(
    (relativePath: string) => {
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
    },
    [expandedDirectories, hasSearchQuery, loadDirectory],
  )
  const { handleCopyTreeNodeName, handleCopyTreeNodeRelativePath, handleCopyTreeNodeRelativePathWithoutSlashes, handleOpenContentSearchResult, handleOpenSmartEmptyFile, handleOpenTreeNodeFolder, handleSelectTreeFile, openFileFromQuickDrawer } = useCodeTreePathActions({
    isNarrowViewport,
    openContentSearchMatch,
    openFile,
    openFileWithTreeLocate,
    projectPath,
    setActiveContentSearchLocation,
    setIsExplorerOpen,
    setIsQuickDrawerOpen,
  })

  useEffect(() => {
    const revealTarget = (location.state as CodeWorkspaceNavigationState | null)?.revealTarget
    if (!revealTarget) return
    if (!revealTarget.relativePath.trim()) return

    void openContentSearchMatch(revealTarget.relativePath, revealTarget.lineNumber, revealTarget.column)
    setActiveContentSearchLocation({
      relativePath: revealTarget.relativePath,
      lineNumber: revealTarget.lineNumber,
      column: revealTarget.column,
    })

    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, navigate, openContentSearchMatch])

  const handleOpenTranscriptReference = useCallback(
    (item: TranscriptFileReference) => {
      void openTranscript({
        projectId,
        transcriptId: item.transcriptId,
        initialMode: 'preview',
      }).then(() => {
        openTranscriptReference(item.transcriptId, item.reference.id)
      })
      onOpenTranscript?.()
    },
    [onOpenTranscript, openTranscript, openTranscriptReference, projectId],
  )

  const handleSaveFromEditor = useCallback(() => {
    void handleSave()
  }, [handleSave])

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

  const handleSelectOpenTab = useCallback(
    (relativePath: string) => {
      void openFileWithTreeLocate(relativePath)
    },
    [openFileWithTreeLocate],
  )

  const handleCloseOpenTab = useCallback(
    (relativePath: string) => {
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
      const nextActivePath = nextTabs[nextTabs.length - 1]
      if (nextActivePath) {
        void openFileWithTreeLocate(nextActivePath)
      }
    },
    [activeRelativePath, openFileWithTreeLocate, openTabPaths],
  )
  const handleEditorCursorPositionChange = useCallback(
    (position: { lineNumber: number; column: number }) => {
      if (!activeRelativePath) return
      setCursorPositionsByPath((prev) => {
        const current = prev[activeRelativePath]
        if (current && current.lineNumber === position.lineNumber && current.column === position.column) {
          return prev
        }

        const nextEntries = [[activeRelativePath, position], ...Object.entries(prev).filter(([pathKey]) => pathKey !== activeRelativePath)].slice(0, MAX_PROJECT_CODE_SESSION_CURSOR_POSITIONS)

        return Object.fromEntries(nextEntries)
      })
    },
    [activeRelativePath],
  )

  return (
    <div ref={pageRootRef} className="relative flex h-full min-h-0 flex-col">
      <SidebarGestureOverlay overlay={sidebarGestureOverlay} />
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
        filePaths={quickDrawerFilePaths}
        favorites={quickDrawerFavorites}
        recents={quickDrawerRecents}
        onClose={() => setIsQuickDrawerOpen(false)}
        onOpenFile={openFileFromQuickDrawer}
        onToggleFavorite={toggleFavoriteForPath}
        onRemovePath={removePathFromQuickDrawer}
      />

      <div className="min-h-0 flex-1">
        <div className="code-layout-grid h-full" style={layoutGridStyle}>
          {!isNarrowViewport && isLeftSidebarCollapsed ? (
            <div className="relative flex h-full min-h-0 items-center justify-center">
              <CodeSidebarRailButton side="left" collapsed onClick={handleExpandSidebar} className="z-20" ariaLabel={t('codeWorkspace.expandSidebar')} />
            </div>
          ) : null}
          {showExplorerPanelForMode && (
            <div className="relative flex h-full min-h-0">
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
              {!isNarrowViewport && <CodeSidebarRailButton side="left" collapsed={false} onClick={() => setIsLeftSidebarCollapsed(true)} className="absolute -right-4 top-1/2 z-20 -translate-y-1/2" ariaLabel={t('codeWorkspace.collapseSidebar')} />}
            </div>
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
                isMarkdownPreviewStale={isMarkdownPreviewStale}
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
                onHandleSave={handleSaveFromEditor}
                onPreviewScroll={handlePreviewScroll}
                onSetActivePreviewSearchMatchIndex={setActivePreviewSearchMatchIndex}
                onSetCursorPosition={handleEditorCursorPositionChange}
                onSetMarkdownPreviewMode={setMarkdownPreviewMode}
                onSetPreviewSearchQuery={setPreviewSearchQuery}
                onOpenSmartEmptyFile={handleOpenSmartEmptyFile}
                onOpenTranscriptReference={handleOpenTranscriptReference}
                parsedMarkdownDoc={parsedMarkdownDoc}
                previewRootRef={previewScrollRef}
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
