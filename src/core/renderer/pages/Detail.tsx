import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import '@xyflow/react/dist/style.css'
import {
  ArrowUpRight,
  BookOpen,
  Bot,
  ChevronLeft,
  Code2,
  Play,
  RefreshCw,
  Settings2,
  Square,
} from 'lucide-react'
import { CardContextMenu } from '../components/CardContextMenu'
import { ProjectMetaDialog } from '../components/ProjectMetaDialog'
import { UrlPopover } from '../components/UrlPopover'
import { RunCommandConfigPopover } from '../components/RunCommandConfigPopover'
import { detectProjectEnvironment, projectEnvironmentLabel } from '../lib/projectEnvironment'
import { middleTruncatePath, projectDisplayName } from '../lib/projectDisplay'
import { normalizeProjectDocLinkTag, projectDocLinkTagLabel } from '../lib/projectDocLinks'
import { useAppStore } from '../stores/appStore'
import type { CliTool } from '../../shared/types'
import { CodeWorkspacePanel } from './code/CodeWorkspacePanel'
import { DetailAiCommitPanel } from './detail/DetailAiCommitPanel'
import { DetailDocumentationCard } from './detail/DetailDocumentationCard'
import { useAiCommitFlow } from './detail/useAiCommitFlow'
import { useProjectDocLinks } from './detail/useProjectDocLinks'

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

