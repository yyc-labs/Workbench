import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { shallow } from 'zustand/shallow'
import {
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Play,
  RefreshCw,
  Square,
} from 'lucide-react'
import { CardContextMenu } from '../components/CardContextMenu'
import { ProjectPaneTabs } from '../components/ProjectPaneTabs'
import { ProjectLinksTrigger } from '../components/ProjectLinksTrigger'
import { ProjectMetaDialog } from '../components/ProjectMetaDialog'
import { UrlPopover } from '../components/UrlPopover'
import { RunCommandConfigPopover } from '../components/RunCommandConfigPopover'
import { detectProjectEnvironment, projectEnvironmentLabel } from '../lib/projectEnvironment'
import { middleTruncatePath, projectDisplayName } from '../lib/projectDisplay'
import { isTmuxRuntimeEntry } from '../lib/runtimePresentation'
import { useI18n, useLocale } from '../i18n'
import { useAppStore } from '../stores/appStore'
import type { AiCommitStatus, AiCommitTaskSnapshot, CliTool } from '../../shared/types'
import { useProjectDevUrlLauncher } from '../hooks/useProjectDevUrlLauncher'
import {
  loadCodeWorkspacePanelModule,
  loadDetailAiCommitPaneHostModule,
  preloadProjectPane,
} from '../lib/projectPagePreload'
import { DetailDocumentationCard } from './detail/DetailDocumentationCard'
import { useProjectDocLinks } from './detail/useProjectDocLinks'

const CodeWorkspacePanel = lazy(() =>
  loadCodeWorkspacePanelModule().then((module) => ({ default: module.CodeWorkspacePanel }))
)
const DetailAiCommitPaneHost = lazy(() =>
  loadDetailAiCommitPaneHostModule().then((module) => ({ default: module.DetailAiCommitPaneHost }))
)

