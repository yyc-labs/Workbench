import type {
  AiCommitTaskSnapshot,
  ProjectFileContentSearchResponse,
  ProjectFileContentSearchOptions,
  ProjectFileNode,
  ProjectFileReadResult,
  ProjectFileStatResult,
  ProjectFileTreeResult,
  ProjectFileWriteResult,
  ProjectInfo,
  ProcessInfo,
  AppConfig,
  Capability,
  TmuxSessionInfo,
  SessionRuntime,
  RuntimeEntry,
  ProjectDocLink,
  RuntimeDiagnostics,
  ProjectFolder,
  ProjectTag,
  StartupDefaultFilter,
  TerminalProcessInventory,
  TerminalStopAllResult,
  GitWorkspaceSnapshot,
  GitOperationRequest,
  GitOperationResult,
  GitSetFileStageRequest,
  GitSetFileStageResult,
  GitFileDiffRequest,
  GitFileDiffResult,
  ProjectCodeFileDrawerState,
} from '../../shared/types'

declare global {
  interface Window {
    electronAPI: {
      detectProjects: (path: string) => Promise<ProjectInfo | null>
      startProcess: (id: string, cmd: string, cwd: string, useWsl?: boolean) => Promise<boolean>
      stopProcess: (id: string) => Promise<boolean>
      sendInput: (id: string, data: string) => Promise<boolean>
      getConfig: () => Promise<AppConfig>
      setConfig: (config: Record<string, unknown>) => Promise<AppConfig>
      selectDirectory: () => Promise<string | null>
      getPathForFile: (file: File) => string
      onProcessOutput: (cb: (d: { projectId: string; data: string }) => void) => () => void
      onProcessStatus: (cb: (d: { projectId: string; status: string }) => void) => () => void
      onProcessExit: (cb: (d: { projectId: string; code: number | null }) => void) => () => void
      openExternal: (url: string) => Promise<void>
      resizeTerminal: (id: string, cols: number, rows: number) => Promise<boolean>
      getCapability: () => Promise<Capability>
      listTmuxSessions: () => Promise<TmuxSessionInfo[]>
      killTmuxSession: (sessionName: string) => Promise<boolean>
      listTerminalProcesses: () => Promise<TerminalProcessInventory>
      stopAllTerminalProcesses: () => Promise<TerminalStopAllResult>
      startRuntime: (projectId: string, projectPath: string, cli?: 'claude' | 'codex') => Promise<boolean>
      getRuntimeDiagnostics: () => Promise<RuntimeDiagnostics>
      listRuntimeEntries: () => Promise<RuntimeEntry[]>
      listProjectFiles: (projectPath: string) => Promise<ProjectFileTreeResult>
      searchProjectFiles: (projectPath: string, query: string) => Promise<ProjectFileNode[]>
      searchProjectContent: (
        projectPath: string,
        query: string,
        options?: ProjectFileContentSearchOptions
      ) => Promise<ProjectFileContentSearchResponse>
      readProjectFile: (projectPath: string, relativePath: string) => Promise<ProjectFileReadResult>
      statProjectFile: (projectPath: string, relativePath: string) => Promise<ProjectFileStatResult>
      writeProjectFile: (
        projectPath: string,
        relativePath: string,
        content: string,
        expectedMtimeMs?: number
      ) => Promise<ProjectFileWriteResult>
      openTerminal: (sessionName: string, statusHint?: string) => Promise<boolean>
      openPathTerminal: (folderPath: string) => Promise<boolean>
      openFolder: (folderPath: string) => Promise<void>
      openInVsCode: (folderPath: string) => Promise<void>
      minimizeWindow: () => Promise<boolean>
      toggleMaximizeWindow: () => Promise<boolean>
      closeWindow: () => Promise<boolean>
      isWindowMaximized: () => Promise<boolean>
      runAiCommit: (
        projectId: string,
        projectPath: string,
        override?: { split?: boolean; splitMaxBatches?: number; maxBullets?: number }
      ) => Promise<boolean>
      getAiCommitState: (projectId: string) => Promise<AiCommitTaskSnapshot | null>
      getLatestCommit: (projectPath: string) => Promise<{
        hash: string
        shortHash: string
        subject: string
        committedAt: string
        bullets: string[]
        filesChanged: number
      }[]>
      getGitWorkspaceSnapshot: (projectPath: string) => Promise<GitWorkspaceSnapshot>
      runGitOperation: (request: GitOperationRequest) => Promise<GitOperationResult>
      setGitFileStage: (request: GitSetFileStageRequest) => Promise<GitSetFileStageResult>
      getGitFileDiff: (request: GitFileDiffRequest) => Promise<GitFileDiffResult>
      onAiCommitOutput: (cb: (d: { projectId: string; data: string }) => void) => () => void
      onAiCommitStatus: (
        cb: (d: { projectId: string; status: 'running' | 'success' | 'error' }) => void
      ) => () => void
      onWindowState: (cb: (d: { isMaximized: boolean }) => void) => () => void
      onCodeFocusSearch: (cb: () => void) => () => void
      onCodeToggleViewMode: (cb: () => void) => () => void
    }
  }
}

