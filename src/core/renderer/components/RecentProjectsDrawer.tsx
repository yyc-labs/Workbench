import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Clock3, Trash2, X } from 'lucide-react'
import { shallow } from 'zustand/shallow'
import { middleTruncatePath, projectDisplayName } from '../lib/projectDisplay'
import type { AiCommitStatus, CliTool, ProjectInfo } from '../../shared/types'
import { useAppStore } from '../stores/appStore'
import { CardContextMenu } from './CardContextMenu'
import { ProjectMetaDialog } from './ProjectMetaDialog'
import { isTmuxRuntimeEntry } from '../lib/runtimePresentation'
import { useI18n } from '../i18n'
import {
  defaultAiRuntimeProfiles,
  getAiRuntimeProfileCli,
  getAiRuntimeProfileLabel,
  resolveAiRuntimeProfile,
  resolveProjectAiRuntimeProfileId,
} from '../../shared/aiRuntimeProfiles'

type RecentProjectDrawerCardProps = {
  project: RecentProjectListItem
  isContextActive: boolean
  onSelectProject: (projectId: string) => void
  onRemoveProject: (projectId: string) => void
  onOpenContextMenu: (projectId: string, x: number, y: number) => void
}

type RecentProjectsDrawerProps = {
  open: boolean
  currentProjectId?: string
  onClose: () => void
  onSelectProject: (projectId: string) => void
  onRemoveProject: (projectId: string) => void
}

type RecentProjectListItem = Pick<ProjectInfo, 'id' | 'path' | 'name' | 'customName' | 'lastOpened'>

type ContextMenuState = {
  projectId: string
  x: number
  y: number
}

type RecentProjectsContextMenuProps = {
  contextMenu: ContextMenuState
  project: ProjectInfo
  onClose: () => void
  onEditMetadata: (projectId: string) => void
}

type RecentProjectsMetaDialogHostProps = {
  projectId: string
  onClose: () => void
}

const DRAWER_TRANSITION_MS = 220
const DRAWER_CONTENT_REVEAL_MS = 70
const EMPTY_RECENT_PROJECTS: RecentProjectListItem[] = []

function getProjectById(projects: ProjectInfo[], projectId?: string | null): ProjectInfo | undefined {
  if (!projectId) return undefined
  return projects.find((project) => project.id === projectId)
}

const RecentProjectDrawerCard = memo(function RecentProjectDrawerCard({
  project,
  isContextActive,
  onSelectProject,
  onRemoveProject,
  onOpenContextMenu,
}: RecentProjectDrawerCardProps) {
  const { t, formatDateTime } = useI18n()

  return (
    <div
      className={`recent-project-drawer-item ${isContextActive ? 'is-context-active' : ''}`}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onOpenContextMenu(project.id, event.clientX, event.clientY)
      }}
    >
      <button
        type="button"
        className="recent-project-drawer-open"
        onClick={() => onSelectProject(project.id)}
        title={project.path}
      >
        <span className="recent-project-drawer-name">{projectDisplayName(project)}</span>
        <span className="recent-project-drawer-meta">
          <span>{middleTruncatePath(project.path, 24, 18)}</span>
          <span>·</span>
          <span>{project.lastOpened ? formatDateTime(project.lastOpened) : t('common.notOpened')}</span>
        </span>
      </button>
      <button
        type="button"
        className="recent-project-drawer-remove"
        title={t('common.removeFromRecent')}
        onClick={() => onRemoveProject(project.id)}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
})

