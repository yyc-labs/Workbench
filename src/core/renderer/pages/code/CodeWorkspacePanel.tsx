import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { shallow } from 'zustand/shallow'
import type { ProjectFileNodeKind, ProjectFileReadResult } from '../../../shared/types'
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
import { revealMarkdownPreviewSourceLine } from './code.markdown'
import { joinProjectPath, resolveTreeNodeFolderPath } from './code.pathActions'
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
type CodeWorkspacePanelProps = {
  projectId: string
  projectPath: string
  themeMode: 'system' | 'light' | 'dark'
  projectHeaderCollapsed?: boolean
  projectName?: string
  projectLinkItems?: { url: string; label: string; tag?: string; tagLabel?: string }[]
  activePane?: 'code' | 'aicommit'
  onSwitchPane?: (pane: 'code' | 'aicommit') => void
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
  activePane = 'code',
  onSwitchPane,
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
    openFile,
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

  const openFileFromQuickDrawer = useCallback((relativePath: string) => {
    void openFile(relativePath)
    if (isNarrowViewport) {
      setIsExplorerOpen(false)
    }
    setIsQuickDrawerOpen(false)
  }, [isNarrowViewport, openFile])

  const handleOpenContentSearchResult = useCallback((relativePath: string, lineNumber: number, column: number) => {
    void openContentSearchMatch(relativePath, lineNumber, column)
    setActiveContentSearchLocation({ relativePath, lineNumber, column })
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
