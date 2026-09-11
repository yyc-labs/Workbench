import { ipcRenderer } from 'electron'
import { IPC } from '../main/ipc'
import type { RunTaskCandidate, RunTask, RunTaskConfigFile, RunTaskConfigReadResult, RunTaskProgressEvent } from '../../shared/runTasks'

export function createRunTaskInvokeApi() {
  return {
    getRunTaskConfig: (projectPath: string) => ipcRenderer.invoke(IPC.RUN_TASK_GET_CONFIG, projectPath) as Promise<RunTaskConfigReadResult>,

    saveRunTaskConfig: (projectPath: string, tasks: RunTaskConfigFile['tasks'], scanDirectories?: string[]) => ipcRenderer.invoke(IPC.RUN_TASK_SAVE_CONFIG, projectPath, tasks, scanDirectories) as Promise<RunTaskConfigReadResult>,

    detectRunTaskCandidates: (projectPath: string, scanDirectories?: string[]) => ipcRenderer.invoke(IPC.RUN_TASK_DETECT_CANDIDATES, projectPath, scanDirectories) as Promise<RunTaskCandidate[]>,

    startRunTask: (projectId: string, projectPath: string, task: RunTask) => ipcRenderer.invoke(IPC.RUN_TASK_START, projectId, projectPath, task) as Promise<boolean>,

    startAllRunTasks: (projectId: string, projectPath: string, tasks?: RunTask[]) => ipcRenderer.invoke(IPC.RUN_TASK_START_ALL, projectId, projectPath, tasks) as Promise<{ started: boolean; error?: string }>,

    stopRunTask: (projectId: string, taskId: string) => ipcRenderer.invoke(IPC.RUN_TASK_STOP, projectId, taskId) as Promise<boolean>,

    stopAllRunTasks: (projectId: string) => ipcRenderer.invoke(IPC.RUN_TASK_STOP_ALL, projectId) as Promise<boolean>,

    getRunTaskState: (projectId: string) => ipcRenderer.invoke(IPC.RUN_TASK_GET_STATE, projectId) as Promise<RunTaskProgressEvent | null>,

    checkRunTaskDocker: (projectPath: string, tasks: RunTask[]) => ipcRenderer.invoke(IPC.RUN_TASK_CHECK_DOCKER, projectPath, tasks) as Promise<{ required: boolean; running: boolean }>,

    startDockerDaemon: (projectPath: string, tasks: RunTask[]) => ipcRenderer.invoke(IPC.RUN_TASK_START_DOCKER, projectPath, tasks) as Promise<{ ready: boolean; error?: string }>,
  }
}
