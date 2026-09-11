import type { RunStartupMode } from './types'

/**
 * Run task model — a project can declare multiple runnable tasks in a
 * `.yworkbench.json` file at the project root. Tasks form a dependency DAG
 * and are orchestrated by the main-process scheduler.
 *
 * Process key convention: `${projectId}::run::<taskId>` (see shared/types.ts
 * ManagedProcessSnapshot). Legacy single-command projects keep using the bare
 * `projectId` key and are synthesized into one default task on the fly.
 */

export const RUN_TASK_CONFIG_DIR_NAME = '.yworkbench'
export const RUN_TASK_CONFIG_FILE_NAME = 'run-tasks.json'
/** Legacy config location (project root `.yworkbench.json`); read as fallback only. */
export const RUN_TASK_LEGACY_CONFIG_FILE_NAME = '.yworkbench.json'

/** Absolute path of the per-project run task config file (POSIX-style join; fs accepts it on Windows). */
export function runTaskConfigFilePath(projectPath: string): string {
  return `${projectPath.replace(/[\\/]+$/, '')}/${RUN_TASK_CONFIG_DIR_NAME}/${RUN_TASK_CONFIG_FILE_NAME}`
}

export type RunTaskReadinessStrategy = 'url' | 'http' | 'port' | 'delay' | 'exit'

export interface RunTaskReadiness {
  /** How the scheduler decides the task is "ready" for downstream tasks. */
  strategy: RunTaskReadinessStrategy
  /**
   * strategy=url: optional custom regex (string form) matched against the
   * process output; defaults to extracting the first http(s) URL.
   */
  urlPattern?: string
  /** strategy=http: URL to poll with HTTP GET until it returns 2xx. */
  httpUrl?: string
  /** strategy=port: wait until this TCP port on 127.0.0.1 is listening. */
  port?: number
  /** strategy=delay: fixed delay in milliseconds. */
  delayMs?: number
  /** strategy=exit: process exit with code 0 counts as ready. */
  /** Shared: readiness wait timeout; defaults to 60_000. */
  timeoutMs?: number
}

export interface RunTask {
  /** Unique within the config file; kebab-case, e.g. 'backend'. */
  id: string
  name: string
  command: string
  /** cwd relative to the project root; empty/missing means project root. */
  cwd?: string
  /** Task ids this task depends on; forms the DAG. */
  dependsOn?: string[]
  readiness?: RunTaskReadiness
  /**
   * Command executed when the user stops this task and its process has already
   * exited (one-shot tasks like `docker compose up -d`), e.g. `docker compose down`.
   */
  stopCommand?: string
  /**
   * Marks this task's published URL as the primary link opened by the
   * start-and-open action. Recommended: at most one task per config.
   */
  primaryUrl?: boolean
  /** Task migrated from legacy single-command fields; at most one per config. */
  isDefault?: boolean
  /** Explicit execution environment; falls back to per-cwd resolution when absent. */
  useWsl?: boolean
  startupMode?: RunStartupMode
  /** Disabled tasks are skipped by "start all"; they can still be started manually. */
  enabled?: boolean
}

export interface RunTaskConfigFile {
  version: 1
  updatedAt?: number
  tasks: RunTask[]
  /** Extra project-relative directories scanned for task candidates. */
  scanDirectories?: string[]
}

/** Result of reading the config file from disk; `error` is set when parsing failed. */
export interface RunTaskConfigReadResult {
  config: RunTaskConfigFile | null
  error?: 'invalid-json' | 'invalid-structure'
}

export type RunTaskCandidateSource = 'package-script' | 'docker-compose' | 'workspace' | 'common-dir'

export interface RunTaskCandidate {
  /** Dedup key: source + cwd + command. */
  key: string
  name: string
  command: string
  /** cwd relative to the project root. */
  cwd?: string
  source: RunTaskCandidateSource
  /** Human-readable origin, e.g. 'backend/package.json scripts.dev'. */
  sourceLabel?: string
  suggestedReadiness?: RunTaskReadiness
}

/** Effective task resolved for a project, either from config file or synthesized from legacy fields. */
export interface EffectiveRunTask {
  task: RunTask
  fromConfig: boolean
}

export type RunTaskState = 'idle' | 'waiting' | 'starting' | 'ready' | 'running' | 'stopping' | 'failed' | 'stopped'

export interface RunTaskProgressEvent {
  projectId: string
  tasks: Record<
    string,
    {
      state: RunTaskState
      url?: string
      error?: string
      /** Output looked like an error while starting — the task may be failing. */
      warning?: string
      startedAt?: number
    }
  >
}

export function runTaskProcessKey(projectId: string, taskId: string): string {
  return `${projectId}::run::${taskId}`
}

/**
 * URL of the task marked with primaryUrl, if it has published one. Used to
 * decide which link the start-and-open action opens when several tasks are up.
 */
export function getPrimaryRunTaskUrl(config: RunTaskConfigFile | null | undefined, states: RunTaskProgressEvent['tasks'] | undefined): string | null {
  if (!config || !states) return null
  const primary = config.tasks.find((task) => task.primaryUrl === true)
  if (!primary) return null
  return states[primary.id]?.url ?? null
}

