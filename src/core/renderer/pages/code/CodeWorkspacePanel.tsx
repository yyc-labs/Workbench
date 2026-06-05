import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { shallow } from 'zustand/shallow'
import type { Components } from 'react-markdown'
import type { ProjectFileNodeKind, ProjectFileReadResult } from '../../../shared/types'
import { useAppStore } from '../../stores/appStore'
import { CodeContentSearchTree, type CodeContentSearchTreeHandle } from './CodeContentSearchTree'
import { CodeWorkspaceChrome } from './CodeWorkspaceChrome'
import { CodeWorkspaceEditorPane } from './CodeWorkspaceEditorPane'
import { CodeFileQuickDrawer } from './CodeFileQuickDrawer'
import type { MonacoCodeEditorHandle, MonacoEditorScrollState } from './MonacoCodeEditor'
import { CodeWorkspaceSidebar } from './CodeWorkspaceSidebar'
import { useCodeFileState } from './useCodeFileState'
import { useMarkdownPreviewSearch } from './useMarkdownPreviewSearch'
import {
  inferLanguageFromRelativePath,
  pushRecentCodeFilePath,
  removeCodeFilePathFromDrawerState,
  toggleFavoriteCodeFilePath,
} from './code.helpers'
import { copyTextToClipboard } from './code.clipboard'
import {
  createMarkdownComponents,
  dirnameFromRelativePath,
  joinPosixPaths,
  MARKDOWN_PASTE_IMAGE_DIRECTORY,
  normalizeMarkdownImageExtensionFromMime,
  parseImageFileFromClipboardEvent,
  relativePosixPath,
  resolveMonacoTheme,
  sanitizeMarkdownImageAlt,
  shouldDisableMarkdownSyntaxHighlight,
} from './code.markdown'
import { joinProjectPath, resolveTreeNodeFolderPath } from './code.pathActions'
import { parseMarkdownDocument } from './code.frontmatterParser'
import { buildKnownFilePathSet } from './code.tree'
import { useProjectCodeSessionState } from './useProjectCodeSessionState'
import { type ContentSearchScopePreset, useCodeWorkspaceExplorerState } from './useCodeWorkspaceExplorerState'
import {
  CODE_FILE_DRAWER_SECTION_LIMIT,
  MAX_PROJECT_CODE_SESSION_CURSOR_POSITIONS,
  MAX_PROJECT_CODE_SESSION_TABS,
  normalizeProjectCodeSession,
  sanitizeProjectCodeSessionByPaths,
} from './useProjectCodeSession'

const NARROW_VIEWPORT_QUERY = '(max-width: 960px)'
const CONTENT_SEARCH_AUTO_COLLAPSE_MATCH_THRESHOLD = 10
type CodeWorkspacePanelProps = {
  projectId: string
  projectPath: string
  themeMode: 'system' | 'light' | 'dark'
  projectHeaderCollapsed?: boolean
  projectName?: string
  projectLinkItems?: { url: string; label: string; tag?: string; tagLabel?: string }[]
  activePane?: 'code' | 'aicommit'
  onSwitchPane?: (pane: 'code' | 'aicommit') => void
  onOpenProjectLinksManager?: () => void
}

type MarkdownPreviewMode = 'edit' | 'preview' | 'split'
type MarkdownScrollModeKey = 'edit' | 'preview' | 'splitEditor' | 'splitPreview'
type CodeViewMode = 'files' | 'search'

function pickFirstFiniteScrollTop(...values: Array<number | undefined>): number {
  for (const value of values) {
    if (Number.isFinite(value)) {
      return Math.max(0, Number(value))
    }
  }
  return 0
}

type EditorSearchMode = 'find' | 'replace'

