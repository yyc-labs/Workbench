import type { StateCreator } from 'zustand'
import type { RunTask, RunTaskConfigFile, RunTaskProgressEvent } from '../../shared/runTasks'
import { getEffectiveRunTasks, runTaskProcessKey } from '../../shared/runTasks'
import type { AppState } from './appStore.types'

export type RunTaskActionsSlice = Pick<
  AppState,
  | 'runTaskConfigs'
  | 'runTaskStates'
  | 'loadRunTaskConfig'
  | 'saveRunTaskConfig'
  | 'handleRunTaskConfigChanged'
  | 'detectRunTaskCandidates'
  | 'startRunTask'
  | 'startAllRunTasks'
  | 'stopRunTask'
  | 'stopAllRunTasks'
  | 'updateRunTaskStates'
  | 'reconcileRunTaskStates'
  | 'dockerPrompt'
  | 'requestDockerLaunch'
  | 'cancelDockerLaunch'
  | 'confirmDockerLaunch'
  | 'setDockerPrompt'
>

// Pending "start Docker?" prompt kept out of the store (non-serializable).
let dockerPromptResolver: ((proceed: boolean) => void) | null = null
let dockerPromptPayload: { projectPath: string; tasks: RunTask[] } | null = null

/**
 * Preflight for docker-based tasks: asks the main process to probe the daemon.
 * When docker is required but not running, shows the global launch prompt and
 * waits for the user's decision (confirm also launches Docker Desktop and
 * waits for readiness).
 */
async function ensureDockerBeforeStart(get: () => AppState, projectPath: string, tasks: RunTask[]): Promise<{ ok: boolean; error?: string }> {
  let check: { required: boolean; running: boolean }
  try {
    check = await window.electronAPI.checkRunTaskDocker(projectPath, tasks)
  } catch {
    // Preflight must never block the start path.
    return { ok: true }
  }
  if (!check.required || check.running) return { ok: true }

  const proceed = await new Promise<boolean>((resolve) => {
    dockerPromptResolver = resolve
    dockerPromptPayload = { projectPath, tasks }
    get().setDockerPrompt({ launching: false, error: null })
  })
  if (!proceed) return { ok: false, error: 'Docker is not running.' }
  return { ok: true }
}

