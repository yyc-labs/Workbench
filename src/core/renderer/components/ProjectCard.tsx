import { memo, useState, useCallback, useEffect, useMemo } from 'react'
import type {
  AiCommitTaskSnapshot,
  CliTool,
  ProjectFolder,
  ProjectInfo,
  ProjectTag,
} from '../../shared/types'
import { useAppStore } from '../stores/appStore'
import { ArrowUpRight, Play, Square, Folder, Sparkles, Terminal, MoreHorizontal, BookOpen, RefreshCw } from 'lucide-react'
import { UrlPopover } from './UrlPopover'
import { CardContextMenu } from './CardContextMenu'
import { ProjectDocLinksDialog } from './ProjectDocLinksDialog'
import { ProjectMetaDialog } from './ProjectMetaDialog'
import { RunCommandConfigPopover } from './RunCommandConfigPopover'
import { middleTruncatePath, projectDisplayName, projectDisplayType } from '../lib/projectDisplay'
import { normalizeProjectDocLinkTag, projectDocLinkCopyValue, projectDocLinkTagLabel, projectDocLinkTarget } from '../lib/projectDocLinks'
import { isTmuxRuntimeEntry } from '../lib/runtimePresentation'
import { useI18n } from '../i18n'
import { useProjectDevUrlLauncher } from '../hooks/useProjectDevUrlLauncher'
import { useProjectDocLinks } from '../pages/detail/useProjectDocLinks'

interface ProjectCardProps {
  project: ProjectInfo
  folders?: ProjectFolder[]
  tags?: ProjectTag[]
  onSelect: (id: string) => void
  index?: number
}

