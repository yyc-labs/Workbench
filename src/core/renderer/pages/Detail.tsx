import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronUp, ListTree, Play, RefreshCw, Square, TriangleAlert } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { shallow } from 'zustand/shallow'
import { defaultAiRuntimeProfiles, getAiRuntimeProfileCli, getAiRuntimeProfileLabel, resolveAiRuntimeProfile, resolveProjectAiRuntimeProfileId } from '../../shared/aiRuntimeProfiles'
import { getActiveRunTaskUrls, isPrimaryRunTaskUrlPending } from '../../shared/runTasks'
import type { AiCommitStatus, AiCommitTaskSnapshot, CliTool } from '../../shared/types'
import { CardContextMenu } from '../components/CardContextMenu'
import { ProjectLinksTrigger } from '../components/ProjectLinksTrigger'
import { ProjectMetaDialog } from '../components/ProjectMetaDialog'
import { ProjectPaneTabs } from '../components/ProjectPaneTabs'
import { RunTasksDialog } from '../components/run-tasks/RunTasksDialog'
import { UrlPopover } from '../components/UrlPopover'
import { useOpenStartupLogs } from '../hooks/useOpenStartupLogs'
import { useProjectDevUrlLauncher } from '../hooks/useProjectDevUrlLauncher'
import { useI18n, useLocale } from '../i18n'
import { middleTruncatePath, projectDisplayName } from '../lib/projectDisplay'
import { detectProjectEnvironment, projectEnvironmentLabel } from '../lib/projectEnvironment'
import { loadCodeWorkspacePanelModule, loadDetailAiCommitPaneHostModule, preloadProjectPane } from '../lib/projectPagePreload'
import { isTmuxRuntimeEntry } from '../lib/runtimePresentation'
import { useAppStore } from '../stores/appStore'
import { DetailDocumentationCard } from './detail/DetailDocumentationCard'
import { useProjectDocLinks } from './detail/useProjectDocLinks'

const CodeWorkspacePanel = lazy(() => loadCodeWorkspacePanelModule().then((module) => ({ default: module.CodeWorkspacePanel })))
const DetailAiCommitPaneHost = lazy(() => loadDetailAiCommitPaneHostModule().then((module) => ({ default: module.DetailAiCommitPaneHost })))

const PROJECT_HEADER_COLLAPSED_STORAGE_KEY = 'app:project-header-collapsed'
const PROJECT_PAGE_CONTEXT_MENU_IGNORE_SELECTOR = ['button', 'a', 'input', 'textarea', 'select', '[contenteditable="true"]', '.monaco-editor', '.xterm', '[role="dialog"]'].join(', ')

// Stable fallback so the processUrls selector keeps its reference between store updates.
const EMPTY_URLS: string[] = []

function shouldSkipProjectPageContextMenu(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(PROJECT_PAGE_CONTEXT_MENU_IGNORE_SELECTOR))
}