export const createRunTaskActionsSlice: StateCreator<AppState, [], [], RunTaskActionsSlice> = (set, get) => ({
  runTaskConfigs: {},
  runTaskStates: {},
  dockerPrompt: null,

  loadRunTaskConfig: async (projectId, projectPath) => {
    const result = await window.electronAPI.getRunTaskConfig(projectPath)
    set((state) => ({
      runTaskConfigs: { ...state.runTaskConfigs, [projectId]: result.config },
    }))
    // Reconcile with the scheduler: adopt states of already-running tasks.
    const liveState = await window.electronAPI.getRunTaskState(projectId)
    if (liveState && Object.keys(liveState.tasks).length > 0) {
      get().updateRunTaskStates(liveState)
    }
    return result
  },

  saveRunTaskConfig: async (projectId, projectPath, tasks, scanDirectories) => {
    const result = await window.electronAPI.saveRunTaskConfig(projectPath, tasks, scanDirectories)
    if (result.config) {
      set((state) => ({
        runTaskConfigs: { ...state.runTaskConfigs, [projectId]: result.config as RunTaskConfigFile },
      }))
    }
    return result
  },

  /**
   * A project's run-task config file changed on disk (watcher event). Reload
   * the cached config so cards, link popovers and the dialog reflect external
   * edits (editor, agent, hand-written). The event carries the project path;
   * the project must already be known to the store.
   */
  handleRunTaskConfigChanged: async (projectPath) => {
    const project = get().projects.find((item) => item.path === projectPath)
    if (!project) return
    await get().loadRunTaskConfig(project.id, projectPath)
  },

  detectRunTaskCandidates: (projectPath, scanDirectories) => {
    return window.electronAPI.detectRunTaskCandidates(projectPath, scanDirectories)
  },

  startRunTask: async (projectId, projectPath, task) => {
    const docker = await ensureDockerBeforeStart(get, projectPath, [task])
    if (!docker.ok) return false

    const key = runTaskProcessKey(projectId, task.id)
    set((state) => ({
      processes: {
        ...state.processes,
        [key]: { pid: null, status: 'running', startTime: Date.now() },
      },
      terminalOutputs: {
        ...state.terminalOutputs,
        [key]: state.terminalOutputs[key] ?? '',
      },
      processUrls: {
        ...state.processUrls,
        [key]: state.processUrls[key] ?? [],
      },
      runTaskStates: {
        ...state.runTaskStates,
        [projectId]: {
          ...(state.runTaskStates[projectId] ?? {}),
          [task.id]: { state: 'starting', startedAt: Date.now() },
        },
      },
    }))
    const started = await window.electronAPI.startRunTask(projectId, projectPath, task)
    if (!started) {
      // Start never took off — drop the optimistic entry instead of leaving a
      // phantom task stuck on "starting".
      set((state) => {
        const current = state.runTaskStates[projectId]
        if (!current?.[task.id]) return state
        const next = { ...current }
        delete next[task.id]
        return { runTaskStates: { ...state.runTaskStates, [projectId]: next } }
      })
    }
    return started
  },

  startAllRunTasks: async (projectId, projectPath) => {
    // Unified start path: config-file tasks, or a synthesized default task for
    // legacy single-command projects — "Run" always goes through run tasks.
    const config = get().runTaskConfigs[projectId]
    const project = get().projects.find((item) => item.id === projectId)
    const { tasks: effectiveTasks } = getEffectiveRunTasks(project ?? {}, config)
    const tasks = effectiveTasks.map((item) => item.task)
    if (tasks.length === 0) {
      return { started: false, error: 'No run tasks configured.' }
    }
    // Optimistically mark every enabled task starting/waiting; the scheduler
    // event stream refines states. Disabled tasks stay untouched.
    const launchable = tasks.filter((task) => task.enabled !== false)

    const docker = await ensureDockerBeforeStart(get, projectPath, launchable)
    if (!docker.ok) {
      return { started: false, error: docker.error }
    }

    set((state) => ({
      runTaskStates: {
        ...state.runTaskStates,
        [projectId]: Object.fromEntries(launchable.map((task) => [task.id, { state: task.dependsOn?.length ? 'waiting' : 'starting', startedAt: Date.now() }])),
      },
    }))
    const result = await window.electronAPI.startAllRunTasks(projectId, projectPath, tasks)
    if (!result.started) {
      // The scheduler never created a session (cycle / manager missing / no
      // tasks) — roll the optimistic marks back instead of leaving the card
      // stuck on "starting" forever.
      set((state) => {
        const current = state.runTaskStates[projectId]
        if (!current) return state
        const next: AppState['runTaskStates'][string] = {}
        for (const [taskId, taskState] of Object.entries(current)) {
          next[taskId] = taskState.state === 'starting' || taskState.state === 'waiting' ? { state: 'stopped' as const } : { ...taskState }
        }
        return { runTaskStates: { ...state.runTaskStates, [projectId]: next } }
      })
    }
    return result
  },

  stopRunTask: async (projectId, taskId) => {
    set((state) => {
      const current = state.runTaskStates[projectId] ?? {}
      const taskState = current[taskId]
      if (!taskState) return state
      return {
        runTaskStates: {
          ...state.runTaskStates,
          [projectId]: { ...current, [taskId]: { ...taskState, state: 'stopping' } },
        },
      }
    })
    return window.electronAPI.stopRunTask(projectId, taskId)
  },

  stopAllRunTasks: async (projectId) => {
    set((state) => {
      const current = state.runTaskStates[projectId]
      if (!current) return state
      const next: AppState['runTaskStates'][string] = {}
      for (const [taskId, taskState] of Object.entries(current)) {
        next[taskId] = ['ready', 'running', 'starting', 'waiting'].includes(taskState.state) ? { ...taskState, state: 'stopping' } : { ...taskState }
      }
      return { runTaskStates: { ...state.runTaskStates, [projectId]: next } }
    })
    return window.electronAPI.stopAllRunTasks(projectId)
  },

  updateRunTaskStates: (event: RunTaskProgressEvent) => {
    set((state) => {
      const current = state.runTaskStates[event.projectId] ?? {}
      // Adopt each entry wholesale: the scheduler clears fields (e.g. urls
      // after a task settles) by omitting them, so a spread merge would let
      // stale values linger.
      const next = { ...current }
      for (const [taskId, taskState] of Object.entries(event.tasks)) {
        next[taskId] = taskState
      }
      return {
        runTaskStates: {
          ...state.runTaskStates,
          [event.projectId]: next,
        },
      }
    })
  },

  /**
   * Heal renderer-side run task states against the scheduler. Progress IPC
   * events can be missed (window transitions, dropped events), leaving a card
   * stuck on "running/starting" while nothing actually runs. The scheduler's
   * getState() reconciles missed exits on its side, so adopting its snapshot
   * is authoritative.
   */
  reconcileRunTaskStates: async () => {
    const projectIds = Object.keys(get().runTaskStates)
    if (projectIds.length === 0) return
    await Promise.all(
      projectIds.map(async (projectId) => {
        try {
          const live = await window.electronAPI.getRunTaskState(projectId)
          if (live && Object.keys(live.tasks).length > 0) {
            get().updateRunTaskStates(live)
            return
          }
          // No session on the scheduler side — anything still active here is stale.
          set((state) => {
            const current = state.runTaskStates[projectId]
            if (!current) return state
            const hasActive = Object.values(current).some((item) => item.state === 'starting' || item.state === 'waiting' || item.state === 'ready' || item.state === 'running' || item.state === 'stopping')
            if (!hasActive) return state
            const next: AppState['runTaskStates'][string] = {}
            for (const [taskId, taskState] of Object.entries(current)) {
              next[taskId] = taskState.state === 'stopped' || taskState.state === 'failed' ? { ...taskState } : { state: 'stopped' as const }
            }
            return { runTaskStates: { ...state.runTaskStates, [projectId]: next } }
          })
        } catch {
          // IPC hiccup — keep current states until the next tick.
        }
      }),
    )
  },

  setDockerPrompt: (prompt: { launching: boolean; error: string | null }) => {
    set({ dockerPrompt: prompt })
  },

  requestDockerLaunch: (projectPath, tasks) => {
    return new Promise<boolean>((resolve) => {
      dockerPromptResolver = resolve
      dockerPromptPayload = { projectPath, tasks }
      set({ dockerPrompt: { launching: false, error: null } })
    })
  },

  cancelDockerLaunch: () => {
    dockerPromptResolver?.(false)
    dockerPromptResolver = null
    dockerPromptPayload = null
    set({ dockerPrompt: null })
  },

  confirmDockerLaunch: async () => {
    const payload = dockerPromptPayload
    const resolver = dockerPromptResolver
    if (!payload || !resolver) return
    set({ dockerPrompt: { launching: true, error: null } })
    let result: { ready: boolean; error?: string }
    try {
      result = await window.electronAPI.startDockerDaemon(payload.projectPath, payload.tasks)
    } catch (err) {
      result = { ready: false, error: err instanceof Error ? err.message : String(err) }
    }
    if (result.ready) {
      resolver(true)
      dockerPromptResolver = null
      dockerPromptPayload = null
      set({ dockerPrompt: null })
      return
    }
    set({ dockerPrompt: { launching: false, error: result.error ?? 'Failed to start Docker.' } })
  },
})
