import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import { ChevronDown, ChevronUp, FileSearch, FolderSearch, LocateFixed, RefreshCw, Search } from 'lucide-react'
import type { Dispatch, Ref, SetStateAction } from 'react'
import { memo, useCallback, useMemo, useState } from 'react'
import type { ProjectFileContentSearchResponse, ProjectFileNodeKind } from '../../../shared/types'
import { useI18n } from '../../i18n'
import { CodeFileTree } from './CodeFileTree'
import type { CodeTreeContextMenuPayload } from './CodeTreeContextMenu'
import { ContentSearchHoverCard } from './ContentSearchHoverCard'
import { contentSearchScopeKey } from './code.contentSearchScope'
import { buildContentSearchTreeData } from './code.contentSearchTree'
import type { CodeTreeContextMenuSnapshot } from './code.treeSelection'
import type { FileSearchLineTarget, FileTreeState } from './code.types'
import { DebouncedSearchInput } from './DebouncedSearchInput'
import type { ContentSearchScopePreset } from './useCodeWorkspaceExplorerState'

type CodeWorkspaceSidebarProps = {
  activeContentSearchLocation: {
    relativePath: string
    lineNumber: number
    column: number
  } | null
  activeContentSearchScopeKey: string
  activeContentSearchScopeLabel: string
  activeRelativePath: string | null
  contentSearchCaseSensitive: boolean
  contentSearchError: string | null
  contentSearchInputRef: Ref<HTMLInputElement>
  contentSearchQuery: string
  contentSearchResult: ProjectFileContentSearchResponse
  contentSearchScopeGlobs: string[]
  contentSearchScopeInput: string
  contentSearchScopePresets: ContentSearchScopePreset[]
  contentSearchScopeSummary: string
  expandedDirectories: Set<string>
  fileSearchError: string | null
  fileSearchInputRef: Ref<HTMLInputElement>
  fileSearchLineTarget: FileSearchLineTarget | null
  hasContentSearchScope: boolean
  hasSearchQuery: boolean
  isContentSearchAdvancedOpen: boolean
  isSearchingContent: boolean
  isSearchingFiles: boolean
  locateRequestToken: number
  /** 17：右键「定位所在文件夹」请求（token 单调递增；relativePath 为空 = 项目根）。 */
  locateFolderRequest?: { relativePath: string; token: number } | null
  /** 17：右键「定位所在文件夹」（file 节点菜单项）。 */
  onLocateNodeFolder?: (relativePath: string) => void | Promise<void>
  /** 17：右键「搜索文件夹」（directory 节点菜单项）。 */
  onSearchFoldersInFolder?: (payload: CodeTreeContextMenuPayload) => void | Promise<void>
  onApplyContentSearchScopePreset: (preset: ContentSearchScopePreset) => void
  onChangeContentSearchQuery: (nextValue: string) => void
  onContentSearchHistoryNavigate?: (direction: 'older' | 'newer') => void
  onChangeFileSearchQuery: (nextValue: string) => void
  onCopyTreeNodeName: (nodeName: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onCopyTreeNodeRelativePath: (relativePath: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onCopyTreeNodeRelativePathWithoutSlashes: (relativePath: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onCopyTreeNodePathWithLineNumber?: (relativePath: string, lineNumber: number) => void | Promise<void>
  onCopyTreeNodeToClipboard?: (relativePath: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onZipTreeNodeFolder?: (relativePath: string, nodeName: string, zipName?: string) => void | Promise<void>
  onCopyTreeNodeZipToClipboard?: (relativePath: string, nodeName: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onRunTreeNodeScriptInSystemTerminal?: (relativePath: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onRunTreeNodeScriptInEmbeddedTerminal?: (relativePath: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onResolveTreeNodeRunnableScript?: (relativePath: string, nodeKind: ProjectFileNodeKind) => unknown
  onFindTreeNodeFilesByName?: (payload: CodeTreeContextMenuPayload) => void
  onOpenContentSearchResult: (relativePath: string, lineNumber: number, column: number) => void
  onOpenTreeNodeFolder: (relativePath: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onOpenTreeNodeTerminal: (relativePath: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onSearchInTreeNodeFolder: (relativePath: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onReloadTree: () => void
  onSelectTreeFile: (relativePath: string, lineTarget?: FileSearchLineTarget) => void
  onSelectExcluded: (relativePath: string, nodeKind: ProjectFileNodeKind) => void
  onSetContentSearchCaseSensitive: Dispatch<SetStateAction<boolean>>
  onSetContentSearchScopeInput: Dispatch<SetStateAction<string>>
  onSetContentSearchAdvancedOpen: Dispatch<SetStateAction<boolean>>
  onToggleTreeDirectory: (relativePath: string) => void
  onLocateFileInTree: (relativePath: string) => void | Promise<void>
  tree: FileTreeState
  treeNodesForView: FileTreeState['nodes']
  viewMode: 'files' | 'search'
  /** 16：选择上下文标识（项目 + 模式 + 解析后查询），变化时树内清空选择。 */
  selectionScopeKey: string
  /** 16：项目根路径，供右键快照与批量复制绝对路径使用。 */
  projectPath: string
  /** 16：批量复制三项（快照已由 CodeFileTree 复核）。 */
  onCopySelectedRelativePaths: (snapshot: CodeTreeContextMenuSnapshot) => void | Promise<void>
  onCopySelectedAbsolutePaths: (snapshot: CodeTreeContextMenuSnapshot) => void | Promise<void>
  onCopySelectedNames: (snapshot: CodeTreeContextMenuSnapshot) => void | Promise<void>
  /** 17：批量复制所选项文件（全 file 快照；菜单条件渲染）。 */
  onCopySelectedFiles: (snapshot: CodeTreeContextMenuSnapshot) => void | Promise<void>
  /** 17：批量复制所选项 zip 到剪贴板（混合打包；仅 Windows 宿主渲染；zipName 来自二级命名面板，留空走主进程默认名）。 */
  onCopySelectedZipToClipboard: (snapshot: CodeTreeContextMenuSnapshot, zipName?: string) => void | Promise<void>
}

const FILE_SEARCH_DEBOUNCE_MS = 180

interface SelectionCountHintProps {
  count: number
}

/** 多选计数（文件视图与全局搜索共用）：只读展示；所选项明细走右键菜单徽标的悬浮卡片。 */
function SelectionCountHint({ count }: SelectionCountHintProps) {
  const { t } = useI18n()
  if (count <= 1) return null

  return <span className="code-tree-selection-count">{t('codeFileTree.selectedCount', { count })}</span>
}

export const CodeWorkspaceSidebar = memo(function CodeWorkspaceSidebar({
  activeContentSearchLocation,
  activeContentSearchScopeKey,
  activeContentSearchScopeLabel,
  activeRelativePath,
  contentSearchCaseSensitive,
  contentSearchError,
  contentSearchInputRef,
  contentSearchQuery,
  contentSearchResult,
  contentSearchScopeGlobs,
  contentSearchScopeInput,
  contentSearchScopePresets,
  contentSearchScopeSummary,
  expandedDirectories,
  fileSearchError,
  fileSearchInputRef,
  fileSearchLineTarget,
  hasContentSearchScope,
  hasSearchQuery,
  isContentSearchAdvancedOpen,
  isSearchingContent,
  isSearchingFiles,
  locateRequestToken,
  locateFolderRequest,
  onLocateNodeFolder,
  onSearchFoldersInFolder,
  onApplyContentSearchScopePreset,
  onChangeContentSearchQuery,
  onContentSearchHistoryNavigate,
  onChangeFileSearchQuery,
  onCopyTreeNodeName,
  onCopyTreeNodeRelativePath,
  onCopyTreeNodeRelativePathWithoutSlashes,
  onCopyTreeNodePathWithLineNumber,
  onCopyTreeNodeToClipboard,
  onZipTreeNodeFolder,
  onCopyTreeNodeZipToClipboard,
  onRunTreeNodeScriptInSystemTerminal,
  onRunTreeNodeScriptInEmbeddedTerminal,
  onResolveTreeNodeRunnableScript,
  onFindTreeNodeFilesByName,
  onOpenContentSearchResult,
  onOpenTreeNodeFolder,
  onOpenTreeNodeTerminal,
  onSearchInTreeNodeFolder,
  onReloadTree,
  onSelectTreeFile,
  onSelectExcluded,
  onSetContentSearchCaseSensitive,
  onSetContentSearchScopeInput,
  onSetContentSearchAdvancedOpen,
  onToggleTreeDirectory,
  onLocateFileInTree,
  tree,
  treeNodesForView,
  viewMode,
  selectionScopeKey,
  projectPath,
  onCopySelectedRelativePaths,
  onCopySelectedAbsolutePaths,
  onCopySelectedNames,
  onCopySelectedFiles,
  onCopySelectedZipToClipboard,
}: CodeWorkspaceSidebarProps) {
  const { t } = useI18n()
  const isFileTreeRefreshing = tree.status === 'loading' || tree.isRefreshingRoot
  // 多选数量指示器（§4.2）：只读展示，全部由 CodeFileTree 的 onSelect 通知驱动，不回写树。
  const [selectedCount, setSelectedCount] = useState(0)
  const handleSelectedCountChange = useCallback((count: number) => {
    setSelectedCount((prev) => (prev === count ? prev : count))
  }, [])
  // 全局搜索结果目录树：共同祖先为根、层级挂载命中文件；直接复用 CodeFileTree 的样式与交互。
  const contentSearchTreeNodes = useMemo(() => buildContentSearchTreeData(contentSearchResult.files), [contentSearchResult.files])
  // 点击命中文件行 = 打开该文件并跳到首个命中。
  const handleSelectContentSearchFile = useCallback(
    (relativePath: string) => {
      const file = contentSearchResult.files.find((item) => item.relativePath === relativePath)
      const firstMatch = file?.matches[0]
      if (!file || !firstMatch) return
      onOpenContentSearchResult(file.relativePath, firstMatch.lineNumber, firstMatch.column)
    },
    [contentSearchResult.files, onOpenContentSearchResult],
  )

  if (viewMode === 'files') {
    return (
      <aside className="code-tree-panel surface-card">
        <div className="code-panel-header">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <DebouncedSearchInput
              inputRef={fileSearchInputRef}
              leadingIcon={<Search className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />}
              placeholder={tree.autoLoadBlocked ? t('codeWorkspace.fileSearchDisabledUntilTreeLoad') : t('codeWorkspace.searchFilesPlaceholder')}
              inputClassName="code-search-input"
              debounceMs={FILE_SEARCH_DEBOUNCE_MS}
              onQueryChange={onChangeFileSearchQuery}
              disabled={tree.autoLoadBlocked}
            />
          </div>
          <SelectionCountHint count={selectedCount} />
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:opacity-45"
            onClick={() => {
              if (!activeRelativePath) return
              void onLocateFileInTree(activeRelativePath)
            }}
            title={activeRelativePath ? t('codeWorkspace.locateCurrentFile') : t('codeWorkspace.noActiveFile')}
            disabled={!activeRelativePath}
          >
            <LocateFixed className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
            onClick={onReloadTree}
            title={t('codeWorkspace.reloadFileTree')}
            disabled={isFileTreeRefreshing}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFileTreeRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {tree.autoLoadBlocked ? (
          <div className="code-panel-empty">
            <div className="code-large-project-empty-state">
              <div className="code-large-project-empty-icon">
                <FolderSearch className="h-5 w-5" />
              </div>
              <div className="code-large-project-empty-title">{t('codeWorkspace.largeProjectManualLoadTitle')}</div>
              <div className="code-large-project-empty-copy">{t('codeWorkspace.largeProjectManualLoadHint')}</div>
              <div className="code-large-project-empty-meta">{t('codeWorkspace.largeProjectManualLoadCount', { count: tree.autoLoadFileCountSample || tree.autoLoadLimit })}</div>
              <div className="code-large-project-empty-copy code-large-project-empty-copy--secondary">{t('codeWorkspace.largeProjectManualLoadDetail', { count: tree.autoLoadFileCountSample || tree.autoLoadLimit })}</div>
              <div className="code-large-project-empty-copy code-large-project-empty-copy--secondary">{t('codeWorkspace.largeProjectManualLoadSettingsHint')}</div>
              <button type="button" className="code-large-project-empty-action" onClick={onReloadTree}>
                <RefreshCw className="h-3.5 w-3.5" />
                <span>{t('codeWorkspace.largeProjectManualLoadAction')}</span>
              </button>
            </div>
          </div>
        ) : tree.status === 'loading' || tree.status === 'idle' ? (
          <div className="code-panel-empty text-xs text-[color:var(--color-muted-foreground)]">{t('codeWorkspace.loadingFiles')}</div>
        ) : tree.status === 'error' ? (
          <div className="code-panel-empty text-xs text-[color:var(--color-destructive)]">{tree.error ?? t('codeWorkspace.failedToLoadFileTree')}</div>
        ) : hasSearchQuery && isSearchingFiles ? (
          <div className="code-panel-empty text-xs text-[color:var(--color-muted-foreground)]">{t('codeWorkspace.searchingFiles')}</div>
        ) : hasSearchQuery && fileSearchError ? (
          <div className="code-panel-empty text-xs text-[color:var(--color-destructive)]">{fileSearchError}</div>
        ) : hasSearchQuery && treeNodesForView.length === 0 ? (
          <div className="code-panel-empty text-xs text-[color:var(--color-muted-foreground)]">{t('codeWorkspace.noMatchingFiles')}</div>
        ) : (
          <CodeFileTree
            nodes={treeNodesForView}
            activeRelativePath={activeRelativePath}
            expandedDirectories={expandedDirectories}
            flatFileListMode={hasSearchQuery}
            flatListLineTarget={fileSearchLineTarget}
            locateRequestToken={locateRequestToken}
            locateFolderRequest={locateFolderRequest}
            onLocateNodeFolder={onLocateNodeFolder}
            onSearchFoldersInFolder={onSearchFoldersInFolder}
            onToggleDirectory={onToggleTreeDirectory}
            onSelectFile={onSelectTreeFile}
            onSelectExcluded={onSelectExcluded}
            onOpenNodeFolder={onOpenTreeNodeFolder}
            onOpenNodeTerminal={onOpenTreeNodeTerminal}
            onSearchInFolder={onSearchInTreeNodeFolder}
            onCopyNodeName={onCopyTreeNodeName}
            onCopyNodeRelativePath={onCopyTreeNodeRelativePath}
            onCopyNodeRelativePathWithoutSlashes={onCopyTreeNodeRelativePathWithoutSlashes}
            onCopyNodeToClipboard={onCopyTreeNodeToClipboard}
            onZipNodeFolder={onZipTreeNodeFolder}
            onCopyNodeZipToClipboard={onCopyTreeNodeZipToClipboard}
            onRunNodeScriptInSystemTerminal={onRunTreeNodeScriptInSystemTerminal}
            onRunNodeScriptInEmbeddedTerminal={onRunTreeNodeScriptInEmbeddedTerminal}
            onResolveNodeRunnableScript={onResolveTreeNodeRunnableScript}
            onFindNodeFilesByName={onFindTreeNodeFilesByName}
            selectionScopeKey={selectionScopeKey}
            projectPath={projectPath}
            onSelectedCountChange={handleSelectedCountChange}
            onCopySelectedRelativePaths={onCopySelectedRelativePaths}
            onCopySelectedAbsolutePaths={onCopySelectedAbsolutePaths}
            onCopySelectedNames={onCopySelectedNames}
            onCopySelectedFiles={onCopySelectedFiles}
            onCopySelectedZipToClipboard={onCopySelectedZipToClipboard}
          />
        )}
      </aside>
    )
  }

  return (
    <aside className="code-tree-panel surface-card">
      <div className="code-panel-header code-search-main-header">
        <div className="code-search-title-row">
          <div className="code-search-title-lockup">
            <span className="code-search-title-icon">
              <FileSearch className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <div className="code-search-title">{t('codeWorkspace.globalSearch')}</div>
              <div className="code-search-subtitle">{hasContentSearchScope ? t('codeWorkspace.scopeLabel', { value: activeContentSearchScopeLabel }) : t('codeWorkspace.searchAcrossProject')}</div>
            </div>
          </div>
          <button
            type="button"
            className={`code-search-meta-action ${contentSearchCaseSensitive ? 'is-active' : ''}`}
            onClick={() => onSetContentSearchCaseSensitive((prev) => !prev)}
            title={contentSearchCaseSensitive ? t('codeWorkspace.caseSensitiveOn') : t('codeWorkspace.caseSensitiveOff')}
            aria-pressed={contentSearchCaseSensitive}
          >
            Aa
          </button>
        </div>
        <div className="code-search-main-query">
          <DebouncedSearchInput
            inputRef={contentSearchInputRef}
            leadingIcon={<Search className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />}
            placeholder={t('codeWorkspace.contentSearchPlaceholder')}
            inputClassName="code-search-input code-search-input--hero"
            debounceMs={FILE_SEARCH_DEBOUNCE_MS}
            onQueryChange={onChangeContentSearchQuery}
            onHistoryNavigate={onContentSearchHistoryNavigate}
            syncValue={contentSearchQuery}
          />
        </div>
        <ScrollAreaPrimitive.Root className="code-search-scope-strip-root">
          <ScrollAreaPrimitive.Viewport className="code-search-scope-strip-viewport" aria-label={t('codeWorkspace.searchScopePresetsAria')}>
            <div className="code-search-scope-strip">
              {contentSearchScopePresets.map((preset) => {
                const isActive = contentSearchScopeKey(preset.scopeInput) === activeContentSearchScopeKey
                return (
                  <button key={preset.id} type="button" className={`code-search-scope-pill ${isActive ? 'is-active' : ''}`} onClick={() => onApplyContentSearchScopePreset(preset)} title={preset.title} aria-pressed={isActive}>
                    <span className="code-search-scope-pill-label">{preset.label}</span>
                    <span className="code-search-scope-pill-hint">{preset.hint}</span>
                  </button>
                )
              })}
            </div>
          </ScrollAreaPrimitive.Viewport>
          <ScrollAreaPrimitive.Scrollbar className="code-search-scope-scrollbar" orientation="horizontal">
            <ScrollAreaPrimitive.Thumb className="code-search-scope-scrollbar-thumb" />
          </ScrollAreaPrimitive.Scrollbar>
        </ScrollAreaPrimitive.Root>
        <div className="code-search-utility-row">
          <button type="button" className="code-search-inline-toggle" onClick={() => onSetContentSearchAdvancedOpen((prev) => !prev)} aria-expanded={isContentSearchAdvancedOpen} title={t('codeWorkspace.openAdvancedScope')}>
            {isContentSearchAdvancedOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            <span>{t('codeWorkspace.advancedScope')}</span>
            {hasContentSearchScope && <span className="code-search-inline-toggle-value">{contentSearchScopeSummary}</span>}
          </button>
        </div>
        {isContentSearchAdvancedOpen && (
          <div className="code-search-advanced-panel">
            <label className="code-search-advanced-label" htmlFor="code-content-search-scope-input">
              {t('codeWorkspace.includeGlobs')}
            </label>
            <input
              id="code-content-search-scope-input"
              type="text"
              value={contentSearchScopeInput}
              onChange={(event) => onSetContentSearchScopeInput(event.target.value)}
              placeholder={t('codeWorkspace.advancedScopePlaceholder')}
              className="code-search-input code-search-scope-input"
              spellCheck={false}
              title={contentSearchScopeSummary}
            />
            <div className="code-search-advanced-help">{t('codeWorkspace.advancedScopeHelp')}</div>
          </div>
        )}
        {contentSearchQuery.trim().length > 0 && !isSearchingContent && !contentSearchError && (
          <div className="code-search-main-toolbar">
            <div className="code-search-main-meta">
              <span className="code-search-main-meta-text">
                <span className="code-search-main-stat">{t('codeWorkspace.filesStat', { count: contentSearchResult.files.length })}</span>
                <span className="code-search-main-meta-sep">•</span>
                <span className="code-search-main-stat">{t('codeWorkspace.matchesStat', { count: contentSearchResult.totalMatches })}</span>
                <span className="code-search-main-meta-sep">•</span>
                <span className="code-search-main-stat">{hasContentSearchScope ? t('codeWorkspace.globsStat', { count: contentSearchScopeGlobs.length }) : t('codeWorkspace.allFiles')}</span>
                {contentSearchResult.limited && <span className="code-search-main-limited">{t('codeWorkspace.limited')}</span>}
              </span>
            </div>
            <SelectionCountHint count={selectedCount} />
          </div>
        )}
      </div>

      {contentSearchQuery.trim().length === 0 ? (
        <div className="code-panel-empty">
          <div className="text-sm text-[color:var(--color-muted-foreground)]">{t('codeWorkspace.globalSearchEmpty')}</div>
        </div>
      ) : isSearchingContent ? (
        <div className="code-panel-empty text-xs text-[color:var(--color-muted-foreground)]">{t('codeWorkspace.searchingContent')}</div>
      ) : contentSearchError ? (
        <div className="code-panel-empty text-xs text-[color:var(--color-destructive)]">{contentSearchError}</div>
      ) : contentSearchResult.files.length === 0 ? (
        <div className="code-panel-empty text-xs text-[color:var(--color-muted-foreground)]">{t('codeWorkspace.noMatchingText')}</div>
      ) : (
        <CodeFileTree
          nodes={contentSearchTreeNodes}
          activeRelativePath={activeRelativePath}
          onSelectFile={handleSelectContentSearchFile}
          onOpenNodeFolder={onOpenTreeNodeFolder}
          onOpenNodeTerminal={onOpenTreeNodeTerminal}
          onSearchInFolder={onSearchInTreeNodeFolder}
          onCopyNodeName={onCopyTreeNodeName}
          onCopyNodeRelativePath={onCopyTreeNodeRelativePath}
          onCopyNodeRelativePathWithoutSlashes={onCopyTreeNodeRelativePathWithoutSlashes}
          onCopyNodePathWithLineNumber={onCopyTreeNodePathWithLineNumber}
          onCopyNodeToClipboard={onCopyTreeNodeToClipboard}
          onZipNodeFolder={onZipTreeNodeFolder}
          onCopyNodeZipToClipboard={onCopyTreeNodeZipToClipboard}
          onRunNodeScriptInSystemTerminal={onRunTreeNodeScriptInSystemTerminal}
          onRunNodeScriptInEmbeddedTerminal={onRunTreeNodeScriptInEmbeddedTerminal}
          onResolveNodeRunnableScript={onResolveTreeNodeRunnableScript}
          onFindNodeFilesByName={onFindTreeNodeFilesByName}
          selectionScopeKey={selectionScopeKey}
          projectPath={projectPath}
          onSelectedCountChange={handleSelectedCountChange}
          onCopySelectedRelativePaths={onCopySelectedRelativePaths}
          onCopySelectedAbsolutePaths={onCopySelectedAbsolutePaths}
          onCopySelectedNames={onCopySelectedNames}
          onCopySelectedFiles={onCopySelectedFiles}
          onCopySelectedZipToClipboard={onCopySelectedZipToClipboard}
          fileHoverCard={(node, openMatchContextMenu) => <ContentSearchHoverCard node={node} activeLocation={activeContentSearchLocation} onOpenMatch={onOpenContentSearchResult} onMatchContextMenu={openMatchContextMenu} />}
        />
      )}
    </aside>
  )
})