/**
 * URLs published by tasks that are currently ready/running (primary task
 * first). Stale URLs from tasks that already settled (stopped/failed) or are
 * still ramping are excluded, so consumers never open a dead link.
 */
export function getActiveRunTaskUrls(config: RunTaskConfigFile | null | undefined, states: RunTaskProgressEvent['tasks'] | undefined): string[] {
  if (!states) return []
  const urls = Object.values(states)
    .filter((item) => item.state === 'ready' || item.state === 'running')
    .map((item) => item.url)
    .filter((url): url is string => Boolean(url))
  const preferred = getPrimaryRunTaskUrl(config, states)
  if (preferred && urls.includes(preferred)) return [preferred, ...urls.filter((url) => url !== preferred)]
  return urls
}

/**
 * True when the config declares a primaryUrl task that is still ramping and
 * has not published its URL yet. While pending, the start-and-open action
 * must keep waiting instead of opening whichever other task became ready
 * first.
 */
export function isPrimaryRunTaskUrlPending(config: RunTaskConfigFile | null | undefined, states: RunTaskProgressEvent['tasks'] | undefined): boolean {
  const primary = config?.tasks.find((task) => task.primaryUrl === true)
  if (!primary) return false
  const state = states?.[primary.id]
  return !state || state.state === 'idle' || state.state === 'waiting' || state.state === 'starting'
}

export function parseRunTaskProcessKey(processId: string): { projectId: string; taskId: string } | null {
  const marker = '::run::'
  const index = processId.indexOf(marker)
  if (index <= 0 || index + marker.length >= processId.length) return null
  return {
    projectId: processId.slice(0, index),
    taskId: processId.slice(index + marker.length),
  }
}

export interface RunTaskProjectFields {
  command?: string
  customCommand?: string
  runWorkingDirectory?: string
  runStartupMode?: RunStartupMode
}

const DEFAULT_TASK_ID = 'default'

/**
 * Resolve the effective task list for a project. When a config file exists it
 * wins; otherwise a single default task is synthesized from the legacy
 * single-command fields so legacy projects keep working unchanged.
 */
export function getEffectiveRunTasks(project: RunTaskProjectFields, config: RunTaskConfigFile | null): { tasks: EffectiveRunTask[]; fromConfig: boolean } {
  if (config && config.tasks.length > 0) {
    return { tasks: config.tasks.map((task) => ({ task, fromConfig: true })), fromConfig: true }
  }
  const command = project.customCommand || project.command
  if (!command) return { tasks: [], fromConfig: false }
  return {
    tasks: [
      {
        task: {
          id: DEFAULT_TASK_ID,
          name: DEFAULT_TASK_ID,
          command,
          cwd: project.runWorkingDirectory || undefined,
          isDefault: true,
          ...(project.runStartupMode ? { startupMode: project.runStartupMode } : {}),
        },
        fromConfig: false,
      },
    ],
    fromConfig: false,
  }
}

export class RunTaskCycleError extends Error {
  readonly cyclePath: string[]
  constructor(cyclePath: string[]) {
    super(`Dependency cycle detected: ${cyclePath.join(' -> ')}`)
    this.name = 'RunTaskCycleError'
    this.cyclePath = cyclePath
  }
}

/**
 * Kahn topological sort of run tasks by dependsOn. Returns tasks in a stable
 * dependency order (dependencies before dependents). Throws RunTaskCycleError
 * when the graph contains a cycle or a dependency references a missing task.
 */
export function topoSortRunTasks(tasks: RunTask[]): RunTask[] {
  const byId = new Map<string, RunTask>()
  for (const task of tasks) {
    if (byId.has(task.id)) {
      throw new RunTaskCycleError([task.id, task.id])
    }
    byId.set(task.id, task)
  }

  const dependents = new Map<string, string[]>()
  const pendingDeps = new Map<string, number>()
  for (const task of tasks) {
    const deps = (task.dependsOn ?? []).filter((dep) => dep !== task.id)
    for (const dep of deps) {
      if (!byId.has(dep)) {
        throw new RunTaskCycleError([task.id, dep, task.id])
      }
    }
    pendingDeps.set(task.id, deps.length)
    for (const dep of deps) {
      const list = dependents.get(dep)
      if (list) list.push(task.id)
      else dependents.set(dep, [task.id])
    }
  }

  // Preserve the original declaration order for determinism.
  const queue = tasks.filter((task) => (pendingDeps.get(task.id) ?? 0) === 0).map((task) => task.id)
  const sorted: RunTask[] = []
  const visited = new Set<string>()

  while (queue.length > 0) {
    const id = queue.shift() as string
    if (visited.has(id)) continue
    visited.add(id)
    sorted.push(byId.get(id) as RunTask)
    for (const dependentId of dependents.get(id) ?? []) {
      const remaining = (pendingDeps.get(dependentId) ?? 0) - 1
      pendingDeps.set(dependentId, remaining)
      if (remaining === 0) queue.push(dependentId)
    }
  }

  if (sorted.length !== tasks.length) {
    const cycle = tasks.filter((task) => !visited.has(task.id)).map((task) => task.id)
    throw new RunTaskCycleError(cycle)
  }
  return sorted
}
