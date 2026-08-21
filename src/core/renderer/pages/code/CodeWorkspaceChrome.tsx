import { ArrowUpRight, Code2, Files, PanelLeftOpen, RefreshCw, Save, Star, TextSearch, X } from 'lucide-react'
import { ProjectLinksTrigger } from '../../components/ProjectLinksTrigger'
import { ModalShell } from '../../components/ModalShell'
import { ProjectPaneTabs } from '../../components/ProjectPaneTabs'
import type { ProjectPanePreload, ProjectPaneTab } from '../../components/ProjectPaneTabs'
import { useI18n } from '../../i18n'
import { Tooltip } from '../../components/ui/tooltip'
import type { UrlPopoverItem } from '../../components/UrlPopover'
import type { DiscardUnsavedConfirmState } from './useCodeFileState'
import { fileNameFromRelativePath } from './code.markdownShared'

type CodeWorkspaceChromeProps = {
  activeLanguage: string | null
  activeRelativePath: string | null
  activePane: 'code' | 'aicommit'
  discardUnsavedConfirm: DiscardUnsavedConfirmState
  isActiveFileFavorite: boolean
  isDirty: boolean
  isExplorerOpen: boolean
  isNarrowViewport: boolean
  onCloseOpenTab: (relativePath: string) => void
  onHandleSave: () => void
  onOpenEditorSearch: (mode: 'find' | 'replace') => void
  onOpenFileFromTab: (relativePath: string) => void
  onOpenFirstProjectLink?: () => void
  onPreloadPane?: ProjectPanePreload
  onStartAndOpenDevUrl?: () => void | Promise<unknown>
  onOpenStartupLogs?: () => void
  onOpenTranscript?: () => void
  onOpenProjectLinksManager?: () => void
  onResolveDiscardUnsavedConfirm: (proceed: boolean) => void
  onSetExplorerOpen: React.Dispatch<React.SetStateAction<boolean>>
  onSetQuickDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>
  onSetViewMode: React.Dispatch<React.SetStateAction<'files' | 'search'>>
  onSwitchPane?: (pane: 'code' | 'aicommit') => void
  onToggleFavorite: (relativePath: string) => void
  openTabs: string[]
  projectFileSize: number
  projectHeaderCollapsed: boolean
  projectDevUrlActionVisible?: boolean
  projectDevUrlPending?: boolean
  projectDevUrlReady?: boolean
  projectLinkItems: UrlPopoverItem[]
  hasProjectDocLinks?: boolean
  projectLinkTagOptions?: ReadonlyArray<{ value: string; label: string }>
  projectName?: string
  saveIndicatorText: string
  saveIndicatorToneClass: string
  saveStatus: 'idle' | 'saving' | 'saved' | 'error'
  saveText: string
  showEditorSearchActions: boolean
  viewMode: 'files' | 'search'
}

function EmptyStateSummary({ activeRelativePath, activeLanguage, projectFileSize, chooseFileLabel }: { activeRelativePath: string | null; activeLanguage: string | null; projectFileSize: number; chooseFileLabel: string }) {
  const summaryText = activeRelativePath ? `${activeLanguage || 'plaintext'} • ${formatFileSize(projectFileSize)}` : chooseFileLabel

  return (
    <p className="truncate text-xs text-[color:var(--color-muted-foreground)]" title={activeRelativePath ? `${activeRelativePath} • ${summaryText}` : summaryText}>
      {activeRelativePath ? `${activeRelativePath} • ${summaryText}` : summaryText}
    </p>
  )
}

