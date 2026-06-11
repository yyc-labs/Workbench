import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { shallow } from 'zustand/shallow'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AlertTriangle,
  ArrowDownToLine,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Code2,
  Columns2,
  Eye,
  FileText,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import type { TranscriptReference, TranscriptViewerMode } from '../../shared/types'
import { ModalShell } from '../components/ModalShell'
import { MonacoTextViewer } from '../components/MonacoTextViewer'
import { middleTruncatePath, projectDisplayName } from '../lib/projectDisplay'
import { useAppStore } from '../stores/appStore'
import { inferLanguageFromRelativePath } from './code/code.helpers'
import {
  createMarkdownComponents,
  type MarkdownStructuredBlockClickPayload,
  shouldDisableMarkdownSyntaxHighlight,
  transformMarkdownUrl,
} from './code/code.markdown'
import { remarkBoxDrawingTables } from './code/code.markdownBoxTables'
import { TranscriptReferenceDrawer } from './transcript/TranscriptReferenceDrawer'

const TRANSCRIPT_SPLIT_BREAKPOINT_PX = 960
const TRANSCRIPT_SPLIT_QUERY = `(max-width: ${TRANSCRIPT_SPLIT_BREAKPOINT_PX}px)`
const PROJECT_HEADER_COLLAPSED_STORAGE_KEY = 'app:project-header-collapsed'
const TRANSCRIPT_DECORATIVE_RULE_MIN_LENGTH = 48

type TranscriptStructuredPreviewState = {
  kind: MarkdownStructuredBlockClickPayload['kind']
  startLine: number
  endLine: number
  markdown: string
}

const StructuredPreviewMarkdown = memo(function StructuredPreviewMarkdown({
  markdown,
  components,
}: {
  markdown: string
  components: Components
}) {
  return (
    <article className="code-markdown-content code-markdown-content--modal transcript-markdown-content px-5 py-8">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBoxDrawingTables]}
        components={components}
        urlTransform={transformMarkdownUrl}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  )
})

function normalizeTranscriptDisplayMarkdown(markdown: string): string {
  if (!markdown) return ''
  return markdown.replace(
    new RegExp(`^[\\t ]*[─━═-]{${TRANSCRIPT_DECORATIVE_RULE_MIN_LENGTH},}[\\t ]*$`, 'gm'),
    '---'
  )
}

function countMarkdownLines(value: string): number {
  if (!value) return 0
  let count = 1
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) count += 1
  }
  return count
}

function sliceMarkdownLines(markdown: string, startLine: number, endLine: number): string {
  if (!markdown) return ''
  const lines = markdown.split('\n')
  const safeStartLine = Math.max(1, Math.floor(startLine))
  const safeEndLine = Math.max(safeStartLine, Math.floor(endLine))
  return lines.slice(safeStartLine - 1, safeEndLine).join('\n').trim()
}

function formatStructuredBlockKind(kind: MarkdownStructuredBlockClickPayload['kind']): string {
  switch (kind) {
    case 'box-flow':
      return 'Flow'
    case 'vertical-flow':
      return 'Vertical Flow'
    case 'table':
      return 'Table'
    default:
      return 'Structured Block'
  }
}

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function formatTranscriptTimestamp(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return 'Unknown time'
  const timestamp = Math.trunc(value)
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return 'Unknown time'
  return DATE_TIME_FORMATTER.format(date)
}

