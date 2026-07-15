import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Code2,
  Columns2,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  RefreshCw,
  Share2,
  Trash2,
} from 'lucide-react'
import type {
  ProjectDocTagOption,
  TranscriptSession,
  TranscriptSessionSummary,
  TranscriptViewerMode,
} from '../../../shared/types'
import type {
  InterpolationValues,
  MessageKey,
  ResolvedLocale,
  SettingsSectionMessageKey,
} from '../../i18n/messages'
import { Button } from '../../components/ui/button'
import { MonacoTextViewer } from '../../components/MonacoTextViewer'
import { ProjectLinksTrigger } from '../../components/ProjectLinksTrigger'
import { ProjectPaneTabs } from '../../components/ProjectPaneTabs'
import { projectDisplayName, middleTruncatePath } from '../../lib/projectDisplay'
import { preloadProjectPane } from '../../lib/projectPagePreload'
import { inferLanguageFromRelativePath } from '../code/code.helpers'
import { transformMarkdownUrl } from '../code/code.markdownUrls'
import { remarkBoxDrawingTables } from '../code/code.markdownBoxTables'
import { MarkdownPreviewVisibilityProvider } from '../code/code.markdownVisibility'

function TranscriptModeButton({
  active,
  disabled = false,
  icon,
  label,
  onClick,
}: {
  active: boolean
  disabled?: boolean
  icon: JSX.Element
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'bg-primary text-white'
          : 'text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
      }`}
      onClick={onClick}
      disabled={disabled}
      title={label}
    >
      {icon}
      {label}
    </button>
  )
}

type TranscriptPageHeaderProps = {
  project: {
    id: string
    path: string
    name: string
    customName?: string
  }
  projectId: string
  projectHeaderCollapsed: boolean
  setProjectHeaderCollapsed: (value: boolean) => void
  transcriptCountLabel: string
  projectDocsCountLabel: string
  firstProjectLinkItem?: { url: string; label: string }
  projectLinkItems: Array<{ url: string; label: string; tagId?: string }>
  docLinkTagOptions: ReadonlyArray<ProjectDocTagOption>
  session: TranscriptSession | undefined
  locale: ResolvedLocale
  formatTranscriptSourceType: (locale: ResolvedLocale, value: string) => string
  navigateToPane: (pane: string) => void
  onOpenManualImport: () => void
  onOpenImportCurrentOutput: () => void
  hasTerminalOutput: boolean
  isImporting: boolean
  renderProjectLinksButton: () => JSX.Element
  saveStatusText: string
  saveStatusToneClass: string
  saveButtonDisabled: boolean
  isSavingTranscript: boolean
  onSaveTranscript: () => void
  t: (
    key: MessageKey | SettingsSectionMessageKey,
    values?: InterpolationValues
  ) => string
  isDevReady: boolean
  pendingOpenDevUrl: boolean
  isActive: boolean
  startAndOpenDevUrl: () => Promise<void>
  onRefreshList: () => void
} 

export function TranscriptPageHeader({
  project,
  projectId,
  projectHeaderCollapsed,
  setProjectHeaderCollapsed,
  transcriptCountLabel,
  projectDocsCountLabel,
  firstProjectLinkItem,
  session,
  locale,
  formatTranscriptSourceType,
  navigateToPane,
  onOpenManualImport,
  onOpenImportCurrentOutput,
  hasTerminalOutput,
  isImporting,
  renderProjectLinksButton,
  saveStatusText,
  saveStatusToneClass,
  saveButtonDisabled,
  isSavingTranscript,
  onSaveTranscript,
  t,
  isDevReady,
  pendingOpenDevUrl,
  isActive,
  startAndOpenDevUrl,
  onRefreshList,
}: TranscriptPageHeaderProps) {
  return (
    <>
      {!projectHeaderCollapsed && (
        <header className="app-chrome pointer-events-auto absolute inset-x-0 top-0 z-[85] flex min-h-[84px] items-center justify-between gap-4 px-8 py-4">
          <div className="flex min-w-0 items-center gap-4">
            <button
              className="rounded-full p-2 text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
              onClick={() => navigateToPane('code')}
            >
              <ChevronLeft className="h-5 w-5" strokeWidth={1.8} />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-[-0.03em] text-[color:var(--color-foreground)]">
                {projectDisplayName(project)}
              </h1>
              <p
                className="mt-0.5 truncate text-xs text-[color:var(--color-muted-foreground)]"
                title={project.path}
              >
                {middleTruncatePath(project.path)}
              </p>
              <p className="mt-0.5 text-[11px] text-[color:var(--color-muted-foreground)]/85">
                {t('transcript.pageTitle')}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <ProjectPaneTabs
              activePane="transcript"
              onPreloadPane={preloadProjectPane}
              onSelectPane={(pane) => {
                if (pane === 'transcript') return
                navigateToPane(pane)
              }}
            />
            {renderProjectLinksButton()}
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-[color:var(--color-border)] px-4 py-2 text-sm font-medium text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
              onClick={onOpenManualImport}
            >
              <FileText className="h-4 w-4" />
              {t('transcript.importPastedContent')}
            </button>
            <button
              type="button"
              className={`inline-flex h-9 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-all ${
                hasTerminalOutput
                  ? 'bg-primary text-white shadow-sm hover:bg-primary-hover'
                  : 'cursor-not-allowed border border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)]'
              }`}
              onClick={onOpenImportCurrentOutput}
              disabled={!hasTerminalOutput || isImporting}
              title={hasTerminalOutput ? t('transcript.importCurrentOutputHint') : t('transcript.processOutputEmpty')}
            >
              {isImporting ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowDownToLine className="h-3.5 w-3.5" />
              )}
              {t('transcript.importCurrentOutput')}
            </button>
            <div className="ml-1 flex items-center gap-2">
              <span className={`hidden text-xs min-[1480px]:inline ${saveStatusToneClass}`}>
                {saveStatusText}
              </span>
              <Button
                type="button"
                className="h-9 rounded-full px-4"
                onClick={onSaveTranscript}
                disabled={saveButtonDisabled}
                title={t('transcript.saveShortcutHint')}
              >
                {isSavingTranscript ? <RefreshCw className="animate-spin" /> : <Check className="h-4 w-4" />}
                {isSavingTranscript ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </div>

          <button
            type="button"
            aria-label={t('transcript.collapseProjectHeader')}
            title={t('transcript.collapseProjectHeader')}
            className="absolute bottom-0 left-1/2 z-[87] inline-flex h-6 w-6 -translate-x-1/2 translate-y-1/2 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-card)] text-[color:var(--color-muted-foreground)] shadow-[0_6px_18px_rgba(0,0,0,0.08)] backdrop-blur-md transition-all hover:scale-105 hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
            onClick={() => setProjectHeaderCollapsed(true)}
          >
            <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        </header>
      )}

      {projectHeaderCollapsed && (
        <button
          type="button"
          aria-label={t('transcript.expandProjectHeader')}
          className="app-chrome fixed left-1/2 top-[calc(var(--window-titlebar-height)+6px)] z-[86] inline-flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full border border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)] shadow-[0_6px_18px_rgba(0,0,0,0.08)] backdrop-blur-md transition-all hover:scale-105 hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
          onClick={() => setProjectHeaderCollapsed(false)}
          title={t('transcript.expandProjectHeader')}
        >
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      )}

      <section className="shrink-0 rounded-[20px] border border-[color:var(--color-border)] bg-[color:var(--color-card)]/62 px-4 py-2">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            {projectHeaderCollapsed ? (
              <div className="flex min-w-0 items-center gap-2.5">
                <p
                  className="max-w-[140px] truncate text-sm font-medium text-[color:var(--color-foreground)]"
                  title={projectDisplayName(project)}
                >
                  {projectDisplayName(project)}
                </p>
                <ProjectPaneTabs
                  activePane="transcript"
                  onPreloadPane={preloadProjectPane}
                  onSelectPane={(pane) => {
                    if (pane === 'transcript') return
                    navigateToPane(pane)
                  }}
                />
                {firstProjectLinkItem && renderProjectLinksButton()}
                {(isDevReady || pendingOpenDevUrl || !isActive) && (
                  <button
                    type="button"
                    className={`quiet-control inline-flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--color-border)] transition-colors hover:bg-[color:var(--color-accent)] disabled:opacity-60 ${
                      isDevReady
                        ? 'text-primary hover:text-primary'
                        : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
                    }`}
                    onClick={() => {
                      void startAndOpenDevUrl()
                    }}
                    disabled={pendingOpenDevUrl}
                    title={isDevReady ? t('project.openDevUrl') : pendingOpenDevUrl ? t('project.waitingForDevUrl') : t('project.startAndOpenDevUrlShort')}
                    aria-label={isDevReady ? t('project.openDevUrl') : pendingOpenDevUrl ? t('project.waitingForDevUrl') : t('project.startAndOpenDevUrlShort')}
                  >
                    {pendingOpenDevUrl ? (
                      <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
                    ) : (
                      <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
                    )}
                  </button>
                )}
              </div>
            ) : (
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[color:var(--color-foreground)]">
                  {t('transcript.listTitle')}
                </p>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-full border border-[color:var(--color-border)] px-2.5 py-0.5 text-[11px] text-[color:var(--color-muted-foreground)]">
                    {transcriptCountLabel}
                  </span>
                  <span className="inline-flex items-center rounded-full border border-[color:var(--color-border)] px-2.5 py-0.5 text-[11px] text-[color:var(--color-muted-foreground)]">
                    {projectDocsCountLabel}
                  </span>
                  {session && (
                    <span
                      className="inline-flex max-w-[280px] items-center truncate rounded-full border border-[color:var(--color-border)] px-2.5 py-0.5 text-[11px] text-[color:var(--color-muted-foreground)]"
                      title={session.title}
                    >
                      {session.title}
                    </span>
                  )}
                  {session && (
                    <span className="inline-flex items-center rounded-full border border-[color:var(--color-border)] px-2.5 py-0.5 text-[11px] text-[color:var(--color-muted-foreground)]">
                      {formatTranscriptSourceType(locale, session.sourceType)}
                    </span>
                  )}
                  {session && (
                    <span className="inline-flex items-center rounded-full border border-[color:var(--color-border)] px-2.5 py-0.5 text-[11px] text-[color:var(--color-muted-foreground)]">
                      {t('transcript.refs', { count: session.references.length })}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex min-w-0 shrink-0 items-center justify-end gap-3">
            {projectHeaderCollapsed ? (
              <>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-3 py-1.5 text-xs font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                  onClick={onOpenManualImport}
                  title={t('transcript.importPastedContent')}
                >
                  <FileText className="h-3.5 w-3.5" />
                  {t('transcript.importPastedContent')}
                </button>
                <button
                  type="button"
                  className={`inline-flex h-9 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-all ${
                    hasTerminalOutput
                      ? 'bg-primary text-white shadow-sm hover:bg-primary-hover'
                      : 'cursor-not-allowed border border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)]'
                  }`}
                  onClick={onOpenImportCurrentOutput}
                  disabled={!hasTerminalOutput || isImporting}
                  title={hasTerminalOutput ? t('transcript.importCurrentOutputHint') : t('transcript.processOutputEmpty')}
                >
                  {isImporting ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ArrowDownToLine className="h-3.5 w-3.5" />
                  )}
                  {t('transcript.importCurrentOutput')}
                </button>
                <div className="ml-1 flex items-center gap-2">
                  <span className={`hidden text-xs min-[1480px]:inline ${saveStatusToneClass}`}>
                    {saveStatusText}
                  </span>
                  <Button
                    type="button"
                    className="h-9 rounded-full px-4"
                    onClick={onSaveTranscript}
                    disabled={saveButtonDisabled}
                    title={t('transcript.saveShortcutHint')}
                  >
                    {isSavingTranscript ? <RefreshCw className="animate-spin" /> : <Check className="h-4 w-4" />}
                    {isSavingTranscript ? t('common.saving') : t('common.save')}
                  </Button>
                </div>
              </>
            ) : (
              <>
                {session && (
                  <span className={`hidden text-xs min-[1240px]:inline ${saveStatusToneClass}`}>
                    {saveStatusText}
                  </span>
                )}
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                  onClick={onRefreshList}
                  title={t('settingsTranscript.refresh')}
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </section>
    </>
  )
}

type TranscriptListSidebarProps = {
  listStatus: 'idle' | 'loading' | 'ready' | 'error'
  summaries: TranscriptSessionSummary[]
  resolvedActiveTranscriptId?: string
  deletingTranscriptId: string | null
  transcriptCountLabel: string
  locale: ResolvedLocale
  formatDateTime: (value: number, options?: Intl.DateTimeFormatOptions) => string
  formatTranscriptSourceType: (locale: ResolvedLocale, value: string) => string
  onRefreshList: () => void
  onSelectTranscript: (transcriptId: string) => void
  onDeleteTranscript: (payload: { id: string; title: string }) => void
  t: (
    key: MessageKey | SettingsSectionMessageKey,
    values?: InterpolationValues
  ) => string
}

export function TranscriptListSidebar({
  listStatus,
  summaries,
  resolvedActiveTranscriptId,
  deletingTranscriptId,
  transcriptCountLabel,
  locale,
  formatDateTime,
  formatTranscriptSourceType,
  onRefreshList,
  onSelectTranscript,
  onDeleteTranscript,
  t,
}: TranscriptListSidebarProps) {
  const sourceGroups = useMemo(() => {
    const groups = new Map<string, {
      id: string
      label: string
      summaries: TranscriptSessionSummary[]
    }>()

    for (const summary of summaries) {
      const id = summary.sourceType
      const existing = groups.get(id)
      if (existing) {
        existing.summaries.push(summary)
        continue
      }
      groups.set(id, {
        id,
        label: formatTranscriptSourceType(locale, id),
        summaries: [summary],
      })
    }

    return Array.from(groups.values())
  }, [formatTranscriptSourceType, locale, summaries])
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    setCollapsedGroupIds((current) => {
      const validGroupIds = new Set(sourceGroups.map((group) => group.id))
      const activeGroupId = sourceGroups.find((group) => (
        group.summaries.some((summary) => summary.id === resolvedActiveTranscriptId)
      ))?.id
      const next = new Set(Array.from(current).filter((id) => validGroupIds.has(id)))
      if (activeGroupId) {
        next.delete(activeGroupId)
      }
      if (next.size === current.size && Array.from(next).every((id) => current.has(id))) {
        return current
      }
      return next
    })
  }, [resolvedActiveTranscriptId, sourceGroups])

  const toggleSourceGroup = (groupId: string) => {
    setCollapsedGroupIds((current) => {
      const next = new Set(current)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  return (
    <aside className="flex h-full w-full min-h-0 flex-col overflow-hidden rounded-[24px] border border-[color:var(--color-border)] bg-[color:var(--color-card)]">
      <div className="border-b border-[color:var(--color-border)] px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[color:var(--color-foreground)]">
              {t('transcript.listTitle')}
            </p>
            <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
              {transcriptCountLabel}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
            onClick={onRefreshList}
            title={t('settingsTranscript.refresh')}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {listStatus === 'loading' && summaries.length <= 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-[color:var(--color-muted-foreground)]">
            {t('transcript.loadingTranscripts')}
          </div>
        ) : listStatus === 'error' && summaries.length <= 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
            <p className="text-sm text-[color:var(--color-destructive)]">
              {t('transcript.failedToLoad')}
            </p>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-3 py-1.5 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
              onClick={onRefreshList}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t('transcript.retry')}
            </button>
          </div>
        ) : summaries.length <= 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
            <FileText className="h-10 w-10 text-[color:var(--color-muted-foreground)]/70" />
            <div>
              <p className="text-sm font-medium text-[color:var(--color-foreground)]">
                {t('transcript.noTranscriptYet')}
              </p>
              <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
                {t('transcript.firstTranscriptHint')}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {sourceGroups.map((group) => {
              const isCollapsed = collapsedGroupIds.has(group.id)
              return (
                <div key={group.id} className="min-w-0">
                  <button
                    type="button"
                    className="code-tree-row font-semibold text-[color:var(--color-muted-foreground)]"
                    style={{ paddingLeft: 10, paddingRight: 10 }}
                    aria-expanded={!isCollapsed}
                    onClick={() => toggleSourceGroup(group.id)}
                    title={group.label}
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
                    )}
                    {isCollapsed ? (
                      <Folder className="h-4 w-4 shrink-0 text-[color:var(--color-warning)]" />
                    ) : (
                      <FolderOpen className="h-4 w-4 shrink-0 text-[color:var(--color-warning)]" />
                    )}
                    <span className="block min-w-0 flex-1 truncate">{group.label}</span>
                    <span className="shrink-0 font-mono text-[10px] font-medium text-[color:var(--color-muted-foreground)]">
                      {group.summaries.length}
                    </span>
                  </button>

                  {!isCollapsed && (
                    <div className="mt-0.5">
                      {group.summaries.map((summary) => {
                        const isActive = summary.id === resolvedActiveTranscriptId
                        const isDeleting = deletingTranscriptId === summary.id
                        const updatedLabel = formatDateTime(summary.updatedAt, {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false,
                        })
                        const rowTitle = `${summary.title}\n${t('transcript.updatedAt', { value: updatedLabel })}\n${t('transcript.refs', { count: summary.referenceCount })}`

                        return (
                          <div key={summary.id} className="group relative min-w-0">
                            <button
                              type="button"
                              className={`code-tree-row ${isActive ? 'code-tree-row--active' : ''} disabled:cursor-not-allowed disabled:opacity-60`}
                              style={{ paddingLeft: 28, paddingRight: 36 }}
                              onClick={() => onSelectTranscript(summary.id)}
                              disabled={isDeleting}
                              title={rowTitle}
                            >
                              <span className="inline-block h-3.5 w-3.5 shrink-0" />
                              <FileText className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]" />
                              <span className="block min-w-0 flex-1 truncate">{summary.title}</span>
                              <span className="shrink-0 font-mono text-[10px] text-[color:var(--color-muted-foreground)]">
                                {updatedLabel}
                              </span>
                            </button>
                            <button
                              type="button"
                              className={`absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-[color:var(--color-muted-foreground)] opacity-0 transition-all hover:bg-[color:var(--color-destructive-background)] hover:text-[color:var(--color-destructive)] focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-60 ${
                                isActive || isDeleting ? 'opacity-100' : 'group-hover:opacity-100'
                              }`}
                              onClick={() => onDeleteTranscript({ id: summary.id, title: summary.title })}
                              disabled={isDeleting || deletingTranscriptId !== null}
                              title={isDeleting ? t('transcript.deletingTranscript') : t('transcript.deleteTranscript')}
                            >
                              {isDeleting ? (
                                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </aside>
  )
}

type TranscriptMainContentProps = {
  resolvedActiveTranscriptId?: string
  session?: TranscriptSession
  effectiveMode: TranscriptViewerMode
  isNarrowViewport: boolean
  locale: ResolvedLocale
  markdownComponents: Components
  displayMarkdownText: string
  previewScrollRef: React.RefObject<HTMLDivElement>
  editorValue: string
  setEditorValue: (value: string) => void
  onSaveTranscript: (currentValue?: string) => void
  onOpenShareModal: () => void
  setTranscriptMode: (sessionId: string, mode: TranscriptViewerMode) => void
  t: (
    key: MessageKey | SettingsSectionMessageKey,
    values?: InterpolationValues
  ) => string
  formatTranscriptSourceType: (locale: ResolvedLocale, value: string) => string
}

export function TranscriptMainContent({
  resolvedActiveTranscriptId,
  session,
  effectiveMode,
  isNarrowViewport,
  locale,
  markdownComponents,
  displayMarkdownText,
  previewScrollRef,
  editorValue,
  setEditorValue,
  onSaveTranscript,
  onOpenShareModal,
  setTranscriptMode,
  t,
  formatTranscriptSourceType,
}: TranscriptMainContentProps) {
  return (
    <main className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[24px] border border-[color:var(--color-border)] bg-[color:var(--color-card)]">
      {!resolvedActiveTranscriptId ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <FileText className="h-10 w-10 text-[color:var(--color-muted-foreground)]/70" />
          <div>
            <p className="text-sm font-medium text-[color:var(--color-foreground)]">
              {t('transcript.selectOrImport')}
            </p>
            <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
              {t('transcript.selectOrImportHint')}
            </p>
          </div>
        </div>
      ) : !session ? (
        <div className="flex h-full items-center justify-center text-sm text-[color:var(--color-muted-foreground)]">
          {t('transcript.loadingTranscript')}
        </div>
      ) : (
        <>
          <div className="border-b border-[color:var(--color-border)] px-6 py-5">
            <div className="flex flex-col gap-4 min-[960px]:flex-row min-[960px]:items-start min-[960px]:justify-between">
              <div className="min-w-0 min-[960px]:max-w-[min(100%,560px)]">
                <div className="flex min-w-0 items-center gap-2">
                  <h2 className="min-w-0 max-w-full flex-1 truncate whitespace-nowrap text-lg font-semibold text-[color:var(--color-foreground)] min-[960px]:max-w-[300px]">
                    {session.title}
                  </h2>
                  <span className="shrink-0 rounded-full border border-[color:var(--color-border)] px-2.5 py-0.5 text-[11px] text-[color:var(--color-muted-foreground)]">
                    {formatTranscriptSourceType(locale, session.sourceType)}
                  </span>
                  <span className="shrink-0 rounded-full border border-[color:var(--color-border)] px-2.5 py-0.5 text-[11px] text-[color:var(--color-muted-foreground)]">
                    {t('transcript.refs', { count: session.references.length })}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-3.5 text-xs font-medium text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={onOpenShareModal}
                  disabled={effectiveMode === 'editor'}
                  title={effectiveMode === 'editor' ? t('transcript.preview') : t('transcript.shareTitle')}
                >
                  <Share2 className="h-3.5 w-3.5" />
                  {t('transcript.share')}
                </button>
                <div className="quiet-control inline-flex items-center gap-1 rounded-full border border-[color:var(--color-border)] p-1">
                  <TranscriptModeButton
                    active={effectiveMode === 'preview'}
                    icon={<Eye className="h-3.5 w-3.5" />}
                    label={t('transcript.preview')}
                    onClick={() => setTranscriptMode(session.id, 'preview')}
                  />
                  <TranscriptModeButton
                    active={effectiveMode === 'editor'}
                    icon={<Code2 className="h-3.5 w-3.5" />}
                    label={t('transcript.editor')}
                    onClick={() => setTranscriptMode(session.id, 'editor')}
                  />
                  <TranscriptModeButton
                    active={effectiveMode === 'split'}
                    disabled={isNarrowViewport}
                    icon={<Columns2 className="h-3.5 w-3.5" />}
                    label={t('transcript.split')}
                    onClick={() => setTranscriptMode(session.id, 'split')}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden p-4">
            <div
              className={`grid h-full min-h-0 overflow-hidden rounded-[20px] border border-[color:var(--color-border)] bg-[color:var(--color-background-subtle)] ${
                effectiveMode === 'split' ? 'min-[960px]:grid-cols-2' : 'grid-cols-1'
              }`}
            >
              {(effectiveMode === 'preview' || effectiveMode === 'split') && (
                <div
                  ref={previewScrollRef}
                  className="code-markdown-preview-scroll-root transcript-markdown-preview-scroll-root min-h-0 overflow-y-auto bg-[color:var(--color-card)]"
                >
                  <article className="code-markdown-content code-markdown-content--viewport-scroll transcript-markdown-content px-6 py-6">
                    <MarkdownPreviewVisibilityProvider forceRenderAllBlocks>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkBoxDrawingTables]}
                        components={markdownComponents}
                        urlTransform={transformMarkdownUrl}
                      >
                        {displayMarkdownText}
                      </ReactMarkdown>
                    </MarkdownPreviewVisibilityProvider>
                  </article>
                </div>
              )}

              {(effectiveMode === 'editor' || effectiveMode === 'split') && (
                <div
                  className={`min-h-0 bg-[color:var(--color-card)] ${
                    effectiveMode === 'split'
                      ? 'border-t border-[color:var(--color-border)] min-[960px]:border-l min-[960px]:border-t-0'
                      : ''
                  }`}
                >
                  <MonacoTextViewer
                    value={editorValue}
                    filePath={`transcript/${session.id}.md`}
                    language={inferLanguageFromRelativePath('transcript.md')}
                    readOnly={false}
                    onChange={setEditorValue}
                    onSave={onSaveTranscript}
                    modelNamespace="transcript-viewer"
                    stickyScroll
                  />
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  )
}