const RecentProjectsContextMenu = memo(function RecentProjectsContextMenu({
  contextMenu,
  project,
  onClose,
  onEditMetadata,
}: RecentProjectsContextMenuProps) {
  const startProject = useAppStore((s) => s.startProject)
  const stopProject = useAppStore((s) => s.stopProject)
  const startRuntime = useAppStore((s) => s.startRuntime)
  const stopRuntime = useAppStore((s) => s.stopRuntime)
  const openTerminal = useAppStore((s) => s.openTerminal)
  const setProjectCli = useAppStore((s) => s.setProjectCli)
  const setProjectAiRuntimeProfile = useAppStore((s) => s.setProjectAiRuntimeProfile)
  const togglePin = useAppStore((s) => s.togglePin)
  const devStatus = useAppStore((s) => s.processes[project.id]?.status ?? 'stopped')
  const session = useAppStore((s) => s.sessions[project.id])
  const runtimeEntry = useAppStore((s) => s.runtimeEntries[project.id])
  const aiEnvironmentMode = useAppStore((s) => s.config.aiEnvironment?.mode)
  const aiRuntimeProfilesConfig = useAppStore((s) => s.config.aiRuntimeProfiles ?? [])
  const activeAiRuntimeProfileId = useAppStore((s) => s.config.activeAiRuntimeProfileId)
  const [isOpeningTerminal, setIsOpeningTerminal] = useState(false)
  const [isStartingRuntime, setIsStartingRuntime] = useState(false)
  const [isStoppingRuntime, setIsStoppingRuntime] = useState(false)

  const aiRuntimeProfiles = aiRuntimeProfilesConfig.length > 0 ? aiRuntimeProfilesConfig : defaultAiRuntimeProfiles()
  const defaultRuntimeProfile = resolveAiRuntimeProfile(aiRuntimeProfiles, activeAiRuntimeProfileId)
  const defaultRuntimeProfileLabel = getAiRuntimeProfileLabel(defaultRuntimeProfile)
  const defaultRuntimeProfileCli: CliTool = getAiRuntimeProfileCli(defaultRuntimeProfile)
  const hasProjectAiRuntimeOverride = Boolean(project.aiRuntimeProfileId?.trim() || project.cli)
  const currentRuntimeProfileId = resolveProjectAiRuntimeProfileId(project, activeAiRuntimeProfileId)
  const currentRuntimeProfile = resolveAiRuntimeProfile(aiRuntimeProfiles, currentRuntimeProfileId, project.cli)
  const currentRuntimeProfileLabel = getAiRuntimeProfileLabel(currentRuntimeProfile, project.cli)
  const currentCli: CliTool = getAiRuntimeProfileCli(currentRuntimeProfile, project.cli)
  const isDevRunning = devStatus === 'running'
  const isDevStopping = devStatus === 'stopping'
  const isRuntimeAttached = session?.status === 'attached'
  const isRuntimeDetached = session?.status === 'detached'
  const isRuntimeActive = isRuntimeAttached || isRuntimeDetached
  const usesTmuxRuntime = isTmuxRuntimeEntry(runtimeEntry, aiEnvironmentMode)
  const aiCommitStatus: AiCommitStatus = 'idle'

  const handleSelectAiRuntimeProfile = useCallback((profileId: string) => {
    void setProjectAiRuntimeProfile(project.id, profileId)
  }, [project.id, setProjectAiRuntimeProfile])

  const handleSwitchCli = useCallback(() => {
    const currentIndex = aiRuntimeProfiles.findIndex((profile) => profile.id === currentRuntimeProfile.id)
    const nextProfile = aiRuntimeProfiles[(currentIndex + 1 + aiRuntimeProfiles.length) % aiRuntimeProfiles.length]
    if (nextProfile) {
      void setProjectAiRuntimeProfile(project.id, nextProfile.id)
      return
    }
    void setProjectCli(project.id, currentCli === 'codex' ? 'claude' : 'codex')
  }, [aiRuntimeProfiles, currentCli, currentRuntimeProfile.id, project.id, setProjectAiRuntimeProfile, setProjectCli])

  const handleOpenTerminal = useCallback(async () => {
    if (isOpeningTerminal) return
    setIsOpeningTerminal(true)
    try {
      await openTerminal(project.id, session?.status)
    } finally {
      window.setTimeout(() => setIsOpeningTerminal(false), 400)
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
  }, [isStartingRuntime, project.id, startRuntime])

  const handleStopRuntime = useCallback(async () => {
    if (isStoppingRuntime) return
    setIsStoppingRuntime(true)
    try {
      await stopRuntime(project.id)
    } finally {
      setIsStoppingRuntime(false)
    }
  }, [isStoppingRuntime, project.id, stopRuntime])

  return (
    <CardContextMenu
      x={contextMenu.x}
      y={contextMenu.y}
      onClose={onClose}
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
      aiCommitStatus={aiCommitStatus}
      onOpenFolder={() => window.electronAPI.openFolder(project.path)}
      onOpenPathTerminal={async () => {
        await window.electronAPI.openPathTerminal(project.path)
      }}
      onOpenVsCode={() => window.electronAPI.openInVsCode(project.path)}
      onTogglePin={() => togglePin(project.id)}
      onEditMetadata={() => onEditMetadata(project.id)}
    />
  )
})

const RecentProjectsMetaDialogHost = memo(function RecentProjectsMetaDialogHost({
  projectId,
  onClose,
}: RecentProjectsMetaDialogHostProps) {
  const project = useAppStore((s) => getProjectById(s.projects, projectId))
  const folders = useAppStore((s) => s.folders)
  const tags = useAppStore((s) => s.tags)
  const assignProjectFolder = useAppStore((s) => s.assignProjectFolder)
  const setProjectTags = useAppStore((s) => s.setProjectTags)
  const setProjectCustomName = useAppStore((s) => s.setProjectCustomName)
  const setProjectCustomType = useAppStore((s) => s.setProjectCustomType)

  if (!project) return null

  return (
    <ProjectMetaDialog
      open
      project={project}
      folders={folders}
      tags={tags}
      onClose={onClose}
      onAssignFolder={assignProjectFolder}
      onSetProjectTags={setProjectTags}
      onSetProjectCustomName={setProjectCustomName}
      onSetProjectCustomType={setProjectCustomType}
    />
  )
})

export function RecentProjectsDrawer({
  open,
  currentProjectId,
  onClose,
  onSelectProject,
  onRemoveProject,
}: RecentProjectsDrawerProps) {
  const { t } = useI18n()
  const [shouldRender, setShouldRender] = useState(open)
  const [visible, setVisible] = useState(open)
  const [contentVisible, setContentVisible] = useState(open)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [metaDialogProjectId, setMetaDialogProjectId] = useState<string | null>(null)
  const currentProject = useAppStore((s) => getProjectById(s.projects, currentProjectId))
  const recentProjects = useAppStore((s) => {
    if (!open && !shouldRender) return EMPTY_RECENT_PROJECTS
    return s.projects
      .filter((project) => project.id !== currentProjectId && typeof project.lastOpened === 'number')
      .sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0))
      .slice(0, 20)
  }, shallow)
  const contextMenuProjectId = contextMenu?.projectId
  const contextMenuProject = useAppStore((s) => getProjectById(s.projects, contextMenuProjectId))
  const metaDialogProject = useAppStore((s) => getProjectById(s.projects, metaDialogProjectId))

  const handleOpenContextMenu = useCallback((projectId: string, x: number, y: number) => {
    setContextMenu({ projectId, x, y })
  }, [])

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  useEffect(() => {
    if (open) {
      setShouldRender(true)
      setContentVisible(false)
      const enterTimer = window.setTimeout(() => setVisible(true), 16)
      const revealTimer = window.setTimeout(() => setContentVisible(true), DRAWER_CONTENT_REVEAL_MS)
      return () => {
        window.clearTimeout(enterTimer)
        window.clearTimeout(revealTimer)
      }
    }
    setContentVisible(false)
    setVisible(false)
    const closeTimer = window.setTimeout(() => setShouldRender(false), DRAWER_TRANSITION_MS)
    return () => {
      window.clearTimeout(closeTimer)
    }
  }, [open])

  useEffect(() => {
    if (!shouldRender) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [shouldRender, onClose])

  useEffect(() => {
    if (open) return
    setContextMenu(null)
    setMetaDialogProjectId(null)
  }, [open])

  useEffect(() => {
    if (!contextMenuProjectId || contextMenuProject) return
    setContextMenu(null)
  }, [contextMenuProject, contextMenuProjectId])

  useEffect(() => {
    if (!metaDialogProjectId || metaDialogProject) return
    setMetaDialogProjectId(null)
  }, [metaDialogProject, metaDialogProjectId])

  if (!shouldRender) return null

  return (
    <>
      <button
        type="button"
        data-allow-recent-gesture="true"
        className={`fixed inset-0 z-[89] bg-[color:var(--color-background-sunken)]/42 backdrop-blur-[3px] transition-opacity duration-200 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        aria-label={t('common.closeRecentProjectsBackdrop')}
        onClick={onClose}
      />

      <aside
        className={`recent-project-drawer ${visible ? 'is-open' : ''}`}
        data-allow-recent-gesture="true"
        data-recent-project-drawer-open={open ? 'true' : 'false'}
      >
        <div className={`flex h-full min-h-0 flex-col transition-opacity duration-150 ${contentVisible ? 'opacity-100' : 'opacity-0'}`}>
          <div className="recent-project-drawer-header">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[color:var(--color-foreground)]">{t('common.recentProjects')}</p>
              <p className="text-[11px] text-[color:var(--color-muted-foreground)]">{t('common.recentProjectsHint')}</p>
            </div>
            <div
              className="recent-project-drawer-current"
              title={currentProject?.path}
              aria-label={currentProject ? `${t('common.currentProject')}: ${projectDisplayName(currentProject)}` : undefined}
            >
              {currentProject ? projectDisplayName(currentProject) : null}
            </div>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background)]/72 text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
              onClick={onClose}
              title={t('common.close')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="recent-project-drawer-content">
            {recentProjects.length === 0 ? (
              <div className="recent-project-drawer-empty">
                <Clock3 className="h-4 w-4" />
                <span>{t('common.noRecentProjects')}</span>
              </div>
            ) : (
              <div className="recent-project-drawer-list">
                {recentProjects.map((project) => (
                  <RecentProjectDrawerCard
                    key={project.id}
                    project={project}
                    isContextActive={contextMenuProjectId === project.id}
                    onSelectProject={onSelectProject}
                    onRemoveProject={onRemoveProject}
                    onOpenContextMenu={handleOpenContextMenu}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>

      {contextMenu && contextMenuProject && (
        <RecentProjectsContextMenu
          contextMenu={contextMenu}
          project={contextMenuProject}
          onClose={handleCloseContextMenu}
          onEditMetadata={setMetaDialogProjectId}
        />
      )}

      {metaDialogProjectId && (
        <RecentProjectsMetaDialogHost
          projectId={metaDialogProjectId}
          onClose={() => setMetaDialogProjectId(null)}
        />
      )}
    </>
  )
}