const PROJECT_HEADER_COLLAPSED_STORAGE_KEY = 'app:project-header-collapsed'
const PROJECT_PAGE_CONTEXT_MENU_IGNORE_SELECTOR = [
  'button',
  'a',
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '.monaco-editor',
  '.xterm',
  '[role="dialog"]',
].join(', ')

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

  return (
    <div className="flex h-full min-h-0 items-center justify-center rounded-[20px] border border-[color:var(--color-border)] bg-[color:var(--color-card)]/50 text-xs text-[color:var(--color-muted-foreground)]">
      {t('common.loading')}
    </div>
  )
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
      docLinks: found.docLinks,
      folderId: found.folderId,
      tagIds: found.tagIds,
    }
  }, shallow)
  const folders = useAppStore((s) => s.folders)
  const tags = useAppStore((s) => s.tags)
  const processStatus = projectId ? useAppStore((s) => s.processes[projectId]?.status ?? 'stopped') : 'stopped'
  const processUrls = projectId ? useAppStore((s) => s.processUrls[projectId] || []) : ([] as string[])
  const session = projectId ? useAppStore((s) => s.sessions[projectId]) : undefined
  const runtimeEntry = projectId ? useAppStore((s) => s.runtimeEntries[projectId]) : undefined
  const aiCommitConfig = useAppStore((s) => s.config.aiCommit)
  const themeMode = useAppStore((s) => s.config.theme)
  const aiEnvironmentMode = useAppStore((s) => s.config.aiEnvironment?.mode)
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

  const activePane = pane === 'aicommit' || pane === 'git' ? 'aicommit' : 'code'
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [runConfigOpen, setRunConfigOpen] = useState(false)
  const [isOpeningTerminal, setIsOpeningTerminal] = useState(false)
  const [isStartingRuntime, setIsStartingRuntime] = useState(false)
  const [isStoppingRuntime, setIsStoppingRuntime] = useState(false)
  const [metaDialogOpen, setMetaDialogOpen] = useState(false)
  const [projectHeaderCollapsed, setProjectHeaderCollapsed] = useState<boolean>(() => readProjectHeaderCollapsed())

  const projectPath = project?.path
  const environment = projectPath ? detectProjectEnvironment(projectPath) : 'unknown'
  const environmentLabel = project ? projectEnvironmentLabel(environment, locale) : t('common.unknown')
  const contentTopPaddingClass = projectHeaderCollapsed
    ? 'pt-5'
    : 'pt-[calc(var(--window-titlebar-height)+84px+8px)]'
  const isRunning = processStatus === 'running'
  const isStopping = processStatus === 'stopping'
  const isActive = isRunning || isStopping
  const isDevReady = isRunning && processUrls.length > 0
  const currentCli: CliTool = project?.cli || 'claude'
  const isRuntimeAttached = session?.status === 'attached'
  const isRuntimeDetached = session?.status === 'detached'
  const isRuntimeActive = isRuntimeAttached || isRuntimeDetached
  const usesTmuxRuntime = isTmuxRuntimeEntry(runtimeEntry, aiEnvironmentMode)
  const [aiCommitStatus, setAiCommitStatus] = useState<AiCommitStatus>('idle')
  const {
    firstDevUrl,
    pendingOpenDevUrl,
    startAndOpenDevUrl,
  } = useProjectDevUrlLauncher({
    projectId: projectId ?? '',
    processStatus,
    processUrls,
    runStartupMode: project?.runStartupMode,
    startProject,
  })
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
  const collapsedProjectLinkItems = useMemo(
    () => [
      ...(isDevReady ? processUrls.map((url) => ({ url, label: `Dev: ${url}` })) : []),
      ...docMenuItems,
    ],
    [docMenuItems, isDevReady, processUrls]
  )

  const handleSwitchCli = useCallback(() => {
    if (!project) return
    void setProjectCli(project.id, currentCli === 'codex' ? 'claude' : 'codex')
  }, [project, currentCli, setProjectCli])

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

  if (!project || !projectId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <h2 className="text-lg font-semibold text-[color:var(--color-foreground)]">{t('detail.projectNotFound')}</h2>
        <button
          className="inline-flex items-center gap-1.5 text-sm text-primary transition-colors hover:text-primary"
          onClick={() => navigate('/')}
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
          {t('detail.backToHome')}
        </button>
      </div>
    )
  }

  const resolvedProjectPath = project.path

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
            <button
              className="rounded-full p-2 text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
              onClick={() => navigate('/')}
            >
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
            </div>

            {isActive ? (
              <div
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${isRunning
                  ? isDevReady
                    ? 'bg-[color:var(--color-success-background)] text-[color:var(--color-success)]'
                    : 'bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)]'
                  : isStopping
                    ? 'bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)]'
                    : 'bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)]'
                  }`}
              >
                {isStopping ? (
                  <RefreshCw className="h-3 w-3 animate-spin" />
                ) : (
                  <span className={`h-1.5 w-1.5 rounded-full ${isDevReady ? 'bg-[color:var(--color-success)]' : 'bg-[color:var(--color-warning)]'}`} />
                )}
                {isRunning ? (isDevReady ? t('common.running') : t('common.starting')) : isStopping ? t('common.stopping') : (usesTmuxRuntime ? t('detail.sessionAvailable') : t('detail.terminalReady'))}
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

            {(isDevReady || pendingOpenDevUrl || !isActive) && (
              <UrlPopover urls={processUrls}>
                <button
                  className={`quiet-control inline-flex items-center gap-1.5 rounded-full border-0 py-1.5 text-xs transition-colors hover:bg-[color:var(--color-accent)] disabled:opacity-60 ${
                    isDevReady
                      ? 'text-primary hover:text-primary'
                      : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
                  } ${
                    firstDevUrl || pendingOpenDevUrl ? 'px-3' : 'px-2.5'
                  }`}
                  onClick={() => { void startAndOpenDevUrl() }}
                  disabled={pendingOpenDevUrl}
                  title={isDevReady ? t('project.openDevUrl') : pendingOpenDevUrl ? t('project.waitingForDevUrl') : t('project.startAndOpenDevUrlShort')}
                  aria-label={isDevReady ? t('project.openDevUrl') : pendingOpenDevUrl ? t('project.waitingForDevUrl') : t('project.startAndOpenDevUrlShort')}
                >
                  {pendingOpenDevUrl ? <RefreshCw className="h-3 w-3 animate-spin" /> : <ArrowUpRight className="h-3 w-3" />}
                  {(firstDevUrl || pendingOpenDevUrl) && (
                    <span className="max-w-[180px] truncate">
                      {firstDevUrl ?? t('project.waitingForDevUrl')}
                    </span>
                  )}
                </button>
              </UrlPopover>
            )}

            <ProjectLinksTrigger
              items={docMenuItems}
              tagOptions={docLinkTagOptionsFromHook}
              onOpenDefault={defaultDocLink ? () => handleOpenDocLink(defaultDocLink) : undefined}
              onOpenManager={openProjectLinksManager}
              size="icon"
              title={defaultDocLink ? t('common.leftClickOpenFirstLink') : t('detail.docsSettings')}
            />

            <button
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-all ${isActive
                ? isStopping
                  ? 'border text-[color:var(--color-warning)] bg-[color:var(--color-warning-background)]'
                  : isDevReady
                    ? 'border text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-background)]'
                    : 'border text-[color:var(--color-warning)] bg-[color:var(--color-warning-background)]'
                : 'bg-primary text-white shadow-sm hover:bg-primary-hover'
                }`}
              style={
                isActive
                  ? isStopping
                    ? { borderColor: 'color-mix(in srgb, var(--color-warning) 34%, transparent)' }
                    : isDevReady
                      ? { borderColor: 'color-mix(in srgb, var(--color-destructive) 32%, transparent)' }
                      : { borderColor: 'color-mix(in srgb, var(--color-warning) 32%, transparent)' }
                  : undefined
              }
              onClick={() => (isActive ? (isStopping ? undefined : stopProject(projectId)) : startProject(projectId))}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setMenuPos(null)
                setRunConfigOpen(true)
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
          isDevRunning={isRunning}
          isDevStopping={isStopping}
          isOpeningTerminal={isOpeningTerminal}
          isStartingRuntime={isStartingRuntime}
          isStoppingRuntime={isStoppingRuntime}
          currentCli={currentCli}
          isPinned={project.pinned}
          onStartRuntime={handleStartRuntime}
          onStopRuntime={handleStopRuntime}
          onOpenTerminal={handleOpenTerminal}
          onSwitchCli={handleSwitchCli}
          onStartProject={() => startProject(project.id)}
          onStopProject={() => stopProject(project.id)}
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

      <RunCommandConfigPopover
        project={project}
        open={runConfigOpen}
        onClose={() => setRunConfigOpen(false)}
      />

      <div className={`min-h-0 flex-1 px-6 pb-6 sm:px-8 ${contentTopPaddingClass} ${activePane === 'aicommit' ? 'overflow-x-auto' : 'overflow-x-hidden'}`}>
        <div className={`mx-auto h-full min-h-0 w-full ${
          activePane === 'aicommit'
            ? 'min-w-[1060px] max-w-[1640px]'
            : 'min-w-0 max-w-[1360px]'
        }`}>
          <Suspense fallback={<DetailPaneFallback />}>
            {activePane === 'code' ? (
              <CodeWorkspacePanel
                key={`${project.id}:${resolvedProjectPath}`}
                projectId={project.id}
                projectPath={resolvedProjectPath}
                themeMode={themeMode}
                projectHeaderCollapsed={projectHeaderCollapsed}
                projectName={projectDisplayName(project)}
                projectLinkItems={collapsedProjectLinkItems}
                projectLinkTagOptions={docLinkTagOptionsFromHook}
                projectDevUrlActionVisible={isDevReady || pendingOpenDevUrl || !isActive}
                projectDevUrlPending={pendingOpenDevUrl}
                projectDevUrlReady={isDevReady}
                activePane={activePane}
                onPreloadPane={preloadProjectPane}
                onStartAndOpenDevUrl={startAndOpenDevUrl}
                onSwitchPane={(nextPane) => {
                  if (!projectId || nextPane === activePane) return
                  navigate(`/project/${projectId}/${nextPane}`)
                }}
                onOpenTranscript={() => {
                  if (!projectId) return
                  navigate(`/project/${projectId}/transcript`)
                }}
                onOpenProjectLinksManager={openProjectLinksManager}
              />
            ) : (
              <DetailAiCommitPaneHost
                projectId={project.id}
                projectPath={resolvedProjectPath}
                projectHeaderCollapsed={projectHeaderCollapsed}
                projectName={projectDisplayName(project)}
                projectLinkItems={collapsedProjectLinkItems}
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
    </div>
  )
}
