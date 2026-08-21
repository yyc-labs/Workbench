import type { Dispatch, Ref, SetStateAction } from 'react'
import { memo } from 'react'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import { ChevronDown, ChevronUp, FileSearch, FolderSearch, LocateFixed, RefreshCw, Search } from 'lucide-react'
import { useI18n } from '../../i18n'
import { DebouncedSearchInput } from './DebouncedSearchInput'
import { CodeContentSearchTree, type CodeContentSearchTreeHandle } from './CodeContentSearchTree'
import { CodeFileTree } from './CodeFileTree'
import type { ProjectFileContentSearchResponse, ProjectFileNodeKind } from '../../../shared/types'
import { contentSearchScopeKey, type ContentSearchScopePreset } from './useCodeWorkspaceExplorerState'
import type { FileTreeState } from './code.types'

type CodeWorkspaceSidebarProps = {
  activeContentSearchLocation: {
    relativePath: string
    lineNumber: number
    column: number
  } | null
  activeContentSearchScopeKey: string
  activeContentSearchScopeLabel: string
  activeRelativePath: string | null
  canToggleContentSearchTree: boolean
  contentSearchCaseSensitive: boolean
  contentSearchError: string | null
  contentSearchInputRef: Ref<HTMLInputElement>
  contentSearchQuery: string
  contentSearchResult: ProjectFileContentSearchResponse
  contentSearchScopeGlobs: string[]
  contentSearchScopeInput: string
  contentSearchScopePresets: ContentSearchScopePreset[]
  contentSearchScopeSummary: string
  contentSearchToggleLabel: string
  contentSearchTreeRef: Ref<CodeContentSearchTreeHandle>
  expandedDirectories: Set<string>
  fileSearchError: string | null
  fileSearchInputRef: Ref<HTMLInputElement>
  hasContentSearchScope: boolean
  hasSearchQuery: boolean
  isContentSearchAdvancedOpen: boolean
  isSearchingContent: boolean
  isSearchingFiles: boolean
  locateRequestToken: number
  onApplyContentSearchScopePreset: (preset: ContentSearchScopePreset) => void
  onChangeContentSearchQuery: (nextValue: string) => void
  onChangeFileSearchQuery: (nextValue: string) => void
  onCopyTreeNodeName: (nodeName: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onCopyTreeNodeRelativePath: (relativePath: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onCopyTreeNodeRelativePathWithoutSlashes: (relativePath: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onOpenContentSearchResult: (relativePath: string, lineNumber: number, column: number) => void
  onOpenTreeNodeFolder: (relativePath: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onOpenTreeNodeTerminal: (relativePath: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onReloadTree: () => void
  onSelectTreeFile: (relativePath: string) => void
  onSelectExcluded: (relativePath: string, nodeKind: ProjectFileNodeKind) => void
  onSetContentSearchCaseSensitive: Dispatch<SetStateAction<boolean>>
  onSetContentSearchScopeInput: Dispatch<SetStateAction<string>>
  onSetContentSearchAdvancedOpen: Dispatch<SetStateAction<boolean>>
  onToggleContentSearchTree: () => void
  onToggleTreeDirectory: (relativePath: string) => void
  onLocateFileInTree: (relativePath: string) => void | Promise<void>
  tree: FileTreeState
  treeNodesForView: FileTreeState['nodes']
  viewMode: 'files' | 'search'
  autoCollapseMatchThreshold?: number
}

const FILE_SEARCH_DEBOUNCE_MS = 180

export const CodeWorkspaceSidebar = memo(function CodeWorkspaceSidebar({
  activeContentSearchLocation,
  activeContentSearchScopeKey,
  activeContentSearchScopeLabel,
  activeRelativePath,
  canToggleContentSearchTree,
  contentSearchCaseSensitive,
  contentSearchError,
  contentSearchInputRef,
  contentSearchQuery,
  contentSearchResult,
  contentSearchScopeGlobs,
  contentSearchScopeInput,
  contentSearchScopePresets,
  contentSearchScopeSummary,
  contentSearchToggleLabel,
  contentSearchTreeRef,
  expandedDirectories,
  fileSearchError,
  fileSearchInputRef,
  hasContentSearchScope,
  hasSearchQuery,
  isContentSearchAdvancedOpen,
  isSearchingContent,
  isSearchingFiles,
  locateRequestToken,
  onApplyContentSearchScopePreset,
  onChangeContentSearchQuery,
  onChangeFileSearchQuery,
  onCopyTreeNodeName,
  onCopyTreeNodeRelativePath,
  onCopyTreeNodeRelativePathWithoutSlashes,
  onOpenContentSearchResult,
  onOpenTreeNodeFolder,
  onOpenTreeNodeTerminal,
  onReloadTree,
  onSelectTreeFile,
  onSelectExcluded,
  onSetContentSearchCaseSensitive,
  onSetContentSearchScopeInput,
  onSetContentSearchAdvancedOpen,
  onToggleContentSearchTree,
  onToggleTreeDirectory,
  onLocateFileInTree,
  tree,
  treeNodesForView,
  viewMode,
  autoCollapseMatchThreshold = 10,
}: CodeWorkspaceSidebarProps) {
  const { t } = useI18n()
  const isFileTreeRefreshing = tree.status === 'loading' || tree.isRefreshingRoot

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
              <button type="button" className="code-large-project-empty-action" onClick={onReloadTree}>
                <RefreshCw className="h-3.5 w-3.5" />
                <span>{t('codeWorkspace.largeProjectManualLoadAction')}</span>
              </button>
            </div>
          </div>
        ) : tree.status === 'loading' ? (
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
            locateRequestToken={locateRequestToken}
            onToggleDirectory={onToggleTreeDirectory}
            onSelectFile={onSelectTreeFile}
            onSelectExcluded={onSelectExcluded}
            onOpenNodeFolder={onOpenTreeNodeFolder}
            onOpenNodeTerminal={onOpenTreeNodeTerminal}
            onCopyNodeName={onCopyTreeNodeName}
            onCopyNodeRelativePath={onCopyTreeNodeRelativePath}
            onCopyNodeRelativePathWithoutSlashes={onCopyTreeNodeRelativePathWithoutSlashes}
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
          <button type="button" className="code-search-meta-action code-search-toggle-action" onClick={onToggleContentSearchTree} disabled={!canToggleContentSearchTree} aria-disabled={!canToggleContentSearchTree}>
            {contentSearchToggleLabel}
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
        <CodeContentSearchTree
          ref={contentSearchTreeRef}
          files={contentSearchResult.files}
          activeLocation={activeContentSearchLocation}
          autoCollapseMatchThreshold={autoCollapseMatchThreshold}
          onOpenMatch={onOpenContentSearchResult}
          onOpenNodeFolder={onOpenTreeNodeFolder}
          onOpenNodeTerminal={onOpenTreeNodeTerminal}
          onCopyNodeName={onCopyTreeNodeName}
          onCopyNodeRelativePath={onCopyTreeNodeRelativePath}
          onCopyNodeRelativePathWithoutSlashes={onCopyTreeNodeRelativePathWithoutSlashes}
        />
      )}
    </aside>
  )
})