export function DetailPage() {
  const { projectId, pane } = useParams<{ projectId: string; pane?: string }>()
  const navigate = useNavigate()
  const project = useAppStore((s) => s.projects.find((p) => p.id === projectId))
  const folders = useAppStore((s) => s.folders)
  const tags = useAppStore((s) => s.tags)
  const processStatus = projectId ? useAppStore((s) => s.processes[projectId]?.status ?? 'stopped') : 'stopped'
  const processUrls = projectId ? useAppStore((s) => s.processUrls[projectId] || []) : ([] as string[])
  const session = projectId ? useAppStore((s) => s.sessions[projectId]) : undefined
  const toolProcessId = useMemo(() => (projectId ? `${projectId}::toolbox` : ''), [projectId])
  const toolProcessStatus = toolProcessId
    ? useAppStore((s) => s.processes[toolProcessId]?.status ?? 'stopped')
    : 'stopped'
  const aiCommitConfig = useAppStore((s) => s.config.aiCommit)
  const themeMode = useAppStore((s) => s.config.theme)
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
  const docLinkTagOptions = useAppStore((s) => s.config.docLinkTags ?? [])

  const activePane = pane === 'aicommit' || pane === 'git' ? 'aicommit' : 'code'
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [runConfigPos, setRunConfigPos] = useState<{ x: number; y: number } | null>(null)
  const [isOpeningTerminal, setIsOpeningTerminal] = useState(false)
  const [metaDialogOpen, setMetaDialogOpen] = useState(false)

  const environment = project ? detectProjectEnvironment(project.path) : 'unknown'
  const environmentLabel = project ? projectEnvironmentLabel(environment) : 'Unknown'
  const isRunning = processStatus === 'running'
  const isStopping = processStatus === 'stopping'
  const isActive = isRunning || isStopping
  const currentCli: CliTool = project?.cli || 'claude'
  const isRuntimeAttached = session?.status === 'attached'
  const isRuntimeDetached = session?.status === 'detached'
  const isRuntimeActive = isRuntimeAttached || isRuntimeDetached
  const aiCommitFlow = useAiCommitFlow({
    projectId,
    projectPath: project?.path,
    toolProcessId,
    aiCommitConfig,
  })
  const {
    aiCommitStatus,
    rightPaneMode,
    setRightPaneMode,
    aiRawText,
    jumpToAiLogToken,
    gitSnapshot,
    gitSnapshotLoading,
    gitSnapshotError,
    refreshGitSnapshot,
    activeCommitHash,
    setActiveCommitHash,
    quickConfigOpen,
    setQuickConfigOpen,
    quickSplit,
    setQuickSplit,
    quickSplitMaxBatches,
    setQuickSplitMaxBatches,
    quickMaxBullets,
    setQuickMaxBullets,
    quickConfigPos,
    setQuickConfigPos,
    quickConfigRef,
    quickButtonRef,
    flowViewportReadyRef,
    flowInitialFocusDoneRef,
    flowLastFocusedStepRef,
    flowApiRef,
    isAiEnabled,
    defaultSplit,
    defaultSplitMaxBatches,
    defaultMaxBullets,
    quickSplitMaxBatchesNumber,
    quickMaxBulletsNumber,
    handleAiCommit,
    runWithQuickConfig,
    saveQuickConfigAsDefault,
    statusText,
    statusClass,
    flowNodes,
    flowEdges,
  } = aiCommitFlow
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
  } = docLinkState

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

  useEffect(() => {
    if (!projectId) return
    if (pane === 'git') {
      navigate(`/project/${projectId}/aicommit`, { replace: true })
      return
    }
    if (pane === 'code' || pane === 'aicommit') return
    navigate(`/project/${projectId}/code`, { replace: true })
  }, [projectId, pane, navigate])

  useEffect(() => {
    if (!projectId || !toolProcessId || !project) return
    if (toolProcessStatus !== 'stopped') return
    const toolCommand = environment === 'ubuntu' ? 'exec bash -i' : 'powershell -NoLogo -NoExit'
    const useWsl = environment === 'ubuntu'
    void startProject(projectId, toolCommand, toolProcessId, useWsl)
  }, [projectId, project, toolProcessId, toolProcessStatus, environment, startProject])

  useEffect(() => {
    if (!toolProcessId) return
    return () => {
      void stopProject(toolProcessId)
    }
  }, [toolProcessId, stopProject])

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

  return (
    <div
      className="flex h-full flex-col"
      onContextMenu={(event) => {
        if (shouldSkipProjectPageContextMenu(event.target)) return
        event.preventDefault()
        setMenuPos({ x: event.clientX, y: event.clientY })
      }}
    >
      <header className="app-chrome flex min-h-[84px] shrink-0 items-center justify-between px-8 py-4">
        <div className="flex min-w-0 items-center gap-4">
          <button
            className="rounded-full p-2 text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
            onClick={() => navigate('/')}
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={1.8} />
          </button>

          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-[-0.03em] text-[color:var(--color-foreground)]">{projectDisplayName(project)}</h1>
            <p className="mt-0.5 truncate text-xs text-[color:var(--color-muted-foreground)]" title={project.path}>
              {middleTruncatePath(project.path)}
            </p>
            <p className="mt-0.5 text-[11px] text-[color:var(--color-muted-foreground)]/85">Environment: {environmentLabel}</p>
          </div>

          {isActive ? (
            <div
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${isRunning
                ? 'bg-[color:var(--color-success-background)] text-[color:var(--color-success)]'
                : isStopping
                  ? 'bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)]'
                  : 'bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)]'
                }`}
            >
              {isStopping ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <span className={`h-1.5 w-1.5 rounded-full ${isRunning ? 'bg-[color:var(--color-success)]' : 'bg-[color:var(--color-warning)]'}`} />
              )}
              {isRunning ? 'Running' : isStopping ? 'Stopping...' : 'Session Available'}
            </div>
          ) : (
            <span className="shrink-0 text-[11px] font-medium text-[color:var(--color-muted-foreground)]">Stopped</span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div className="quiet-control flex items-center gap-1 rounded-full border border-[color:var(--color-border)] p-1">
            <button
              type="button"
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                activePane === 'code'
                  ? 'bg-primary text-white'
                  : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
              }`}
              onClick={() => {
                if (!projectId || activePane === 'code') return
                navigate(`/project/${projectId}/code`)
              }}
            >
              <Code2 className="h-3.5 w-3.5" />
              Code
            </button>
            <button
              type="button"
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                activePane === 'aicommit'
                  ? 'bg-primary text-white'
                  : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
              }`}
              onClick={() => {
                if (!projectId || activePane === 'aicommit') return
                navigate(`/project/${projectId}/aicommit`)
              }}
            >
              <Bot className="h-3.5 w-3.5" />
              Git Commit
            </button>
          </div>

          {isRunning && processUrls.length > 0 && (
            <UrlPopover urls={processUrls}>
              <button
                className="quiet-control inline-flex items-center gap-1.5 rounded-full border-0 px-3 py-1.5 text-xs text-primary transition-colors hover:bg-[color:var(--color-accent)]"
                onClick={() => window.electronAPI.openExternal(processUrls[0])}
              >
                <ArrowUpRight className="h-3 w-3" />
                <span className="max-w-[180px] truncate">{processUrls[0]}</span>
              </button>
            </UrlPopover>
          )}

          {defaultDocLink && (
            <UrlPopover items={docMenuItems}>
              <button
                type="button"
                className="quiet-control inline-flex items-center gap-1.5 rounded-full border-0 px-3 py-1.5 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                onClick={() => window.electronAPI.openExternal(defaultDocLink.url)}
                title={defaultDocLink.url}
              >
                <BookOpen className="h-3 w-3" />
                <span className="max-w-[200px] truncate">
                  资料 · {projectDocLinkTagLabel(
                    normalizeProjectDocLinkTag(defaultDocLink.tag, docLinkTagOptions),
                    docLinkTagOptions
                  )}: {defaultDocLink.title}
                </span>
              </button>
            </UrlPopover>
          )}

          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-3 py-1.5 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
            onClick={() => setLinkSettingsOpen(true)}
          >
            <Settings2 className="h-3.5 w-3.5" />
            资料设置
          </button>

          <button
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-all ${isActive
              ? isStopping
                ? 'border text-[color:var(--color-warning)] bg-[color:var(--color-warning-background)]'
                : 'border text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-background)]'
              : 'bg-primary text-white shadow-sm hover:bg-primary-hover'
              }`}
            style={
              isActive
                ? isStopping
                  ? { borderColor: 'color-mix(in srgb, var(--color-warning) 34%, transparent)' }
                  : { borderColor: 'color-mix(in srgb, var(--color-destructive) 32%, transparent)' }
                : undefined
            }
            onClick={() => (isActive ? (isStopping ? undefined : stopProject(projectId)) : startProject(projectId))}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setMenuPos(null)
              setRunConfigPos({ x: e.clientX, y: e.clientY })
            }}
            disabled={isStopping}
            title="左键执行当前动作，右键配置 Run 命令"
          >
            {isActive ? (
              <>
                {isStopping ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                {isStopping ? 'Stopping...' : 'Stop'}
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                Run
              </>
            )}
          </button>

        </div>
      </header>

      {quickConfigOpen && (
        <div
          ref={quickConfigRef}
          className="fixed z-[120] w-[260px] rounded-[16px] border p-3 shadow-xl surface-card"
          style={{
            left: `${quickConfigPos.x}px`,
            top: `${quickConfigPos.y}px`,
            borderColor: 'var(--color-border)',
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold text-[color:var(--color-foreground)]">Quick AI Commit Config</p>
            <button
              className="rounded-full px-2 py-0.5 text-[11px] text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
              onClick={() => setQuickConfigOpen(false)}
            >
              Close
            </button>
          </div>

          <label className="mb-2 flex items-center gap-2 text-xs text-[color:var(--color-foreground)]">
            <input
              type="checkbox"
              checked={quickSplit}
              onChange={(e) => setQuickSplit(e.target.checked)}
            />
            Enable split commit
          </label>

          <div className="mb-3">
            <p className="mb-1 text-[11px] text-[color:var(--color-muted-foreground)]">Split max batches (1-12)</p>
            <input
              type="number"
              min={1}
              max={12}
              step={1}
              value={quickSplitMaxBatches}
              disabled={!quickSplit}
              onChange={(e) => setQuickSplitMaxBatches(e.target.value)}
              className="quiet-control h-8 w-full rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)]"
            />
          </div>

          <div className="mb-3">
            <p className="mb-1 text-[11px] text-[color:var(--color-muted-foreground)]">Max bullets per commit</p>
            <div className="mb-2 flex items-center gap-1.5">
              {[8, 12, 16].map((value) => {
                const active = quickMaxBulletsNumber === value
                return (
                  <button
                    key={value}
                    type="button"
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      active
                        ? 'bg-primary text-white'
                        : 'border border-[color:var(--color-border)] text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]'
                    }`}
                    onClick={() => setQuickMaxBullets(String(value))}
                  >
                    {value}
                  </button>
                )
              })}
            </div>
            <input
              type="number"
              min={1}
              max={20}
              step={1}
              value={quickMaxBullets}
              onChange={(e) => setQuickMaxBullets(e.target.value)}
              className="quiet-control h-8 w-full rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)]"
              placeholder="8"
            />
          </div>

          <div className="mb-2 text-[10px] text-[color:var(--color-muted-foreground)]">
            Default: Split {defaultSplit ? 'On' : 'Off'} · {defaultSplitMaxBatches} · Bullets {defaultMaxBullets}
          </div>

          <div className="flex items-center gap-2">
            <button
              className="flex-1 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
              onClick={() => void runWithQuickConfig()}
              disabled={aiCommitStatus === 'running'}
            >
              Run This Time
            </button>
            <button
              className="rounded-full border border-[color:var(--color-border)] px-3 py-1.5 text-xs text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]"
              onClick={() => void saveQuickConfigAsDefault()}
            >
              Save Default
            </button>
          </div>
        </div>
      )}

      {menuPos && (
        <CardContextMenu
          x={menuPos.x}
          y={menuPos.y}
          onClose={() => setMenuPos(null)}
          isRuntimeActive={isRuntimeActive}
          isDevRunning={isRunning}
          isDevStopping={isStopping}
          isOpeningTerminal={isOpeningTerminal}
          currentCli={currentCli}
          isPinned={project.pinned}
          onStartRuntime={() => startRuntime(project.id)}
          onStopRuntime={() => stopRuntime(project.id)}
          onOpenTerminal={handleOpenTerminal}
          onSwitchCli={handleSwitchCli}
          onStartProject={() => startProject(project.id)}
          onStopProject={() => stopProject(project.id)}
          onAiAutoCommit={() => {
            void handleAiCommit()
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

      {runConfigPos && (
        <RunCommandConfigPopover
          project={project}
          x={runConfigPos.x}
          y={runConfigPos.y}
          onClose={() => setRunConfigPos(null)}
        />
      )}

      <div className={`min-h-0 flex-1 px-6 pb-6 pt-5 sm:px-8 ${activePane === 'aicommit' ? 'overflow-x-auto' : 'overflow-x-hidden'}`}>
        <div className={`mx-auto h-full min-h-0 w-full ${
          activePane === 'aicommit'
            ? 'min-w-[1060px] max-w-[1640px]'
            : 'min-w-0 max-w-[1360px]'
        }`}>
          {activePane === 'code' ? (
            <CodeWorkspacePanel projectId={project.id} projectPath={project.path} themeMode={themeMode} />
          ) : (
            <DetailAiCommitPanel
              rightPaneMode={rightPaneMode}
              setRightPaneMode={setRightPaneMode}
              jumpToAiLogToken={jumpToAiLogToken}
              flowNodes={flowNodes}
              flowEdges={flowEdges}
              aiRawText={aiRawText}
              statusClass={statusClass}
              statusText={statusText}
              gitSnapshot={gitSnapshot}
              gitSnapshotLoading={gitSnapshotLoading}
              gitSnapshotError={gitSnapshotError}
              onRefreshGitSnapshot={() => void refreshGitSnapshot()}
              activeCommitHash={activeCommitHash}
              setActiveCommitHash={setActiveCommitHash}
              flowApiRef={flowApiRef}
              flowViewportReadyRef={flowViewportReadyRef}
              flowInitialFocusDoneRef={flowInitialFocusDoneRef}
              flowLastFocusedStepRef={flowLastFocusedStepRef}
              aiCommitStatus={aiCommitStatus}
              isAiEnabled={isAiEnabled}
              aiAutoCommitButtonRef={quickButtonRef}
              onAiAutoCommit={() => {
                void handleAiCommit()
              }}
              onAiAutoCommitContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (aiCommitStatus === 'running') return
                setMenuPos(null)
                const panelWidth = 260
                const panelHeight = 320
                const x = Math.max(8, Math.min(e.clientX, window.innerWidth - panelWidth - 8))
                const y = Math.max(8, Math.min(e.clientY, window.innerHeight - panelHeight - 8))
                setQuickConfigPos({ x, y })
                setQuickConfigOpen(true)
              }}
            />
          )}
        </div>
      </div>

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
    </div>
  )
}
