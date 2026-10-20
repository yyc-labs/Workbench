import * as path from 'path'
import type { RunTask, RunTaskCandidate, RunTaskConfigFile, RunTaskConfigReadResult, RunTaskProgressEvent } from '../../../shared/runTasks'
import type { PtySize } from '../../../shared/types'
import type { ProcessManager } from '../runner'
import { ensureDockerDaemonRunning, isDockerDaemonRunning, taskRequiresDocker } from './docker-preflight'
import { RunTaskConfigStore } from './run-task-config-store'
import { RunTaskConfigWatcher } from './run-task-config-watcher'
import { detectRunTaskCandidates } from './run-task-detector'
import type { EmitRunTaskProgress, StartTaskInTerminal } from './run-task-scheduler'
import { RunTaskScheduler, resolveTaskUseWsl } from './run-task-scheduler'

export interface RunTaskServiceDependencies {
  getProcessManager: () => ProcessManager | null
  emitRunTaskProgress: EmitRunTaskProgress
  /** Notifies the renderer that a project's run-task config file changed on disk. */
  emitRunTaskConfigChanged?: (projectPath: string) => void
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
  private readonly configWatcher: RunTaskConfigWatcher | null
  private readonly scheduler: RunTaskScheduler
  private readonly getWslDistro: () => string

  constructor(deps: RunTaskServiceDependencies) {
    this.getWslDistro = deps.getWslDistro ?? (() => 'Ubuntu')
    this.configWatcher = deps.emitRunTaskConfigChanged ? new RunTaskConfigWatcher(deps.emitRunTaskConfigChanged) : null
    this.scheduler = new RunTaskScheduler(deps.getProcessManager, deps.emitRunTaskProgress, deps.startInTerminal, this.getWslDistro)
  }

  getConfig(projectPath: string): RunTaskConfigReadResult {
    // Watching piggybacks on reads: every renderer config load (re)arms the
    // watcher, so projects get watched exactly when their config is used.
    this.configWatcher?.ensureWatch(projectPath)
    return this.configStore.readConfig(projectPath)
  }

  saveConfig(projectPath: string, tasks: RunTask[], scanDirectories?: string[]): RunTaskConfigReadResult {
    return this.configStore.writeConfig(projectPath, tasks, scanDirectories)
  }

  detectCandidates(projectPath: string, scanDirectories?: string[]): RunTaskCandidate[] {
    return detectRunTaskCandidates(projectPath, scanDirectories)
  }

  /**
   * initialSize 由 renderer 入口（Ctrl+J 面板 / 项目卡 / 运行任务对话框）按集合面板终端区域的
   * 预测视口计算后传入（lib/terminalViewportSize.ts 的 predictCurrentPanelViewport），使 pty 以真实
   * 列宽启动，避免挂载后 fit → conpty reflow 把行尾补齐成一片空格。
   *
   * 已知遗留：主进程侧发起的启动（quickActionService 的「一键启动」/快捷操作）拿不到面板几何
   * （视口预测依赖 renderer 的字体度量与窗口尺寸），不传 initialSize → runner 兜底 80×24，
   * 该路径启动的任务在面板挂载时仍会触发一次 reflow。暂按 B 方案只标注不修。
   */
  async start(projectId: string, projectPath: string, task: RunTask, initialSize?: PtySize): Promise<boolean> {
    return this.scheduler.start(projectId, projectPath, task, initialSize)
  }

  async startAll(projectId: string, projectPath: string, config: RunTaskConfigFile | null, initialSize?: PtySize): Promise<{ started: boolean; error?: string }> {
    if (!config || config.tasks.length === 0) {
      return { started: false, error: 'No run tasks configured.' }
    }
    return this.scheduler.startAll(projectId, projectPath, config.tasks, initialSize)
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
