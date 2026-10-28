import { useCallback, useEffect, useMemo, useState } from 'react'
import { defaultAiRuntimeProfiles, getAiRuntimeProfileCli, getAiRuntimeProfileLabel, resolveAiRuntimeProfile, resolveProjectAiRuntimeProfileId } from '../../../shared/aiRuntimeProfiles'
import type { CliTool, ProjectInfo } from '../../../shared/types'
import { CardContextMenu } from '../../components/CardContextMenu'
import { isTmuxRuntimeEntry } from '../../lib/runtimePresentation'
import { useAppStore } from '../../stores/appStore'

const DEFAULT_AI_RUNTIME_PROFILE_OPTION_VALUE = '__default_ai_runtime_profile__'

type SessionProjectContextTarget = Pick<ProjectInfo, 'id' | 'path' | 'pinned' | 'aiRuntimeProfileId' | 'cli'>

/** 会话页复用首页项目卡的右键菜单：状态 flag 与动作组装对齐 ProjectCard。 */
export function SessionProjectContextMenu({ project, position, onClose }: { project: SessionProjectContextTarget; position: { x: number; y: number }; onClose: () => void }) {
  const devStatus = useAppStore((s) => s.processes[project.id]?.status ?? 'stopped')
  const runTaskStates = useAppStore((s) => s.runTaskStates[project.id])
  const startAllRunTasks = useAppStore((s) => s.startAllRunTasks)
  const stopAllRunTasks = useAppStore((s) => s.stopAllRunTasks)
  const stopProject = useAppStore((s) => s.stopProject)
  const startRuntime = useAppStore((s) => s.startRuntime)
  const stopRuntime = useAppStore((s) => s.stopRuntime)
  const openTerminal = useAppStore((s) => s.openTerminal)
  const setProjectCli = useAppStore((s) => s.setProjectCli)
  const setProjectAiRuntimeProfile = useAppStore((s) => s.setProjectAiRuntimeProfile)
  const togglePin = useAppStore((s) => s.togglePin)
  const aiRuntimeProfilesConfig = useAppStore((s) => s.config.aiRuntimeProfiles ?? [])
  const activeAiRuntimeProfileId = useAppStore((s) => s.config.activeAiRuntimeProfileId)
  const session = useAppStore((s) => s.sessions[project.id])
  const runtimeEntry = useAppStore((s) => s.runtimeEntries[project.id])
  const aiEnvironmentMode = useAppStore((s) => s.config.aiEnvironment?.mode)

  const [isOpeningTerminal, setIsOpeningTerminal] = useState(false)
  const [isStartingRuntime, setIsStartingRuntime] = useState(false)
  const [isStoppingRuntime, setIsStoppingRuntime] = useState(false)
  const [aiCommitStatus, setAiCommitStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle')

  const aiRuntimeProfiles = aiRuntimeProfilesConfig.length > 0 ? aiRuntimeProfilesConfig : defaultAiRuntimeProfiles()
  const defaultRuntimeProfile = resolveAiRuntimeProfile(aiRuntimeProfiles, activeAiRuntimeProfileId)
  const defaultRuntimeProfileLabel = getAiRuntimeProfileLabel(defaultRuntimeProfile)
  const defaultRuntimeProfileCli: CliTool = getAiRuntimeProfileCli(defaultRuntimeProfile)
  const hasProjectAiRuntimeOverride = Boolean(project.aiRuntimeProfileId?.trim() || project.cli)
  const currentRuntimeProfileId = resolveProjectAiRuntimeProfileId(project, activeAiRuntimeProfileId)
  const currentRuntimeProfile = resolveAiRuntimeProfile(aiRuntimeProfiles, currentRuntimeProfileId, project.cli)
  const currentRuntimeProfileLabel = getAiRuntimeProfileLabel(currentRuntimeProfile, project.cli)
  const currentCli: CliTool = getAiRuntimeProfileCli(currentRuntimeProfile, project.cli)

  const isRuntimeActive = session?.status === 'attached' || session?.status === 'detached'
  const usesTmuxRuntime = isTmuxRuntimeEntry(runtimeEntry, aiEnvironmentMode)
  const isDevRunning = devStatus === 'running'
  const isDevStopping = devStatus === 'stopping'
  const activeRunTaskIds = useMemo(() => {
    if (!runTaskStates) return [] as string[]
    return Object.entries(runTaskStates)
      .filter(([, item]) => item.state === 'starting' || item.state === 'waiting' || item.state === 'ready' || item.state === 'running' || item.state === 'stopping')
      .map(([taskId]) => taskId)
  }, [runTaskStates])
  const isAnyRunTaskStopping = Boolean(runTaskStates && Object.values(runTaskStates).some((item) => item.state === 'stopping'))
  const runTasksActive = activeRunTaskIds.length > 0
  const isMenuDevRunning = isDevRunning || runTasksActive
  const isMenuDevStopping = isDevStopping || isAnyRunTaskStopping

  const resolveSelectedRuntimeProfileId = useCallback((profileId: string) => (profileId === DEFAULT_AI_RUNTIME_PROFILE_OPTION_VALUE ? defaultRuntimeProfile.id : profileId), [defaultRuntimeProfile.id])

  const handleSelectAiRuntimeProfile = useCallback(
    (profileId: string) => {
      void setProjectAiRuntimeProfile(project.id, profileId === DEFAULT_AI_RUNTIME_PROFILE_OPTION_VALUE ? '' : profileId)
    },
    [project.id, setProjectAiRuntimeProfile],
  )

  const handleSwitchCli = useCallback(() => {
    const currentIndex = aiRuntimeProfiles.findIndex((profile) => profile.id === currentRuntimeProfile.id)
    const nextProfile = aiRuntimeProfiles[(currentIndex + 1 + aiRuntimeProfiles.length) % aiRuntimeProfiles.length]
    if (nextProfile) {
      void setProjectAiRuntimeProfile(project.id, nextProfile.id)
      return
    }
    void setProjectCli(project.id, currentCli === 'codex' ? 'claude' : 'codex')
  }, [aiRuntimeProfiles, currentCli, currentRuntimeProfile.id, project.id, setProjectAiRuntimeProfile, setProjectCli])

  const handleUseAiRuntimeProfileOnce = useCallback(
    async (profileId: string) => {
      await startRuntime(project.id, resolveSelectedRuntimeProfileId(profileId))
    },
    [project.id, resolveSelectedRuntimeProfileId, startRuntime],
  )

  const handleSwitchAndUseAiRuntimeProfile = useCallback(
    async (profileId: string) => {
      const projectProfileId = profileId === DEFAULT_AI_RUNTIME_PROFILE_OPTION_VALUE ? '' : profileId
      await setProjectAiRuntimeProfile(project.id, projectProfileId)
      await startRuntime(project.id, resolveSelectedRuntimeProfileId(profileId))
    },
    [project.id, resolveSelectedRuntimeProfileId, setProjectAiRuntimeProfile, startRuntime],
  )

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

  const handleCardRun = useCallback(() => {
    void startAllRunTasks(project.id, project.path)
  }, [project.id, project.path, startAllRunTasks])

  const handleCardStop = useCallback(() => {
    if (runTasksActive) {
      void stopAllRunTasks(project.id)
      return
    }
    void stopProject(project.id)
  }, [project.id, runTasksActive, stopAllRunTasks, stopProject])

  const handleAiAutoCommit = useCallback(async () => {
    if (aiCommitStatus === 'running') return
    try {
      setAiCommitStatus('running')
      const ok = await window.electronAPI.runAiCommit(project.id, project.path)
      if (!ok) setAiCommitStatus('error')
    } catch (err) {
      console.error('[SessionProjectContextMenu] ai auto commit failed:', err)
      setAiCommitStatus('error')
    }
  }, [aiCommitStatus, project.id, project.path])

  useEffect(() => {
    const api = window.electronAPI

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

  return (
    <CardContextMenu
      x={position.x}
      y={position.y}
      onClose={onClose}
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
      onStartProject={handleCardRun}
      onStopProject={handleCardStop}
      onAiAutoCommit={handleAiAutoCommit}
      aiCommitStatus={aiCommitStatus}
      onOpenFolder={() => window.electronAPI.openFolder(project.path)}
      onOpenPathTerminal={async () => {
        await window.electronAPI.openPathTerminal(project.path)
      }}
      onOpenVsCode={() => window.electronAPI.openInVsCode(project.path)}
      onTogglePin={() => togglePin(project.id)}
    />
  )
}