function ProjectCardInner({ project, folders = [], tags = [], onSelect, index = 0 }: ProjectCardProps) {
  const { t } = useI18n()
  const devStatus = useAppStore((s) => s.processes[project.id]?.status ?? 'stopped')
  const devUrls = useAppStore((s) => s.processUrls[project.id] || [])
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
  const docLinkTagOptions = useAppStore((s) => s.config.docLinkTags)
  const { handleGetDocLinkSecret, handleOpenDocLink } = useProjectDocLinks({ project })

  const currentCli: CliTool = project.cli || 'claude'

  const session = useAppStore((s) => s.sessions[project.id])
  const runtimeEntry = useAppStore((s) => s.runtimeEntries[project.id])
  const aiEnvironmentMode = useAppStore((s) => s.config.aiEnvironment?.mode)
  const isRuntimeAttached = session?.status === 'attached'
  const isRuntimeDetached = session?.status === 'detached'
  const isRuntimeActive = isRuntimeAttached || isRuntimeDetached
  const usesTmuxRuntime = isTmuxRuntimeEntry(runtimeEntry, aiEnvironmentMode)
  const runtimeLabel = isRuntimeAttached ? t('common.active') : isRuntimeDetached ? t('common.background') : t('common.offline')
  const accentColor = isRuntimeAttached
    ? 'var(--color-success)'
    : isRuntimeDetached
      ? 'var(--color-warning)'
      : 'var(--color-primary)'
  const runtimeColorClass = isRuntimeAttached
    ? 'text-[color:var(--color-success)]'
    : isRuntimeDetached
      ? 'text-[color:var(--color-warning)]'
      : 'text-[color:var(--color-muted-foreground)]'
  const runtimeDotClass = isRuntimeAttached
    ? 'bg-[color:var(--color-success)]'
    : isRuntimeDetached
      ? 'bg-[color:var(--color-warning)]'
      : 'bg-[color:var(--color-muted-foreground)]/45'

  const handleSwitchCli = useCallback(() => {
    setProjectCli(project.id, currentCli === 'codex' ? 'claude' : 'codex')
  }, [project.id, currentCli, setProjectCli])

  const togglePin = useAppStore((s) => s.togglePin)
  const removeProject = useAppStore((s) => s.removeProject)
  const isDevRunning = devStatus === 'running'
  const isDevStopping = devStatus === 'stopping'
  const isDevReady = isDevRunning && devUrls.length > 0
  const docLinks = project.docLinks ?? []
  const defaultDocLink = docLinks[0]
  const linkMenuItems = useMemo(
    () => [
      ...(isDevReady ? devUrls.map((url) => ({ url, label: `Dev: ${url}` })) : []),
      ...docLinks.map((link) => {
        const normalizedTag = normalizeProjectDocLinkTag(link.tag, docLinkTagOptions)
        const isSsh = (link.kind ?? 'url') === 'ssh'
        return {
          url: link.url ?? '',
          label: `${isSsh ? t('documentation.connectSsh') : t('project.docCategoryPrefix')} · ${link.title}`,
          tag: normalizedTag,
          tagLabel: projectDocLinkTagLabel(normalizedTag, docLinkTagOptions),
          onOpen: () => handleOpenDocLink(link),
          kind: link.kind ?? 'url',
          description: projectDocLinkTarget(link),
          copyValue: isSsh ? undefined : projectDocLinkCopyValue(link),
          copyLabel: isSsh ? t('documentation.copyPassword') : undefined,
          copyValueResolver: isSsh && link.hasSecret
            ? async () => await handleGetDocLinkSecret(link.id) || ''
            : undefined,
        }
      }),
    ],
    [devUrls, docLinkTagOptions, docLinks, handleGetDocLinkSecret, handleOpenDocLink, isDevReady, t]
  )
  const hasProjectDocLinks = docLinks.length > 0
  const hoverDocLabel = defaultDocLink
    ? `${t('project.runtimeDocsPrefix')} ${defaultDocLink.title}`
    : docLinks.length > 0
      ? t('project.docsCount', { count: docLinks.length })
      : null

  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [menuAllowRemove, setMenuAllowRemove] = useState(false)
  const [runConfigOpen, setRunConfigOpen] = useState(false)
  const [isOpeningTerminal, setIsOpeningTerminal] = useState(false)
  const [isStartingRuntime, setIsStartingRuntime] = useState(false)
  const [isStoppingRuntime, setIsStoppingRuntime] = useState(false)
  const [metaDialogOpen, setMetaDialogOpen] = useState(false)
  const [docLinksDialogOpen, setDocLinksDialogOpen] = useState(false)
  const [aiCommitStatus, setAiCommitStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle')
  const handleOpenTerminal = useCallback(async () => {
    if (isOpeningTerminal) return
    setIsOpeningTerminal(true)
    try {
      await openTerminal(project.id, session?.status)
    } finally {
      setTimeout(() => setIsOpeningTerminal(false), 400)
    }
  }, [isOpeningTerminal, openTerminal, project.id, session?.status])

  const handleStartRuntime = useCallback(async () => {
    if (isStartingRuntime) return
    setIsStartingRuntime(true)
    try {
      await startRuntime(project.id)
    } finally {
      setIsStartingRuntime(false)
    }
  }, [isStartingRuntime, startRuntime, project.id])

  const handleStopRuntime = useCallback(async () => {
    if (isStoppingRuntime) return
    setIsStoppingRuntime(true)
    try {
      await stopRuntime(project.id)
    } finally {
      setIsStoppingRuntime(false)
    }
  }, [isStoppingRuntime, stopRuntime, project.id])

  useEffect(() => {
    const api = window.electronAPI as unknown as {
      onAiCommitStatus?: (
        cb: (d: { projectId: string; status: 'running' | 'success' | 'error' }) => void
      ) => () => void
      getAiCommitState?: (projectId: string) => Promise<AiCommitTaskSnapshot | null>
    }

    if (typeof api.onAiCommitStatus !== 'function') return

    const cleanup = api.onAiCommitStatus(({ projectId, status }) => {
      if (projectId !== project.id) return
      setAiCommitStatus(status)
    })

    void (async () => {
      if (typeof api.getAiCommitState !== 'function') return
      try {
        const state = await api.getAiCommitState(project.id)
        setAiCommitStatus(state?.status ?? 'idle')
      } catch {
        // ignore
      }
    })()

    return cleanup
  }, [project.id])

  const handleAiAutoCommit = useCallback(async () => {
    if (aiCommitStatus === 'running') return
    try {
      setAiCommitStatus('running')
      const ok = await window.electronAPI.runAiCommit(project.id, project.path)
      if (!ok) setAiCommitStatus('error')
    } catch (err) {
      console.error('[ProjectCard] ai auto commit failed:', err)
      setAiCommitStatus('error')
    }
  }, [aiCommitStatus, project.id, project.path])

  const {
    pendingOpenDevUrl,
    startAndOpenDevUrl,
  } = useProjectDevUrlLauncher({
    projectId: project.id,
    processStatus: devStatus,
    processUrls: devUrls,
    runStartupMode: project.runStartupMode,
    startProject,
  })

  const handleOpenFirstLink = useCallback(async () => {
    if (defaultDocLink) {
      await handleOpenDocLink(defaultDocLink)
    }
  }, [defaultDocLink, handleOpenDocLink])

  return (
    <div
      className="group relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 overflow-hidden rounded-[18px] px-4 py-3 cursor-pointer card-enter surface-card surface-card-hover"
      style={{
        animationDelay: `${index * 40}ms`,
        background: 'var(--color-card)',
        border: '1px solid var(--color-border)',
        backdropFilter: 'saturate(150%) blur(18px)',
        WebkitBackdropFilter: 'saturate(150%) blur(18px)',
        boxShadow: 'var(--shadow-card)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'color-mix(in srgb, var(--color-card) 88%, var(--color-primary) 5%)'
        e.currentTarget.style.borderColor = 'var(--color-border-hover)'
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.boxShadow = 'var(--shadow-card-hover)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--color-card)'
        e.currentTarget.style.borderColor = 'var(--color-border)'
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = 'var(--shadow-card)'
      }}
      onClick={() => onSelect(project.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenuAllowRemove(false)
        setMenuPos({ x: e.clientX, y: e.clientY })
      }}
    >
      <div
        className="pointer-events-none absolute inset-y-3 left-0 w-1 rounded-r-full opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: accentColor }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: 'linear-gradient(90deg, color-mix(in srgb, var(--color-primary) 7%, transparent), transparent 44%)',
        }}
      />
      <div
        className="quiet-control relative z-10 w-10 h-10 rounded-[14px] flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-[1.04]"
        style={{
          color: 'var(--color-primary)',
        }}
      >
        <Folder className="h-[18px] w-[18px]" strokeWidth={1.7} />
      </div>

      <div className="relative z-10 flex-1 min-w-0">
        <div className="flex min-w-0 items-center gap-2.5">
          <h3 className="text-[15px] font-medium text-[color:var(--color-foreground)] truncate">{projectDisplayName(project)}</h3>
          {project.pinned && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--color-warning)]" title={t('common.pinned')} />
          )}
          <span className={`inline-flex items-center gap-1 text-[10px] font-medium shrink-0 ${runtimeColorClass}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${runtimeDotClass}`} />
            {runtimeLabel}
          </span>
          {isDevReady && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-primary shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              {t('common.dev')}
            </span>
          )}
        </div>
        {project.tagIds && project.tagIds.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {project.tagIds.slice(0, 3).map((tagId) => {
              const tag = tags.find((item) => item.id === tagId)
              if (!tag) return null
              return (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[10px] text-[color:var(--color-muted-foreground)]"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: tag.color || 'var(--color-primary)' }}
                  />
                  {tag.name}
                </span>
              )
            })}
            {project.tagIds.length > 3 && (
              <span className="text-[10px] text-[color:var(--color-muted-foreground)]">
                +{project.tagIds.length - 3}
              </span>
            )}
          </div>
        )}
        <div className="mt-1.5 flex min-w-0 items-center gap-2 text-xs text-[color:var(--color-muted-foreground)]">
          <p className="min-w-0 flex-1 truncate" title={project.path}>{middleTruncatePath(project.path)}</p>
          <span className="shrink-0 text-[color:var(--color-muted-foreground)]/45">/</span>
          <span className="shrink-0 capitalize">{projectDisplayType(project) || t('project.unknownType')}</span>
          {project.packageManager && (
            <>
              <span className="shrink-0 text-[color:var(--color-muted-foreground)]/45">/</span>
              <span className="shrink-0">{project.packageManager}</span>
            </>
          )}
          {isRuntimeActive && session && usesTmuxRuntime && (
            <>
              <span className="hidden shrink-0 text-[color:var(--color-muted-foreground)]/45 opacity-0 transition-opacity duration-300 group-hover:opacity-100 md:inline">/</span>
              <span className="hidden max-w-0 shrink items-center gap-1 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-300 group-hover:max-w-[220px] group-hover:opacity-100 md:inline-flex">
                <Terminal className="h-3 w-3 shrink-0" />
                <span className="truncate">{session.sessionName}</span>
              </span>
            </>
          )}
          {hoverDocLabel && (
            <>
              <span className="hidden shrink-0 text-[color:var(--color-muted-foreground)]/45 opacity-0 transition-opacity duration-300 group-hover:opacity-100 lg:inline">/</span>
              <span className="hidden max-w-0 shrink items-center gap-1 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-300 group-hover:max-w-[180px] group-hover:opacity-100 lg:inline-flex">
                <BookOpen className="h-3 w-3 shrink-0" />
                <span className="truncate">{hoverDocLabel}</span>
              </span>
            </>
          )}
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
          isPinned={project.pinned}
          onStartRuntime={handleStartRuntime}
          onStopRuntime={handleStopRuntime}
          onOpenTerminal={handleOpenTerminal}
          onSwitchCli={handleSwitchCli}
          onStartProject={() => startProject(project.id)}
          onStopProject={() => stopProject(project.id)}
          onAiAutoCommit={handleAiAutoCommit}
          aiCommitStatus={aiCommitStatus}
          onOpenFolder={() => window.electronAPI.openFolder(project.path)}
          onOpenPathTerminal={async () => {
            await window.electronAPI.openPathTerminal(project.path)
          }}
          onOpenVsCode={() => window.electronAPI.openInVsCode(project.path)}
          onTogglePin={() => togglePin(project.id)}
          onRemoveProject={menuAllowRemove ? () => removeProject(project.id) : undefined}
          onEditMetadata={() => setMetaDialogOpen(true)}
        />
      )}

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

      {docLinksDialogOpen && (
        <ProjectDocLinksDialog
          open={docLinksDialogOpen}
          project={project}
          onClose={() => setDocLinksDialogOpen(false)}
        />
      )}

      <RunCommandConfigPopover
        project={project}
        open={runConfigOpen}
        onClose={() => setRunConfigOpen(false)}
      />

      <div className="relative z-10 flex items-center gap-1.5 shrink-0">
        <button
          className="quiet-control hidden h-8 items-center gap-1 rounded-full border-0 px-2.5 text-[11px] font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] md:inline-flex"
          onClick={(e) => { e.stopPropagation(); handleSwitchCli() }}
          title={`AI CLI: ${currentCli}`}
        >
          {currentCli === 'codex' ? (
            <Terminal className="h-3 w-3" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          {currentCli}
        </button>
        {hasProjectDocLinks && (
          <UrlPopover items={linkMenuItems}>
            <button
              className="quiet-control inline-flex h-8 w-8 items-center justify-center rounded-full border-0 text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] cursor-pointer"
              onClick={(e) => {
                e.stopPropagation()
                void handleOpenFirstLink()
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setDocLinksDialogOpen(true)
              }}
              title={t('common.leftClickOpenFirstLink')}
            >
              <BookOpen className="h-3.5 w-3.5 shrink-0" />
            </button>
          </UrlPopover>
        )}
        {(isDevReady || pendingOpenDevUrl || (!isDevRunning && !isDevStopping)) && (
          <button
            className={`quiet-control inline-flex h-8 w-8 items-center justify-center rounded-full border-0 transition-colors hover:bg-[color:var(--color-accent)] disabled:opacity-60 ${
              isDevReady
                ? 'text-primary hover:text-primary'
                : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
            }`}
            onClick={(e) => {
              e.stopPropagation()
              void startAndOpenDevUrl()
            }}
            title={isDevReady
              ? t('project.openDevUrl')
              : pendingOpenDevUrl
                ? t('project.waitingForDevUrl')
                : t('project.startAndOpenDevUrlShort')}
            aria-label={isDevReady
              ? t('project.openDevUrl')
              : pendingOpenDevUrl
                ? t('project.waitingForDevUrl')
                : t('project.startAndOpenDevUrlShort')}
            disabled={pendingOpenDevUrl}
          >
            {pendingOpenDevUrl ? (
              <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
            ) : (
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
            )}
          </button>
        )}
        {isDevRunning || isDevStopping ? (
          <button
            className={`h-8 px-3 text-xs rounded-full border flex items-center gap-1 font-medium transition-colors shrink-0 ${
              isDevStopping
                ? 'text-[color:var(--color-warning)] bg-[color:var(--color-warning-background)]'
                : isDevReady
                  ? 'text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-background)]'
                  : 'text-[color:var(--color-warning)] bg-[color:var(--color-warning-background)]'
            }`}
            style={{
              borderColor: isDevStopping || !isDevReady
                ? 'color-mix(in srgb, var(--color-warning) 34%, transparent)'
                : 'color-mix(in srgb, var(--color-destructive) 34%, transparent)',
            }}
            onClick={(e) => { e.stopPropagation(); if (!isDevStopping) stopProject(project.id) }}
            disabled={isDevStopping}
          >
            {isDevStopping ? <RefreshCw className="h-3 w-3 animate-spin" /> : isDevReady ? <Square className="h-3 w-3" /> : <RefreshCw className="h-3 w-3 animate-spin" />}
            <span className="hidden sm:inline">{isDevStopping ? t('common.stopping') : isDevReady ? t('common.stop') : t('common.starting')}</span>
          </button>
        ) : (
          <button
            className="h-8 px-3.5 text-xs rounded-full bg-primary text-white hover:bg-primary-hover flex items-center gap-1 font-medium transition-colors shrink-0 shadow-sm"
            onClick={(e) => { e.stopPropagation(); startProject(project.id) }}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setRunConfigOpen(true)
            }}
            title={t('common.leftClickRunRightClickConfig')}
          >
            <Play className="h-3 w-3" />
            <span className="hidden sm:inline">{t('common.run')}</span>
          </button>
        )}
        <button
          className="h-8 w-8 rounded-full flex items-center justify-center text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)] transition-colors"
          title={t('common.moreActions')}
          onClick={(e) => {
            e.stopPropagation()
            setMenuAllowRemove(true)
            setMenuPos({ x: e.clientX, y: e.clientY })
          }}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

export const ProjectCard = memo(ProjectCardInner)
