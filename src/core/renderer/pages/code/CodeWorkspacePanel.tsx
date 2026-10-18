import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { shallow } from 'zustand/shallow'
import type { ProjectFileNodeKind, ProjectFileReadResult, TranscriptFileReference } from '../../../shared/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import type { ProjectPanePreload } from '../../components/ProjectPaneTabs'
import { SidebarGestureHost } from '../../components/SidebarGestureHost'
import { openUrlPopoverItem, type UrlPopoverItem } from '../../components/UrlPopover'
import { Input } from '../../components/ui/input'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { CodeContentSearchTree, type CodeContentSearchTreeHandle } from './CodeContentSearchTree'
import { CodeFileQuickDrawer } from './CodeFileQuickDrawer'
import { CodeSidebarRailButton } from './CodeSidebarRailButton'
import { CodeTreeContextMenu } from './CodeTreeContextMenu'
import { CodeWorkspaceChrome } from './CodeWorkspaceChrome'
import { CodeWorkspaceEditorPane } from './CodeWorkspaceEditorPane'
import { CodeWorkspaceSidebar } from './CodeWorkspaceSidebar'
import { readContentSearchHistory, recordContentSearchHistory } from './code.contentSearchHistory'
import { inferLanguageFromRelativePath, pushRecentCodeFilePath, removeCodeFilePathFromDrawerState, toggleFavoriteCodeFilePath } from './code.helpers'
import { resolveMarkdownLinkTarget } from './code.markdownLinkTarget'
import { revealMarkdownPreviewSourceLine } from './code.markdownShared'
import type { CodeWorkspaceNavigationState } from './code.navigation'
import { resolveTreeNodeSearchScope } from './code.pathActions'
import { buildKnownFilePathSet } from './code.tree'
import { FolderFileSearchPopover } from './FolderFileSearchPopover'
import type { MonacoCodeEditorHandle } from './MonacoCodeEditor'
import { TranscriptContentDrawer, type TranscriptContentDrawerTarget } from './TranscriptContentDrawer'
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
const CODE_LEFT_SIDEBAR_WIDTH_STORAGE_KEY = 'app:code-left-sidebar-width'
// 文件树宽度约束（px）：保留最小树宽与最小编辑器可用宽度，避免拖拽到不可用比例
const CODE_TREE_MIN_WIDTH = 200
const CODE_TREE_MAX_WIDTH = 560
const CODE_TREE_MIN_EDITOR_WIDTH = 360
const CODE_TREE_DEFAULT_WIDTH = 280
const CODE_TREE_RESIZE_LONG_PRESS_MS = 48

function readPersistedTreeWidth(): number | null {
  try {
    const raw = window.localStorage.getItem(CODE_LEFT_SIDEBAR_WIDTH_STORAGE_KEY)
    if (!raw) return null
    const value = Number(raw)
    if (!Number.isFinite(value) || value <= 0) return null
    return Math.min(CODE_TREE_MAX_WIDTH, Math.max(CODE_TREE_MIN_WIDTH, value))
  } catch {
    return null
  }
}

