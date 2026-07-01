import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { shallow } from 'zustand/shallow'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AlertTriangle,
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
  RefreshCw,
  Share2,
  Trash2,
  X,
} from 'lucide-react'
import type {
  AiCommitStatus,
  AiCommitTaskSnapshot,
  TranscriptReference,
  TranscriptShareBindingMode,
  TranscriptShareEntry,
  TranscriptShareHost,
  TranscriptViewerMode,
} from '../../shared/types'
import { CardContextMenu } from '../components/CardContextMenu'
import { ModalShell } from '../components/ModalShell'
import { ProjectPaneTabs } from '../components/ProjectPaneTabs'
import { ProjectLinksTrigger } from '../components/ProjectLinksTrigger'
import { ProjectMetaDialog } from '../components/ProjectMetaDialog'
import { Button } from '../components/ui/button'
import { useProjectDevUrlLauncher } from '../hooks/useProjectDevUrlLauncher'
import { useScrollableContentCapture } from '../hooks/useScrollableContentCapture'
import { MonacoTextViewer } from '../components/MonacoTextViewer'
import { formatStructuredBlockKind as formatStructuredBlockKindLabel, formatTranscriptSourceType, useI18n, useLocale } from '../i18n'
import { middleTruncatePath, projectDisplayName } from '../lib/projectDisplay'
import { preloadProjectPane } from '../lib/projectPagePreload'
import { isTmuxRuntimeEntry } from '../lib/runtimePresentation'
import { useAppStore } from '../stores/appStore'
import { inferLanguageFromRelativePath } from './code/code.helpers'
import {
  createMarkdownComponents,
  formatCodeLanguageLabel,
  type MarkdownStructuredBlockClickPayload,
  shouldDisableMarkdownSyntaxHighlight,
} from './code/code.markdown'
import { transformMarkdownUrl } from './code/code.markdownUrls'
import { remarkBoxDrawingTables } from './code/code.markdownBoxTables'
import { DetailDocumentationCard } from './detail/DetailDocumentationCard'
import { useProjectDocLinks } from './detail/useProjectDocLinks'
import {
  defaultAiRuntimeProfiles,
  getAiRuntimeProfileCli,
  getAiRuntimeProfileLabel,
  resolveAiRuntimeProfile,
  resolveProjectAiRuntimeProfileId,
} from '../../shared/aiRuntimeProfiles'
import { ManualTranscriptImportModal } from './transcript/ManualTranscriptImportModal'
import { TranscriptShareModal } from './transcript/TranscriptShareModal'
import { buildTranscriptShareSnapshot } from './transcript/transcriptShareSnapshot'
import {
  TranscriptPreviewModals,
  type TranscriptCodePreviewState,
  type TranscriptStructuredPreviewState,
} from './transcript/TranscriptPreviewModals'
import { TranscriptReferenceDrawer } from './transcript/TranscriptReferenceDrawer'
import {
  normalizeTranscriptDisplayMarkdown,
  readTranscriptListSidebarCollapsed,
  shouldSkipProjectPageContextMenu,
  sliceMarkdownLines,
  TRANSCRIPT_LIST_SIDEBAR_COLLAPSED_STORAGE_KEY,
} from './transcript/transcriptPage.utils'
import {
  TranscriptListSidebar,
  TranscriptMainContent,
  TranscriptPageHeader,
} from './transcript/TranscriptPageSections'
import { useTranscriptPageChromeState } from './transcript/useTranscriptPageChromeState'
import type { CodeWorkspaceNavigationState } from './code/code.navigation'

function filterPreferredShareHosts(hosts: TranscriptShareHost[]): TranscriptShareHost[] {
  const preferred = hosts.filter((item) => item.host.startsWith('192.'))
  return preferred.length > 0 ? preferred : hosts
}

/**
 * Wait for React to commit a state-driven re-render and for the browser to paint
 * it. Two rAFs straddle a commit + paint; the trailing timeout gives async
 * renderers (SyntaxHighlighter) a beat to flush their inline styles into the DOM.
 */