export function CodeWorkspacePanel({
  projectId,
  projectPath,
  themeMode,
  projectHeaderCollapsed = false,
  projectName,
  projectLinkItems = [],
  activePane = 'code',
  onSwitchPane,
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
  const [hasAttemptedInitialRestore, setHasAttemptedInitialRestore] = useState(false)
  const [locateRequestToken, setLocateRequestToken] = useState(0)
  const [markdownPreviewMode, setMarkdownPreviewMode] = useState<MarkdownPreviewMode>(
    () => (persistedLastMarkdownPreviewMode === 'edit' || persistedLastMarkdownPreviewMode === 'preview' || persistedLastMarkdownPreviewMode === 'split')
      ? persistedLastMarkdownPreviewMode
      : 'edit'
  )
  const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>(
    () => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
  )
  const editorRef = useRef<MonacoCodeEditorHandle | null>(null)
  const contentSearchTreeRef = useRef<CodeContentSearchTreeHandle | null>(null)
  const previewScrollRef = useRef<HTMLDivElement | null>(null)
  const editorScrollStateRef = useRef<MonacoEditorScrollState | null>(null)
  const previewScrollStateRef = useRef<{ scrollTop: number; scrollHeight: number; viewportHeight: number } | null>(null)
  const markdownScrollMemoryRef = useRef<Record<string, Partial<Record<MarkdownScrollModeKey, number>>>>({})
  const activeScrollSyncSourceRef = useRef<'editor' | 'preview' | null>(null)
  const scrollSyncReleaseTimerRef = useRef<number | null>(null)
  const pendingModeSwitchRef = useRef<{ from: MarkdownPreviewMode; to: MarkdownPreviewMode } | null>(null)
  const pendingEditorRestoreTopRef = useRef<number | null>(null)
  const splitSyncReadyRef = useRef(false)
  const pendingRevealRef = useRef<{ relativePath: string; lineNumber: number; column: number } | null>(null)
  const pendingCursorRevealRef = useRef<{ relativePath: string; lineNumber: number; column: number } | null>(null)
  const fileSearchInputRef = useRef<HTMLInputElement | null>(null)
  const contentSearchInputRef = useRef<HTMLInputElement | null>(null)
  const captureCurrentModeScrollRef = useRef<() => void>(() => {})
  const markOpenedFileInExplorerRef = useRef<(relativePath: string) => void>(() => {})
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
      if (isRestoringCodeSessionRef.current) {
        const persistedCursor = persistedProjectCodeSession?.cursorPositions?.[nextPath]
        if (persistedCursor) {
          pendingCursorRevealRef.current = {
            relativePath: nextPath,
            lineNumber: persistedCursor.lineNumber,
            column: persistedCursor.column,
          }
        }
      } else {
        pendingCursorRevealRef.current = null
      }
    }

    splitSyncReadyRef.current = false
    markOpenedFileInExplorerRef.current(result.relativePath)
    setCodeFileDrawerState((prev) => pushRecentCodeFilePath(prev, result.relativePath))
  }, [persistedProjectCodeSession?.cursorPositions, pushOpenTabPath])
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
  useEffect(() => {
    markOpenedFileInExplorerRef.current = markFilePathKnown
  }, [markFilePathKnown])

  const monacoTheme = useMemo(
    () => (effectiveTheme === 'dark' ? 'vs-dark' : resolveMonacoTheme(themeMode)),
    [effectiveTheme, themeMode]
  )
  const activeLanguage = activeFile?.language ?? inferLanguageFromRelativePath(activeRelativePath ?? '')
  const activeFileSize = activeFile?.size ?? 0
  const isMarkdownFile = useMemo(() => {
    const normalized = (activeRelativePath ?? '').toLowerCase()
    return normalized.endsWith('.md') || normalized.endsWith('.markdown') || normalized.endsWith('.mdx') || normalized.endsWith('.mdc')
  }, [activeRelativePath])
  const isMdcFile = useMemo(() => {
    const normalized = (activeRelativePath ?? '').toLowerCase()
    return normalized.endsWith('.mdc')
  }, [activeRelativePath])
  const shouldParseFrontmatter = useMemo(() => {
    const normalized = (activeRelativePath ?? '').toLowerCase()
    return (
      normalized.endsWith('.md') ||
      normalized.endsWith('.markdown') ||
      normalized.endsWith('.mdx') ||
      normalized.endsWith('.mdc')
    )
  }, [activeRelativePath])
  const parsedMarkdownDoc = useMemo(
    () => (shouldParseFrontmatter ? parseMarkdownDocument(editorValue) : null),
    [editorValue, shouldParseFrontmatter]
  )
  const markdownPreviewContent = useMemo(() => {
    if (parsedMarkdownDoc?.hasFrontmatter) {
      return parsedMarkdownDoc.markdownBody
    }
    return editorValue
  }, [editorValue, parsedMarkdownDoc])
  const enableMarkdownSyntaxHighlight = useMemo(
    () => !shouldDisableMarkdownSyntaxHighlight(markdownPreviewContent),
    [markdownPreviewContent]
  )
  const effectiveMarkdownPreviewMode = isMarkdownFile
    ? (markdownPreviewMode === 'split' && isNarrowViewport ? 'preview' : markdownPreviewMode)
    : 'edit'
  const previousEffectiveMarkdownModeRef = useRef<MarkdownPreviewMode>(effectiveMarkdownPreviewMode)
  const isShowingEditor = effectiveMarkdownPreviewMode !== 'preview'
  const isShowingPreview = effectiveMarkdownPreviewMode === 'preview' || effectiveMarkdownPreviewMode === 'split'
  const shouldHandleFindInPreview = isMarkdownFile && isShowingPreview && !isShowingEditor
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
  const quickDrawerFavorites = useMemo(
    () => codeFileDrawerState.favorites.filter((path) => allProjectFilePathSet.has(path)).slice(0, CODE_FILE_DRAWER_SECTION_LIMIT),
    [allProjectFilePathSet, codeFileDrawerState.favorites]
  )
  const quickDrawerRecents = useMemo(
    () => codeFileDrawerState.recents.filter((path) => allProjectFilePathSet.has(path)).slice(0, CODE_FILE_DRAWER_SECTION_LIMIT),
    [allProjectFilePathSet, codeFileDrawerState.recents]
  )
  const handlePasteImage = useCallback(async (file: File | null, clipboardEvent?: ClipboardEvent): Promise<string | null> => {
    if (!isMarkdownFile || !activeRelativePath) return null
    const fromClipboardEvent = clipboardEvent ? parseImageFileFromClipboardEvent(clipboardEvent) : null
    const candidateFile = fromClipboardEvent ?? file

    if (!candidateFile || !candidateFile.type || !candidateFile.type.startsWith('image/')) {
      const pngBase64 = window.electronAPI.readClipboardImagePngBase64()
      if (!pngBase64) return null

      const fileDirectory = dirnameFromRelativePath(activeRelativePath)
      const imageDirectory = fileDirectory
        ? joinPosixPaths(fileDirectory, MARKDOWN_PASTE_IMAGE_DIRECTORY)
        : MARKDOWN_PASTE_IMAGE_DIRECTORY
      const savedImage = await window.electronAPI.writeProjectImageFile(
        projectPath,
        imageDirectory,
        'png',
        pngBase64
      )
      const relativeImagePath = relativePosixPath(fileDirectory, savedImage.relativePath)
      const normalizedRelativeImagePath = relativeImagePath.startsWith('./') || relativeImagePath.startsWith('../')
        ? relativeImagePath
        : `./${relativeImagePath}`
      const alt = sanitizeMarkdownImageAlt(savedImage.relativePath)
      return `![${alt}](${normalizedRelativeImagePath})`
    }

    const fileDirectory = dirnameFromRelativePath(activeRelativePath)
    const imageDirectory = fileDirectory
      ? joinPosixPaths(fileDirectory, MARKDOWN_PASTE_IMAGE_DIRECTORY)
      : MARKDOWN_PASTE_IMAGE_DIRECTORY
    const extension = normalizeMarkdownImageExtensionFromMime(candidateFile.type)
    const arrayBuffer = await candidateFile.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)

    let binary = ''
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i])
    }
    const dataBase64 = btoa(binary)

    const savedImage = await window.electronAPI.writeProjectImageFile(
      projectPath,
      imageDirectory,
      extension,
      dataBase64
    )
    const relativeImagePath = relativePosixPath(fileDirectory, savedImage.relativePath)
    const normalizedRelativeImagePath = relativeImagePath.startsWith('./') || relativeImagePath.startsWith('../')
      ? relativeImagePath
      : `./${relativeImagePath}`
    const alt = sanitizeMarkdownImageAlt(savedImage.relativePath)
    return `![${alt}](${normalizedRelativeImagePath})`
  }, [activeRelativePath, isMarkdownFile, projectPath])
  const markdownComponents = useMemo<Components>(() => createMarkdownComponents({
    activeRelativePath,
    enableMarkdownSyntaxHighlight,
    projectPath,
    themeMode: effectiveTheme,
  }), [activeRelativePath, effectiveTheme, enableMarkdownSyntaxHighlight, projectPath])

  const captureCurrentModeScroll = useCallback(() => {
    if (!isMarkdownFile || !activeRelativePath) return

    if (effectiveMarkdownPreviewMode === 'edit') {
      const state = editorRef.current?.getScrollState() ?? editorScrollStateRef.current
      if (state) {
        const current = markdownScrollMemoryRef.current[activeRelativePath] ?? {}
        markdownScrollMemoryRef.current[activeRelativePath] = {
          ...current,
          edit: Math.max(0, state.scrollTop),
        }
      }
      return
    }

    if (effectiveMarkdownPreviewMode === 'preview') {
      const preview = previewScrollRef.current
      if (preview) {
        const current = markdownScrollMemoryRef.current[activeRelativePath] ?? {}
        markdownScrollMemoryRef.current[activeRelativePath] = {
          ...current,
          preview: Math.max(0, preview.scrollTop),
        }
      }
      return
    }

    const editorState = editorRef.current?.getScrollState() ?? editorScrollStateRef.current
    const preview = previewScrollRef.current
    const current = markdownScrollMemoryRef.current[activeRelativePath] ?? {}
    markdownScrollMemoryRef.current[activeRelativePath] = {
      ...current,
      splitEditor: editorState ? Math.max(0, editorState.scrollTop) : current.splitEditor,
      splitPreview: preview ? Math.max(0, preview.scrollTop) : current.splitPreview,
    }
  }, [activeRelativePath, effectiveMarkdownPreviewMode, isMarkdownFile])

  useEffect(() => {
    captureCurrentModeScrollRef.current = captureCurrentModeScroll
  }, [captureCurrentModeScroll])

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
    const root = document.documentElement
    const sync = () => {
      const attr = root.getAttribute('data-theme')
      setEffectiveTheme(attr === 'dark' ? 'dark' : 'light')
    }

    sync()
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes' && record.attributeName === 'data-theme') {
          sync()
          break
        }
      }
    })
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  const toggleFavoriteForPath = useCallback((relativePath: string) => {
    setCodeFileDrawerState((prev) => toggleFavoriteCodeFilePath(prev, relativePath))
  }, [])

  const removePathFromQuickDrawer = useCallback((relativePath: string) => {
    setCodeFileDrawerState((prev) => removeCodeFilePathFromDrawerState(prev, relativePath))
  }, [])
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
  }, [focusSearchInputByMode, handleSave, openEditorSearchByMode, openPreviewSearch, shouldHandleFindInPreview])

  useEffect(() => {
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
  }, [focusSearchInputByMode])

  useEffect(() => {
    return window.electronAPI.onCodeToggleViewMode(() => {
      toggleCodeViewMode()
    })
  }, [toggleCodeViewMode])

  useEffect(() => {
    const normalized = (persistedLastMarkdownPreviewMode === 'edit' || persistedLastMarkdownPreviewMode === 'preview' || persistedLastMarkdownPreviewMode === 'split')
      ? persistedLastMarkdownPreviewMode
      : 'edit'
    setMarkdownPreviewMode(normalized)
  }, [persistedLastMarkdownPreviewMode, projectId])

  useEffect(() => {
    void setProjectLastMarkdownPreviewMode(projectId, markdownPreviewMode)
  }, [markdownPreviewMode, projectId, setProjectLastMarkdownPreviewMode])

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

  const setActiveSyncSource = useCallback((source: 'editor' | 'preview') => {
    activeScrollSyncSourceRef.current = source
    if (scrollSyncReleaseTimerRef.current) {
      window.clearTimeout(scrollSyncReleaseTimerRef.current)
    }
    scrollSyncReleaseTimerRef.current = window.setTimeout(() => {
      activeScrollSyncSourceRef.current = null
      scrollSyncReleaseTimerRef.current = null
    }, 120)
  }, [])

  const storeScrollTop = useCallback((path: string, key: MarkdownScrollModeKey, scrollTop: number) => {
    if (!Number.isFinite(scrollTop)) return
    const current = markdownScrollMemoryRef.current[path] ?? {}
    markdownScrollMemoryRef.current[path] = {
      ...current,
      [key]: Math.max(0, scrollTop),
    }
  }, [])

  const mapScrollTopByRatio = useCallback(
    (
      source: { scrollTop: number; scrollHeight: number; viewportHeight: number } | null,
      target: { scrollHeight: number; viewportHeight: number } | null
    ): number | null => {
      if (!source || !target) return null
      const sourceMax = Math.max(0, source.scrollHeight - source.viewportHeight)
      const targetMax = Math.max(0, target.scrollHeight - target.viewportHeight)
      if (targetMax <= 0) return 0
      if (sourceMax <= 0) return 0
      const ratio = Math.min(1, Math.max(0, source.scrollTop / sourceMax))
      return ratio * targetMax
    },
    []
  )

  const applyPreviewScrollTop = useCallback((scrollTop: number) => {
    const preview = previewScrollRef.current
    if (!preview) return
    preview.scrollTop = Math.max(0, scrollTop)
  }, [])

  const applyEditorScrollTop = useCallback((scrollTop: number) => {
    editorRef.current?.setScrollTop(Math.max(0, scrollTop))
  }, [])

  const restoreEditorScrollTop = useCallback((scrollTop: number) => {
    const normalized = Math.max(0, scrollTop)
    pendingEditorRestoreTopRef.current = normalized
    editorRef.current?.setScrollTop(normalized)
  }, [])

  useLayoutEffect(() => {
    const previous = previousEffectiveMarkdownModeRef.current
    if (previous === effectiveMarkdownPreviewMode) return
    pendingModeSwitchRef.current = { from: previous, to: effectiveMarkdownPreviewMode }
    previousEffectiveMarkdownModeRef.current = effectiveMarkdownPreviewMode
  }, [effectiveMarkdownPreviewMode])

  useEffect(() => {
    if (tree.status !== 'ready') return
    if (hasAttemptedInitialRestore) return
    setHasAttemptedInitialRestore(true)

    const sanitizedSession = sanitizeProjectCodeSessionByPaths(
      persistedProjectCodeSession,
      allProjectFilePathSet
    )
    const restoreCandidates = Array.from(new Set([
      persistedLastCodeFile?.trim() || '',
      sanitizedSession?.activePath?.trim() || '',
      sanitizedSession?.tabs[0]?.trim() || '',
    ].filter(Boolean)))

    if (restoreCandidates.length <= 0) {
      isRestoringCodeSessionRef.current = false
      return
    }

    void (async () => {
      for (const relativePath of restoreCandidates) {
        await ensureTreePathLoaded(relativePath)
        const opened = await openFile(relativePath)
        if (opened) return
      }
    })()
      .finally(() => {
        isRestoringCodeSessionRef.current = false
      })
  }, [
    allProjectFilePathSet,
    ensureTreePathLoaded,
    hasAttemptedInitialRestore,
    openFile,
    persistedLastCodeFile,
    persistedProjectCodeSession,
    tree.status,
  ])

  useEffect(() => {
    return () => {
      if (scrollSyncReleaseTimerRef.current) {
        window.clearTimeout(scrollSyncReleaseTimerRef.current)
        scrollSyncReleaseTimerRef.current = null
      }
    }
  }, [])

  useLayoutEffect(() => {
    if (!isMarkdownFile || !activeRelativePath) return
    splitSyncReadyRef.current = false
    const switchContext = pendingModeSwitchRef.current
    if (switchContext?.to !== effectiveMarkdownPreviewMode) {
      pendingModeSwitchRef.current = null
    }

    const timer = window.setTimeout(() => {
      const stored = markdownScrollMemoryRef.current[activeRelativePath] ?? {}
      const switchFrom = pendingModeSwitchRef.current?.to === effectiveMarkdownPreviewMode
        ? pendingModeSwitchRef.current.from
        : null

      if (effectiveMarkdownPreviewMode === 'edit') {
        const nextTop = switchFrom === 'preview'
          ? pickFirstFiniteScrollTop(stored.preview, stored.splitPreview, stored.splitEditor, stored.edit)
          : switchFrom === 'split'
            ? pickFirstFiniteScrollTop(stored.splitEditor, stored.splitPreview, stored.edit, stored.preview)
            : pickFirstFiniteScrollTop(stored.edit, stored.splitEditor, stored.preview, stored.splitPreview)
        restoreEditorScrollTop(nextTop)
        pendingModeSwitchRef.current = null
        return
      }

      if (effectiveMarkdownPreviewMode === 'preview') {
        const nextTop = switchFrom === 'edit'
          ? pickFirstFiniteScrollTop(stored.edit, stored.splitEditor, stored.splitPreview, stored.preview)
          : switchFrom === 'split'
            ? pickFirstFiniteScrollTop(stored.splitPreview, stored.splitEditor, stored.preview, stored.edit)
            : pickFirstFiniteScrollTop(stored.preview, stored.splitPreview, stored.splitEditor, stored.edit)
        applyPreviewScrollTop(nextTop)
        pendingModeSwitchRef.current = null
        return
      }

      const nextEditorTop = switchFrom === 'preview'
        ? pickFirstFiniteScrollTop(stored.preview, stored.splitPreview, stored.splitEditor, stored.edit)
        : pickFirstFiniteScrollTop(stored.splitEditor, stored.edit, stored.preview, stored.splitPreview)
      const nextPreviewTop = switchFrom === 'edit'
        ? pickFirstFiniteScrollTop(stored.edit, stored.splitEditor, stored.splitPreview, stored.preview)
        : pickFirstFiniteScrollTop(stored.splitPreview, stored.preview, stored.splitEditor, stored.edit)
      restoreEditorScrollTop(nextEditorTop)
      applyPreviewScrollTop(nextPreviewTop)
      splitSyncReadyRef.current = true
      pendingModeSwitchRef.current = null
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [
    activeRelativePath,
    restoreEditorScrollTop,
    applyPreviewScrollTop,
    effectiveMarkdownPreviewMode,
    isMarkdownFile,
  ])

  const handleEditorScrollStateChange = useCallback((state: MonacoEditorScrollState) => {
    editorScrollStateRef.current = state
    if (isMarkdownFile && isShowingEditor && pendingEditorRestoreTopRef.current != null) {
      const maxTop = Math.max(0, state.scrollHeight - state.viewportHeight)
      const pendingTop = Math.min(Math.max(0, pendingEditorRestoreTopRef.current), maxTop)
      if (Math.abs(state.scrollTop - pendingTop) > 1) {
        editorRef.current?.setScrollTop(pendingTop)
        return
      }
      pendingEditorRestoreTopRef.current = null
    }

    if (!isMarkdownFile || !activeRelativePath || !isShowingEditor) return
    const modeKey: MarkdownScrollModeKey = effectiveMarkdownPreviewMode === 'split' ? 'splitEditor' : 'edit'
    storeScrollTop(activeRelativePath, modeKey, state.scrollTop)

    if (effectiveMarkdownPreviewMode !== 'split' || !isShowingPreview || !splitSyncReadyRef.current) return
    if (activeScrollSyncSourceRef.current === 'preview') return

    const previewState = previewScrollStateRef.current
    const targetTop = mapScrollTopByRatio(state, previewState)
    if (targetTop == null) return
    setActiveSyncSource('editor')
    applyPreviewScrollTop(targetTop)
    storeScrollTop(activeRelativePath, 'splitPreview', targetTop)
  }, [
    activeRelativePath,
    applyPreviewScrollTop,
    effectiveMarkdownPreviewMode,
    isMarkdownFile,
    isShowingEditor,
    isShowingPreview,
    mapScrollTopByRatio,
    setActiveSyncSource,
    storeScrollTop,
  ])

  const handlePreviewScroll = useCallback(() => {
    const preview = previewScrollRef.current
    if (!preview || !isMarkdownFile || !activeRelativePath || !isShowingPreview) return

    const viewportHeight = preview.clientHeight
    const scrollHeight = preview.scrollHeight
    const scrollTop = preview.scrollTop
    const nextState = { scrollTop, scrollHeight, viewportHeight }
    previewScrollStateRef.current = nextState

    const modeKey: MarkdownScrollModeKey = effectiveMarkdownPreviewMode === 'split' ? 'splitPreview' : 'preview'
    storeScrollTop(activeRelativePath, modeKey, scrollTop)

    if (effectiveMarkdownPreviewMode !== 'split' || !isShowingEditor || !splitSyncReadyRef.current) return
    if (activeScrollSyncSourceRef.current === 'editor') return

    const editorState = editorScrollStateRef.current
    const targetTop = mapScrollTopByRatio(nextState, editorState)
    if (targetTop == null) return
    setActiveSyncSource('preview')
    applyEditorScrollTop(targetTop)
    storeScrollTop(activeRelativePath, 'splitEditor', targetTop)
  }, [
    activeRelativePath,
    applyEditorScrollTop,
    effectiveMarkdownPreviewMode,
    isMarkdownFile,
    isShowingEditor,
    isShowingPreview,
    mapScrollTopByRatio,
    setActiveSyncSource,
    storeScrollTop,
  ])

  const openFileFromQuickDrawer = useCallback((relativePath: string) => {
    void openFile(relativePath)
    if (isNarrowViewport) {
      setIsExplorerOpen(false)
    }
    setIsQuickDrawerOpen(false)
  }, [isNarrowViewport, openFile])

  useEffect(() => {
    if (!isShowingPreview) return
    const preview = previewScrollRef.current
    if (!preview) return

    const syncPreviewState = () => {
      previewScrollStateRef.current = {
        scrollTop: preview.scrollTop,
        scrollHeight: preview.scrollHeight,
        viewportHeight: preview.clientHeight,
      }
    }

    syncPreviewState()
    const resizeObserver = new ResizeObserver(() => {
      syncPreviewState()
    })
    resizeObserver.observe(preview)

    return () => {
      resizeObserver.disconnect()
    }
  }, [isShowingPreview, editorValue, effectiveMarkdownPreviewMode])

  const openContentSearchMatch = useCallback(async (relativePath: string, lineNumber: number, column: number) => {
    const opened = await openFile(relativePath)
    if (!opened) return
    setActiveContentSearchLocation({ relativePath, lineNumber, column })
    pendingRevealRef.current = { relativePath, lineNumber, column }
    window.setTimeout(() => {
      if (!pendingRevealRef.current) return
      const pending = pendingRevealRef.current
      if (pending.relativePath !== relativePath || pending.lineNumber !== lineNumber || pending.column !== column) return
      editorRef.current?.revealPosition(lineNumber, column)
    }, 0)
  }, [openFile])
  const handleOpenContentSearchResult = useCallback((relativePath: string, lineNumber: number, column: number) => {
    void openContentSearchMatch(relativePath, lineNumber, column)
    if (isNarrowViewport) {
      setIsExplorerOpen(false)
    }
  }, [isNarrowViewport, openContentSearchMatch])

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
    void ensureTreePathLoaded(relativePath).then(() => openFile(relativePath))
  }, [ensureTreePathLoaded, openFile])

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
      void openFile(nextActivePath)
    }
  }, [activeRelativePath, openFile, openTabPaths])
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

  useEffect(() => {
    const pending = pendingRevealRef.current
    if (!pending) return
    if (pending.relativePath !== activeRelativePath) return
    editorRef.current?.revealPosition(pending.lineNumber, pending.column)
    pendingRevealRef.current = null
  }, [activeRelativePath, editorValue])

  useEffect(() => {
    const pending = pendingCursorRevealRef.current
    if (!pending) return
    if (pending.relativePath !== activeRelativePath) return
    editorRef.current?.revealPosition(pending.lineNumber, pending.column)
    pendingCursorRevealRef.current = null
  }, [activeRelativePath, editorValue])

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
          const firstLink = projectLinkItems[0]
          if (!firstLink) return
          void window.electronAPI.openExternal(firstLink.url)
        }}
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
        projectLinkItems={projectLinkItems}
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
              ensureTreePathLoaded={ensureTreePathLoaded}
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
              onOpenContentSearchResult={handleOpenContentSearchResult}
              onOpenTreeNodeFolder={handleOpenTreeNodeFolder}
              onReloadTree={() => {
                void loadTree()
              }}
              onSelectTreeFile={handleSelectTreeFile}
              onSetContentSearchAdvancedOpen={setIsContentSearchAdvancedOpen}
              onSetContentSearchCaseSensitive={setContentSearchCaseSensitive}
              onSetContentSearchScopeInput={setContentSearchScopeInput}
              onToggleContentSearchTree={handleToggleContentSearchTree}
              onToggleTreeDirectory={handleToggleTreeDirectory}
              setLocateRequestToken={setLocateRequestToken}
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
                editorRef={editorRef}
                editorValue={editorValue}
                effectiveMarkdownPreviewMode={effectiveMarkdownPreviewMode}
                handlePasteImage={handlePasteImage}
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
                parsedMarkdownDoc={parsedMarkdownDoc}
                previewScrollRef={previewScrollRef}
                previewSearchInputRef={previewSearchInputRef}
                previewSearchMatches={previewSearchMatches}
                previewSearchQuery={previewSearchQuery}
                previewSearchVisible={previewSearchVisible}
                previewSearchMatchIndex={activePreviewSearchMatchIndex}
                viewMode={viewMode}
              />
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