export interface AppState {
  isAppReady: boolean
  projects: ProjectInfo[]
  folders: ProjectFolder[]
  tags: ProjectTag[]
  processes: Record<string, ProcessInfo>
  terminalOutputs: Record<string, string>
  processUrls: Record<string, string[]>
  config: AppConfig
  searchQuery: string
  homeEnvFilter: 'all' | 'ubuntu' | 'windows'
  homeClassifierFilter: StartupDefaultFilter
  homeDefaultFilterApplied: boolean
  capability: Capability | null
  tmuxSessions: TmuxSessionInfo[]
  sessions: Record<string, SessionRuntime>
  runtimeEntries: Record<string, RuntimeEntry>

  loadConfig: () => Promise<void>
  setTheme: (theme: AppConfig['theme']) => Promise<void>
  setRuntimeLauncherScript: (scriptPath: string) => Promise<void>
  setRuntimeKeepAliveOnQuit: (enabled: boolean) => Promise<void>
  setAiCommitConfig: (aiCommit: NonNullable<AppConfig['aiCommit']>) => Promise<void>
  initApp: () => Promise<void>
  addProject: (dirPath: string) => Promise<void>
  removeProject: (projectId: string) => Promise<void>
  startProject: (
    projectId: string,
    commandOverride?: string,
    processId?: string,
    useWsl?: boolean
  ) => Promise<void>
  stopProject: (projectId: string) => Promise<void>
  loadRuntimeEntries: () => Promise<void>
  appendOutput: (projectId: string, data: string) => void
  clearOutput: (projectId: string) => void
  updateProcessStatus: (projectId: string, status: string) => void
  handleProcessExit: (projectId: string, code: number | null) => void
  sendInput: (projectId: string, data: string) => void
  setSearchQuery: (query: string) => void
  setHomeEnvFilter: (filter: AppState['homeEnvFilter']) => void
  setHomeClassifierFilter: (filter: StartupDefaultFilter) => void
  markHomeDefaultFilterApplied: () => void
  togglePin: (projectId: string) => void
  updateLastOpened: (projectId: string) => void
  clearProcessUrl: (projectId: string) => void
  loadTmuxSessions: () => Promise<void>
  syncManagedProcesses: () => Promise<void>
  rehydrateProcessUrlsFromStorage: () => void
  refreshSessions: () => Promise<void>
  setProjectCli: (projectId: string, cli: 'claude' | 'codex') => Promise<void>
  setProjectCustomName: (projectId: string, customName?: string) => Promise<void>
  setProjectCustomType: (projectId: string, customType?: string) => Promise<void>
  setProjectCustomCommand: (projectId: string, customCommand?: string) => Promise<void>
  setProjectDocLinks: (projectId: string, docLinks: ProjectDocLink[]) => Promise<void>
  setProjectLastCodeFile: (projectId: string, relativePath?: string) => Promise<void>
  setProjectLastMarkdownPreviewMode: (projectId: string, mode?: 'edit' | 'preview' | 'split') => Promise<void>
  setProjectCodeFileDrawerState: (projectId: string, state: ProjectCodeFileDrawerState) => Promise<void>
  clearAllProjectLastCodeFiles: () => Promise<void>
  setStartupDefaultFilter: (filter?: StartupDefaultFilter) => Promise<void>
  createFolder: (name: string, color?: string) => Promise<void>
  renameFolder: (folderId: string, name: string) => Promise<void>
  removeFolder: (folderId: string) => Promise<void>
  reorderFolders: (activeFolderId: string, overFolderId: string) => Promise<void>
  assignProjectFolder: (projectId: string, folderId?: string) => Promise<void>
  createTag: (name: string, color?: string) => Promise<void>
  renameTag: (tagId: string, name: string) => Promise<void>
  removeTag: (tagId: string) => Promise<void>
  reorderTags: (activeTagId: string, overTagId: string) => Promise<void>
  setProjectTags: (projectId: string, tagIds: string[]) => Promise<void>
  startRuntime: (projectId: string) => Promise<void>
  stopRuntime: (projectId: string) => Promise<void>
  openTerminal: (projectId: string, statusHint?: string) => Promise<boolean>
}