function readProjectHeaderCollapsed(): boolean {
  try {
    return localStorage.getItem(PROJECT_HEADER_COLLAPSED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function DetailPaneFallback() {
  const { t } = useI18n()

  return <div className="flex h-full min-h-0 items-center justify-center rounded-[20px] border border-[color:var(--color-border)] bg-[color:var(--color-card)]/50 text-xs text-[color:var(--color-muted-foreground)]">{t('common.loading')}</div>
}

export function DetailPage() {
  const locale = useLocale()
  const { t } = useI18n()
  const { projectId, pane } = useParams<{ projectId: string; pane?: string }>()
  const navigate = useNavigate()
  const project = useAppStore((s) => {
    const found = s.projects.find((p) => p.id === projectId)
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
      runWorkingDirectory: found.runWorkingDirectory,
      runStartupMode: found.runStartupMode,
      packageManager: found.packageManager,
      pinned: found.pinned,
      cli: found.cli,
      aiRuntimeProfileId: found.aiRuntimeProfileId,
      docLinks: found.docLinks,
      folderId: found.folderId,
      tagIds: found.tagIds,
    }
  }, shallow)
  const folders = useAppStore((s) => s.folders)
  const tags = useAppStore((s) => s.tags)
  const processStatus = projectId ? useAppStore((s) => s.processes[projectId]?.status ?? 'stopped') : 'stopped'
  const processUrls = projectId ? useAppStore((s) => s.processUrls[projectId] ?? EMPTY_URLS) : EMPTY_URLS
  const runTaskStates = projectId ? useAppStore((s) => s.runTaskStates[projectId]) : undefined
  const runTaskConfig = projectId ? useAppStore((s) => s.runTaskConfigs[projectId]) : undefined
  const loadRunTaskConfig = useAppStore((s) => s.loadRunTaskConfig)
  const runTaskUrls = useMemo(() => getActiveRunTaskUrls(runTaskConfig, runTaskStates), [runTaskConfig, runTaskStates])
  const primaryUrlPending = useMemo(() => isPrimaryRunTaskUrlPending(runTaskConfig, runTaskStates), [runTaskConfig, runTaskStates])
  const session = projectId ? useAppStore((s) => s.sessions[projectId]) : undefined
  const runtimeEntry = projectId ? useAppStore((s) => s.runtimeEntries[projectId]) : undefined
  const aiCommitConfig = useAppStore((s) => s.config.aiCommit)
  const themeMode = useAppStore((s) => s.config.theme)
  const aiEnvironmentMode = useAppStore((s) => s.config.aiEnvironment?.mode)
  const aiRuntimeProfilesConfig = useAppStore((s) => s.config.aiRuntimeProfiles ?? [])
  const activeAiRuntimeProfileId = useAppStore((s) => s.config.activeAiRuntimeProfileId)
  const startProject = useAppStore((s) => s.startProject)
  const stopProject = useAppStore((s) => s.stopProject)
  const startAllRunTasks = useAppStore((s) => s.startAllRunTasks)
  const stopAllRunTasks = useAppStore((s) => s.stopAllRunTasks)
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

  const activePane = pane === 'aicommit' || pane === 'git' ? 'aicommit' : 'code'
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [runTasksOpen, setRunTasksOpen] = useState(false)
  // Stable callback so memoized RunTasksDialog doesn't re-render with the page.
  const closeRunTasksDialog = useCallback(() => setRunTasksOpen(false), [])
  const [isOpeningTerminal, setIsOpeningTerminal] = useState(false)
  const [isStartingRuntime, setIsStartingRuntime] = useState(false)
  const [isStoppingRuntime, setIsStoppingRuntime] = useState(false)
  const [runtimeStartError, setRuntimeStartError] = useState<string | null>(null)
  const [metaDialogOpen, setMetaDialogOpen] = useState(false)
  const [projectHeaderCollapsed, setProjectHeaderCollapsed] = useState<boolean>(() => readProjectHeaderCollapsed())

  // HTML/PDF preview guests forward their mouse sequence as synthetic events
  // dispatched straight on `document` (target === document), which never reach
  // the React onContextMenu below. Ctrl+right-click inside a preview therefore
  // opens the project context menu card here; right-drag gestures are skipped
  // because the gesture navigator already consumed (prevented) them.
  useEffect(() => {
    const onPreviewContextMenu = (event: MouseEvent) => {
      if (event.target !== document) return
      if (event.defaultPrevented) return
      if (!event.ctrlKey) return
      event.preventDefault()
      setMenuPos({ x: event.clientX, y: event.clientY })
    }
    document.addEventListener('contextmenu', onPreviewContextMenu)
    return () => document.removeEventListener('contextmenu', onPreviewContextMenu)
  }, [])

  const projectPath = project?.path
  const environment = projectPath ? detectProjectEnvironment(projectPath) : 'unknown'
  const environmentLabel = project ? projectEnvironmentLabel(environment, locale) : t('common.unknown')
  const contentTopPaddingClass = projectHeaderCollapsed ? 'pt-5' : 'pt-[calc(var(--window-titlebar-height)+84px+8px)]'
  const isRunning = processStatus === 'running'
  const isStopping = processStatus === 'stopping'
  const hasActiveRunTasks = Boolean(runTaskStates && Object.values(runTaskStates).some((item) => item.state === 'starting' || item.state === 'waiting' || item.state === 'ready' || item.state === 'running' || item.state === 'stopping'))
  const isAnyRunTaskStopping = Boolean(runTaskStates && Object.values(runTaskStates).some((item) => item.state === 'stopping'))
  // The context menu reflects the unified run-task pipeline, not the legacy
  // bare-process state alone.
  const isMenuDevRunning = isRunning || hasActiveRunTasks
  const isMenuDevStopping = isStopping || isAnyRunTaskStopping
  // Starting always goes through the run-task pipeline (legacy commands are
  // synthesized into a default task), so task activity counts as project activity.
  const isActive = isRunning || isStopping || hasActiveRunTasks
  // Ready = bare process with a URL, or run tasks that are active and no
  // longer ramping (no task left in starting/waiting).
  const hasStartingRunTasks = Boolean(runTaskStates && Object.values(runTaskStates).some((item) => item.state === 'starting' || item.state === 'waiting'))
  const isDevReady = (isRunning && processUrls.length > 0) || (hasActiveRunTasks && !hasStartingRunTasks)
  // At least one task logged an error hint — badge the status pill so the
  // user notices a task may be failing without opening the logs.
  const hasRunTaskWarning = Boolean(runTaskStates && Object.values(runTaskStates).some((item) => item.warning && (item.state === 'starting' || item.state === 'waiting' || item.state === 'running')))
  const allProcessUrls = useMemo(() => {
    const merged = [...processUrls]
    for (const url of runTaskUrls) {
      if (!merged.includes(url)) merged.push(url)
    }
    return merged
  }, [processUrls, runTaskUrls])
  const aiRuntimeProfiles = aiRuntimeProfilesConfig.length > 0 ? aiRuntimeProfilesConfig : defaultAiRuntimeProfiles()
  const defaultRuntimeProfile = resolveAiRuntimeProfile(aiRuntimeProfiles, activeAiRuntimeProfileId)
  const defaultRuntimeProfileLabel = getAiRuntimeProfileLabel(defaultRuntimeProfile)
  const defaultRuntimeProfileCli: CliTool = getAiRuntimeProfileCli(defaultRuntimeProfile)
  const hasProjectAiRuntimeOverride = Boolean(project?.aiRuntimeProfileId?.trim() || project?.cli)
  const currentRuntimeProfileId = project ? resolveProjectAiRuntimeProfileId(project, activeAiRuntimeProfileId) : activeAiRuntimeProfileId
  const currentRuntimeProfile = resolveAiRuntimeProfile(aiRuntimeProfiles, currentRuntimeProfileId, project?.cli)
  const currentRuntimeProfileLabel = getAiRuntimeProfileLabel(currentRuntimeProfile, project?.cli)
  const currentCli: CliTool = getAiRuntimeProfileCli(currentRuntimeProfile, project?.cli)
  const isRuntimeAttached = session?.status === 'attached'
  const isRuntimeDetached = session?.status === 'detached'
  const isRuntimeActive = isRuntimeAttached || isRuntimeDetached
  const usesTmuxRuntime = isTmuxRuntimeEntry(runtimeEntry, aiEnvironmentMode)
  const [aiCommitStatus, setAiCommitStatus] = useState<AiCommitStatus>('idle')
  const { firstDevUrl, pendingOpenDevUrl, startAndOpenDevUrl } = useProjectDevUrlLauncher({
    projectId: projectId ?? '',
    processStatus,
    processUrls,
    runStartupMode: project?.runStartupMode,
    startProject,
    extraUrls: runTaskUrls,
    primaryUrlPending,
    isStartPending: hasStartingRunTasks,
    start: () =>
      startAllRunTasks(projectId ?? '', projectPath ?? '').then((result) => {
        if (!result.started && result.error) console.warn('[Detail] start all run tasks failed:', result.error)
        return result.started
      }),
  })
  const openStartupLogs = useOpenStartupLogs()
  const docLinkState = useProjectDocLinks({ project })
  const {
    docLinks,
    defaultDocLink,
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
  const openProjectLinksManager = useCallback(() => {
    setLinkSettingsOpen(true)
  }, [setLinkSettingsOpen])
  const collapsedProjectLinkItems = useMemo(() => [...(isDevReady ? allProcessUrls.map((url) => ({ url, label: `Dev: ${url}` })) : []), ...docMenuItems], [docMenuItems, isDevReady, allProcessUrls])
  const hasProjectDocLinks = docMenuItems.length > 0

  const handleSelectAiRuntimeProfile = useCallback(
    (profileId: string) => {
      if (!project) return
      void setProjectAiRuntimeProfile(project.id, profileId)
    },
    [project, setProjectAiRuntimeProfile],
  )

  const handleSwitchCli = useCallback(() => {
    if (!project) return
    const currentIndex = aiRuntimeProfiles.findIndex((profile) => profile.id === currentRuntimeProfile.id)
    const nextProfile = aiRuntimeProfiles[(currentIndex + 1 + aiRuntimeProfiles.length) % aiRuntimeProfiles.length]
    if (nextProfile) {
      void setProjectAiRuntimeProfile(project.id, nextProfile.id)
      return
    }
    void setProjectCli(project.id, currentCli === 'codex' ? 'claude' : 'codex')
  }, [project, aiRuntimeProfiles, currentCli, currentRuntimeProfile.id, setProjectAiRuntimeProfile, setProjectCli])

  const handleUseAiRuntimeProfileOnce = useCallback(
    async (profileId: string) => {
      if (!project) return
      await startRuntime(project.id, profileId || defaultRuntimeProfile.id)
    },
    [defaultRuntimeProfile.id, project, startRuntime],
  )

  const handleSwitchAndUseAiRuntimeProfile = useCallback(
    async (profileId: string) => {
      if (!project) return
      await setProjectAiRuntimeProfile(project.id, profileId)
      await startRuntime(project.id, profileId || defaultRuntimeProfile.id)
    },
    [defaultRuntimeProfile.id, project, setProjectAiRuntimeProfile, startRuntime],
  )

  const handleOpenTerminal = useCallback(async () => {
    if (!projectId || isOpeningTerminal) return
    setIsOpeningTerminal(true)
    try {
      await openTerminal(projectId, session?.status)
    } finally {
      setTimeout(() => setIsOpeningTerminal(false), 400)
    }
  }, [projectId, isOpeningTerminal, openTerminal, session?.status])

  const handleStartRuntime = useCallback(async () => {
    if (!project || isStartingRuntime) return
    setIsStartingRuntime(true)
    setRuntimeStartError(null)
    try {
      await startRuntime(project.id)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setRuntimeStartError(message)
      console.error('[Detail] runtime start failed:', err)
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

  // Unified start/stop: everything goes through the run-task pipeline.
  const handleStartProjectTasks = useCallback(() => {
    if (!projectId) return
    void startAllRunTasks(projectId, projectPath ?? '')
  }, [projectId, projectPath, startAllRunTasks])

  const handleStopProjectTasks = useCallback(() => {
    if (!projectId) return
    void (async () => {
      await stopAllRunTasks(projectId)
      await stopProject(projectId)
    })()
  }, [projectId, stopAllRunTasks, stopProject])

  useEffect(() => {
    if (!projectId) return
    if (pane === 'transcript') {
      navigate(`/project/${projectId}/transcript`, { replace: true })
      return
    }
    if (pane === 'git') {
      navigate(`/project/${projectId}/aicommit`, { replace: true })
      return
    }
    if (pane === 'code' || pane === 'aicommit') return
    navigate(`/project/${projectId}/code`, { replace: true })
  }, [projectId, pane, navigate])

  useEffect(() => {
    if (!projectId) return
    const api = window.electronAPI

    const cleanup =
      typeof api.onAiCommitStatus === 'function'
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
    // Lazily discover the project's run task config so primaryUrl ordering works.
    if (projectId && runTaskConfig === undefined && projectPath) {
      void loadRunTaskConfig(projectId, projectPath)
    }
  }, [projectId, runTaskConfig, projectPath, loadRunTaskConfig])

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

  const resolvedProjectPath = project?.path ?? ''
  const projectRenderKey = `${projectId ?? 'unknown'}:${resolvedProjectPath}`
  const codePaneRef = useRef<HTMLDivElement | null>(null)
  const aiCommitPaneRef = useRef<HTMLDivElement | null>(null)
  const [paneMountState, setPaneMountState] = useState(() => ({
    projectKey: projectRenderKey,
    code: activePane === 'code',
    aicommit: activePane === 'aicommit',
  }))
  const hasMountedCodePane = paneMountState.projectKey === projectRenderKey ? paneMountState.code : activePane === 'code'
  const hasMountedAiCommitPane = paneMountState.projectKey === projectRenderKey ? paneMountState.aicommit : activePane === 'aicommit'

  useEffect(() => {
    setPaneMountState((prev) => {
      if (prev.projectKey !== projectRenderKey) {
        return {
          projectKey: projectRenderKey,
          code: activePane === 'code',
          aicommit: activePane === 'aicommit',
        }
      }
      if (activePane === 'code') {
        if (prev.code) return prev
        return { ...prev, code: true }
      }
      if (prev.aicommit) return prev
      return { ...prev, aicommit: true }
    })
  }, [activePane, projectRenderKey])

  useEffect(() => {
    const hiddenPane = activePane === 'code' ? aiCommitPaneRef.current : codePaneRef.current
    const activeElement = document.activeElement
    if (!hiddenPane || !(activeElement instanceof HTMLElement)) return
    if (!hiddenPane.contains(activeElement)) return
    activeElement.blur()
  }, [activePane])

  if (!project || !projectId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <h2 className="text-lg font-semibold text-[color:var(--color-foreground)]">{t('detail.projectNotFound')}</h2>
        <button className="inline-flex items-center gap-1.5 text-sm text-primary transition-colors hover:text-primary" onClick={() => navigate('/')}>
          <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
          {t('detail.backToHome')}
        </button>
      </div>
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
        <header className="app-chrome pointer-events-auto absolute inset-x-0 top-0 z-[85] flex min-h-[84px] items-center justify-between px-8 py-4">
          <div className="flex min-w-0 items-center gap-4">
            <button className="rounded-full p-2 text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]" onClick={() => navigate('/')}>
              <ChevronLeft className="h-5 w-5" strokeWidth={1.8} />
            </button>

            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-[-0.03em] text-[color:var(--color-foreground)]">{projectDisplayName(project)}</h1>
              <p className="mt-0.5 truncate text-xs text-[color:var(--color-muted-foreground)]" title={resolvedProjectPath}>
                {middleTruncatePath(resolvedProjectPath)}
              </p>
              <p className="mt-0.5 text-[11px] text-[color:var(--color-muted-foreground)]/85">
                {t('detail.environment')}: {environmentLabel}
              </p>
              {runtimeStartError && (
                <p className="mt-1 max-w-[460px] truncate rounded-full border border-[color:var(--color-destructive)]/25 bg-[color:var(--color-destructive-background)] px-2 py-1 text-[11px] text-[color:var(--color-destructive)]" title={runtimeStartError}>
                  {runtimeStartError}
                </p>
              )}
            </div>

            {isActive ? (
              <div
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                  isStopping ? 'bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)]' : isDevReady ? 'bg-[color:var(--color-success-background)] text-[color:var(--color-success)]' : 'bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)]'
                }`}
                title={hasRunTaskWarning ? t('runTasks.outputErrorHint') : undefined}
              >
                {isStopping ? <RefreshCw className="h-3 w-3 animate-spin" /> : <span className={`h-1.5 w-1.5 rounded-full ${isDevReady ? 'bg-[color:var(--color-success)]' : 'bg-[color:var(--color-warning)]'}`} />}
                {hasRunTaskWarning && !isStopping && <TriangleAlert className="h-3 w-3 shrink-0" />}
                {isStopping ? t('common.stopping') : isDevReady ? t('common.running') : t('common.starting')}
              </div>
            ) : (
              <span className="shrink-0 text-[11px] font-medium text-[color:var(--color-muted-foreground)]">{t('common.stop')}</span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <ProjectPaneTabs
              activePane={activePane}
              onPreloadPane={preloadProjectPane}
              onSelectPane={(nextPane) => {
                if (!projectId || nextPane === activePane) return
                navigate(`/project/${projectId}/${nextPane}`)
              }}
            />

            <button
              type="button"
              className="quiet-control relative inline-flex items-center gap-1.5 rounded-full border-0 px-2.5 py-1.5 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
              onClick={() => setRunTasksOpen(true)}
              title={t('runTasks.title')}
              aria-label={t('runTasks.title')}
            >
              <ListTree className="h-3.5 w-3.5" />
              {hasActiveRunTasks && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[color:var(--color-success)]" />}
            </button>

            {(isDevReady || pendingOpenDevUrl || !isActive) && (
              <UrlPopover urls={allProcessUrls}>
                <button
                  className={`quiet-control inline-flex items-center gap-1.5 rounded-full border-0 py-1.5 text-xs transition-colors hover:bg-[color:var(--color-accent)] disabled:opacity-60 ${
                    isDevReady ? 'text-primary hover:text-primary' : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
                  } ${firstDevUrl || pendingOpenDevUrl ? 'px-3' : 'px-2.5'}`}
                  onClick={() => {
                    void startAndOpenDevUrl()
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (projectId) openStartupLogs(projectId)
                  }}
                  disabled={pendingOpenDevUrl}
                  title={isDevReady ? t('project.openDevUrl') : pendingOpenDevUrl ? t('project.waitingForDevUrl') : t('project.startAndOpenDevUrlShort')}
                  aria-label={isDevReady ? t('project.openDevUrl') : pendingOpenDevUrl ? t('project.waitingForDevUrl') : t('project.startAndOpenDevUrlShort')}
                >
                  {pendingOpenDevUrl ? <RefreshCw className="h-3 w-3 animate-spin" /> : <ArrowUpRight className="h-3 w-3" />}
                  {(firstDevUrl || pendingOpenDevUrl) && <span className="max-w-[180px] truncate">{firstDevUrl ?? t('project.waitingForDevUrl')}</span>}
                </button>
              </UrlPopover>
            )}

            <ProjectLinksTrigger items={docMenuItems} tagOptions={docLinkTagOptionsFromHook} onOpenDefault={defaultDocLink ? () => handleOpenDocLink(defaultDocLink) : undefined} onOpenManager={openProjectLinksManager} size="icon" title={defaultDocLink ? t('common.leftClickOpenFirstLink') : t('detail.docsSettings')} />

            <button
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-all ${
                isActive
                  ? isStopping
                    ? 'border text-[color:var(--color-warning)] bg-[color:var(--color-warning-background)]'
                    : isDevReady
                      ? 'border text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-background)]'
                      : 'border text-[color:var(--color-warning)] bg-[color:var(--color-warning-background)]'
                  : 'bg-primary text-white shadow-sm hover:bg-primary-hover'
              }`}
              style={isActive ? (isStopping ? { borderColor: 'color-mix(in srgb, var(--color-warning) 34%, transparent)' } : isDevReady ? { borderColor: 'color-mix(in srgb, var(--color-destructive) 32%, transparent)' } : { borderColor: 'color-mix(in srgb, var(--color-warning) 32%, transparent)' }) : undefined}
              onClick={() => (isActive ? (isStopping ? undefined : handleStopProjectTasks()) : handleStartProjectTasks())}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setMenuPos(null)
                setRunTasksOpen(true)
              }}
              disabled={isStopping}
              title={t('common.leftClickRunRightClickConfig')}
            >
              {isActive ? (
                <>
                  {isStopping ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : isDevReady ? <Square className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                  {isStopping ? t('common.stopping') : isDevReady ? t('common.stop') : t('common.starting')}
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" />
                  {t('common.run')}
                </>
              )}
            </button>
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

      {menuPos && (
        <CardContextMenu
          x={menuPos.x}
          y={menuPos.y}
          onClose={() => setMenuPos(null)}
          isRuntimeActive={isRuntimeActive}
          usesTmuxRuntime={usesTmuxRuntime}
          isDevRunning={isMenuDevRunning}
          isDevStopping={isMenuDevStopping}
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
          onUseAiRuntimeProfile={handleUseAiRuntimeProfileOnce}
          onSwitchAndUseAiRuntimeProfile={handleSwitchAndUseAiRuntimeProfile}
          onStartProject={handleStartProjectTasks}
          onStopProject={handleStopProjectTasks}
          onAiAutoCommit={() => {
            void handleAiAutoCommit()
          }}
          aiCommitStatus={aiCommitStatus}
          onOpenFolder={() => window.electronAPI.openFolder(resolvedProjectPath)}
          onOpenPathTerminal={async () => {
            await window.electronAPI.openPathTerminal(resolvedProjectPath)
          }}
          onOpenVsCode={() => window.electronAPI.openInVsCode(resolvedProjectPath)}
          onTogglePin={() => togglePin(project.id)}
          onEditMetadata={() => setMetaDialogOpen(true)}
          onOpenRunTasks={() => setRunTasksOpen(true)}
        />
      )}

      {metaDialogOpen && (
        <ProjectMetaDialog open={metaDialogOpen} project={project} folders={folders} tags={tags} onClose={() => setMetaDialogOpen(false)} onAssignFolder={assignProjectFolder} onSetProjectTags={setProjectTags} onSetProjectCustomName={setProjectCustomName} onSetProjectCustomType={setProjectCustomType} />
      )}

      {/* 条件挂载：关闭时零开销（不订阅 store、不执行任何弹窗渲染）。 */}
      {runTasksOpen && <RunTasksDialog project={project} open onClose={closeRunTasksDialog} />}

      <div className={`min-h-0 flex-1 px-6 pb-6 sm:px-8 ${contentTopPaddingClass}`}>
        <div className="relative h-full min-h-0 w-full">
          <div ref={codePaneRef} className={`absolute inset-0 overflow-hidden ${activePane === 'code' ? '' : 'pointer-events-none invisible opacity-0'}`} aria-hidden={activePane !== 'code'}>
            <div className="mx-auto h-full min-h-0 w-full min-w-0 max-w-[1360px]">
              <Suspense fallback={<DetailPaneFallback />}>
                {hasMountedCodePane && (
                  <CodeWorkspacePanel
                    key={projectRenderKey}
                    projectId={project.id}
                    projectPath={resolvedProjectPath}
                    themeMode={themeMode}
                    projectHeaderCollapsed={projectHeaderCollapsed}
                    projectName={projectDisplayName(project)}
                    projectLinkItems={collapsedProjectLinkItems}
                    hasProjectDocLinks={hasProjectDocLinks}
                    projectLinkTagOptions={docLinkTagOptionsFromHook}
                    projectDevUrlActionVisible={isDevReady || pendingOpenDevUrl || !isActive}
                    projectDevUrlPending={pendingOpenDevUrl}
                    projectDevUrlReady={isDevReady}
                    activePane={activePane}
                    onPreloadPane={preloadProjectPane}
                    onStartAndOpenDevUrl={startAndOpenDevUrl}
                    onOpenStartupLogs={() => {
                      if (projectId) openStartupLogs(projectId)
                    }}
                    onSwitchPane={(nextPane) => {
                      if (!projectId || nextPane === activePane) return
                      navigate(`/project/${projectId}/${nextPane}`)
                    }}
                    onOpenTranscript={() => {
                      if (!projectId) return
                      navigate(`/project/${projectId}/transcript`)
                    }}
                    onOpenProjectLinksManager={openProjectLinksManager}
                    onOpenRunTasks={() => setRunTasksOpen(true)}
                    runTasksActive={hasActiveRunTasks}
                    onRequestProjectContextMenu={(x, y) => setMenuPos({ x, y })}
                  />
                )}
              </Suspense>
            </div>
          </div>

          <div ref={aiCommitPaneRef} className={`absolute inset-0 ${activePane === 'aicommit' ? 'overflow-x-auto overflow-y-hidden' : 'overflow-hidden pointer-events-none invisible opacity-0'}`} aria-hidden={activePane !== 'aicommit'}>
            <div className="mx-auto h-full min-h-0 w-full min-w-[1060px] max-w-[1640px] overflow-hidden">
              <Suspense fallback={<DetailPaneFallback />}>
                {hasMountedAiCommitPane && (
                  <DetailAiCommitPaneHost
                    key={projectRenderKey}
                    projectId={project.id}
                    projectPath={resolvedProjectPath}
                    projectHeaderCollapsed={projectHeaderCollapsed}
                    projectName={projectDisplayName(project)}
                    projectLinkItems={collapsedProjectLinkItems}
                    hasProjectDocLinks={hasProjectDocLinks}
                    projectLinkTagOptions={docLinkTagOptionsFromHook}
                    projectDevUrlActionVisible={isDevReady || pendingOpenDevUrl || !isActive}
                    projectDevUrlPending={pendingOpenDevUrl}
                    projectDevUrlReady={isDevReady}
                    aiCommitConfig={aiCommitConfig}
                    activePane={activePane}
                    onPreloadPane={preloadProjectPane}
                    onSwitchPane={(nextPane) => {
                      if (!projectId || nextPane === activePane) return
                      navigate(`/project/${projectId}/${nextPane}`)
                    }}
                    onStartAndOpenDevUrl={startAndOpenDevUrl}
                    onOpenStartupLogs={() => {
                      if (projectId) openStartupLogs(projectId)
                    }}
                    onOpenTranscript={() => {
                      if (!projectId) return
                      navigate(`/project/${projectId}/transcript`)
                    }}
                    onOpenProjectLinksManager={openProjectLinksManager}
                    onCloseProjectContextMenu={() => setMenuPos(null)}
                  />
                )}
              </Suspense>
            </div>
          </div>
        </div>
      </div>

      <DetailDocumentationCard
        docLinks={docLinks}
        projectId={project?.id}
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
    </div>
  )
}
