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

  setDocLinkSecret: (projectId: string, linkId: string, secret: string) =>
    ipcRenderer.invoke(IPC.DOC_LINK_SECRET_SET, projectId, linkId, secret),

  getDocLinkSecret: (projectId: string, linkId: string) =>
    ipcRenderer.invoke(IPC.DOC_LINK_SECRET_GET, projectId, linkId) as Promise<{ secret: string | null }>,

  deleteDocLinkSecret: (projectId: string, linkId: string) =>
    ipcRenderer.invoke(IPC.DOC_LINK_SECRET_DELETE, projectId, linkId),

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

  minimizeWindow: () =>
    ipcRenderer.invoke(IPC.WINDOW_MINIMIZE),

  toggleMaximizeWindow: () =>
    ipcRenderer.invoke(IPC.WINDOW_TOGGLE_MAXIMIZE),

  closeWindow: () =>
    ipcRenderer.invoke(IPC.WINDOW_CLOSE),

  isWindowMaximized: () =>
    ipcRenderer.invoke(IPC.WINDOW_IS_MAXIMIZED),

  resizeTerminal: (projectId: string, cols: number, rows: number) =>
    ipcRenderer.invoke(IPC.PROCESS_RESIZE, projectId, cols, rows),

  runAiCommit: (
    projectId: string,
    projectPath: string,
    override?: { split?: boolean; splitMaxBatches?: number; maxBullets?: number }
  ) => ipcRenderer.invoke(IPC.AI_COMMIT_RUN, projectId, projectPath, override),

  getAiCommitState: (projectId: string) =>
    ipcRenderer.invoke(IPC.AI_COMMIT_GET_STATE, projectId),

  getLatestCommit: (projectPath: string) =>
    ipcRenderer.invoke(IPC.GIT_GET_LATEST_COMMIT, projectPath),

  getGitWorkspaceSnapshot: (projectPath: string) =>
    ipcRenderer.invoke(IPC.GIT_GET_WORKSPACE_SNAPSHOT, projectPath),

  runGitOperation: (
    request: {
      projectPath: string
      operation:
        | 'fetch'
        | 'pull'
        | 'push'
        | 'merge'
        | 'switch'
        | 'create-remote-branch'
        | 'create-local-branch'
        | 'delete-local-branch'
        | 'set-upstream'
      targetBranch?: string
      remoteName?: string
    }
  ) => ipcRenderer.invoke(IPC.GIT_RUN_OPERATION, request),

  setGitFileStage: (
    request: { projectPath: string; filePath: string; stage: boolean }
  ) => ipcRenderer.invoke(IPC.GIT_SET_FILE_STAGE, request),

  getGitFileDiff: (
    request: { projectPath: string; filePath: string; staged: boolean }
  ) => ipcRenderer.invoke(IPC.GIT_GET_FILE_DIFF, request),

  getGitConflictFile: (
    request: { projectPath: string; filePath: string }
  ) => ipcRenderer.invoke(IPC.GIT_GET_CONFLICT_FILE, request),

  resolveGitConflictFile: (
    request: { projectPath: string; filePath: string; content: string; markResolved?: boolean }
  ) => ipcRenderer.invoke(IPC.GIT_RESOLVE_CONFLICT_FILE, request),

  getCapability: () => ipcRenderer.invoke(IPC.WSL_GET_CAPABILITY),

  listTmuxSessions: () => ipcRenderer.invoke(IPC.TMUX_LIST_SESSIONS),

  killTmuxSession: (sessionName: string) =>
    ipcRenderer.invoke(IPC.TMUX_KILL_SESSION, sessionName),

  listTerminalProcesses: () =>
    ipcRenderer.invoke(IPC.TERMINAL_LIST_ALL),

  stopAllTerminalProcesses: () =>
    ipcRenderer.invoke(IPC.TERMINAL_STOP_ALL),

  startRuntime: (projectId: string, projectPath: string, cli?: 'claude' | 'codex') =>
    ipcRenderer.invoke(IPC.RUNTIME_START, projectId, projectPath, cli),

  getRuntimeDiagnostics: () =>
    ipcRenderer.invoke(IPC.RUNTIME_DIAGNOSTICS),

  listRuntimeEntries: () =>
    ipcRenderer.invoke(IPC.RUNTIME_LIST_ENTRIES),

  listProjectFiles: (projectPath: string) =>
    ipcRenderer.invoke(IPC.PROJECT_FILE_TREE, projectPath),

  searchProjectFiles: (projectPath: string, query: string) =>
    ipcRenderer.invoke(IPC.PROJECT_FILE_SEARCH, projectPath, query),

  searchProjectContent: (projectPath: string, query: string, options?: { caseSensitive?: boolean }) =>
    ipcRenderer.invoke(IPC.PROJECT_FILE_CONTENT_SEARCH, projectPath, query, options),

  readProjectFile: (projectPath: string, relativePath: string) =>
    ipcRenderer.invoke(IPC.PROJECT_FILE_READ, projectPath, relativePath),

  statProjectFile: (projectPath: string, relativePath: string) =>
    ipcRenderer.invoke(IPC.PROJECT_FILE_STAT, projectPath, relativePath),

  writeProjectFile: (
    projectPath: string,
    relativePath: string,
    content: string,
    expectedMtimeMs?: number
  ) => ipcRenderer.invoke(IPC.PROJECT_FILE_WRITE, projectPath, relativePath, content, expectedMtimeMs),

  openTerminal: (sessionName: string, statusHint?: string) => {
    console.log('[preload.openTerminal] invoking IPC SHELL_OPEN_TERMINAL sessionName=', sessionName, 'statusHint=', statusHint)
    return ipcRenderer.invoke(IPC.SHELL_OPEN_TERMINAL, sessionName, statusHint)
      .then((r) => { console.log('[preload.openTerminal] IPC resolved', r); return r })
      .catch((e) => { console.error('[preload.openTerminal] IPC rejected', e); throw e })
  },

  openPathTerminal: (folderPath: string, command?: string) =>
    ipcRenderer.invoke(IPC.SHELL_OPEN_PATH_TERMINAL, folderPath, command),

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

  onWindowState: (
    cb: (data: { isMaximized: boolean }) => void
  ) => {
    const handler = (
      _e: IpcRendererEvent,
      d: { isMaximized: boolean }
    ) => cb(d)
    ipcRenderer.on(IPC.WINDOW_STATE, handler)
    return () => ipcRenderer.removeListener(IPC.WINDOW_STATE, handler)
  },

  onCodeFocusSearch: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on(IPC.CODE_FOCUS_SEARCH, handler)
    return () => ipcRenderer.removeListener(IPC.CODE_FOCUS_SEARCH, handler)
  },

  onCodeToggleViewMode: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on(IPC.CODE_TOGGLE_VIEW_MODE, handler)
    return () => ipcRenderer.removeListener(IPC.CODE_TOGGLE_VIEW_MODE, handler)
  },
}

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = typeof api
