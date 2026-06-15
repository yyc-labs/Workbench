import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { shallow } from 'zustand/shallow'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AlertTriangle,
  ArrowDownToLine,
  BookOpen,
  Check,
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
import { CardContextMenu } from '../components/CardContextMenu'
import { ModalShell } from '../components/ModalShell'
import { ProjectPaneTabs } from '../components/ProjectPaneTabs'
import { ProjectMetaDialog } from '../components/ProjectMetaDialog'
import { UrlPopover } from '../components/UrlPopover'
import { Button } from '../components/ui/button'
import { useScrollableContentCapture } from '../hooks/useScrollableContentCapture'
import { MonacoTextViewer } from '../components/MonacoTextViewer'
import { formatStructuredBlockKind as formatStructuredBlockKindLabel, formatTranscriptSourceType, useI18n, useLocale } from '../i18n'
import { middleTruncatePath, projectDisplayName } from '../lib/projectDisplay'
import { isTmuxRuntimeEntry } from '../lib/runtimePresentation'
import { useAppStore } from '../stores/appStore'
import { inferLanguageFromRelativePath } from './code/code.helpers'
import {
  createMarkdownComponents,
  formatCodeLanguageLabel,
  type MarkdownStructuredBlockClickPayload,
  shouldDisableMarkdownSyntaxHighlight,
  transformMarkdownUrl,
} from './code/code.markdown'
import { remarkBoxDrawingTables } from './code/code.markdownBoxTables'
import { DetailDocumentationCard } from './detail/DetailDocumentationCard'
import { useProjectDocLinks } from './detail/useProjectDocLinks'
import { ManualTranscriptImportModal } from './transcript/ManualTranscriptImportModal'
import {
  TranscriptPreviewModals,
  type TranscriptCodePreviewState,
  type TranscriptStructuredPreviewState,
} from './transcript/TranscriptPreviewModals'
import { TranscriptReferenceDrawer } from './transcript/TranscriptReferenceDrawer'
import {
  normalizeTranscriptDisplayMarkdown,
  shouldSkipProjectPageContextMenu,
  sliceMarkdownLines,
} from './transcript/transcriptPage.utils'
import { useTranscriptPageChromeState } from './transcript/useTranscriptPageChromeState'

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
  const locale = useLocale()
  const { t, formatDateTime } = useI18n()
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
      type: found.type,
      customType: found.customType,
      command: found.command,
      customCommand: found.customCommand,
      runStartupMode: found.runStartupMode,
      packageManager: found.packageManager,
      pinned: found.pinned,
      cli: found.cli,
      docLinks: found.docLinks,
      folderId: found.folderId,
      tagIds: found.tagIds,
      codeSession: found.codeSession,
    }
  }, shallow)
  const folders = useAppStore((s) => s.folders)
  const tags = useAppStore((s) => s.tags)
  const processStatus = useAppStore((s) => (projectId ? s.processes[projectId]?.status ?? 'stopped' : 'stopped'))
  const processUrls = useAppStore((s) => (projectId ? s.processUrls[projectId] ?? [] : []))
  const runtimeSession = useAppStore((s) => (projectId ? s.sessions[projectId] : undefined))
  const runtimeEntry = useAppStore((s) => (projectId ? s.runtimeEntries[projectId] : undefined))
  const aiEnvironmentMode = useAppStore((s) => s.config.aiEnvironment?.mode)
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
  const startProject = useAppStore((s) => s.startProject)
  const stopProject = useAppStore((s) => s.stopProject)
  const startRuntime = useAppStore((s) => s.startRuntime)
  const stopRuntime = useAppStore((s) => s.stopRuntime)
  const openTerminal = useAppStore((s) => s.openTerminal)
  const setProjectCli = useAppStore((s) => s.setProjectCli)
  const assignProjectFolder = useAppStore((s) => s.assignProjectFolder)
  const setProjectTags = useAppStore((s) => s.setProjectTags)
  const setProjectCustomName = useAppStore((s) => s.setProjectCustomName)
  const setProjectCustomType = useAppStore((s) => s.setProjectCustomType)
  const togglePin = useAppStore((s) => s.togglePin)
  const docLinkState = useProjectDocLinks({ project })
  const {
    docLinks,
    docMenuItems,
    linkSettingsOpen,
    setLinkSettingsOpen,
    docTitleInput,
    setDocTitleInput,
    docUrlInput,
    setDocUrlInput,
    docTagInput,
    setDocTagInput,
    docLinkTagOptions: docLinkTagOptionsFromHook,
    docNoteInput,
    setDocNoteInput,
    docAccountInput,
    setDocAccountInput,
    docSecretInput,
    setDocSecretInput,
    docError,
    setDocError,
    handleAddDocLink,
    handleAddDocTag,
    handleRenameDocTag,
    handleRemoveDocTag,
    handleUpdateDocLink,
    handleSetDefaultDocLink,
    handleReorderDocLinks,
    handleRemoveDocLink,
    handleCopyDocLinkAccount,
    handleCopyDocLinkSecret,
    handleGetDocLinkSecret,
  } = docLinkState
  const [isImporting, setIsImporting] = useState(false)
  const [isImportingManual, setIsImportingManual] = useState(false)
  const [manualImportOpen, setManualImportOpen] = useState(false)
  const [deletingTranscriptId, setDeletingTranscriptId] = useState<string | null>(null)
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{ id: string; title: string } | null>(null)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [isOpeningTerminal, setIsOpeningTerminal] = useState(false)
  const [metaDialogOpen, setMetaDialogOpen] = useState(false)
  const {
    projectHeaderCollapsed,
    setProjectHeaderCollapsed,
    effectiveTheme,
    isNarrowViewport,
  } = useTranscriptPageChromeState()
  const [structuredPreview, setStructuredPreview] = useState<TranscriptStructuredPreviewState | null>(null)
  const [codePreview, setCodePreview] = useState<TranscriptCodePreviewState | null>(null)
  const [editorValue, setEditorValue] = useState('')
  const [isSavingTranscript, setIsSavingTranscript] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccessAt, setSaveSuccessAt] = useState<number | null>(null)
  const previewScrollRef = useRef<HTMLDivElement | null>(null)
  const previewScrollPositionRef = useRef({ top: 0, left: 0 })
  const structuredPreviewCapture = useScrollableContentCapture()
  const codePreviewCapture = useScrollableContentCapture()

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

  const effectiveMode: TranscriptViewerMode = useMemo(() => {
    const preferred = storedMode ?? 'preview'
    return preferred === 'split' && isNarrowViewport ? 'preview' : preferred
  }, [isNarrowViewport, storedMode])

  const activeReference = useMemo(() => {
    if (!session || !activeReferenceId) return null
    return session.references.find((item) => item.id === activeReferenceId) ?? null
  }, [activeReferenceId, session])
  const isRuntimeAttached = runtimeSession?.status === 'attached'
  const isRuntimeDetached = runtimeSession?.status === 'detached'
  const isRuntimeActive = isRuntimeAttached || isRuntimeDetached
  const usesTmuxRuntime = isTmuxRuntimeEntry(runtimeEntry, aiEnvironmentMode)
  const isDevRunning = processStatus === 'running'
  const isDevStopping = processStatus === 'stopping'
  const currentCli = project?.cli || 'claude'
  const projectLinkItems = useMemo(
    () => [
      ...(isDevRunning ? processUrls.map((url) => ({ url, label: `Dev: ${url}` })) : []),
      ...docMenuItems,
    ],
    [docMenuItems, isDevRunning, processUrls]
  )
  const firstProjectLinkItem = projectLinkItems[0]
  const projectDocsCountLabel = t('project.docsCount', { count: docLinks.length })

  const enableMarkdownSyntaxHighlight = useMemo(
    () => !shouldDisableMarkdownSyntaxHighlight(session?.markdownText ?? ''),
    [session?.markdownText]
  )
  const displayMarkdownText = useMemo(
    () => normalizeTranscriptDisplayMarkdown(session?.markdownText ?? ''),
    [session?.markdownText]
  )
  const isDirty = session ? editorValue !== session.rawText : false
  const saveButtonDisabled = !session || effectiveMode === 'preview' || !isDirty || isSavingTranscript
  const saveStatusText = saveError
    ? saveError
    : isSavingTranscript
      ? t('common.saving')
      : isDirty
        ? t('transcript.unsavedChanges')
        : saveSuccessAt
          ? t('transcript.savedAt', {
            value: formatDateTime(saveSuccessAt, {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: false,
            }),
          })
          : t('transcript.allChangesSaved')
  const saveStatusToneClass = saveError
    ? 'text-[color:var(--color-destructive)]'
    : isDirty
      ? 'text-[color:var(--color-foreground)]'
      : 'text-[color:var(--color-muted-foreground)]'
  const structuredPreviewMarkdown = structuredPreview?.markdown ?? ''
  const structuredPreviewEnableSyntaxHighlight = useMemo(
    () => !shouldDisableMarkdownSyntaxHighlight(structuredPreviewMarkdown),
    [structuredPreviewMarkdown]
  )

  const handleInternalLinkClick = useCallback((href: string) => {
    if (!session) return
    const previewScroller = previewScrollRef.current
    if (previewScroller) {
      previewScrollPositionRef.current = {
        top: previewScroller.scrollTop,
        left: previewScroller.scrollLeft,
      }
    }
    const reference = session.references.find((item) => item.href === href)
    if (!reference) return
    openTranscriptReference(session.id, reference.id)
  }, [openTranscriptReference, session])

  const openProjectLinksManager = useCallback(() => {
    setLinkSettingsOpen(true)
  }, [setLinkSettingsOpen])

  const handleOpenFirstProjectLink = useCallback(() => {
    if (firstProjectLinkItem) {
      void window.electronAPI.openExternal(firstProjectLinkItem.url)
      return
    }
    openProjectLinksManager()
  }, [firstProjectLinkItem, openProjectLinksManager])

  const handleOpenTerminal = useCallback(async () => {
    if (!projectId || isOpeningTerminal) return
    setIsOpeningTerminal(true)
    try {
      await openTerminal(projectId, runtimeSession?.status)
    } finally {
      setTimeout(() => setIsOpeningTerminal(false), 400)
    }
  }, [isOpeningTerminal, openTerminal, projectId, runtimeSession?.status])

  const handleSwitchCli = useCallback(() => {
    if (!project) return
    void setProjectCli(project.id, currentCli === 'codex' ? 'claude' : 'codex')
  }, [currentCli, project, setProjectCli])

  const closeStructuredPreview = useCallback(() => {
    setStructuredPreview(null)
  }, [])

  const closeCodePreview = useCallback(() => {
    setCodePreview(null)
  }, [])

  const structuredPreviewCaptureLabel = structuredPreviewCapture.status === 'running'
    ? t('transcript.copyStructuredPreviewImageRunning')
    : structuredPreviewCapture.status === 'success'
      ? t('transcript.copyStructuredPreviewImageCopied')
      : structuredPreviewCapture.status === 'error'
        ? t('transcript.copyStructuredPreviewImageFailed')
        : t('transcript.copyStructuredPreviewImage')
  const codePreviewCaptureLabel = codePreviewCapture.status === 'running'
    ? t('transcript.copyStructuredPreviewImageRunning')
    : codePreviewCapture.status === 'success'
      ? t('transcript.copyStructuredPreviewImageCopied')
      : codePreviewCapture.status === 'error'
        ? t('transcript.copyStructuredPreviewImageFailed')
        : t('transcript.copyStructuredPreviewImage')

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
      onCodeBlockExpand: (payload) => {
        setCodePreview(payload)
      },
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
      onCodeBlockExpand: (payload) => {
        setCodePreview(payload)
      },
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
        `${formatTranscriptSourceType(locale, 'process-output')} · ${formatDateTime(Date.now(), {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })}`
      )
      if (!imported) return
      await openTranscript({ projectId, transcriptId: imported.id, initialMode: 'preview' })
    } finally {
      setIsImporting(false)
    }
  }, [importCurrentProcessOutputTranscript, isImporting, openTranscript, projectId])

  const handleManualImport = useCallback(async ({
    projectId: targetProjectId,
    rawText,
    title,
  }: {
    projectId: string
    rawText: string
    title?: string
  }) => {
    setIsImportingManual(true)
    try {
      await window.electronAPI.importTranscriptViaGateway({
        projectId: targetProjectId,
        rawText,
        title,
        sourceType: 'manual-markdown',
        capturedAt: Date.now(),
      })
      return true
    } catch (error) {
      console.error('[TranscriptPage.handleManualImport] failed:', error)
      return false
    } finally {
      setIsImportingManual(false)
    }
  }, [])

  const handleSelectTranscript = useCallback((transcriptId: string) => {
    if (!projectId) return
    void openTranscript({ projectId, transcriptId })
  }, [openTranscript, projectId])

  const handleSaveTranscript = useCallback(async () => {
    if (!session || !isDirty || isSavingTranscript) return
    setIsSavingTranscript(true)
    setSaveError(null)
    try {
      const updated = await window.electronAPI.updateTranscript({
        projectId: session.projectId,
        transcriptId: session.id,
        rawText: editorValue,
        title: session.title,
      })
      useAppStore.getState().upsertTranscriptSession(updated, { activate: true })
      setEditorValue(updated.rawText)
      setSaveSuccessAt(Date.now())
    } catch (error) {
      console.error('[TranscriptPage.handleSaveTranscript] failed:', error)
      setSaveError(error instanceof Error ? error.message : t('transcript.saveFailed'))
    } finally {
      setIsSavingTranscript(false)
    }
  }, [editorValue, isDirty, isSavingTranscript, session, t])

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

  useEffect(() => {
    setEditorValue(session?.rawText ?? '')
    setSaveError(null)
    setSaveSuccessAt(null)
    setIsSavingTranscript(false)
  }, [session?.id, session?.rawText])

  useEffect(() => {
    if (!activeReference) return
    const previewScroller = previewScrollRef.current
    if (!previewScroller) return
    const { top, left } = previewScrollPositionRef.current
    const restoreId = window.requestAnimationFrame(() => {
      previewScroller.scrollTop = top
      previewScroller.scrollLeft = left
    })
    return () => {
      window.cancelAnimationFrame(restoreId)
    }
  }, [activeReference])

  if (!project || !projectId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <h2 className="text-lg font-semibold text-[color:var(--color-foreground)]">{t('transcript.projectNotFound')}</h2>
        <button
          className="inline-flex items-center gap-1.5 text-sm text-primary transition-colors hover:text-primary"
          onClick={() => navigate('/')}
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
          {t('transcript.backToHome')}
        </button>
      </div>
    )
  }

  const hasTerminalOutput = terminalOutput.trim().length > 0
  const contentTopPaddingClass = projectHeaderCollapsed
    ? 'pt-5'
    : 'pt-[calc(var(--window-titlebar-height)+84px+8px)]'
  const codePreviewLanguageLabel = codePreview ? formatCodeLanguageLabel(codePreview.language, t) : ''
  const transcriptCountLabel = t('transcript.savedSessions', { count: summaries.length })
  const renderProjectLinksButton = (compact: boolean) => {
    const className = compact
      ? 'inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-3 py-1.5 text-xs font-medium text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]'
      : 'inline-flex items-center gap-2 rounded-full border border-[color:var(--color-border)] px-4 py-2 text-sm font-medium text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]'
    const title = firstProjectLinkItem ? t('common.leftClickOpenFirstLink') : t('detail.docsSettings')
    const content = (
      <>
        <BookOpen className={compact ? 'h-3.5 w-3.5 shrink-0' : 'h-4 w-4 shrink-0'} />
        <span>{projectDocsCountLabel}</span>
      </>
    )

    if (firstProjectLinkItem) {
      return (
        <UrlPopover items={projectLinkItems}>
          <button
            type="button"
            className={className}
            onClick={handleOpenFirstProjectLink}
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
              openProjectLinksManager()
            }}
            title={title}
          >
            {content}
          </button>
        </UrlPopover>
      )
    }

    return (
      <button
        type="button"
        className={className}
        onClick={openProjectLinksManager}
        title={title}
      >
        {content}
      </button>
    )
  }

  return (
    <div
      className="relative flex h-full flex-col"
      onContextMenu={(event) => {
        if (shouldSkipProjectPageContextMenu(event.target)) return
        event.preventDefault()
        setMenuPos({ x: event.clientX, y: event.clientY })
      }}
    >
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
                {t('transcript.pageTitle')}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <ProjectPaneTabs
              activePane="transcript"
              onSelectPane={(pane) => {
                if (pane === 'transcript') return
                navigate(`/project/${projectId}/${pane}`)
              }}
            />
            {renderProjectLinksButton(false)}
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-[color:var(--color-border)] px-4 py-2 text-sm font-medium text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
              onClick={() => setManualImportOpen(true)}
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
              onClick={() => {
                void handleImportCurrentOutput()
              }}
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
                onClick={() => void handleSaveTranscript()}
                disabled={saveButtonDisabled}
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

      <div className={`min-h-0 flex-1 overflow-x-hidden px-6 pb-6 sm:px-8 ${contentTopPaddingClass}`}>
        <div className="mx-auto flex h-full min-h-0 w-full min-w-0 max-w-[1360px] flex-col gap-3">
          <section className="shrink-0 rounded-[20px] border border-[color:var(--color-border)] bg-[color:var(--color-card)]/62 px-4 py-2">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                {projectHeaderCollapsed ? (
                  <div className="flex min-w-0 items-center gap-2.5">
                    <p className="max-w-[140px] truncate text-sm font-medium text-[color:var(--color-foreground)]" title={projectDisplayName(project)}>
                      {projectDisplayName(project)}
                    </p>
                    <ProjectPaneTabs
                      activePane="transcript"
                      onSelectPane={(pane) => {
                        if (pane === 'transcript') return
                        navigate(`/project/${projectId}/${pane}`)
                      }}
                    />
                  </div>
                ) : (
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('transcript.listTitle')}</p>
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
                    {renderProjectLinksButton(true)}
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-3 py-1.5 text-xs font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                      onClick={() => setManualImportOpen(true)}
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
                      onClick={() => {
                        void handleImportCurrentOutput()
                      }}
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
                        onClick={() => void handleSaveTranscript()}
                        disabled={saveButtonDisabled}
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
                      onClick={() => {
                        void loadProjectTranscripts(projectId)
                      }}
                      title={t('settingsTranscript.refresh')}
                    >
                      <RefreshCw className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          </section>

          <div className="grid min-h-0 flex-1 gap-4 min-[1080px]:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-[color:var(--color-border)] bg-[color:var(--color-card)]">
              <div className="border-b border-[color:var(--color-border)] px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('transcript.listTitle')}</p>
                    <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
                      {transcriptCountLabel}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                    onClick={() => {
                      void loadProjectTranscripts(projectId)
                    }}
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
                    <p className="text-sm text-[color:var(--color-destructive)]">{t('transcript.failedToLoad')}</p>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-3 py-1.5 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
                      onClick={() => {
                        void loadProjectTranscripts(projectId)
                      }}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      {t('transcript.retry')}
                    </button>
                  </div>
                ) : summaries.length <= 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
                    <FileText className="h-10 w-10 text-[color:var(--color-muted-foreground)]/70" />
                    <div>
                      <p className="text-sm font-medium text-[color:var(--color-foreground)]">{t('transcript.noTranscriptYet')}</p>
                      <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
                        {t('transcript.firstTranscriptHint')}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 px-4"
                      onClick={() => setManualImportOpen(true)}
                    >
                      <FileText className="h-4 w-4" />
                      {t('transcript.importPastedContent')}
                    </Button>
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
                            onContextMenu={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              setMenuPos({ x: event.clientX, y: event.clientY })
                            }}
                            disabled={isDeleting}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-[color:var(--color-foreground)]">
                                  {summary.title}
                                </p>
                                <p className="mt-1 text-[11px] text-[color:var(--color-muted-foreground)]">
                                  {formatTranscriptSourceType(locale, summary.sourceType)}
                                </p>
                              </div>
                              <span className="shrink-0 rounded-full border border-[color:var(--color-border)] px-2 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">
                                {t('transcript.refs', { count: summary.referenceCount })}
                              </span>
                            </div>
                            <p className="mt-2 text-[11px] text-[color:var(--color-muted-foreground)]">
                              {t('transcript.updatedAt', {
                                value: formatDateTime(summary.updatedAt, {
                                  month: '2-digit',
                                  day: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  hour12: false,
                                }),
                              })}
                            </p>
                          </button>
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-destructive-background)] hover:text-[color:var(--color-destructive)] disabled:cursor-not-allowed disabled:opacity-60"
                            onClick={() => {
                              setDeleteConfirmTarget({ id: summary.id, title: summary.title })
                            }}
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
            </aside>

            <main className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[24px] border border-[color:var(--color-border)] bg-[color:var(--color-card)]">
              {!resolvedActiveTranscriptId ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                  <FileText className="h-10 w-10 text-[color:var(--color-muted-foreground)]/70" />
                  <div>
                    <p className="text-sm font-medium text-[color:var(--color-foreground)]">{t('transcript.selectOrImport')}</p>
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
                          <h2 className="min-w-0 max-w-full flex-1 truncate whitespace-nowrap text-lg font-semibold text-[color:var(--color-foreground)] min-[960px]:max-w-[360px]">
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
                            value={editorValue}
                            filePath={`transcript/${session.id}.md`}
                            language={inferLanguageFromRelativePath('transcript.md')}
                            readOnly={false}
                            onChange={setEditorValue}
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
      </div>

      {menuPos && (
        <CardContextMenu
          x={menuPos.x}
          y={menuPos.y}
          onClose={() => setMenuPos(null)}
          isRuntimeActive={isRuntimeActive}
          usesTmuxRuntime={usesTmuxRuntime}
          isDevRunning={isDevRunning}
          isDevStopping={isDevStopping}
          isOpeningTerminal={isOpeningTerminal}
          currentCli={currentCli}
          isPinned={project.pinned}
          onStartRuntime={() => startRuntime(project.id)}
          onStopRuntime={() => stopRuntime(project.id)}
          onOpenTerminal={handleOpenTerminal}
          onSwitchCli={handleSwitchCli}
          onStartProject={() => startProject(project.id)}
          onStopProject={() => stopProject(project.id)}
          onOpenFolder={() => window.electronAPI.openFolder(project.path)}
          onOpenPathTerminal={async () => {
            await window.electronAPI.openPathTerminal(project.path)
          }}
          onOpenVsCode={() => window.electronAPI.openInVsCode(project.path)}
          onTogglePin={() => togglePin(project.id)}
          onEditMetadata={() => setMetaDialogOpen(true)}
        />
      )}

      {metaDialogOpen && (
        <ProjectMetaDialog
          open={metaDialogOpen}
          project={project}
          folders={folders}
          tags={tags}
          onClose={() => setMetaDialogOpen(false)}
          onAssignFolder={assignProjectFolder}
          onSetProjectTags={setProjectTags}
          onSetProjectCustomName={setProjectCustomName}
          onSetProjectCustomType={setProjectCustomType}
        />
      )}

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

      <ManualTranscriptImportModal
        open={manualImportOpen}
        onClose={() => setManualImportOpen(false)}
        onImport={handleManualImport}
        project={{
          id: project.id,
          path: project.path,
          name: project.name,
          customName: project.customName,
        }}
        initialProjectId={projectId}
        submitting={isImportingManual}
        title={t('transcript.manualImportCurrentProjectTitle')}
        description={t('transcript.manualImportCurrentProjectDescription')}
        onImported={async () => {
          if (!projectId) return
          await loadProjectTranscripts(projectId)
          const latestTranscriptId = useAppStore.getState().transcriptSummariesByProjectId[projectId]?.[0]?.id
          if (!latestTranscriptId) return
          await openTranscript({ projectId, transcriptId: latestTranscriptId, initialMode: 'preview' })
        }}
      />

      <DetailDocumentationCard
        docLinks={docLinks}
        docTitleInput={docTitleInput}
        setDocTitleInput={setDocTitleInput}
        docUrlInput={docUrlInput}
        setDocUrlInput={setDocUrlInput}
        docTagInput={docTagInput}
        setDocTagInput={setDocTagInput}
        docTagOptions={docLinkTagOptionsFromHook}
        docNoteInput={docNoteInput}
        setDocNoteInput={setDocNoteInput}
        docAccountInput={docAccountInput}
        setDocAccountInput={setDocAccountInput}
        docSecretInput={docSecretInput}
        setDocSecretInput={setDocSecretInput}
        docError={docError}
        setDocError={setDocError}
        onAddDocLink={handleAddDocLink}
        onAddDocTag={handleAddDocTag}
        onRenameDocTag={handleRenameDocTag}
        onRemoveDocTag={handleRemoveDocTag}
        onUpdateDocLink={handleUpdateDocLink}
        onSetDefaultDocLink={handleSetDefaultDocLink}
        onReorderDocLinks={handleReorderDocLinks}
        onRemoveDocLink={handleRemoveDocLink}
        onCopyDocLinkAccount={handleCopyDocLinkAccount}
        onCopyDocLinkSecret={handleCopyDocLinkSecret}
        onGetDocLinkSecret={handleGetDocLinkSecret}
        settingsOpen={linkSettingsOpen}
        setSettingsOpen={setLinkSettingsOpen}
        hideCard
      />

      <TranscriptPreviewModals
        structuredPreview={structuredPreview}
        codePreview={codePreview}
        structuredPreviewMarkdown={structuredPreviewMarkdown}
        structuredPreviewComponents={structuredPreviewComponents}
        structuredPreviewCapture={structuredPreviewCapture}
        structuredPreviewCaptureLabel={structuredPreviewCaptureLabel}
        codePreviewCapture={codePreviewCapture}
        codePreviewCaptureLabel={codePreviewCaptureLabel}
        codePreviewLanguageLabel={codePreviewLanguageLabel}
        effectiveTheme={effectiveTheme}
        locale={locale}
        t={t}
        formatStructuredBlockKindLabel={formatStructuredBlockKindLabel}
        onCloseStructuredPreview={closeStructuredPreview}
        onCloseCodePreview={closeCodePreview}
      />

      <ModalShell
        open={Boolean(deleteConfirmTarget)}
        onClose={() => {
          if (deletingTranscriptId) return
          setDeleteConfirmTarget(null)
        }}
        widthClassName="max-w-[460px]"
        baseZIndex={1120}
        ariaLabel={t('transcript.deleteConfirmLabel')}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="section-label mb-1">{t('transcript.listTitle')}</p>
            <p className="text-sm font-semibold text-[color:var(--color-foreground)]">
              {t('transcript.deleteThisTranscript')}
            </p>
          </div>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => setDeleteConfirmTarget(null)}
            title={t('common.close')}
            disabled={Boolean(deletingTranscriptId)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="rounded-[14px] border border-[color:var(--color-destructive)]/22 bg-[color:var(--color-destructive-background)] px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-[color:var(--color-destructive)]">
            <AlertTriangle className="h-3.5 w-3.5" />
            {t('transcript.deleteThisTranscriptHint')}
          </p>
          <p className="mt-2 break-words text-[12px] text-[color:var(--color-foreground)]">
            {deleteConfirmTarget?.title}
          </p>
        </div>

        <p className="mt-2 text-[10.5px] text-[color:var(--color-muted-foreground)]">
          {t('transcript.deleteThisTranscriptIrreversible')}
        </p>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            className="quiet-control inline-flex h-9 items-center justify-center rounded-full border-0 px-4 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => setDeleteConfirmTarget(null)}
            disabled={Boolean(deletingTranscriptId)}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center rounded-full bg-[color:var(--color-destructive)] px-4 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => {
              void handleDeleteTranscript()
            }}
            disabled={Boolean(deletingTranscriptId)}
          >
            {deletingTranscriptId ? t('transcript.deleting') : t('transcript.confirmDelete')}
          </button>
        </div>
      </ModalShell>
    </div>
  )
}