function clampTreeWidth(width: number): number {
  const maxWidth = Math.min(CODE_TREE_MAX_WIDTH, window.innerWidth - CODE_TREE_MIN_EDITOR_WIDTH)
  return Math.min(maxWidth, Math.max(CODE_TREE_MIN_WIDTH, width))
}
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
  onOpenStartupLogs?: () => void
  onOpenTranscript?: () => void
  onOpenProjectLinksManager?: () => void
  onOpenRunTasks?: () => void
  runTasksActive?: boolean
  onRequestProjectContextMenu?: (x: number, y: number) => void
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
  onOpenStartupLogs,
  onOpenTranscript,
  onOpenProjectLinksManager,
  onOpenRunTasks,
  runTasksActive,
  onRequestProjectContextMenu,
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
  // 终端集合面板（Ctrl+J）：chrome 入口按钮 + 运行中徽标（纯 store 派生，面板隐藏时也准确）。
  const revealTerminal = useAppStore((s) => s.revealTerminal)
  const terminalPanelActive = useAppStore((s) => !s.floatingPanel.hidden && s.collectionActiveProjectId === projectId)
  const terminalPanelProcesses = useAppStore((s) => s.processes)
  const terminalPanelRunTaskStates = useAppStore((s) => s.runTaskStates[projectId])
  const terminalRunningCount = useMemo(() => {
    let count = 0
    for (const [key, info] of Object.entries(terminalPanelProcesses)) {
      if (key !== projectId && !key.startsWith(`${projectId}::`)) continue
      if (info.status === 'running' || info.status === 'stopping') count += 1
    }
    for (const taskState of Object.values(terminalPanelRunTaskStates ?? {})) {
      if (taskState.state === 'ready' || taskState.state === 'running') count += 1
    }
    return count
  }, [projectId, terminalPanelProcesses, terminalPanelRunTaskStates])
  const transcriptSummaries = useAppStore((s) => s.transcriptSummariesByProjectId[projectId] ?? [], shallow)
  const treeAutoLoadFileLimit = useAppStore((s) => s.config.codeTreeAutoLoadFileLimit ?? 4000)
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
  const [leftSidebarWidth, setLeftSidebarWidth] = useState<number | null>(() => readPersistedTreeWidth())
  const [isResizingTree, setIsResizingTree] = useState(false)
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
  const layoutGridRef = useRef<HTMLDivElement | null>(null)
  // 拖拽过程中的临时状态，全部走 ref，避免 pointermove 触发的 React 重渲染
  const treeResizeRef = useRef<{ startX: number; startWidth: number; rafId: number | null; latestX: number } | null>(null)
  const captureCurrentModeScrollRef = useRef<() => void>(() => {})
  const markOpenedFileInExplorerRef = useRef<(relativePath: string) => void>(() => {})
  const handleOpenedCodeFileRef = useRef<(relativePath: string) => void>(() => {})
  const resetScrollSyncStateRef = useRef<() => void>(() => {})
  const pendingLocateAfterTreeReloadRef = useRef<string | null>(null)
  const pendingSearchInputFocusModeRef = useRef<CodeViewMode | null>(null)
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
  const { activeFile, activeKind, binaryDataUrl, editorValue, setEditorValue, activeRelativePath, isReading, saveStatus, discardUnsavedConfirm, resolveDiscardUnsavedConfirm, isDirty, openFile, openExcludedEntry, navigateFileHistory, handleSave, saveText, saveIndicatorText, saveIndicatorToneClass } = useCodeFileState({
    projectId,
    projectPath,
    persistedLastCodeFile,
    onBeforeOpenFile: handleBeforeOpenCodeFile,
    onDidOpenFile: handleDidOpenCodeFile,
  })
  const handleMarkdownProjectFileLinkClick = useCallback(
    (relativePath: string) => {
      if (!projectPath) {
        void openFile(relativePath)
        return
      }
      void resolveMarkdownLinkTarget(projectPath, relativePath).then((target) => {
        void openFile(target ?? relativePath)
      })
    },
    [openFile, projectPath],
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
    excludedPathKinds,
    expandedDirectories,
    fileSearchError,
    fileSearchLineTarget,
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
    treeAutoLoadFileLimit,
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
  const { previewSearchVisible, previewSearchQuery, setPreviewSearchQuery, cyclePreviewSearchHistory, activePreviewSearchMatchIndex, setActivePreviewSearchMatchIndex, previewSearchMatches, previewSearchInputRef, closePreviewSearch, openPreviewSearch, goToNextPreviewSearchMatch, goToPreviousPreviewSearchMatch } =
    useMarkdownPreviewSearch(previewScrollRef, shouldHandleFindInPreview, markdownPreviewContent)
  const excludedPaths = useMemo(() => new Set(excludedPathKinds.keys()), [excludedPathKinds])
  const { codeFileDrawerState, cursorPositionsByPath, isRestoringCodeSessionRef, openTabPaths, setCodeFileDrawerState, setCursorPositionsByPath, setOpenTabPaths, visibleOpenTabs } = useProjectCodeSessionState({
    projectId,
    persistedProjectCodeSession,
    persistedCodeFileDrawerState,
    persistedLastCodeFile,
    activeRelativePath,
    contentSearchScopeInput,
    setContentSearchScopeInput,
    knownFilePaths: tree.knownFilePaths,
    excludedPaths,
    treeStatus: tree.status,
    setProjectCodeSession,
    setProjectCodeFileDrawerState,
    setProjectLastCodeFile,
  })
  const allProjectFilePathSet = useMemo(
    () => buildKnownFilePathSet(tree.knownFilePaths, openTabPaths, activeRelativePath, codeFileDrawerState, persistedProjectCodeSession, persistedLastCodeFile, excludedPaths),
    [activeRelativePath, codeFileDrawerState, excludedPaths, openTabPaths, persistedLastCodeFile, persistedProjectCodeSession, tree.knownFilePaths],
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

      // 被排除条目在树中进入解释视图；tab / 会话恢复等入口点击同样拦截，避免走文件读取。
      const excludedKind = excludedPathKinds.get(normalizedPath)
      if (excludedKind) {
        return openExcludedEntry(normalizedPath, excludedKind)
      }

      const opened = await openFile(normalizedPath, forceReload)
      if (!opened) return false

      await locateFileInTree(normalizedPath)
      return true
    },
    [excludedPathKinds, locateFileInTree, openExcludedEntry, openFile],
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

  // 文件树宽度拖拽：长按折叠按钮进入，松手时一次性写入 state 与 localStorage。
  // 拖拽过程中只通过 rAF 直写 grid 的 inline style，不触发 React 重渲染。
  const applyTreeWidthStyle = useCallback((width: number) => {
    const grid = layoutGridRef.current
    if (grid) grid.style.gridTemplateColumns = `${width}px minmax(0, 1fr)`
  }, [])

  const handleTreeResizeMove = useCallback(
    (event: PointerEvent) => {
      const state = treeResizeRef.current
      if (!state) return
      state.latestX = event.clientX
      if (state.rafId === null) {
        state.rafId = window.requestAnimationFrame(() => {
          const current = treeResizeRef.current
          if (!current) return
          current.rafId = null
          applyTreeWidthStyle(clampTreeWidth(current.startWidth + (current.latestX - current.startX)))
        })
      }
    },
    [applyTreeWidthStyle],
  )

  const endTreeResize = useCallback(() => {
    const state = treeResizeRef.current
    window.removeEventListener('pointermove', handleTreeResizeMove)
    window.removeEventListener('pointerup', endTreeResize)
    window.removeEventListener('pointercancel', endTreeResize)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    setIsResizingTree(false)
    if (!state) return
    if (state.rafId !== null) window.cancelAnimationFrame(state.rafId)
    const finalWidth = clampTreeWidth(state.startWidth + (state.latestX - state.startX))
    treeResizeRef.current = null
    applyTreeWidthStyle(finalWidth)
    setLeftSidebarWidth(finalWidth)
    try {
      window.localStorage.setItem(CODE_LEFT_SIDEBAR_WIDTH_STORAGE_KEY, String(finalWidth))
    } catch {
      // 隐私模式等场景下 localStorage 不可写，忽略即可
    }
  }, [applyTreeWidthStyle, handleTreeResizeMove])

  const startTreeResize = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const grid = layoutGridRef.current
      if (!grid) return
      // 读取 grid 实际解析后的第一列像素宽度（文件树列），而非容器总宽；
      // 否则未存宽度时 startWidth 会取到整个内容区宽度，被 clamp 直接顶到上限。
      let startWidth = CODE_TREE_DEFAULT_WIDTH
      if (leftSidebarWidth) {
        startWidth = leftSidebarWidth
      } else {
        const trackWidths = window
          .getComputedStyle(grid)
          .gridTemplateColumns.split(' ')
          .map((value) => Number.parseFloat(value))
        if (trackWidths.length > 0 && Number.isFinite(trackWidths[0]) && trackWidths[0] > 0) {
          startWidth = trackWidths[0]
        }
      }
      treeResizeRef.current = { startX: event.clientX, startWidth, rafId: null, latestX: event.clientX }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('pointermove', handleTreeResizeMove)
      window.addEventListener('pointerup', endTreeResize)
      window.addEventListener('pointercancel', endTreeResize)
      setIsResizingTree(true)
    },
    [applyTreeWidthStyle, endTreeResize, handleTreeResizeMove, leftSidebarWidth],
  )
  const isActiveFileFavorite = Boolean(activeRelativePath && codeFileDrawerState.favorites.includes(activeRelativePath))
  // #11-2：全局搜索历史（localStorage，上限 20），交互模型复刻 useMonacoSearchWidget 的内存态历史。
  const contentSearchHistoryRef = useRef<string[]>([])
  const contentSearchHistoryIndexRef = useRef(-1)
  const contentSearchHistoryDraftRef = useRef('')
  const contentSearchQueryRef = useRef('')
  // 程序化回填标记：syncValue effect 会把回填值经 emitQuery 再次上抛，需跳过历史记录，否则翻阅历史会重排历史顺序。
  const expectedExternalContentSearchQueryRef = useRef<string | null>(null)
  const handleFileSearchQueryChange = useCallback((nextValue: string) => {
    setFileSearchQuery(nextValue)
  }, [])
  const handleContentSearchQueryChange = useCallback((nextValue: string) => {
    contentSearchQueryRef.current = nextValue
    if (expectedExternalContentSearchQueryRef.current !== null) {
      if (nextValue === expectedExternalContentSearchQueryRef.current) {
        expectedExternalContentSearchQueryRef.current = null // 程序化回填，不记录
      }
    } else {
      contentSearchHistoryIndexRef.current = -1
      contentSearchHistoryDraftRef.current = ''
      if (nextValue.trim()) {
        contentSearchHistoryRef.current = recordContentSearchHistory(nextValue)
      }
    }
    setContentSearchQuery(nextValue)
  }, [])
  const cycleContentSearchHistory = useCallback((direction: 'older' | 'newer') => {
    if (contentSearchHistoryRef.current.length === 0) {
      contentSearchHistoryRef.current = readContentSearchHistory()
    }
    const history = contentSearchHistoryRef.current
    if (history.length === 0) return

    const currentIndex = contentSearchHistoryIndexRef.current
    if (currentIndex === -1) {
      contentSearchHistoryDraftRef.current = contentSearchQueryRef.current
    }
    const nextIndex = direction === 'older' ? (currentIndex === -1 ? 0 : Math.min(history.length - 1, currentIndex + 1)) : currentIndex === -1 ? -1 : currentIndex - 1
    contentSearchHistoryIndexRef.current = nextIndex
    const nextQuery = nextIndex === -1 ? contentSearchHistoryDraftRef.current : history[nextIndex]
    expectedExternalContentSearchQueryRef.current = nextQuery
    setContentSearchQuery(nextQuery) // 经 syncValue={contentSearchQuery} 回填输入框 draft
  }, [])
  const applyContentSearchScopePreset = useCallback((preset: ContentSearchScopePreset) => {
    setContentSearchScopeInput(preset.scopeInput)
    if (!preset.scopeInput) {
      setIsContentSearchAdvancedOpen(false)
    }
  }, [])
  const handleSearchInFolder = useCallback(
    (relativePath: string, nodeKind: ProjectFileNodeKind) => {
      const scopeInput = resolveTreeNodeSearchScope(relativePath, nodeKind)
      setContentSearchScopeInput(scopeInput)

      // 已在搜索视图时输入框已挂载，直接聚焦；否则借助 pendingSearchInputFocusModeRef 在视图切换渲染后聚焦。
      if (viewMode === 'search') {
        window.setTimeout(() => {
          contentSearchInputRef.current?.focus()
          contentSearchInputRef.current?.select()
        }, 0)
        return
      }
      pendingSearchInputFocusModeRef.current = 'search'
      setViewMode('search')
      if (isNarrowViewport && !isExplorerOpen) {
        setIsExplorerOpen(true)
      }
    },
    [contentSearchInputRef, isExplorerOpen, isNarrowViewport, viewMode],
  )

  useEffect(() => {
    window.localStorage.setItem(CODE_LEFT_SIDEBAR_COLLAPSED_STORAGE_KEY, isLeftSidebarCollapsed ? '1' : '0')
  }, [isLeftSidebarCollapsed])

  const focusSearchInputByMode = useCallback(
    (mode: CodeViewMode = viewMode) => {
      const focusTarget = () => {
        const target = mode === 'search' ? contentSearchInputRef.current : fileSearchInputRef.current
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
    },
    [contentSearchInputRef, fileSearchInputRef, isExplorerOpen, isLeftSidebarCollapsed, isNarrowViewport, refreshRootIfStale, viewMode],
  )

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
    setViewMode((prev) => {
      const next = prev === 'files' ? 'search' : 'files'
      pendingSearchInputFocusModeRef.current = next === 'search' ? next : null
      return next
    })
    if (isNarrowViewport && !isExplorerOpen) {
      setIsExplorerOpen(true)
    }
  }, [isExplorerOpen, isNarrowViewport])

  // 文件名过滤输入为非受控组件，视图切换时会重挂载并显示为空；
  // 保留旧 query 会导致状态与 UI 失同步，切回 files 后文件树被
  // 残留搜索结果（可能为空）占据，观感即“文件树丢失”。
  useEffect(() => {
    if (viewMode !== 'files') return
    setFileSearchQuery('')
  }, [setFileSearchQuery, viewMode])

  useEffect(() => {
    if (pendingSearchInputFocusModeRef.current !== viewMode) return
    pendingSearchInputFocusModeRef.current = null

    const timer = window.setTimeout(() => {
      focusSearchInputByMode(viewMode)
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [focusSearchInputByMode, viewMode])

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
  const layoutGridStyle = isNarrowViewport ? { gridTemplateColumns: 'minmax(0, 1fr)' } : isLeftSidebarCollapsed ? { gridTemplateColumns: '44px minmax(0, 1fr)' } : leftSidebarWidth ? { gridTemplateColumns: `${leftSidebarWidth}px minmax(0, 1fr)` } : undefined
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
  const {
    closeFolderFileSearch,
    closeFolderSearchContextMenu,
    closePendingScriptConfirm,
    closeZipAsDialog,
    confirmPendingScript,
    confirmZipTreeNodeAs,
    handleCopyTreeNodeToClipboard,
    handleCopyTreeNodeName,
    handleCopyTreeNodeRelativePath,
    handleCopyTreeNodeRelativePathWithoutSlashes,
    handleCopyTreeNodePathWithLineNumber,
    handleCopyTreeNodeZipToClipboard,
    handleExecuteScriptInEmbeddedTerminal,
    handleExecuteScriptInSystemTerminal,
    handleFindTreeNodeFilesByName,
    handleFolderSearchContextMenu,
    handleOpenContentSearchResult,
    handleOpenSmartEmptyFile,
    handleOpenTreeNodeFolder,
    handleOpenTreeNodeTerminal,
    handleSelectExcluded,
    handleSelectTreeFile,
    handleZipTreeNode,
    handleZipTreeNodeAs,
    folderSearchContextMenuPayload,
    folderSearchTarget,
    isScriptConfirmBusy,
    isZipDialogBusy,
    openFileFromQuickDrawer,
    pendingScriptConfirm,
    resolveTreeNodeRunnableScript,
    zipAsTarget,
  } = useCodeTreePathActions({
    isNarrowViewport,
    openContentSearchMatch,
    openFile,
    openExcludedEntry,
    openFileWithTreeLocate,
    projectId,
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

  const [transcriptContentDrawer, setTranscriptContentDrawer] = useState<TranscriptContentDrawerTarget | null>(null)

  const handleOpenTranscriptContentReference = useCallback((item: TranscriptFileReference) => {
    setTranscriptContentDrawer({
      transcriptId: item.transcriptId,
      referenceId: item.reference.id,
      transcriptTitle: item.transcriptTitle,
    })
  }, [])

  // 13.2：菜单回调适配（去掉 zipName 参数位，避免 nodeKind 被误当作 zip 名）。
  const handleZipNodeFolderFromMenu = useCallback(
    (relativePath: string, nodeName: string) => {
      void handleZipTreeNode(relativePath, nodeName)
    },
    [handleZipTreeNode],
  )

  const handleCopyNodeZipToClipboardFromMenu = useCallback(
    (relativePath: string, nodeName: string) => {
      void handleCopyTreeNodeZipToClipboard(relativePath, nodeName)
    },
    [handleCopyTreeNodeZipToClipboard],
  )

  // zip 命名弹窗：打开时以文件夹名作为默认值。
  const [zipAsDraftName, setZipAsDraftName] = useState('')
  useEffect(() => {
    if (zipAsTarget) {
      setZipAsDraftName(zipAsTarget.nodeName)
    }
  }, [zipAsTarget])

  const handleOpenTranscriptPageReference = useCallback(
    (target: TranscriptContentDrawerTarget) => {
      setTranscriptContentDrawer(null)
      void openTranscript({
        projectId,
        transcriptId: target.transcriptId,
        initialMode: 'preview',
      }).then(() => {
        openTranscriptReference(target.transcriptId, target.referenceId)
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
      <SidebarGestureHost
        pageRootRef={pageRootRef}
        onToggleHeader={() => {
          window.dispatchEvent(new CustomEvent('app:toggle-project-header'))
        }}
        onToggleLeftSidebar={() => {
          if (isNarrowViewport) {
            setIsExplorerOpen((current) => !current)
            return
          }
          if (isLeftSidebarCollapsed) {
            handleExpandSidebar()
            return
          }
          setIsLeftSidebarCollapsed(true)
        }}
      />
      <CodeWorkspaceChrome
        activeLanguage={activeLanguage}
        activeRelativePath={activeRelativePath}
        activePane={activePane}
        discardUnsavedConfirm={discardUnsavedConfirm}
        isActiveFileFavorite={isActiveFileFavorite}
        isDirty={isDirty}
        isExplorerOpen={isExplorerOpen}
        isNarrowViewport={isNarrowViewport}
        onCloseOpenTab={handleCloseOpenTab}
        onHandleSave={() => {
          void handleSave()
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
        onOpenStartupLogs={onOpenStartupLogs}
        onOpenTranscript={onOpenTranscript}
        onOpenProjectLinksManager={onOpenProjectLinksManager}
        onOpenRunTasks={onOpenRunTasks}
        runTasksActive={runTasksActive}
        onRevealTerminalPanel={() => revealTerminal(projectId)}
        terminalPanelActive={terminalPanelActive}
        terminalRunningCount={terminalRunningCount}
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
        saveIndicatorText={saveIndicatorText}
        saveIndicatorToneClass={saveIndicatorToneClass}
        saveStatus={saveStatus}
        saveText={saveText}
        showEditorSearchActions={isShowingEditor && (activeKind === 'text' || activeKind === 'markdown' || activeKind === 'csv' || activeKind === 'html')}
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
        <div ref={layoutGridRef} className={`code-layout-grid h-full${isResizingTree ? ' is-resizing-tree' : ''}`} style={layoutGridStyle}>
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
                fileSearchLineTarget={fileSearchLineTarget}
                hasContentSearchScope={hasContentSearchScope}
                hasSearchQuery={hasSearchQuery}
                isContentSearchAdvancedOpen={isContentSearchAdvancedOpen}
                isSearchingContent={isSearchingContent}
                isSearchingFiles={isSearchingFiles}
                locateRequestToken={locateRequestToken}
                onApplyContentSearchScopePreset={applyContentSearchScopePreset}
                onChangeContentSearchQuery={handleContentSearchQueryChange}
                onContentSearchHistoryNavigate={cycleContentSearchHistory}
                onChangeFileSearchQuery={handleFileSearchQueryChange}
                onCopyTreeNodeName={handleCopyTreeNodeName}
                onCopyTreeNodeRelativePath={handleCopyTreeNodeRelativePath}
                onCopyTreeNodeRelativePathWithoutSlashes={handleCopyTreeNodeRelativePathWithoutSlashes}
                onCopyTreeNodePathWithLineNumber={handleCopyTreeNodePathWithLineNumber}
                onCopyTreeNodeToClipboard={handleCopyTreeNodeToClipboard}
                onZipTreeNodeFolder={handleZipNodeFolderFromMenu}
                onZipTreeNodeFolderAs={handleZipTreeNodeAs}
                onCopyTreeNodeZipToClipboard={handleCopyNodeZipToClipboardFromMenu}
                onRunTreeNodeScriptInSystemTerminal={handleExecuteScriptInSystemTerminal}
                onRunTreeNodeScriptInEmbeddedTerminal={handleExecuteScriptInEmbeddedTerminal}
                onResolveTreeNodeRunnableScript={resolveTreeNodeRunnableScript}
                onFindTreeNodeFilesByName={handleFindTreeNodeFilesByName}
                onOpenContentSearchResult={handleOpenContentSearchResult}
                onOpenTreeNodeFolder={handleOpenTreeNodeFolder}
                onOpenTreeNodeTerminal={handleOpenTreeNodeTerminal}
                onSearchInTreeNodeFolder={handleSearchInFolder}
                onReloadTree={handleReloadTree}
                onSelectTreeFile={handleSelectTreeFile}
                onSelectExcluded={handleSelectExcluded}
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
              {!isNarrowViewport && (
                <CodeSidebarRailButton
                  side="left"
                  collapsed={false}
                  onClick={() => setIsLeftSidebarCollapsed(true)}
                  onLongPress={startTreeResize}
                  resizing={isResizingTree}
                  longPressMs={CODE_TREE_RESIZE_LONG_PRESS_MS}
                  className="absolute -right-4 top-1/2 z-20 -translate-y-1/2"
                  ariaLabel={t('codeWorkspace.collapseSidebar')}
                />
              )}
            </div>
          )}

          {showEditorPanelForMode && (
            <section className="code-editor-panel surface-card">
              <CodeWorkspaceEditorPane
                activeLanguage={activeLanguage}
                activeRelativePath={activeRelativePath}
                binaryDataUrl={binaryDataUrl}
                closeCodePreview={closeCodePreview}
                closeStructuredPreview={closeStructuredPreview}
                codePreview={codePreview}
                editorRef={editorRef}
                editorValue={editorValue}
                effectiveMarkdownPreviewMode={effectiveMarkdownPreviewMode}
                excludedNodeKind={activeFile?.excludedNodeKind ?? 'file'}
                fileKind={activeKind}
                fileMtimeMs={activeFile?.mtimeMs ?? null}
                fileSize={activeFileSize}
                fileUnsupportedReason={activeFile?.unsupportedReason ?? null}
                handlePasteImage={handlePasteImage}
                isInitialRestoring={isInitialRestoring}
                isMdcFile={isMdcFile}
                isMarkdownFile={isMarkdownFile}
                isNarrowViewport={isNarrowViewport}
                isReading={isReading}
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
                onCyclePreviewSearchHistory={cyclePreviewSearchHistory}
                onSetCursorPosition={handleEditorCursorPositionChange}
                onSetMarkdownPreviewMode={setMarkdownPreviewMode}
                onSetPreviewSearchQuery={setPreviewSearchQuery}
                onOpenSmartEmptyFile={handleOpenSmartEmptyFile}
                onOpenTranscriptContentReference={handleOpenTranscriptContentReference}
                onOpenFile={openFileWithTreeLocate}
                onRequestProjectContextMenu={onRequestProjectContextMenu}
                parsedMarkdownDoc={parsedMarkdownDoc}
                previewRootRef={previewScrollRef}
                previewScrollRef={previewScrollRef}
                previewSearchInputRef={previewSearchInputRef}
                previewSearchMatches={previewSearchMatches}
                previewSearchQuery={previewSearchQuery}
                previewSearchVisible={previewSearchVisible}
                previewSearchMatchIndex={activePreviewSearchMatchIndex}
                projectId={projectId}
                projectPath={projectPath}
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
      <TranscriptContentDrawer open={Boolean(transcriptContentDrawer)} target={transcriptContentDrawer} projectId={projectId} projectPath={projectPath} onClose={() => setTranscriptContentDrawer(null)} onOpenInTranscriptPage={handleOpenTranscriptPageReference} />
      {folderSearchTarget && (
        <FolderFileSearchPopover
          x={folderSearchTarget.x}
          y={folderSearchTarget.y}
          folderRelativePath={folderSearchTarget.relativePath}
          folderName={folderSearchTarget.nodeName}
          projectPath={projectPath}
          onOpenFile={(relativePath) => {
            void openFileWithTreeLocate(relativePath)
          }}
          onContextMenu={handleFolderSearchContextMenu}
          onClose={closeFolderFileSearch}
        />
      )}
      {folderSearchContextMenuPayload && (
        <CodeTreeContextMenu
          x={folderSearchContextMenuPayload.x}
          y={folderSearchContextMenuPayload.y}
          relativePath={folderSearchContextMenuPayload.relativePath}
          nodeName={folderSearchContextMenuPayload.nodeName}
          nodeKind={folderSearchContextMenuPayload.nodeKind}
          onOpenFolder={() => handleOpenTreeNodeFolder(folderSearchContextMenuPayload.relativePath, folderSearchContextMenuPayload.nodeKind)}
          onOpenTerminal={() => handleOpenTreeNodeTerminal(folderSearchContextMenuPayload.relativePath, folderSearchContextMenuPayload.nodeKind)}
          onSearchInFolder={() => handleSearchInFolder(folderSearchContextMenuPayload.relativePath, folderSearchContextMenuPayload.nodeKind)}
          onCopyName={() => handleCopyTreeNodeName(folderSearchContextMenuPayload.nodeName)}
          onCopyRelativePath={() => handleCopyTreeNodeRelativePath(folderSearchContextMenuPayload.relativePath)}
          onCopyRelativePathWithoutSlashes={() => handleCopyTreeNodeRelativePathWithoutSlashes(folderSearchContextMenuPayload.relativePath)}
          onCopyFileToClipboard={() => void handleCopyTreeNodeToClipboard(folderSearchContextMenuPayload.relativePath)}
          onZipFolder={() => handleZipNodeFolderFromMenu(folderSearchContextMenuPayload.relativePath, folderSearchContextMenuPayload.nodeName)}
          onZipFolderAs={() => handleZipTreeNodeAs(folderSearchContextMenuPayload.relativePath, folderSearchContextMenuPayload.nodeName)}
          onCopyZipToClipboard={() => handleCopyNodeZipToClipboardFromMenu(folderSearchContextMenuPayload.relativePath, folderSearchContextMenuPayload.nodeName)}
          onRunScriptInSystemTerminal={() => handleExecuteScriptInSystemTerminal(folderSearchContextMenuPayload.relativePath, folderSearchContextMenuPayload.nodeKind)}
          onRunScriptInEmbeddedTerminal={() => handleExecuteScriptInEmbeddedTerminal(folderSearchContextMenuPayload.relativePath, folderSearchContextMenuPayload.nodeKind)}
          resolveRunnableScript={resolveTreeNodeRunnableScript}
          onClose={closeFolderSearchContextMenu}
        />
      )}
      <ConfirmDialog
        open={Boolean(zipAsTarget)}
        onClose={closeZipAsDialog}
        onConfirm={() => confirmZipTreeNodeAs(zipAsDraftName)}
        ariaLabel={t('codeFileTree.zipDialogPrompt')}
        title={t('codeFileTree.zipFolderAs')}
        description={t('codeFileTree.zipDialogPrompt')}
        confirmLabel={t('codeFileTree.zipDialogConfirm')}
        busy={isZipDialogBusy}
        widthClassName="max-w-[420px]"
      >
        <Input
          value={zipAsDraftName}
          onChange={(event) => setZipAsDraftName(event.target.value)}
          disabled={isZipDialogBusy}
          autoFocus
          spellCheck={false}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !isZipDialogBusy) {
              void confirmZipTreeNodeAs(zipAsDraftName)
            }
          }}
        />
      </ConfirmDialog>
      <ConfirmDialog
        open={Boolean(pendingScriptConfirm)}
        onClose={closePendingScriptConfirm}
        onConfirm={() => confirmPendingScript()}
        ariaLabel={t('codeFileTree.scriptConfirmTitle')}
        title={t('codeFileTree.scriptConfirmTitle')}
        description={t('codeFileTree.scriptConfirmDescription')}
        confirmLabel={t('codeFileTree.sectionRun')}
        busy={isScriptConfirmBusy}
        widthClassName="max-w-[420px]"
      />
    </div>
  )
}