function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const decimals = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(decimals)} ${units[unitIndex]}`
}

export function CodeWorkspaceChrome({
  activeLanguage,
  activeRelativePath,
  activePane,
  discardUnsavedConfirm,
  isActiveFileFavorite,
  isDirty,
  isExplorerOpen,
  isNarrowViewport,
  onCloseOpenTab,
  onHandleSave,
  onOpenEditorSearch,
  onOpenFileFromTab,
  onOpenFirstProjectLink,
  onPreloadPane,
  onStartAndOpenDevUrl,
  onOpenStartupLogs,
  onOpenTranscript,
  onOpenProjectLinksManager,
  onResolveDiscardUnsavedConfirm,
  onSetExplorerOpen,
  onSetQuickDrawerOpen,
  onSetViewMode,
  onSwitchPane,
  onToggleFavorite,
  openTabs,
  projectFileSize,
  projectHeaderCollapsed,
  projectDevUrlActionVisible = false,
  projectDevUrlPending = false,
  projectDevUrlReady = false,
  projectLinkItems,
  hasProjectDocLinks = false,
  projectLinkTagOptions = [],
  projectName,
  saveIndicatorText,
  saveIndicatorToneClass,
  saveStatus,
  saveText,
  showEditorSearchActions,
  viewMode,
}: CodeWorkspaceChromeProps) {
  const { t } = useI18n()
  return (
    <>
      <div className="mb-3 flex min-h-[52px] items-center justify-between gap-3 rounded-[20px] border px-4 py-2" style={{ borderColor: 'var(--color-border)', background: 'color-mix(in srgb, var(--color-card) 95%, transparent)' }}>
        <div className="min-w-0">
          {projectHeaderCollapsed ? (
            <div className="flex min-w-0 items-center gap-2.5">
              <p className="max-w-[140px] truncate text-sm font-medium text-[color:var(--color-foreground)]" title={projectName}>
                {projectName || t('codeWorkspace.currentProjectFallback')}
              </p>
              <ProjectPaneTabs
                activePane={activePane}
                onPreloadPane={onPreloadPane}
                onSelectPane={(pane) => {
                  if (pane === 'transcript') {
                    onOpenTranscript?.()
                    return
                  }
                  onSwitchPane?.(pane)
                }}
              />
              {hasProjectDocLinks && <ProjectLinksTrigger items={projectLinkItems} tagOptions={projectLinkTagOptions} onOpenDefault={onOpenFirstProjectLink} onOpenManager={onOpenProjectLinksManager} size="icon" title={t('common.leftClickOpenFirstLink')} />}
              {projectDevUrlActionVisible && onStartAndOpenDevUrl && (
                <button
                  type="button"
                  className={`quiet-control inline-flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--color-border)] transition-colors hover:bg-[color:var(--color-accent)] disabled:opacity-60 ${
                    projectDevUrlReady ? 'text-primary hover:text-primary' : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
                  }`}
                  onClick={() => {
                    void onStartAndOpenDevUrl()
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onOpenStartupLogs?.()
                  }}
                  disabled={projectDevUrlPending}
                  title={projectDevUrlReady ? t('project.openDevUrl') : projectDevUrlPending ? t('project.waitingForDevUrl') : t('project.startAndOpenDevUrlShort')}
                  aria-label={projectDevUrlReady ? t('project.openDevUrl') : projectDevUrlPending ? t('project.waitingForDevUrl') : t('project.startAndOpenDevUrlShort')}
                >
                  {projectDevUrlPending ? <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />}
                </button>
              )}
            </div>
          ) : (
            <EmptyStateSummary activeRelativePath={activeRelativePath} activeLanguage={activeLanguage} projectFileSize={projectFileSize} chooseFileLabel={t('codeWorkspace.chooseFileToStart')} />
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {viewMode === 'files' && activeRelativePath && (
            <button
              type="button"
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-xs transition-colors ${
                isActiveFileFavorite ? 'border-[color:var(--color-warning)]/40 bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)]' : 'border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
              }`}
              onClick={() => onToggleFavorite(activeRelativePath)}
              title={isActiveFileFavorite ? t('codeWorkspace.removeFavorite') : t('codeWorkspace.addFavorite')}
            >
              <Star className={`h-3.5 w-3.5 ${isActiveFileFavorite ? 'fill-current' : ''}`} />
              {isActiveFileFavorite ? t('codeWorkspace.favorited') : t('codeWorkspace.favorite')}
            </button>
          )}
          {activeRelativePath && (
            <>
              <button
                type="button"
                className="inline-flex items-center rounded-full border border-[color:var(--color-border)] px-3 py-1.5 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-45"
                onClick={() => onOpenEditorSearch('find')}
                title={showEditorSearchActions ? t('codeWorkspace.findTitle') : t('codeWorkspace.switchToEditorFirst')}
                disabled={!showEditorSearchActions}
              >
                {t('codeWorkspace.find')}
              </button>
              <button
                type="button"
                className="inline-flex items-center rounded-full border border-[color:var(--color-border)] px-3 py-1.5 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-45"
                onClick={() => onOpenEditorSearch('replace')}
                title={showEditorSearchActions ? t('codeWorkspace.replaceTitle') : t('codeWorkspace.switchToEditorFirst')}
                disabled={!showEditorSearchActions}
              >
                {t('codeWorkspace.replace')}
              </button>
            </>
          )}
          <button
            type="button"
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
              isExplorerOpen ? 'border-[color:var(--color-primary)] bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)]' : 'border-[color:var(--color-border)] text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]'
            }`}
            onClick={() => onSetQuickDrawerOpen((prev) => !prev)}
            title={t('codeWorkspace.quickFileDrawer')}
          >
            <PanelLeftOpen className="h-3.5 w-3.5" />
            {t('codeWorkspace.files')}
          </button>
          <div className="code-view-mode-switch" role="tablist" aria-label={t('codeWorkspace.modeAria')}>
            <button type="button" role="tab" aria-selected={viewMode === 'files'} className={`code-view-mode-btn ${viewMode === 'files' ? 'is-active' : ''}`} onClick={() => onSetViewMode('files')} title={t('codeWorkspace.fileExplorerAndEditor')}>
              <Files className="h-3.5 w-3.5" />
              {t('codeWorkspace.files')}
            </button>
            <button type="button" role="tab" aria-selected={viewMode === 'search'} className={`code-view-mode-btn ${viewMode === 'search' ? 'is-active' : ''}`} onClick={() => onSetViewMode('search')} title={t('codeWorkspace.globalContentSearch')}>
              <TextSearch className="h-3.5 w-3.5" />
              {t('codeWorkspace.search')}
            </button>
          </div>
          {isNarrowViewport && (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-3 py-1.5 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
              onClick={() => onSetExplorerOpen((prev) => !prev)}
              title={isExplorerOpen ? t('codeWorkspace.switchToEditor') : viewMode === 'search' ? t('codeWorkspace.openSearchPanel') : t('codeWorkspace.openFileExplorer')}
            >
              <Code2 className="h-3.5 w-3.5" />
              {isExplorerOpen ? t('codeWorkspace.editor') : viewMode === 'search' ? t('codeWorkspace.search') : t('codeWorkspace.explorer')}
            </button>
          )}
          <span className={`text-[11px] ${saveIndicatorToneClass}`}>{saveIndicatorText}</span>
          <button
            type="button"
            className={`inline-flex h-9 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-all ${saveStatus === 'saving' ? 'border text-[color:var(--color-warning)] bg-[color:var(--color-warning-background)]' : 'bg-primary text-white shadow-sm hover:bg-primary-hover disabled:opacity-50'}`}
            onClick={onHandleSave}
            disabled={!activeRelativePath || !isDirty || saveStatus === 'saving'}
          >
            <Save className="h-3.5 w-3.5" />
            {saveText}
          </button>
        </div>
      </div>

      {openTabs.length > 0 && (
        <div className="code-open-tabs mb-3">
          {openTabs.map((path) => {
            const isActive = activeRelativePath === path
            return (
              <Tooltip key={path} content={path} align="start" interactive={false} contentClassName="font-mono text-[10.5px] leading-[1.4]" className="code-open-tab-trigger">
                <button
                  type="button"
                  className={`code-open-tab ${isActive ? 'is-active' : ''}`}
                  onClick={() => {
                    onOpenFileFromTab(path)
                  }}
                >
                  <span className="code-open-tab-label">{fileNameFromRelativePath(path)}</span>
                  <span className="code-open-tab-path">{path}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    className="code-open-tab-close"
                    aria-label={t('codeWorkspace.closeTab', { path })}
                    onClick={(event) => {
                      event.stopPropagation()
                      onCloseOpenTab(path)
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      event.stopPropagation()
                      onCloseOpenTab(path)
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </span>
                </button>
              </Tooltip>
            )
          })}
        </div>
      )}

      <ModalShell open={Boolean(discardUnsavedConfirm)} onClose={() => onResolveDiscardUnsavedConfirm(false)} widthClassName="max-w-[440px]" baseZIndex={1100} ariaLabel={t('codeWorkspace.unsavedAria')}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="section-label mb-1">{t('codeWorkspace.unsavedTitle')}</p>
            <p className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('codeWorkspace.unsavedCurrentFile')}</p>
          </div>
          <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]" onClick={() => onResolveDiscardUnsavedConfirm(false)} title={t('common.close')}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/70 px-3 py-2 text-[12px] text-[color:var(--color-foreground)]">
          {discardUnsavedConfirm?.forceReload ? t('codeWorkspace.unsavedForceReload') : t('codeWorkspace.unsavedSwitchFile', { path: discardUnsavedConfirm?.nextRelativePath ?? t('codeWorkspace.chooseFileToStart') })}
        </p>
        <p className="mt-2 text-[10.5px] text-[color:var(--color-muted-foreground)]">{t('codeWorkspace.unsavedHint')}</p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" className="quiet-control inline-flex h-9 items-center justify-center rounded-full border-0 px-4 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]" onClick={() => onResolveDiscardUnsavedConfirm(false)}>
            {t('common.cancel')}
          </button>
          <button type="button" className="inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 text-xs font-medium text-white transition-colors hover:bg-primary-hover" onClick={() => onResolveDiscardUnsavedConfirm(true)}>
            {t('codeWorkspace.discardAndContinue')}
          </button>
        </div>
      </ModalShell>
    </>
  )
}