function readProjectHeaderCollapsed(): boolean {
  try {
    return localStorage.getItem(PROJECT_HEADER_COLLAPSED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function formatSourceTypeLabel(value: string): string {
  switch (value) {
    case 'process-output':
      return 'Process Output'
    case 'tmux-capture':
      return 'Tmux Capture'
    case 'agent-hook':
      return 'Agent Hook'
    case 'manual-markdown':
      return 'Manual Markdown'
    case 'imported-file':
      return 'Imported File'
    default:
      return 'Transcript'
  }
}

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

export function TranscriptPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const project = useAppStore((s) => {
    const found = s.projects.find((item) => item.id === projectId)
    if (!found) return undefined
    return {
      id: found.id,
      path: found.path,
      name: found.name,
      customName: found.customName,
      codeSession: found.codeSession,
    }
  }, shallow)
  const {
    summaries,
    activeTranscriptId,
    listStatus,
    terminalOutput,
  } = useAppStore((s) => {
    if (!projectId) {
      return {
        summaries: [],
        activeTranscriptId: undefined,
        listStatus: 'idle' as const,
        terminalOutput: '',
      }
    }
    return {
      summaries: s.transcriptSummariesByProjectId[projectId] ?? [],
      activeTranscriptId: s.activeTranscriptIdByProjectId[projectId],
      listStatus: s.transcriptListStatusByProjectId[projectId] ?? 'idle',
      terminalOutput: s.terminalOutputs[projectId] ?? '',
    }
  }, shallow)
  const loadProjectTranscripts = useAppStore((s) => s.loadProjectTranscripts)
  const openTranscript = useAppStore((s) => s.openTranscript)
  const importCurrentProcessOutputTranscript = useAppStore((s) => s.importCurrentProcessOutputTranscript)
  const setTranscriptMode = useAppStore((s) => s.setTranscriptMode)
  const openTranscriptReference = useAppStore((s) => s.openTranscriptReference)
  const closeTranscriptReference = useAppStore((s) => s.closeTranscriptReference)
  const removeTranscriptSession = useAppStore((s) => s.removeTranscriptSession)
  const setProjectLastCodeFile = useAppStore((s) => s.setProjectLastCodeFile)
  const setProjectCodeSession = useAppStore((s) => s.setProjectCodeSession)
  const [isImporting, setIsImporting] = useState(false)
  const [deletingTranscriptId, setDeletingTranscriptId] = useState<string | null>(null)
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{ id: string; title: string } | null>(null)
  const [projectHeaderCollapsed, setProjectHeaderCollapsed] = useState<boolean>(() => readProjectHeaderCollapsed())
  const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>(
    () => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
  )
  const [isNarrowViewport, setIsNarrowViewport] = useState(
    () => window.matchMedia(TRANSCRIPT_SPLIT_QUERY).matches
  )
  const [structuredPreview, setStructuredPreview] = useState<TranscriptStructuredPreviewState | null>(null)

  const resolvedActiveTranscriptId = activeTranscriptId ?? summaries[0]?.id
  const session = useAppStore((s) => (
    resolvedActiveTranscriptId ? s.transcriptSessions[resolvedActiveTranscriptId] : undefined
  ))
  const storedMode = useAppStore((s) => (
    resolvedActiveTranscriptId ? s.transcriptModeBySessionId[resolvedActiveTranscriptId] : undefined
  ))
  const activeReferenceId = useAppStore((s) => (
    resolvedActiveTranscriptId ? s.activeTranscriptReferenceIdBySessionId[resolvedActiveTranscriptId] : undefined
  ))

  useEffect(() => {
    if (!projectId) return
    void loadProjectTranscripts(projectId)
  }, [loadProjectTranscripts, projectId])

  useEffect(() => {
    if (!projectId || !resolvedActiveTranscriptId) return
    void openTranscript({ projectId, transcriptId: resolvedActiveTranscriptId })
  }, [openTranscript, projectId, resolvedActiveTranscriptId])

  useEffect(() => {
    const root = document.documentElement
    const syncTheme = () => {
      setEffectiveTheme(root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
    }
    syncTheme()
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes' && record.attributeName === 'data-theme') {
          syncTheme()
          break
        }
      }
    })
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const media = window.matchMedia(TRANSCRIPT_SPLIT_QUERY)
    const syncViewport = () => setIsNarrowViewport(media.matches)
    syncViewport()
    media.addEventListener('change', syncViewport)
    return () => media.removeEventListener('change', syncViewport)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(PROJECT_HEADER_COLLAPSED_STORAGE_KEY, projectHeaderCollapsed ? '1' : '0')
    } catch {
      // ignore storage errors
    }
  }, [projectHeaderCollapsed])

  useEffect(() => {
    const onToggleProjectHeader = () => {
      setProjectHeaderCollapsed((prev) => !prev)
    }
    window.addEventListener('app:toggle-project-header', onToggleProjectHeader as EventListener)
    return () => {
      window.removeEventListener('app:toggle-project-header', onToggleProjectHeader as EventListener)
    }
  }, [])

  const effectiveMode: TranscriptViewerMode = useMemo(() => {
    const preferred = storedMode ?? 'preview'
    return preferred === 'split' && isNarrowViewport ? 'preview' : preferred
  }, [isNarrowViewport, storedMode])

  const activeReference = useMemo(() => {
    if (!session || !activeReferenceId) return null
    return session.references.find((item) => item.id === activeReferenceId) ?? null
  }, [activeReferenceId, session])

  const enableMarkdownSyntaxHighlight = useMemo(
    () => !shouldDisableMarkdownSyntaxHighlight(session?.markdownText ?? ''),
    [session?.markdownText]
  )
  const displayMarkdownText = useMemo(
    () => normalizeTranscriptDisplayMarkdown(session?.markdownText ?? ''),
    [session?.markdownText]
  )
  const structuredPreviewMarkdown = structuredPreview?.markdown ?? ''
  const structuredPreviewEnableSyntaxHighlight = useMemo(
    () => !shouldDisableMarkdownSyntaxHighlight(structuredPreviewMarkdown),
    [structuredPreviewMarkdown]
  )

  const handleInternalLinkClick = useCallback((href: string) => {
    if (!session) return
    const reference = session.references.find((item) => item.href === href)
    if (!reference) return
    openTranscriptReference(session.id, reference.id)
  }, [openTranscriptReference, session])

  const closeStructuredPreview = useCallback(() => {
    setStructuredPreview(null)
  }, [])

  const handleStructuredBlockClick = useCallback((payload: MarkdownStructuredBlockClickPayload) => {
    const markdown = sliceMarkdownLines(displayMarkdownText, payload.startLine, payload.endLine)
    if (!markdown) return
    setStructuredPreview({
      ...payload,
      markdown,
    })
  }, [displayMarkdownText])

  const markdownComponents = useMemo(() => {
    if (!project) return {}
    return createMarkdownComponents({
      activeRelativePath: null,
      activeInternalHref: activeReference?.href ?? null,
      enableMarkdownSyntaxHighlight,
      onInternalLinkClick: handleInternalLinkClick,
      onStructuredBlockClick: handleStructuredBlockClick,
      projectPath: project.path,
      themeMode: effectiveTheme,
    })
  }, [
    activeReference?.href,
    effectiveTheme,
    enableMarkdownSyntaxHighlight,
    handleInternalLinkClick,
    handleStructuredBlockClick,
    project,
  ])

  const structuredPreviewComponents = useMemo(() => {
    if (!project) return {}
    return createMarkdownComponents({
      activeRelativePath: null,
      activeInternalHref: null,
      enableMarkdownSyntaxHighlight: structuredPreviewEnableSyntaxHighlight,
      lineOffset: structuredPreview ? structuredPreview.startLine - 1 : 0,
      onInternalLinkClick: handleInternalLinkClick,
      projectPath: project.path,
      themeMode: effectiveTheme,
    })
  }, [
    effectiveTheme,
    handleInternalLinkClick,
    project,
    structuredPreview?.startLine,
    structuredPreviewEnableSyntaxHighlight,
  ])

  const handleImportCurrentOutput = useCallback(async () => {
    if (!projectId || isImporting) return
    setIsImporting(true)
    try {
      const imported = await importCurrentProcessOutputTranscript(
        projectId,
        `Process Output · ${formatTranscriptTimestamp(Date.now())}`
      )
      if (!imported) return
      await openTranscript({ projectId, transcriptId: imported.id, initialMode: 'preview' })
    } finally {
      setIsImporting(false)
    }
  }, [importCurrentProcessOutputTranscript, isImporting, openTranscript, projectId])

  const handleSelectTranscript = useCallback((transcriptId: string) => {
    if (!projectId) return
    void openTranscript({ projectId, transcriptId })
  }, [openTranscript, projectId])

  const handleDeleteTranscript = useCallback(async () => {
    if (!projectId || deletingTranscriptId || !deleteConfirmTarget) return
    const { id, title: _title } = deleteConfirmTarget
    setDeletingTranscriptId(id)
    try {
      await removeTranscriptSession(projectId, id)
      setDeleteConfirmTarget((current) => (current?.id === id ? null : current))
    } finally {
      setDeletingTranscriptId((current) => (current === id ? null : current))
    }
  }, [deleteConfirmTarget, deletingTranscriptId, projectId, removeTranscriptSession])

  const handleOpenReferenceInCodeWorkspace = useCallback(async ({
    relativePath,
    lineNumber,
    column,
  }: {
    relativePath: string
    lineNumber: number
    column: number
  }) => {
    if (!projectId || !project) return

    const currentSession = project.codeSession
    const nextTabs = Array.from(new Set([
      ...(currentSession?.tabs ?? []),
      relativePath,
    ].map((item) => item.trim()).filter(Boolean))).slice(-5)

    await setProjectLastCodeFile(projectId, relativePath)
    await setProjectCodeSession(projectId, {
      ...currentSession,
      tabs: nextTabs,
      activePath: relativePath,
      cursorPositions: {
        ...(currentSession?.cursorPositions ?? {}),
        [relativePath]: {
          lineNumber: Math.max(1, Math.floor(lineNumber)),
          column: Math.max(1, Math.floor(column)),
        },
      },
    })
    navigate(`/project/${projectId}/code`)
  }, [navigate, project, projectId, setProjectCodeSession, setProjectLastCodeFile])

  if (!project || !projectId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <h2 className="text-lg font-semibold text-[color:var(--color-foreground)]">Project not found</h2>
        <button
          className="inline-flex items-center gap-1.5 text-sm text-primary transition-colors hover:text-primary"
          onClick={() => navigate('/')}
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
          Back to Home
        </button>
      </div>
    )
  }

  const hasTerminalOutput = terminalOutput.trim().length > 0
  const contentTopPaddingClass = projectHeaderCollapsed
    ? 'pt-5'
    : 'pt-[calc(var(--window-titlebar-height)+84px+8px)]'

  return (
    <div className="relative flex h-full flex-col">
      {!projectHeaderCollapsed && (
        <header className="app-chrome pointer-events-auto absolute inset-x-0 top-0 z-[85] flex min-h-[84px] items-center justify-between gap-4 px-8 py-4">
          <div className="flex min-w-0 items-center gap-4">
            <button
              className="rounded-full p-2 text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
              onClick={() => navigate(`/project/${projectId}/code`)}
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
                Transcript Viewer
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <div className="quiet-control flex items-center gap-1 rounded-full border border-[color:var(--color-border)] p-1">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:text-[color:var(--color-foreground)]"
                onClick={() => navigate(`/project/${projectId}/code`)}
              >
                <Code2 className="h-3.5 w-3.5" />
                Code
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:text-[color:var(--color-foreground)]"
                onClick={() => navigate(`/project/${projectId}/aicommit`)}
              >
                <Bot className="h-3.5 w-3.5" />
                AI Commit
              </button>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-primary)]/30 bg-[color:var(--color-primary)]/10 px-3 py-1.5 text-xs font-medium text-[color:var(--color-primary)]">
              <FileText className="h-3.5 w-3.5" />
              Transcript
            </div>
            <button
              type="button"
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                hasTerminalOutput
                  ? 'bg-primary text-white hover:bg-primary-hover'
                  : 'cursor-not-allowed border border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)]'
              }`}
              onClick={() => {
                void handleImportCurrentOutput()
              }}
              disabled={!hasTerminalOutput || isImporting}
              title={hasTerminalOutput ? 'Import current process output' : 'Current process output is empty'}
            >
              {isImporting ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowDownToLine className="h-4 w-4" />
              )}
              Import Current Output
            </button>
          </div>

          <button
            type="button"
            aria-label="收起项目栏"
            title="收起项目栏"
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
          aria-label="展开项目栏"
          className="app-chrome fixed left-1/2 top-[calc(var(--window-titlebar-height)+6px)] z-[86] inline-flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full border border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)] shadow-[0_6px_18px_rgba(0,0,0,0.08)] backdrop-blur-md transition-all hover:scale-105 hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
          onClick={() => setProjectHeaderCollapsed(false)}
          title="展开项目栏"
        >
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      )}

      <div className={`flex-1 min-h-0 overflow-hidden px-8 pb-8 ${contentTopPaddingClass}`}>
        <div className="grid h-full min-h-0 gap-6 min-[1080px]:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-[color:var(--color-border)] bg-[color:var(--color-card)]">
            <div className="border-b border-[color:var(--color-border)] px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[color:var(--color-foreground)]">Transcripts</p>
                  <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
                    {summaries.length} saved session{summaries.length === 1 ? '' : 's'}
                  </p>
                </div>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                  onClick={() => {
                    void loadProjectTranscripts(projectId)
                  }}
                  title="Refresh transcript list"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              {listStatus === 'loading' && summaries.length <= 0 ? (
                <div className="flex h-full items-center justify-center text-xs text-[color:var(--color-muted-foreground)]">
                  Loading transcripts...
                </div>
              ) : listStatus === 'error' && summaries.length <= 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
                  <p className="text-sm text-[color:var(--color-destructive)]">Failed to load transcripts.</p>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-3 py-1.5 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
                    onClick={() => {
                      void loadProjectTranscripts(projectId)
                    }}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retry
                  </button>
                </div>
              ) : summaries.length <= 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
                  <FileText className="h-10 w-10 text-[color:var(--color-muted-foreground)]/70" />
                  <div>
                    <p className="text-sm font-medium text-[color:var(--color-foreground)]">No transcript yet</p>
                    <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
                      Import the current process output to create the first saved session.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {summaries.map((summary) => {
                    const isActive = summary.id === resolvedActiveTranscriptId
                    const isDeleting = deletingTranscriptId === summary.id
                    return (
                      <div
                        key={summary.id}
                        className={`flex items-start gap-2 rounded-[18px] border px-3 py-3 transition-colors ${
                          isActive
                            ? 'border-[color:var(--color-primary)]/35 bg-[color:var(--color-primary)]/8'
                            : 'border-transparent bg-[color:var(--color-background)] hover:border-[color:var(--color-border)] hover:bg-[color:var(--color-accent)]/45'
                        }`}
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
                          onClick={() => handleSelectTranscript(summary.id)}
                          disabled={isDeleting}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-[color:var(--color-foreground)]">
                                {summary.title}
                              </p>
                              <p className="mt-1 text-[11px] text-[color:var(--color-muted-foreground)]">
                                {formatSourceTypeLabel(summary.sourceType)}
                              </p>
                            </div>
                            <span className="shrink-0 rounded-full border border-[color:var(--color-border)] px-2 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">
                              {summary.referenceCount} refs
                            </span>
                          </div>
                          <p className="mt-2 text-[11px] text-[color:var(--color-muted-foreground)]">
                            Updated {formatTranscriptTimestamp(summary.updatedAt)}
                          </p>
                        </button>
                        <button
                          type="button"
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-destructive-background)] hover:text-[color:var(--color-destructive)] disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => {
                            setDeleteConfirmTarget({ id: summary.id, title: summary.title })
                          }}
                          disabled={isDeleting || deletingTranscriptId !== null}
                          title={isDeleting ? 'Deleting transcript...' : 'Delete transcript'}
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
          </aside>

          <main className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[24px] border border-[color:var(--color-border)] bg-[color:var(--color-card)]">
            {!resolvedActiveTranscriptId ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <FileText className="h-10 w-10 text-[color:var(--color-muted-foreground)]/70" />
                <div>
                  <p className="text-sm font-medium text-[color:var(--color-foreground)]">Select or import a transcript</p>
                  <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
                    Saved sessions will appear here with Markdown preview and parsed references.
                  </p>
                </div>
              </div>
            ) : !session ? (
              <div className="flex h-full items-center justify-center text-sm text-[color:var(--color-muted-foreground)]">
                Loading transcript...
              </div>
            ) : (
              <>
                <div className="border-b border-[color:var(--color-border)] px-6 py-5">
                  <div className="flex flex-col gap-4 min-[960px]:flex-row min-[960px]:items-start min-[960px]:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-lg font-semibold text-[color:var(--color-foreground)]">
                          {session.title}
                        </h2>
                        <span className="rounded-full border border-[color:var(--color-border)] px-2.5 py-0.5 text-[11px] text-[color:var(--color-muted-foreground)]">
                          {formatSourceTypeLabel(session.sourceType)}
                        </span>
                        <span className="rounded-full border border-[color:var(--color-border)] px-2.5 py-0.5 text-[11px] text-[color:var(--color-muted-foreground)]">
                          {session.references.length} refs
                        </span>
                      </div>
                    </div>

                    <div className="quiet-control inline-flex items-center gap-1 rounded-full border border-[color:var(--color-border)] p-1">
                      <TranscriptModeButton
                        active={effectiveMode === 'preview'}
                        icon={<Eye className="h-3.5 w-3.5" />}
                        label="Preview"
                        onClick={() => setTranscriptMode(session.id, 'preview')}
                      />
                      <TranscriptModeButton
                        active={effectiveMode === 'editor'}
                        icon={<Code2 className="h-3.5 w-3.5" />}
                        label="Editor"
                        onClick={() => setTranscriptMode(session.id, 'editor')}
                      />
                      <TranscriptModeButton
                        active={effectiveMode === 'split'}
                        disabled={isNarrowViewport}
                        icon={<Columns2 className="h-3.5 w-3.5" />}
                        label="Split"
                        onClick={() => setTranscriptMode(session.id, 'split')}
                      />
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
                        className="code-markdown-preview-scroll-root transcript-markdown-preview-scroll-root min-h-0 overflow-y-auto bg-[color:var(--color-card)]"
                      >
                        <article className="code-markdown-content code-markdown-content--viewport-scroll transcript-markdown-content px-6 py-6">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkBoxDrawingTables]}
                            components={markdownComponents}
                            urlTransform={transformMarkdownUrl}
                          >
                            {displayMarkdownText}
                          </ReactMarkdown>
                        </article>
                      </div>
                    )}

                    {(effectiveMode === 'editor' || effectiveMode === 'split') && (
                      <div className={`min-h-0 bg-[color:var(--color-card)] ${effectiveMode === 'split' ? 'border-t border-[color:var(--color-border)] min-[960px]:border-l min-[960px]:border-t-0' : ''}`}>
                        <MonacoTextViewer
                          value={displayMarkdownText}
                          filePath={`transcript/${session.id}.md`}
                          language={inferLanguageFromRelativePath('transcript.md')}
                          readOnly
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
        </div>
      </div>

      <TranscriptReferenceDrawer
        open={Boolean(session && activeReference)}
        baseZIndex={structuredPreview ? 1190 : 1150}
        projectPath={project.path}
        projectName={projectDisplayName(project)}
        reference={activeReference}
        currentCodeSession={project.codeSession}
        onClose={() => {
          if (!session) return
          closeTranscriptReference(session.id)
        }}
        onOpenInCodeWorkspace={handleOpenReferenceInCodeWorkspace}
      />

      <ModalShell
        open={Boolean(structuredPreview)}
        onClose={closeStructuredPreview}
        widthClassName="max-w-[min(1280px,calc(100vw-40px))]"
        baseZIndex={1180}
        ariaLabel="Transcript structured preview"
        overlayClassName="backdrop-blur-0 bg-black/18"
        panelClassName="transcript-structured-preview-modal p-4 sm:p-5"
      >
        <div className="flex max-h-[min(88vh,980px)] min-h-0 flex-col">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="section-label mb-1">Transcript</p>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-[color:var(--color-foreground)]">
                  {structuredPreview ? formatStructuredBlockKind(structuredPreview.kind) : 'Structured Block'}
                </p>
                {structuredPreview && (
                  <span className="rounded-full border border-[color:var(--color-border)] px-2.5 py-0.5 text-[11px] text-[color:var(--color-muted-foreground)]">
                    Lines {structuredPreview.startLine}-{structuredPreview.endLine}
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11px] text-[color:var(--color-muted-foreground)]">
                原位内容保留在文档里，这里提供放大查看。
              </p>
            </div>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
              onClick={closeStructuredPreview}
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto rounded-[20px] border border-[color:var(--color-border)] bg-[color:var(--color-background-subtle)]">
            <StructuredPreviewMarkdown
              markdown={structuredPreviewMarkdown}
              components={structuredPreviewComponents}
            />
          </div>
        </div>
      </ModalShell>

      <ModalShell
        open={Boolean(deleteConfirmTarget)}
        onClose={() => {
          if (deletingTranscriptId) return
          setDeleteConfirmTarget(null)
        }}
        widthClassName="max-w-[460px]"
        baseZIndex={1120}
        ariaLabel="删除 transcript 确认"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="section-label mb-1">Transcript</p>
            <p className="text-sm font-semibold text-[color:var(--color-foreground)]">
              删除这条 transcript？
            </p>
          </div>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => setDeleteConfirmTarget(null)}
            title="Close"
            disabled={Boolean(deletingTranscriptId)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="rounded-[14px] border border-[color:var(--color-destructive)]/22 bg-[color:var(--color-destructive-background)] px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-[color:var(--color-destructive)]">
            <AlertTriangle className="h-3.5 w-3.5" />
            删除后将从列表和本地 transcript 存储中移除
          </p>
          <p className="mt-2 break-words text-[12px] text-[color:var(--color-foreground)]">
            {deleteConfirmTarget?.title}
          </p>
        </div>

        <p className="mt-2 text-[10.5px] text-[color:var(--color-muted-foreground)]">
          该操作不可撤销，但不会删除项目源码文件。
        </p>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            className="quiet-control inline-flex h-9 items-center justify-center rounded-full border-0 px-4 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => setDeleteConfirmTarget(null)}
            disabled={Boolean(deletingTranscriptId)}
          >
            取消
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center rounded-full bg-[color:var(--color-destructive)] px-4 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => {
              void handleDeleteTranscript()
            }}
            disabled={Boolean(deletingTranscriptId)}
          >
            {deletingTranscriptId ? '删除中...' : '确认删除'}
          </button>
        </div>
      </ModalShell>
    </div>
  )
}
