import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC } from '../main/ipc'

type ThemeMode = 'system' | 'light' | 'dark'

function resolveTheme(theme: ThemeMode): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

let initialThemeMode: ThemeMode = 'system'

// Apply theme before renderer boot to avoid first-paint flicker.
try {
  initialThemeMode = ipcRenderer.sendSync(IPC.CONFIG_GET_THEME_SYNC) as ThemeMode
  const effective = resolveTheme(initialThemeMode)
  if (document.documentElement.getAttribute('data-theme') !== effective) {
    document.documentElement.setAttribute('data-theme', effective)
  }
  document.documentElement.setAttribute('data-theme-mode', initialThemeMode)
  document.documentElement.style.backgroundColor = effective === 'dark' ? '#09090b' : '#f5f7fb'
  document.documentElement.style.colorScheme = effective
} catch {
  // Best effort; renderer ThemeSync will apply theme later.
}

const api = {
  detectProjects: (dirPath: string) =>
    ipcRenderer.invoke(IPC.DETECT_DIRECTORY, dirPath),

  startProcess: (projectId: string, command: string, cwd: string, useWsl?: boolean) =>
    ipcRenderer.invoke(IPC.PROCESS_START, projectId, command, cwd, useWsl),

  stopProcess: (projectId: string) =>
    ipcRenderer.invoke(IPC.PROCESS_STOP, projectId),

  sendInput: (projectId: string, data: string) =>
    ipcRenderer.invoke(IPC.PROCESS_INPUT, projectId, data),

  getConfig: () => ipcRenderer.invoke(IPC.CONFIG_GET),

  setConfig: (partial: Record<string, unknown>) =>
    ipcRenderer.invoke(IPC.CONFIG_SET, partial),

  selectDirectory: () => ipcRenderer.invoke(IPC.DIALOG_SELECT_DIRECTORY),

  getPathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },

  openExternal: (url: string) =>
    ipcRenderer.invoke(IPC.SHELL_OPEN_EXTERNAL, url),

  openFolder: (folderPath: string) =>
    ipcRenderer.invoke(IPC.SHELL_OPEN_FOLDER, folderPath),

  openInVsCode: (folderPath: string) =>
    ipcRenderer.invoke(IPC.SHELL_OPEN_VSCODE, folderPath),

  resizeTerminal: (projectId: string, cols: number, rows: number) =>
    ipcRenderer.invoke(IPC.PROCESS_RESIZE, projectId, cols, rows),

  runAiCommit: (
    projectId: string,
    projectPath: string,
    override?: { split?: boolean; splitMaxBatches?: number }
  ) => ipcRenderer.invoke(IPC.AI_COMMIT_RUN, projectId, projectPath, override),

  getLatestCommit: (projectPath: string) =>
    ipcRenderer.invoke(IPC.GIT_GET_LATEST_COMMIT, projectPath),

  getCapability: () => ipcRenderer.invoke(IPC.WSL_GET_CAPABILITY),

  listTmuxSessions: () => ipcRenderer.invoke(IPC.TMUX_LIST_SESSIONS),

  killTmuxSession: (sessionName: string) =>
    ipcRenderer.invoke(IPC.TMUX_KILL_SESSION, sessionName),

  startRuntime: (projectId: string, projectPath: string, cli?: 'claude' | 'codex') =>
    ipcRenderer.invoke(IPC.RUNTIME_START, projectId, projectPath, cli),

  getRuntimeDiagnostics: () =>
    ipcRenderer.invoke(IPC.RUNTIME_DIAGNOSTICS),

  listRuntimeEntries: () =>
    ipcRenderer.invoke(IPC.RUNTIME_LIST_ENTRIES),

  openTerminal: (sessionName: string, statusHint?: string) => {
    console.log('[preload.openTerminal] invoking IPC SHELL_OPEN_TERMINAL sessionName=', sessionName, 'statusHint=', statusHint)
    return ipcRenderer.invoke(IPC.SHELL_OPEN_TERMINAL, sessionName, statusHint)
      .then((r) => { console.log('[preload.openTerminal] IPC resolved', r); return r })
      .catch((e) => { console.error('[preload.openTerminal] IPC rejected', e); throw e })
  },

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

  onAiCommitOutput: (
    cb: (data: { projectId: string; data: string }) => void
  ) => {
    const handler = (
      _e: IpcRendererEvent,
      d: { projectId: string; data: string }
    ) => cb(d)
    ipcRenderer.on(IPC.AI_COMMIT_OUTPUT, handler)
    return () => ipcRenderer.removeListener(IPC.AI_COMMIT_OUTPUT, handler)
  },

  onAiCommitStatus: (
    cb: (data: { projectId: string; status: 'running' | 'success' | 'error' }) => void
  ) => {
    const handler = (
      _e: IpcRendererEvent,
      d: { projectId: string; status: 'running' | 'success' | 'error' }
    ) => cb(d)
    ipcRenderer.on(IPC.AI_COMMIT_STATUS, handler)
    return () => ipcRenderer.removeListener(IPC.AI_COMMIT_STATUS, handler)
  },
}

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = typeof api
