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
>

// Pending "start Docker?" prompt kept out of the store (non-serializable).
let dockerPromptResolver: ((proceed: boolean) => void) | null = null
let dockerPromptPayload: { projectPath: string; tasks: RunTask[] } | null = null
// Optimistic starting/waiting marks: set the moment the user clicks start
// (before the docker preflight) so the UI never looks stuck. Protected from
// reconciling until the scheduler actually advances the tasks, a rollback
// happens, or the grace window expires.
let optimisticStartProjectId: string | null = null
let optimisticStartTaskIds: Set<string> | null = null
const OPTIMISTIC_START_GRACE_MS = 30_000
// In-flight background Docker launch (from a confirmed prompt).
let dockerLaunchPromise: Promise<boolean> | null = null
// After the launch settles the scheduler session still holds 'idle' task
// placeholders until it actually advances a task; the grace window keeps
// reconciling from snapping the optimistic marks back meanwhile.
let dockerLaunchGraceUntil = 0

type RunTaskTaskState = NonNullable<RunTaskProgressEvent['tasks'][string]>

/**
 * Per-field equality for a single task state. Reconcile and progress events
 * frequently repeat an unchanged snapshot; treating it as equal lets zustand
 * keep the old reference so subscribed dialogs and pages skip re-rendering.
 */
function isSameTaskState(a: RunTaskTaskState | undefined, b: RunTaskTaskState | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.state !== b.state || a.url !== b.url || a.error !== b.error || a.warning !== b.warning || a.startedAt !== b.startedAt) return false
  const aUrls = a.urls
  const bUrls = b.urls
  if (aUrls === bUrls) return true
  if (!aUrls || !bUrls || aUrls.length !== bUrls.length) return false
  return aUrls.every((url, index) => url === bUrls[index])
}

function clearOptimisticStart(projectId: string): void {
  if (projectId !== optimisticStartProjectId) return
  optimisticStartProjectId = null
  optimisticStartTaskIds = null
}

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

  // A background launch from an earlier confirmed prompt may still be in
  // flight — wait for it instead of prompting the user again.
  if (dockerLaunchPromise) {
    const ready = await dockerLaunchPromise
    return ready ? { ok: true } : { ok: false, error: 'Docker is not running.' }
  }

  const proceed = await get().requestDockerLaunch(projectPath, tasks)
  if (!proceed) return { ok: false, error: 'Docker is not running.' }
  return { ok: true }
}