function waitForRenderSettle(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.setTimeout(resolve, 32)
      })
    })
  })
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
      aiRuntimeProfileId: found.aiRuntimeProfileId,
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
  const aiRuntimeProfilesConfig = useAppStore((s) => s.config.aiRuntimeProfiles ?? [])
  const activeAiRuntimeProfileId = useAppStore((s) => s.config.activeAiRuntimeProfileId)
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
  const setProjectAiRuntimeProfile = useAppStore((s) => s.setProjectAiRuntimeProfile)
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
    handleOpenDocLink,
  } = docLinkState
  const defaultDocLink = docLinks[0]
  const [isImporting, setIsImporting] = useState(false)
  const [isImportingManual, setIsImportingManual] = useState(false)
  const [manualImportOpen, setManualImportOpen] = useState(false)
  const [deletingTranscriptId, setDeletingTranscriptId] = useState<string | null>(null)
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{ id: string; title: string } | null>(null)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [isOpeningTerminal, setIsOpeningTerminal] = useState(false)
  const [isStartingRuntime, setIsStartingRuntime] = useState(false)
  const [isStoppingRuntime, setIsStoppingRuntime] = useState(false)
  const [aiCommitStatus, setAiCommitStatus] = useState<AiCommitStatus>('idle')
  const [metaDialogOpen, setMetaDialogOpen] = useState(false)
  const {
    projectHeaderCollapsed,
    setProjectHeaderCollapsed,
    effectiveTheme,
    isNarrowViewport,
  } = useTranscriptPageChromeState()
  const [isTranscriptListCollapsed, setIsTranscriptListCollapsed] = useState(readTranscriptListSidebarCollapsed)
  const [structuredPreview, setStructuredPreview] = useState<TranscriptStructuredPreviewState | null>(null)
  const [codePreview, setCodePreview] = useState<TranscriptCodePreviewState | null>(null)
  const [editorValue, setEditorValue] = useState('')
  const [isSavingTranscript, setIsSavingTranscript] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccessAt, setSaveSuccessAt] = useState<number | null>(null)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [shareEntries, setShareEntries] = useState<TranscriptShareEntry[]>([])
  const [shareHosts, setShareHosts] = useState<TranscriptShareHost[]>([])
  const [sharePort, setSharePort] = useState<number>(17374)
  const [shareBindingMode, setShareBindingMode] = useState<TranscriptShareBindingMode>('lan')
  const [isGeneratingShare, setIsGeneratingShare] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  // When true, the preview forces every code block to its inline-styled
  // SyntaxHighlighter DOM so the share snapshot clone is stable regardless of scroll.
  const [forceRenderAllForShare, setForceRenderAllForShare] = useState(false)
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
    try {
      window.localStorage.setItem(
        TRANSCRIPT_LIST_SIDEBAR_COLLAPSED_STORAGE_KEY,
        isTranscriptListCollapsed ? '1' : '0'
      )
    } catch {
      // localStorage can be unavailable in restricted WebViews.
    }
  }, [isTranscriptListCollapsed])

  useEffect(() => {
    if (!projectId) return
    const api = window.electronAPI as unknown as {
      onAiCommitStatus?: (
        cb: (d: { projectId: string; status: Exclude<AiCommitStatus, 'idle'> }) => void
      ) => () => void
      getAiCommitState?: (projectId: string) => Promise<AiCommitTaskSnapshot | null>
    }

    const cleanup = typeof api.onAiCommitStatus === 'function'
      ? api.onAiCommitStatus(({ projectId: pid, status }) => {
        if (pid !== projectId) return
        setAiCommitStatus(status)
      })
      : undefined

    void (async () => {
      if (typeof api.getAiCommitState !== 'function') return
      try {
        const state = await api.getAiCommitState(projectId)
        setAiCommitStatus(state?.status ?? 'idle')
      } catch {
        // ignore restore failures
      }
    })()

    return cleanup
  }, [projectId])

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
  const isActive = isDevRunning || isDevStopping
  const aiRuntimeProfiles = aiRuntimeProfilesConfig.length > 0 ? aiRuntimeProfilesConfig : defaultAiRuntimeProfiles()
  const defaultRuntimeProfile = resolveAiRuntimeProfile(aiRuntimeProfiles, activeAiRuntimeProfileId)
  const defaultRuntimeProfileLabel = getAiRuntimeProfileLabel(defaultRuntimeProfile)
  const defaultRuntimeProfileCli = getAiRuntimeProfileCli(defaultRuntimeProfile)
  const hasProjectAiRuntimeOverride = Boolean(project?.aiRuntimeProfileId?.trim() || project?.cli)
  const currentRuntimeProfileId = project
    ? resolveProjectAiRuntimeProfileId(project, activeAiRuntimeProfileId)
    : activeAiRuntimeProfileId
  const currentRuntimeProfile = resolveAiRuntimeProfile(aiRuntimeProfiles, currentRuntimeProfileId, project?.cli)
  const currentRuntimeProfileLabel = getAiRuntimeProfileLabel(currentRuntimeProfile, project?.cli)
  const currentCli = getAiRuntimeProfileCli(currentRuntimeProfile, project?.cli)
  const {
    isDevReady,
    pendingOpenDevUrl,
    startAndOpenDevUrl,
  } = useProjectDevUrlLauncher({
    projectId: projectId ?? '',
    processStatus,
    processUrls,
    runStartupMode: project?.runStartupMode,
    startProject,
  })
  const projectLinkItems = useMemo(
    () => [
      ...(isDevReady ? processUrls.map((url) => ({ url, label: `Dev: ${url}` })) : []),
      ...docMenuItems,
    ],
    [docMenuItems, isDevReady, processUrls]
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

  const handleOpenTerminal = useCallback(async () => {
    if (!projectId || isOpeningTerminal) return
    setIsOpeningTerminal(true)
    try {
      await openTerminal(projectId, runtimeSession?.status)
    } finally {
      setTimeout(() => setIsOpeningTerminal(false), 400)
    }
  }, [isOpeningTerminal, openTerminal, projectId, runtimeSession?.status])

  const handleStartRuntime = useCallback(async () => {
    if (!project || isStartingRuntime) return
    setIsStartingRuntime(true)
    try {
      await startRuntime(project.id)
    } finally {
      setIsStartingRuntime(false)
    }
  }, [isStartingRuntime, project, startRuntime])

  const handleStopRuntime = useCallback(async () => {
    if (!project || isStoppingRuntime) return
    setIsStoppingRuntime(true)
    try {
      await stopRuntime(project.id)
    } finally {
      setIsStoppingRuntime(false)
    }
  }, [isStoppingRuntime, project, stopRuntime])

  const handleSelectAiRuntimeProfile = useCallback((profileId: string) => {
    if (!project) return
    void setProjectAiRuntimeProfile(project.id, profileId)
  }, [project, setProjectAiRuntimeProfile])

  const handleSwitchCli = useCallback(() => {
    if (!project) return
    const currentIndex = aiRuntimeProfiles.findIndex((profile) => profile.id === currentRuntimeProfile.id)
    const nextProfile = aiRuntimeProfiles[(currentIndex + 1 + aiRuntimeProfiles.length) % aiRuntimeProfiles.length]
    if (nextProfile) {
      void setProjectAiRuntimeProfile(project.id, nextProfile.id)
      return
    }
    void setProjectCli(project.id, currentCli === 'codex' ? 'claude' : 'codex')
  }, [aiRuntimeProfiles, currentCli, currentRuntimeProfile.id, project, setProjectAiRuntimeProfile, setProjectCli])

  const handleAiAutoCommit = useCallback(async () => {
    if (!project || aiCommitStatus === 'running') return
    try {
      setAiCommitStatus('running')
      const ok = await window.electronAPI.runAiCommit(project.id, project.path)
      if (!ok) setAiCommitStatus('error')
    } catch {
      setAiCommitStatus('error')
    }
  }, [aiCommitStatus, project])

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
      forceRenderAllBlocks: forceRenderAllForShare,
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
    forceRenderAllForShare,
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

  const handleSaveTranscript = useCallback(async (nextRawText = editorValue) => {
    const hasChanges = session ? nextRawText !== session.rawText : false
    if (!session || !hasChanges || isSavingTranscript) return
    setIsSavingTranscript(true)
    setSaveError(null)
    try {
      const updated = await window.electronAPI.updateTranscript({
        projectId: session.projectId,
        transcriptId: session.id,
        rawText: nextRawText,
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
  }, [editorValue, isSavingTranscript, session, t])

  const refreshShareEntries = useCallback(async () => {
    if (!session) return
    try {
      const result = await window.electronAPI.listTranscriptShares()
      setShareBindingMode(result.bindingMode)
      setShareHosts(filterPreferredShareHosts(result.hosts))
      setSharePort(result.port)
      setShareEntries(result.entries.filter((entry) => entry.transcriptId === session.id))
    } catch (error) {
      console.error('[TranscriptPage.refreshShareEntries] failed:', error)
    }
  }, [session])

  const handleOpenShareModal = useCallback(() => {
    setShareError(null)
    setShareModalOpen(true)
    void refreshShareEntries()
  }, [refreshShareEntries])

  const handleGenerateShare = useCallback(async () => {
    if (!session || isGeneratingShare) return
    const previewNode = previewScrollRef.current
    if (!previewNode) {
      setShareError(t('transcript.shareFailed'))
      return
    }
    setIsGeneratingShare(true)
    setShareError(null)
    // Force every code block into its inline-styled SyntaxHighlighter form before
    // cloning. Without this, off-screen blocks are still the class-dependent plain
    // fallback whose background/padding break once detached from the live document.
    setForceRenderAllForShare(true)
    try {
      // Let React commit the forced render, then give SyntaxHighlighter a frame to
      // apply its inline styles before we snapshot the DOM.
      await waitForRenderSettle()
      const snapshot = buildTranscriptShareSnapshot(previewNode, session.title, {
        copied: t('common.copied'),
        copyFailed: t('codeMarkdown.copyFailed'),
        transcriptRefDisabled: t('transcript.shareSnapshotTranscriptRefDisabled'),
      })
      const result = await window.electronAPI.startTranscriptShare({
        projectId: session.projectId,
        transcriptId: session.id,
        title: session.title,
        html: snapshot.html,
        images: snapshot.images,
      })
      setShareBindingMode(result.bindingMode)
      setShareHosts(filterPreferredShareHosts(result.hosts))
      setSharePort(result.port)
      setShareEntries((current) => [result.entry, ...current.filter((entry) => entry.token !== result.entry.token)])
    } catch (error) {
      console.error('[TranscriptPage.handleGenerateShare] failed:', error)
      setShareError(error instanceof Error ? error.message : t('transcript.shareFailed'))
    } finally {
      setForceRenderAllForShare(false)
      setIsGeneratingShare(false)
    }
  }, [isGeneratingShare, session, t])

  const handleRevokeShare = useCallback(async (token: string) => {
    try {
      const result = await window.electronAPI.stopTranscriptShare(token)
      setShareBindingMode(result.bindingMode)
      setShareHosts(filterPreferredShareHosts(result.hosts))
      setSharePort(result.port)
      const activeId = session?.id
      setShareEntries(result.entries.filter((entry) => !activeId || entry.transcriptId === activeId))
    } catch (error) {
      console.error('[TranscriptPage.handleRevokeShare] failed:', error)
    }
  }, [session?.id])

  const handleRevokeAllShares = useCallback(async () => {
    const tokens = shareEntries.map((entry) => entry.token)
    for (const token of tokens) {
      try {
        await window.electronAPI.stopTranscriptShare(token)
      } catch (error) {
        console.error('[TranscriptPage.handleRevokeAllShares] failed:', error)
      }
    }
    setShareEntries([])
  }, [shareEntries])

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
    navigate(`/project/${projectId}/code`, {
      state: {
        revealTarget: {
          relativePath,
          lineNumber: Math.max(1, Math.floor(lineNumber)),
          column: Math.max(1, Math.floor(column)),
        },
      } satisfies CodeWorkspaceNavigationState,
    })
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
  const showTranscriptListSidebar = isNarrowViewport || !isTranscriptListCollapsed
  const transcriptLayoutGridStyle = !isNarrowViewport && isTranscriptListCollapsed
    ? { gridTemplateColumns: '44px minmax(0,1fr)' }
    : undefined
  const renderProjectLinksButton = () => {
    return (
      <ProjectLinksTrigger
        items={projectLinkItems}
        tagOptions={docLinkTagOptionsFromHook}
        onOpenDefault={defaultDocLink ? () => handleOpenDocLink(defaultDocLink) : undefined}
        onOpenManager={openProjectLinksManager}
        size="icon"
        title={firstProjectLinkItem ? t('common.leftClickOpenFirstLink') : t('detail.docsSettings')}
      />
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
      <div className={`min-h-0 flex-1 overflow-x-hidden px-6 pb-6 sm:px-8 ${contentTopPaddingClass}`}>
        <div className="mx-auto flex h-full min-h-0 w-full min-w-0 max-w-[1360px] flex-col gap-3">
          <TranscriptPageHeader
            project={project}
            projectId={projectId}
            projectHeaderCollapsed={projectHeaderCollapsed}
            setProjectHeaderCollapsed={setProjectHeaderCollapsed}
            transcriptCountLabel={transcriptCountLabel}
            projectDocsCountLabel={projectDocsCountLabel}
            firstProjectLinkItem={firstProjectLinkItem}
            projectLinkItems={projectLinkItems}
            docLinkTagOptions={docLinkTagOptionsFromHook}
            session={session}
            locale={locale}
            formatTranscriptSourceType={formatTranscriptSourceType}
            navigateToPane={(pane) => navigate(`/project/${projectId}/${pane}`)}
            onOpenManualImport={() => setManualImportOpen(true)}
            onOpenImportCurrentOutput={() => {
              void handleImportCurrentOutput()
            }}
            hasTerminalOutput={hasTerminalOutput}
            isImporting={isImporting}
            renderProjectLinksButton={renderProjectLinksButton}
            saveStatusText={saveStatusText}
            saveStatusToneClass={saveStatusToneClass}
            saveButtonDisabled={saveButtonDisabled}
            isSavingTranscript={isSavingTranscript}
            onSaveTranscript={() => {
              void handleSaveTranscript()
            }}
            t={t}
            isDevReady={isDevReady}
            pendingOpenDevUrl={pendingOpenDevUrl}
            isActive={isActive}
            startAndOpenDevUrl={startAndOpenDevUrl}
            onRefreshList={() => {
              void loadProjectTranscripts(projectId)
            }}
          />

          <div
            className="grid min-h-0 flex-1 gap-4 min-[1080px]:grid-cols-[280px_minmax(0,1fr)]"
            style={transcriptLayoutGridStyle}
          >
            {!isNarrowViewport && isTranscriptListCollapsed && (
              <div className="relative flex h-full min-h-0 items-center justify-center">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="z-20 h-8 w-8 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-card)]/96 shadow-[0_8px_20px_rgba(15,23,42,0.10)] backdrop-blur-md"
                  onClick={() => setIsTranscriptListCollapsed(false)}
                  aria-label={t('transcript.expandListSidebar')}
                  title={t('transcript.expandListSidebar')}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            {showTranscriptListSidebar && (
              <div className="relative flex h-full min-h-0">
                <TranscriptListSidebar
                  listStatus={listStatus}
                  summaries={summaries}
                  resolvedActiveTranscriptId={resolvedActiveTranscriptId}
                  deletingTranscriptId={deletingTranscriptId}
                  transcriptCountLabel={transcriptCountLabel}
                  locale={locale}
                  formatDateTime={formatDateTime}
                  formatTranscriptSourceType={formatTranscriptSourceType}
                  onRefreshList={() => {
                    void loadProjectTranscripts(projectId)
                  }}
                  onSelectTranscript={handleSelectTranscript}
                  onDeleteTranscript={(payload) => {
                    setDeleteConfirmTarget(payload)
                  }}
                  t={t}
                />
                {!isNarrowViewport && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="absolute -right-4 top-1/2 z-20 h-8 w-8 -translate-y-1/2 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-card)]/96 shadow-[0_8px_20px_rgba(15,23,42,0.10)] backdrop-blur-md"
                    onClick={() => setIsTranscriptListCollapsed(true)}
                    aria-label={t('transcript.collapseListSidebar')}
                    title={t('transcript.collapseListSidebar')}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            )}

            <TranscriptMainContent
              resolvedActiveTranscriptId={resolvedActiveTranscriptId}
              session={session}
              effectiveMode={effectiveMode}
              isNarrowViewport={isNarrowViewport}
              locale={locale}
              markdownComponents={markdownComponents}
              displayMarkdownText={displayMarkdownText}
              previewScrollRef={previewScrollRef}
              editorValue={editorValue}
              setEditorValue={setEditorValue}
              onSaveTranscript={(currentValue) => {
                void handleSaveTranscript(currentValue)
              }}
              onOpenShareModal={handleOpenShareModal}
              setTranscriptMode={setTranscriptMode}
              t={t}
              formatTranscriptSourceType={formatTranscriptSourceType}
            />
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
          isStartingRuntime={isStartingRuntime}
          isStoppingRuntime={isStoppingRuntime}
          currentCli={currentCli}
          defaultRuntimeProfileLabel={defaultRuntimeProfileLabel}
          defaultRuntimeProfileCli={defaultRuntimeProfileCli}
          isUsingDefaultAiRuntimeProfile={!hasProjectAiRuntimeOverride}
          currentRuntimeProfileLabel={currentRuntimeProfileLabel}
          currentRuntimeProfileId={currentRuntimeProfile.id}
          aiRuntimeProfiles={aiRuntimeProfiles}
          isPinned={project.pinned}
          onStartRuntime={handleStartRuntime}
          onStopRuntime={handleStopRuntime}
          onOpenTerminal={handleOpenTerminal}
          onSwitchCli={handleSwitchCli}
          onSelectAiRuntimeProfile={handleSelectAiRuntimeProfile}
          onStartProject={() => startProject(project.id)}
          onStopProject={() => stopProject(project.id)}
          onAiAutoCommit={() => {
            void handleAiAutoCommit()
          }}
          aiCommitStatus={aiCommitStatus}
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

      <TranscriptShareModal
        open={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        entries={shareEntries}
        hosts={shareHosts}
        port={sharePort}
        bindingMode={shareBindingMode}
        generating={isGeneratingShare}
        error={shareError}
        onGenerate={() => void handleGenerateShare()}
        onRevoke={(token) => void handleRevokeShare(token)}
        onRevokeAll={() => void handleRevokeAllShares()}
      />

      <DetailDocumentationCard
        docLinks={docLinks}
        docKindInput={docLinkState.docKindInput}
        setDocKindInput={docLinkState.setDocKindInput}
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
        docSshHostInput={docLinkState.docSshHostInput}
        setDocSshHostInput={docLinkState.setDocSshHostInput}
        docSshPortInput={docLinkState.docSshPortInput}
        setDocSshPortInput={docLinkState.setDocSshPortInput}
        docSshUsernameInput={docLinkState.docSshUsernameInput}
        setDocSshUsernameInput={docLinkState.setDocSshUsernameInput}
        docSshShortcutInput={docLinkState.docSshShortcutInput}
        setDocSshShortcutInput={docLinkState.setDocSshShortcutInput}
        docSshRouteInput={docLinkState.docSshRouteInput}
        setDocSshRouteInput={docLinkState.setDocSshRouteInput}
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
        onOpenDocLink={handleOpenDocLink}
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
