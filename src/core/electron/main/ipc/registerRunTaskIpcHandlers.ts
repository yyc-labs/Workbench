import { ipcMain } from 'electron'
import { IPC } from '../ipc'
import type { RunTask } from '../../../shared/runTasks'
import type { RegisterIpcHandlersDependencies } from './registerIpcHandlers.shared'

export function registerRunTaskIpcHandlers(deps: RegisterIpcHandlersDependencies): void {
  const service = deps.runTaskService

  ipcMain.handle(IPC.RUN_TASK_GET_CONFIG, (_event, projectPath: string) => {
    return service.getConfig(projectPath)
  })

  ipcMain.handle(IPC.RUN_TASK_SAVE_CONFIG, (_event, projectPath: string, tasks: RunTask[], scanDirectories?: string[]) => {
    return service.saveConfig(projectPath, tasks, scanDirectories)
  })

  ipcMain.handle(IPC.RUN_TASK_DETECT_CANDIDATES, (_event, projectPath: string, scanDirectories?: string[]) => {
    return service.detectCandidates(projectPath, scanDirectories)
  })

  ipcMain.handle(IPC.RUN_TASK_START, (_event, projectId: string, projectPath: string, task: RunTask) => {
    return service.start(projectId, projectPath, task)
  })

  ipcMain.handle(IPC.RUN_TASK_START_ALL, (_event, projectId: string, projectPath: string, tasks?: RunTask[]) => {
    // The renderer passes the effective task list (config file tasks, or a
    // synthesized default task for legacy single-command projects).
    const config = tasks && tasks.length > 0 ? { version: 1 as const, tasks } : service.getConfig(projectPath).config
    return service.startAll(projectId, projectPath, config)
  })

  ipcMain.handle(IPC.RUN_TASK_STOP, (_event, projectId: string, taskId: string) => {
    return service.stop(projectId, taskId)
  })

  ipcMain.handle(IPC.RUN_TASK_STOP_ALL, (_event, projectId: string) => {
    return service.stopAll(projectId)
  })

  ipcMain.handle(IPC.RUN_TASK_GET_STATE, (_event, projectId: string) => {
    return service.getState(projectId)
  })

  ipcMain.handle(IPC.RUN_TASK_CHECK_DOCKER, (_event, projectPath: string, tasks: RunTask[]) => {
    return service.checkDockerDaemon(projectPath, tasks)
  })

  ipcMain.handle(IPC.RUN_TASK_START_DOCKER, (_event, projectPath: string, tasks: RunTask[]) => {
    return service.startDockerDaemon(projectPath, tasks)
  })
}
