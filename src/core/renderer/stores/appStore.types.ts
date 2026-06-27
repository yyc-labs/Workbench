import type {
  AiCommitTaskSnapshot,
  AiCommitUndoCloseReason,
  AiCommitUndoResult,
  ClaudeBashrcConfig,
  CodexEnvironmentScope,
  CodexSettingsInput,
  CodexSettingsSaveResult,
  CodexSettingsSnapshot,
  ClaudeRuntimeProfile,
  AiRuntimeProfile,
  ProjectFileContentSearchResponse,
  ProjectFileContentSearchOptions,
  ProjectFileNode,
  ProjectFileReadResult,
  ProjectFileStatResult,
  ProjectFileTreeResult,
  ProjectFileWriteImageResult,
  ProjectFileWriteResult,
  ProjectInfo,
  ProcessInfo,
  AppConfig,
  Capability,
  RuntimeSessionInfo,
  TmuxSessionInfo,
  SessionRuntime,
  RuntimeEntry,
  ProjectDocLink,
  RuntimeDiagnostics,
  ProjectFolder,
  ProjectTag,
  ProjectDocTagOption,
  StartupDefaultFilter,
  TerminalProcessInventory,
  TerminalStopAllResult,
  GitRepositorySnapshot,
  GitRepositoryListResult,
  GitOperationRequest,
  GitOperationResult,
  GitSetFileStageRequest,
  GitSetFileStageResult,
  GitFileDiffRequest,
  GitFileDiffResult,
  GitConflictFileRequest,
  GitConflictFileResult,
  GitResolveConflictRequest,
  GitResolveConflictResult,
  ProjectCodeFileDrawerState,
  ProjectCodeSession,
  AgentHookEnvelope,
  AgentHookGatewayStatus,
  TranscriptGatewayImportPayload,
  TranscriptImportedEvent,
  TranscriptImportPayload,
  TranscriptSession,
  TranscriptSessionSummary,
  TranscriptShareListResult,
  TranscriptShareStartPayload,
  TranscriptShareStartResult,
  TranscriptUpdatePayload,
  TranscriptViewerMode,
  TranscriptViewerRequest,
  LearningCategory,
  LearningCreateCategoryPayload,
  LearningCreateNotePayload,
  LearningNote,
  LearningNoteSummary,
  LearningUpdateCategoryPayload,
  LearningUpdateNotePayload,
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
      getCodexEnvironmentScope: () => Promise<CodexEnvironmentScope>
      getCodexSettings: () => Promise<CodexSettingsSnapshot>
      setCodexSettings: (payload: CodexSettingsInput) => Promise<CodexSettingsSaveResult>
      getClaudeBashrcConfig: () => Promise<ClaudeBashrcConfig>
      setClaudeBashrcConfig: (config: ClaudeBashrcConfig) => Promise<ClaudeBashrcConfig>
      setWindowsUserEnv: (config: ClaudeBashrcConfig) => Promise<ClaudeBashrcConfig>
      setDocLinkSecret: (projectId: string, linkId: string, secret: string) => Promise<boolean>
      getDocLinkSecret: (projectId: string, linkId: string) => Promise<{ secret: string | null }>
      deleteDocLinkSecret: (projectId: string, linkId: string) => Promise<boolean>
      selectDirectory: (defaultPath?: string) => Promise<string | null>
      getPathForFile: (file: File) => string
      readClipboardImagePngBase64: () => string | null
      captureWindowRectToPngBase64: (
        rect: { x: number; y: number; width: number; height: number }
      ) => Promise<string>
      writeClipboardImagePngBase64: (pngBase64: string) => Promise<boolean>
      readLocalImageAsDataUrl: (source: string) => Promise<string>
      onProcessOutput: (cb: (d: { projectId: string; data: string }) => void) => () => void
      onProcessStatus: (cb: (d: { projectId: string; status: string }) => void) => () => void
      onProcessExit: (cb: (d: { projectId: string; code: number | null }) => void) => () => void
      onRuntimeStateChanged: (
        cb: (d: { reason: string; projectId?: string; sessionName?: string }) => void
      ) => () => void
      openExternal: (url: string) => Promise<void>
      resizeTerminal: (id: string, cols: number, rows: number) => Promise<boolean>
      getCapability: () => Promise<Capability>
      listTmuxSessions: () => Promise<TmuxSessionInfo[]>
      killTmuxSession: (sessionName: string) => Promise<boolean>
      listTerminalProcesses: () => Promise<TerminalProcessInventory>
      stopAllTerminalProcesses: () => Promise<TerminalStopAllResult>
      startRuntime: (
        projectId: string,
        projectPath: string,
        profile?: AiRuntimeProfile | null,
        cli?: 'claude' | 'codex'
      ) => Promise<boolean>
      getRuntimeDiagnostics: (profile?: AiRuntimeProfile | null) => Promise<RuntimeDiagnostics>
      listRuntimeSessions: () => Promise<RuntimeSessionInfo[]>
      listRuntimeEntries: () => Promise<RuntimeEntry[]>
      listProjectFiles: (projectPath: string) => Promise<ProjectFileTreeResult>
      listProjectDirectoryFiles: (
        projectPath: string,
        directoryRelativePath: string | null
      ) => Promise<ProjectFileTreeResult>
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
      writeProjectImageFile: (
        projectPath: string,
        targetDirectoryRelativePath: string,
        extension: string,
        dataBase64: string
      ) => Promise<ProjectFileWriteImageResult>
      importTranscript: (payload: TranscriptImportPayload) => Promise<TranscriptSession>
      importTranscriptViaGateway: (payload: TranscriptGatewayImportPayload) => Promise<{
        ok: boolean
        projectId: string
        sessionId: string
        title: string
        sourceType: string
        openViewer: boolean
      }>
      listProjectTranscripts: (projectId: string) => Promise<TranscriptSessionSummary[]>
      listAllTranscripts: () => Promise<Array<{ projectId: string; summaries: TranscriptSessionSummary[] }>>
      getTranscript: (projectId: string, transcriptId: string) => Promise<TranscriptSession | null>
      updateTranscript: (payload: TranscriptUpdatePayload) => Promise<TranscriptSession>
      deleteTranscript: (projectId: string, transcriptId: string) => Promise<boolean>
      startTranscriptShare: (payload: TranscriptShareStartPayload) => Promise<TranscriptShareStartResult>
      stopTranscriptShare: (token: string) => Promise<TranscriptShareListResult>
      listTranscriptShares: () => Promise<TranscriptShareListResult>
      listLearningCategories: () => Promise<LearningCategory[]>
      createLearningCategory: (payload: LearningCreateCategoryPayload) => Promise<LearningCategory[]>
      updateLearningCategory: (payload: LearningUpdateCategoryPayload) => Promise<LearningCategory[]>
      deleteLearningCategory: (categoryId: string) => Promise<LearningCategory[]>
      listLearningNotes: () => Promise<LearningNoteSummary[]>
      getLearningNote: (noteId: string) => Promise<LearningNote | null>
      createLearningNote: (payload?: LearningCreateNotePayload) => Promise<LearningNote>
      updateLearningNote: (payload: LearningUpdateNotePayload) => Promise<LearningNote>
      deleteLearningNote: (noteId: string) => Promise<boolean>
      openTerminal: (sessionName: string, statusHint?: string) => Promise<boolean>
      openPathTerminal: (folderPath: string, command?: string) => Promise<boolean>
      openSshTerminal: (
        payload: {
          host: string
          port?: number
          username: string
          password?: string | null
          route?: 'wsl' | 'windows'
        }
      ) => Promise<{
        ok: boolean
        mode: 'wsl-expect' | 'native-ssh'
        autoLogin: boolean
        message?: string
        reason?:
          | 'invalid-input'
          | 'windows-host-required'
          | 'wsl-not-installed'
          | 'wsl-distro-unavailable'
          | 'wsl-bash-unavailable'
          | 'wsl-expect-unavailable'
          | 'terminal-launch-failed'
      }>
      openFolder: (folderPath: string, revealPath?: string) => Promise<void>
      openInVsCode: (folderPath: string) => Promise<void>
      minimizeWindow: () => Promise<boolean>
      toggleMaximizeWindow: () => Promise<boolean>
      closeWindow: () => Promise<boolean>
      isWindowMaximized: () => Promise<boolean>
      runAiCommit: (
        projectId: string,
        repoRoot: string,
        override?: { split?: boolean; splitMaxBatches?: number; maxBullets?: number }
      ) => Promise<boolean>
      getAiCommitState: (projectId: string) => Promise<AiCommitTaskSnapshot | null>
      beginAiCommitUndoAuth: (projectId: string) => Promise<AiCommitTaskSnapshot | null>
      cancelAiCommitUndoAuth: (projectId: string) => Promise<AiCommitTaskSnapshot | null>
      undoAiCommit: (projectId: string) => Promise<AiCommitUndoResult>
      closeAiCommitUndo: (
        projectId: string,
        reason?: AiCommitUndoCloseReason
      ) => Promise<AiCommitTaskSnapshot | null>
      getAgentHookStatus: () => Promise<AgentHookGatewayStatus>
      getAgentHookRecentEvents: () => Promise<AgentHookEnvelope[]>
      getLatestCommit: (repoRoot: string) => Promise<{
        hash: string
        shortHash: string
        subject: string
        committedAt: string
        bullets: string[]
        filesChanged: number
      }[]>
      listGitRepositories: (workspacePath: string) => Promise<GitRepositoryListResult>
      getGitRepositorySnapshot: (repoRoot: string) => Promise<GitRepositorySnapshot>
      runGitOperation: (request: GitOperationRequest) => Promise<GitOperationResult>
      setGitFileStage: (request: GitSetFileStageRequest) => Promise<GitSetFileStageResult>
      getGitFileDiff: (request: GitFileDiffRequest) => Promise<GitFileDiffResult>
      getGitConflictFile: (request: GitConflictFileRequest) => Promise<GitConflictFileResult>
      resolveGitConflictFile: (request: GitResolveConflictRequest) => Promise<GitResolveConflictResult>
      onAiCommitOutput: (cb: (d: { projectId: string; data: string }) => void) => () => void
      onAiCommitStatus: (
        cb: (d: { projectId: string; status: 'running' | 'success' | 'error' }) => void
      ) => () => void
      onAgentHookEvent: (cb: (d: AgentHookEnvelope) => void) => () => void
      onTranscriptImported: (cb: (d: TranscriptImportedEvent) => void) => () => void
      onWindowState: (cb: (d: { isMaximized: boolean }) => void) => () => void
      onCodeFocusSearch: (cb: () => void) => () => void
      onCodeToggleViewMode: (cb: () => void) => () => void
      onGlobalHomeShortcut: (cb: () => void) => () => void
      onGlobalThemeShortcut: (cb: () => void) => () => void
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
  runtimeModeSwitchCooldownUntil: number
  transcriptSummariesByProjectId: Record<string, TranscriptSessionSummary[]>
  transcriptSessions: Record<string, TranscriptSession>
  activeTranscriptIdByProjectId: Record<string, string | undefined>
  transcriptModeBySessionId: Record<string, TranscriptViewerMode | undefined>
  activeTranscriptReferenceIdBySessionId: Record<string, string | undefined>
  transcriptListStatusByProjectId: Record<string, 'idle' | 'loading' | 'ready' | 'error'>

  loadConfig: () => Promise<void>
  setTheme: (theme: AppConfig['theme']) => Promise<void>
  setLocale: (locale: NonNullable<AppConfig['locale']>) => Promise<void>
  setAiEnvironmentConfig: (aiEnvironment: NonNullable<AppConfig['aiEnvironment']>) => Promise<void>
  setRuntimeLauncherScript: (scriptPath: string) => Promise<void>
  setRuntimeKeepAliveOnQuit: (enabled: boolean) => Promise<void>
  setAiCommitConfig: (aiCommit: NonNullable<AppConfig['aiCommit']>) => Promise<void>
  setAiRuntimeProfiles: (profiles: AiRuntimeProfile[], activeProfileId: string) => Promise<void>
  loadCodexSettings: () => Promise<CodexSettingsSnapshot>
  saveCodexSettings: (payload: CodexSettingsInput) => Promise<CodexSettingsSnapshot>
  setAgentHookConfig: (agentHooks: NonNullable<AppConfig['agentHooks']>) => Promise<void>
  setClaudeRuntimeProfiles: (profiles: ClaudeRuntimeProfile[], activeProfileId: string) => Promise<void>
  setDocLinkTags: (tags: ProjectDocTagOption[]) => Promise<void>
  initApp: () => Promise<void>
  addProject: (dirPath: string) => Promise<void>
  removeProject: (projectId: string) => Promise<void>
  startProject: (
    projectId: string,
    commandOverride?: string,
    processId?: string,
    useWsl?: boolean,
    cwdOverride?: string,
    runStartupModeOverride?: 'silent' | 'terminal'
  ) => Promise<boolean>
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
  clearProjectLastOpened: (projectId: string) => Promise<void>
  clearProcessUrl: (projectId: string) => void
  loadTmuxSessions: () => Promise<void>
  syncManagedProcesses: () => Promise<void>
  rehydrateProcessUrlsFromStorage: () => void
  refreshSessions: () => Promise<void>
  refreshRuntimeState: (mode?: 'sessions' | 'all') => Promise<void>
  importTranscript: (payload: TranscriptImportPayload) => Promise<TranscriptSession | null>
  importCurrentProcessOutputTranscript: (projectId: string, title?: string) => Promise<TranscriptSession | null>
  loadProjectTranscripts: (projectId: string) => Promise<void>
  loadTranscriptSession: (projectId: string, transcriptId: string) => Promise<TranscriptSession | null>
  openTranscript: (request: TranscriptViewerRequest) => Promise<void>
  upsertTranscriptSession: (
    session: TranscriptSession,
    options?: { activate?: boolean; initialMode?: TranscriptViewerMode }
  ) => void
  openTranscriptReference: (sessionId: string, referenceId: string) => void
  closeTranscriptReference: (sessionId: string) => void
  setTranscriptMode: (sessionId: string, mode: TranscriptViewerMode) => void
  removeTranscriptSession: (projectId: string, transcriptId: string) => Promise<void>
  setProjectCli: (projectId: string, cli: 'claude' | 'codex') => Promise<void>
  setProjectAiRuntimeProfile: (projectId: string, profileId: string) => Promise<void>
  setProjectCustomName: (projectId: string, customName?: string) => Promise<void>
  setProjectCustomType: (projectId: string, customType?: string) => Promise<void>
  setProjectCustomCommand: (projectId: string, customCommand?: string) => Promise<void>
  setProjectRunWorkingDirectory: (projectId: string, runWorkingDirectory?: string) => Promise<void>
  setProjectRunStartupMode: (projectId: string, mode: 'silent' | 'terminal') => Promise<void>
  setProjectDocLinks: (projectId: string, docLinks: ProjectDocLink[]) => Promise<void>
  setProjectLastCodeFile: (projectId: string, relativePath?: string) => Promise<void>
  setProjectCodeSession: (projectId: string, session?: ProjectCodeSession) => Promise<void>
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
