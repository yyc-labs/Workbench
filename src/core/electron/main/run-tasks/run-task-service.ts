import * as path from 'path'
import type { RunTask, RunTaskCandidate, RunTaskConfigFile, RunTaskConfigReadResult, RunTaskProgressEvent } from '../../../shared/runTasks'
import type { ProcessManager } from '../runner'
import { ensureDockerDaemonRunning, isDockerDaemonRunning, taskRequiresDocker } from './docker-preflight'
import { RunTaskConfigStore } from './run-task-config-store'
import { detectRunTaskCandidates } from './run-task-detector'
import { resolveTaskUseWsl, RunTaskScheduler } from './run-task-scheduler'
import type { EmitRunTaskProgress, StartTaskInTerminal } from './run-task-scheduler'

export interface RunTaskServiceDependencies {
  getProcessManager: () => ProcessManager | null
  emitRunTaskProgress: EmitRunTaskProgress
  /** Opens an external terminal window for tasks configured with startupMode=terminal. */
  startInTerminal?: StartTaskInTerminal
  /** Default WSL distro for daemon probes of WSL-resolved docker tasks. */
  getWslDistro?: () => string
}

/**
 * Facade for the run-task feature: config persistence, candidate detection,
 * and DAG orchestration. Wired into IPC handlers via the shared deps object.
 */
export class RunTaskService {
  private readonly configStore = new RunTaskConfigStore()
  private readonly scheduler: RunTaskScheduler
  private readonly getWslDistro: () => string

  constructor(deps: RunTaskServiceDependencies) {
    this.getWslDistro = deps.getWslDistro ?? (() => 'Ubuntu')
    this.scheduler = new RunTaskScheduler(deps.getProcessManager, deps.emitRunTaskProgress, deps.startInTerminal, this.getWslDistro)
  }

  getConfig(projectPath: string): RunTaskConfigReadResult {
    return this.configStore.readConfig(projectPath)
  }

  saveConfig(projectPath: string, tasks: RunTask[], scanDirectories?: string[]): RunTaskConfigReadResult {
    return this.configStore.writeConfig(projectPath, tasks, scanDirectories)
  }

  detectCandidates(projectPath: string, scanDirectories?: string[]): RunTaskCandidate[] {
    return detectRunTaskCandidates(projectPath, scanDirectories)
  }

  async start(projectId: string, projectPath: string, task: RunTask): Promise<boolean> {
    return this.scheduler.start(projectId, projectPath, task)
  }

  async startAll(projectId: string, projectPath: string, config: RunTaskConfigFile | null): Promise<{ started: boolean; error?: string }> {
    if (!config || config.tasks.length === 0) {
      return { started: false, error: 'No run tasks configured.' }
    }
    return this.scheduler.startAll(projectId, projectPath, config.tasks)
  }

  async stop(projectId: string, taskId: string): Promise<boolean> {
    return this.scheduler.stopTask(projectId, taskId)
  }

  async stopAll(projectId: string): Promise<boolean> {
    return this.scheduler.stopAll(projectId)
  }

  getState(projectId: string): RunTaskProgressEvent | null {
    return this.scheduler.getState(projectId)
  }

  /**
   * Preflight for docker-based tasks: resolves which environments (Windows
   * host / WSL distro) the docker tasks would run in and probes the daemon in
   * each of them.
   */
  async checkDockerDaemon(projectPath: string, tasks: RunTask[]): Promise<{ required: boolean; running: boolean }> {
    const dockerTasks = tasks.filter(taskRequiresDocker)
    if (dockerTasks.length === 0) return { required: false, running: false }

    let needsWsl = false
    let needsNative = false
    for (const task of dockerTasks) {
      const cwd = task.cwd ? path.join(projectPath, task.cwd) : projectPath
      if (resolveTaskUseWsl(cwd, task.useWsl) === true) needsWsl = true
      else needsNative = true
    }

    const [wsl, native] = await Promise.all([needsWsl ? isDockerDaemonRunning(true, this.getWslDistro()) : Promise.resolve(true), needsNative ? isDockerDaemonRunning(false, this.getWslDistro()) : Promise.resolve(true)])
    return { required: true, running: wsl && native }
  }

  async startDockerDaemon(projectPath: string, tasks: RunTask[]): Promise<{ ready: boolean; error?: string }> {
    const dockerTasks = tasks.filter(taskRequiresDocker)
    let needsWsl = false
    let needsNative = false
    for (const task of dockerTasks) {
      const cwd = task.cwd ? path.join(projectPath, task.cwd) : projectPath
      if (resolveTaskUseWsl(cwd, task.useWsl) === true) needsWsl = true
      else needsNative = true
    }
    if (!needsWsl && !needsNative) return { ready: true }
    return ensureDockerDaemonRunning(needsWsl, needsNative, this.getWslDistro())
  }
}
