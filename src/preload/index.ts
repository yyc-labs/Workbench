import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '../main/ipc'

const api = {
  detectProjects: (dirPath: string) =>
    ipcRenderer.invoke(IPC.DETECT_DIRECTORY, dirPath),

  startProcess: (projectId: string, command: string, cwd: string) =>
    ipcRenderer.invoke(IPC.PROCESS_START, projectId, command, cwd),

  stopProcess: (projectId: string) =>
    ipcRenderer.invoke(IPC.PROCESS_STOP, projectId),

  sendInput: (projectId: string, data: string) =>
    ipcRenderer.invoke(IPC.PROCESS_INPUT, projectId, data),

  getConfig: () => ipcRenderer.invoke(IPC.CONFIG_GET),

  setConfig: (partial: Record<string, unknown>) =>
    ipcRenderer.invoke(IPC.CONFIG_SET, partial),

  selectDirectory: () => ipcRenderer.invoke(IPC.DIALOG_SELECT_DIRECTORY),

  openExternal: (url: string) =>
    ipcRenderer.invoke(IPC.SHELL_OPEN_EXTERNAL, url),

  resizeTerminal: (projectId: string, cols: number, rows: number) =>
    ipcRenderer.invoke(IPC.PROCESS_RESIZE, projectId, cols, rows),

  getCapability: () => ipcRenderer.invoke(IPC.WSL_GET_CAPABILITY),

  listTmuxSessions: () => ipcRenderer.invoke(IPC.TMUX_LIST_SESSIONS),

  killTmuxSession: (projectId: string) =>
    ipcRenderer.invoke(IPC.TMUX_KILL_SESSION, projectId),

  rehydrateTmuxSessions: () => ipcRenderer.invoke(IPC.TMUX_REHYDRATE),

  onProcessOutput: (
    cb: (data: { projectId: string; data: string }) => void
  ) => {
    const handler = (
      _e: IpcRendererEvent,
      d: { projectId: string; data: string }
    ) => cb(d)
    ipcRenderer.on(IPC.PROCESS_OUTPUT, handler)
    return () => ipcRenderer.removeListener(IPC.PROCESS_OUTPUT, handler)
  },

  onProcessStatus: (
    cb: (data: { projectId: string; status: string }) => void
  ) => {
    const handler = (
      _e: IpcRendererEvent,
      d: { projectId: string; status: string }
    ) => cb(d)
    ipcRenderer.on(IPC.PROCESS_STATUS, handler)
    return () => ipcRenderer.removeListener(IPC.PROCESS_STATUS, handler)
  },

  onProcessExit: (
    cb: (data: { projectId: string; code: number | null }) => void
  ) => {
    const handler = (
      _e: IpcRendererEvent,
      d: { projectId: string; code: number | null }
    ) => cb(d)
    ipcRenderer.on(IPC.PROCESS_EXIT, handler)
    return () => ipcRenderer.removeListener(IPC.PROCESS_EXIT, handler)
  },
}

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = typeof api