export const createRunTaskActionsSlice: StateCreator<AppState, [], [], RunTaskActionsSlice> = (set, get) => ({
  runTaskConfigs: {},
  runTaskStates: {},
  dockerPrompt: false,

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
    // Mark starting immediately, before the docker preflight — whether or not
    // the docker prompt interrupts, the click must show up in the UI at once.
    optimisticStartProjectId = projectId
    optimisticStartTaskIds = new Set([task.id])
    dockerLaunchGraceUntil = Date.now() + OPTIMISTIC_START_GRACE_MS
    set((state) => ({
      runTaskStates: {
        ...state.runTaskStates,
        [projectId]: {
          ...(state.runTaskStates[projectId] ?? {}),
          [task.id]: { state: 'starting', startedAt: Date.now() },
        },
      },
    }))

    const docker = await ensureDockerBeforeStart(get, projectPath, [task])
    if (!docker.ok) {
      set((state) => {
        const current = state.runTaskStates[projectId]
        if (!current?.[task.id]) return state
        const next = { ...current }
        delete next[task.id]
        return { runTaskStates: { ...state.runTaskStates, [projectId]: next } }
      })
      clearOptimisticStart(projectId)
      return false
    }

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
    // Optimistically mark every enabled task starting/waiting — before the
    // docker preflight, so the click always shows up immediately. Disabled
    // tasks stay untouched.
    const launchable = tasks.filter((task) => task.enabled !== false)
    optimisticStartProjectId = projectId
    optimisticStartTaskIds = new Set(launchable.map((task) => task.id))
    dockerLaunchGraceUntil = Date.now() + OPTIMISTIC_START_GRACE_MS
    set((state) => ({
      runTaskStates: {
        ...state.runTaskStates,
        [projectId]: Object.fromEntries(launchable.map((task) => [task.id, { state: task.dependsOn?.length ? 'waiting' : 'starting', startedAt: Date.now() }])),
      },
    }))

    const docker = await ensureDockerBeforeStart(get, projectPath, launchable)
    if (!docker.ok) {
      set((state) => {
        const current = state.runTaskStates[projectId]
        if (!current) return state
        const next: AppState['runTaskStates'][string] = {}
        for (const [taskId, taskState] of Object.entries(current)) {
          next[taskId] = taskState.state === 'starting' || taskState.state === 'waiting' ? { state: 'stopped' as const } : { ...taskState }
        }
        return { runTaskStates: { ...state.runTaskStates, [projectId]: next } }
      })
      clearOptimisticStart(projectId)
      return { started: false, error: docker.error }
    }

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
      clearOptimisticStart(projectId)
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
      const current = state.runTaskStates[event.projectId]
      // Skip the write entirely when every incoming task state matches what we
      // already hold — repeated progress events and the periodic reconcile then
      // keep the old reference and subscribers don't re-render.
      if (current) {
        const allSame = Object.entries(event.tasks).every(([taskId, taskState]) => isSameTaskState(current[taskId], taskState))
        if (allSame) return state
      }
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
    // Once every optimistically marked task has been advanced by the
    // scheduler (event carries it non-idle), the real state stream owns the
    // UI again — lift the reconcile protection.
    if (event.projectId === optimisticStartProjectId && optimisticStartTaskIds) {
      const allAdopted = [...optimisticStartTaskIds].every((taskId) => {
        const taskState = event.tasks[taskId]
        return taskState !== undefined && taskState.state !== 'idle'
      })
      if (allAdopted) clearOptimisticStart(event.projectId)
    }
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
        // While the optimistic start marks are protected (docker prompt open,
        // background docker launch in flight, or just settled and the
        // scheduler session still holds 'idle' placeholders), adopting the
        // snapshot — or the no-session cleanup — would snap the marked tasks
        // back to "not started". Skip until the scheduler advances the tasks
        // (updateRunTaskStates lifts the protection) or the grace expires.
        const startProtectionActive = projectId === optimisticStartProjectId && (dockerLaunchPromise !== null || get().dockerPrompt || Date.now() < dockerLaunchGraceUntil)
        if (startProtectionActive) return
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

  requestDockerLaunch: (projectPath, tasks) => {
    return new Promise<boolean>((resolve) => {
      dockerPromptResolver = resolve
      dockerPromptPayload = { projectPath, tasks }
      set({ dockerPrompt: true })
    })
  },

  cancelDockerLaunch: () => {
    dockerPromptResolver?.(false)
    dockerPromptResolver = null
    dockerPromptPayload = null
    set({ dockerPrompt: false })
  },

  // Confirming closes the prompt right away; Docker Desktop launches in the
  // background and the awaiting start action resumes once the daemon is ready.
  confirmDockerLaunch: async () => {
    const payload = dockerPromptPayload
    const resolver = dockerPromptResolver
    if (!payload || !resolver) return
    dockerPromptResolver = null
    dockerPromptPayload = null
    set({ dockerPrompt: false })

    // Re-assert the starting/waiting marks (they were set at click time) so
    // cards and the dialog keep showing the tasks as launching.
    const projectId = get().projects.find((item) => item.path === payload.projectPath)?.id ?? null
    const launchable = payload.tasks.filter((task) => task.enabled !== false)
    if (projectId) {
      optimisticStartProjectId = projectId
      optimisticStartTaskIds = new Set(launchable.map((task) => task.id))
      set((state) => ({
        runTaskStates: {
          ...state.runTaskStates,
          [projectId]: Object.fromEntries(launchable.map((task) => [task.id, { state: task.dependsOn?.length ? 'waiting' : 'starting', startedAt: Date.now() } as RunTaskTaskState])),
        },
      }))
    }

    dockerLaunchPromise = window.electronAPI
      .startDockerDaemon(payload.projectPath, payload.tasks)
      .then((result) => result.ready)
      .catch(() => false)
    const ready = await dockerLaunchPromise
    dockerLaunchPromise = null
    dockerLaunchGraceUntil = ready ? Date.now() + OPTIMISTIC_START_GRACE_MS : 0
    resolver(ready)

    if (!ready && projectId) {
      clearOptimisticStart(projectId)
      // Docker launch failed — roll the optimistic marks back instead of
      // leaving the cards stuck on "starting" forever.
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
  },
})
