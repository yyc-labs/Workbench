import type { RunTask, RunTaskCandidate, RunTaskConfigFile, RunTaskConfigReadResult, RunTaskProgressEvent } from './runTasks'
import type {
  AgentHookEnvelope,
  AgentHookGatewayStatus,
  AgentLogDetail,
  AgentLogSource,
  AgentLogSummary,
  AiCommitRunOverride,
  AiCommitTaskSnapshot,
  AiCommitUndoCloseReason,
  AiCommitUndoResult,
  AiConnectionTestRequest,
  AiConnectionTestResult,
  AiGatewayBindingResult,
  AiGatewayClientCli,
  AiGatewayConfig,
  AiGatewayLogEntry,
  AiGatewaySaveConfigResult,
  AiGatewayStatus,
  AiRuntimeProfile,
  AppCacheLocationInfo,
  AppConfig,
  AppViewPath,
  BrowserAiConfig,
  BrowserAiConnectionTestResult,
  BrowserAiContextPreview,
  BrowserAiRunTaskPayload,
  BrowserAiSaveResultPayload,
  BrowserAiSaveTaskRecordPayload,
  BrowserAiSnapshot,
  BrowserAiTaskRecord,
  BrowserAiTaskRecordSummary,
  BrowserAiTaskResult,
  BrowserDataCleanupResult,
  BrowserDataMaintenanceInfo,
  BrowserScreenshotProgress,
  BrowserScreenshotRequest,
  BrowserScreenshotResult,
  BrowserScreenshotTarget,
  Capability,
  ClaudeBashrcConfig,
  CodexEnvironmentScope,
  CodexGatewayBinding,
  CodexGatewayBindingResult,
  CodexGatewayBindingSaveInput,
  CodexSettingsInput,
  CodexSettingsSaveResult,
  CodexSettingsSnapshot,
  DocLinkLibraryFile,
  GitConflictFileRequest,
  GitConflictFileResult,
  GitFileDiffRequest,
  GitFileDiffResult,
  GitOperationRequest,
  GitOperationResult,
  GitRepositoryListResult,
  GitRepositorySnapshot,
  GitResolveConflictRequest,
  GitResolveConflictResult,
  GitSetFileStageRequest,
  GitSetFileStageResult,
  LearningCategory,
  LearningCreateCategoryPayload,
  LearningCreateNotePayload,
  LearningNote,
  LearningNoteSummary,
  LearningSearchResult,
  LearningUpdateCategoryPayload,
  LearningUpdateNotePayload,
  LegacyUserDataMigrationInfo,
  LegacyUserDataMigrationResult,
  ManagedProcessSnapshot,
  MarkdownDocumentHistoryEntry,
  MarkdownDocumentImageSaveResult,
  MarkdownDocumentOpenRequest,
  MarkdownDocumentReadResult,
  MarkdownDocumentWriteResult,
  ProcessInfo,
  ProcessPortInventory,
  ProjectFileAutoLoadDecision,
  ProjectFileContentSearchOptions,
  ProjectFileContentSearchResponse,
  ProjectFileNode,
  ProjectFileReadResult,
  ProjectFileStatResult,
  ProjectFileTreeOptions,
  ProjectFileTreeResult,
  ProjectFileWriteImageResult,
  ProjectFileWriteResult,
  ProjectFileZipResult,
  ProjectInfo,
  RuntimeDiagnostics,
  RuntimeEntry,
  RuntimeSessionInfo,
  Skill,
  SkillCategory,
  SkillCreateCategoryPayload,
  SkillCreatePayload,
  SkillSummary,
  SkillUpdateCategoryPayload,
  SkillUpdatePayload,
  TerminalProcessInventory,
  TerminalStopAllResult,
  TmuxSessionInfo,
  TranscriptCaptureInitialText,
  TranscriptExternalImportPayload,
  TranscriptFileReference,
  TranscriptGatewayImportPayload,
  TranscriptImportedEvent,
  TranscriptImportPayload,
  TranscriptSession,
  TranscriptSessionSummary,
  TranscriptShareListResult,
  TranscriptShareStartPayload,
  TranscriptShareStartResult,
  TranscriptUpdatePayload,
  UpsertSharedDocLinkInput,
} from './types'

export type ElectronApiSubscription<T> = (cb: (data: T) => void) => () => void
export type ElectronApiSignalSubscription = (cb: () => void) => () => void

export type ProcessOutputEvent = { projectId: string; data: string }
export type ProcessStatusEvent = { projectId: string; status: string }
export type ProcessExitEvent = { projectId: string; code: number | null }
export type RuntimeStateChangedEvent = { reason: string; projectId?: string; sessionName?: string }
export type AiCommitStatusEvent = { projectId: string; status: 'running' | 'success' | 'error' }
export type WindowStateEvent = { isMaximized: boolean }
export type AppNavigateEvent = { path: string }
export type WindowCaptureRect = { x: number; y: number; width: number; height: number }
export type TrayPanelSize = { width: number; height: number }
export type DocLinkSecretResult = { secret: string | null }
export type TranscriptGatewayImportResult = {
  ok: boolean
  projectId: string
  sessionId: string
  title: string
  sourceType: string
  openViewer: boolean
}
export type LatestCommitSummary = {
  hash: string
  shortHash: string
  subject: string
  committedAt: string
  bullets: string[]
  filesChanged: number
}
export type OpenSshTerminalPayload = {
  host: string
  port?: number
  username: string
  password?: string | null
  route?: 'wsl' | 'windows'
}
export type OpenSshTerminalResult = {
  ok: boolean
  mode: 'wsl-expect' | 'native-ssh'
  autoLogin: boolean
  message?: string
  reason?: 'invalid-input' | 'windows-host-required' | 'wsl-not-installed' | 'wsl-distro-unavailable' | 'wsl-bash-unavailable' | 'wsl-expect-unavailable' | 'terminal-launch-failed'
}

export interface CoreElectronApi {
  detectProjects: (path: string) => Promise<ProjectInfo | null>
  startProcess: (id: string, cmd: string, cwd: string, useWsl?: boolean) => Promise<boolean>
  stopProcess: (id: string) => Promise<boolean>
  sendInput: (id: string, data: string) => Promise<boolean>
  getConfig: () => Promise<AppConfig>
  setConfig: (config: Record<string, unknown>) => Promise<AppConfig>
  restartApp: () => Promise<boolean>
  getCacheLocationInfo: () => Promise<AppCacheLocationInfo>
  getLegacyUserDataMigrationInfo: () => Promise<LegacyUserDataMigrationInfo>
  migrateLegacyUserData: () => Promise<LegacyUserDataMigrationResult>
  getBrowserDataMaintenanceInfo: () => Promise<BrowserDataMaintenanceInfo>
  cleanupLegacyBrowserCaches: (rootPath?: string) => Promise<BrowserDataCleanupResult>
  getCodexEnvironmentScope: () => Promise<CodexEnvironmentScope>
  getCodexSettings: () => Promise<CodexSettingsSnapshot>
  setCodexSettings: (payload: CodexSettingsInput) => Promise<CodexSettingsSaveResult>
  getClaudeBashrcConfig: () => Promise<ClaudeBashrcConfig>
  setClaudeBashrcConfig: (config: ClaudeBashrcConfig) => Promise<ClaudeBashrcConfig>
  setWindowsUserEnv: (config: ClaudeBashrcConfig) => Promise<ClaudeBashrcConfig>
  setDocLinkSecret: (projectId: string, linkId: string, secret: string) => Promise<boolean>
  getDocLinkSecret: (projectId: string, linkId: string) => Promise<DocLinkSecretResult>
  deleteDocLinkSecret: (projectId: string, linkId: string) => Promise<boolean>
  selectDirectory: (defaultPath?: string) => Promise<string | null>
  getPathForFile: (file: File) => string
  readClipboardImagePngBase64: () => string | null
  readClipboardText: () => string
  consumeTranscriptCaptureInitialText: () => Promise<TranscriptCaptureInitialText>
  captureWindowRectToPngBase64: (rect: WindowCaptureRect) => Promise<string>
  writeClipboardImagePngBase64: (pngBase64: string) => Promise<boolean>
  readLocalImageAsDataUrl: (source: string) => Promise<string>
  openExternal: (url: string) => Promise<void>
  openFolder: (folderPath: string, revealPath?: string) => Promise<void>
  openInVsCode: (folderPath: string) => Promise<void>
  minimizeWindow: () => Promise<boolean>
  toggleMaximizeWindow: () => Promise<boolean>
  closeWindow: () => Promise<boolean>
  isWindowMaximized: () => Promise<boolean>
  openAppViewWindow: (viewPath: AppViewPath) => Promise<boolean>
  hasAppViewWindow: (viewPath: AppViewPath) => Promise<boolean>
  trayPanelShowMainWindow: () => Promise<boolean>
  trayPanelHideMainWindow: () => Promise<boolean>
  trayPanelQuitApp: () => Promise<boolean>
  trayPanelDismiss: () => Promise<boolean>
  trayPanelResizeToContent: (size: TrayPanelSize) => Promise<boolean>
  runAiCommit: (projectId: string, repoRoot: string, override?: AiCommitRunOverride) => Promise<boolean>
  cancelAiCommit: (projectId: string) => Promise<boolean>
  getAiCommitState: (projectId: string) => Promise<AiCommitTaskSnapshot | null>
  beginAiCommitUndoAuth: (projectId: string) => Promise<AiCommitTaskSnapshot | null>
  cancelAiCommitUndoAuth: (projectId: string) => Promise<AiCommitTaskSnapshot | null>
  undoAiCommit: (projectId: string) => Promise<AiCommitUndoResult>
  closeAiCommitUndo: (projectId: string, reason?: AiCommitUndoCloseReason) => Promise<AiCommitTaskSnapshot | null>
  getAgentHookStatus: () => Promise<AgentHookGatewayStatus>
  getAgentHookRecentEvents: () => Promise<AgentHookEnvelope[]>
}

export interface AgentLogsElectronApi {
  getAgentLogSummaries: () => Promise<AgentLogSummary[]>
  clearAgentLogs: () => Promise<boolean>
  getAgentLogDetail: (source: AgentLogSource, id: string) => Promise<AgentLogDetail | null>
}

export interface AiConnectionElectronApi {
  testAiConnection: (input: AiConnectionTestRequest) => Promise<AiConnectionTestResult>
}

export interface AiGatewayElectronApi {
  getAiGatewayStatus: () => Promise<AiGatewayStatus>
  getAiGatewayConfig: () => Promise<AiGatewayConfig>
  getAiGatewayRecentLogs: () => Promise<AiGatewayLogEntry[]>
  saveAiGatewayConfig: (config: AiGatewayConfig) => Promise<AiGatewaySaveConfigResult>
  startAiGateway: () => Promise<AiGatewayStatus>
  stopAiGateway: () => Promise<AiGatewayStatus>
  applyAiGatewayClientBinding: (cli: AiGatewayClientCli) => Promise<AiGatewayBindingResult>
  restoreAiGatewayClientBinding: (cli: AiGatewayClientCli) => Promise<AiGatewayBindingResult>
  getCodexGatewayBinding: () => Promise<CodexGatewayBinding | null>
  saveCodexGatewayBinding: (input: CodexGatewayBindingSaveInput) => Promise<CodexGatewayBindingResult>
}

export interface GitElectronApi {
  getLatestCommit: (repoRoot: string) => Promise<LatestCommitSummary[]>
  listGitRepositories: (workspacePath: string) => Promise<GitRepositoryListResult>
  getGitRepositorySnapshot: (repoRoot: string) => Promise<GitRepositorySnapshot>
  runGitOperation: (request: GitOperationRequest) => Promise<GitOperationResult>
  setGitFileStage: (request: GitSetFileStageRequest) => Promise<GitSetFileStageResult>
  getGitFileDiff: (request: GitFileDiffRequest) => Promise<GitFileDiffResult>
  getGitConflictFile: (request: GitConflictFileRequest) => Promise<GitConflictFileResult>
  resolveGitConflictFile: (request: GitResolveConflictRequest) => Promise<GitResolveConflictResult>
}

export interface ProjectFileElectronApi {
  getProjectFileAutoLoadDecision: (projectPath: string) => Promise<ProjectFileAutoLoadDecision>
  listProjectFiles: (projectPath: string, options?: ProjectFileTreeOptions) => Promise<ProjectFileTreeResult>
  listProjectDirectoryFiles: (projectPath: string, directoryRelativePath: string | null) => Promise<ProjectFileTreeResult>
  searchProjectFiles: (projectPath: string, query: string, folderRelativePath?: string) => Promise<ProjectFileNode[]>
  searchProjectContent: (projectPath: string, query: string, options?: ProjectFileContentSearchOptions) => Promise<ProjectFileContentSearchResponse>
  readProjectFile: (projectPath: string, relativePath: string) => Promise<ProjectFileReadResult>
  statProjectFile: (projectPath: string, relativePath: string) => Promise<ProjectFileStatResult>
  writeProjectFile: (projectPath: string, relativePath: string, content: string, expectedMtimeMs?: number) => Promise<ProjectFileWriteResult>
  writeProjectImageFile: (projectPath: string, targetDirectoryRelativePath: string, extension: string, dataBase64: string) => Promise<ProjectFileWriteImageResult>
  openProjectFilePath: (projectPath: string, relativePath: string) => Promise<{ ok: boolean; error?: string }>
  zipProjectFolder: (projectPath: string, folderRelativePath: string, zipName: string) => Promise<ProjectFileZipResult>
  copyProjectFolderZipToClipboard: (projectPath: string, folderRelativePath: string, zipName: string) => Promise<{ name: string; size: number }>
  copyProjectFileToClipboard: (projectPath: string, fileRelativePath: string) => Promise<{ name: string; size: number }>
}

export interface MarkdownDocumentElectronApi {
  selectMarkdownDocument: () => Promise<string | null>
  readMarkdownDocument: (path: string) => Promise<MarkdownDocumentReadResult>
  writeMarkdownDocument: (path: string, content: string, expectedMtimeMs: number) => Promise<MarkdownDocumentWriteResult>
  listMarkdownDocumentHistory: () => Promise<MarkdownDocumentHistoryEntry[]>
  removeMarkdownDocumentHistory: (path: string) => Promise<MarkdownDocumentHistoryEntry[]>
  clearMarkdownDocumentHistory: () => Promise<void>
  saveMarkdownDocumentPastedImageAs: (dataBase64: string, extension: string, suggestedName?: string) => Promise<MarkdownDocumentImageSaveResult | null>
  consumePendingMarkdownDocumentOpen: () => Promise<MarkdownDocumentOpenRequest | null>
  routeMarkdownDocumentOpen: (filePath: string) => Promise<boolean>
}

export interface DocLinkLibraryElectronApi {
  listDocLinkLibrary: () => Promise<DocLinkLibraryFile>
  createDocLinkGroup: (name: string) => Promise<DocLinkLibraryFile>
  renameDocLinkGroup: (groupId: string, name: string) => Promise<DocLinkLibraryFile>
  removeDocLinkGroup: (groupId: string) => Promise<DocLinkLibraryFile>
  upsertSharedDocLink: (input: UpsertSharedDocLinkInput) => Promise<DocLinkLibraryFile>
  removeSharedDocLink: (linkId: string) => Promise<DocLinkLibraryFile>
  reorderSharedDocLinks: (groupId: string, orderedLinkIds: string[]) => Promise<DocLinkLibraryFile>
  setSharedDocLinkSecret: (linkId: string, secret: string) => Promise<void>
  getSharedDocLinkSecret: (linkId: string) => Promise<DocLinkSecretResult>
  deleteSharedDocLinkSecret: (linkId: string) => Promise<void>
}

export interface TranscriptElectronApi {
  importTranscript: (payload: TranscriptImportPayload) => Promise<TranscriptSession>
  importExternalTranscript: (payload: TranscriptExternalImportPayload) => Promise<TranscriptImportedEvent>
  importTranscriptViaGateway: (payload: TranscriptGatewayImportPayload) => Promise<TranscriptGatewayImportResult>
  listProjectTranscripts: (projectId: string) => Promise<TranscriptSessionSummary[]>
  listProjectTranscriptFileReferences: (projectId: string, relativePath: string) => Promise<TranscriptFileReference[]>
  listAllTranscripts: () => Promise<Array<{ projectId: string; summaries: TranscriptSessionSummary[] }>>
  getTranscript: (projectId: string, transcriptId: string) => Promise<TranscriptSession | null>
  updateTranscript: (payload: TranscriptUpdatePayload) => Promise<TranscriptSession>
  deleteTranscript: (projectId: string, transcriptId: string) => Promise<boolean>
  startTranscriptShare: (payload: TranscriptShareStartPayload) => Promise<TranscriptShareStartResult>
  stopTranscriptShare: (token: string) => Promise<TranscriptShareListResult>
  listTranscriptShares: () => Promise<TranscriptShareListResult>
}

export interface LearningElectronApi {
  listLearningCategories: () => Promise<LearningCategory[]>
  createLearningCategory: (payload: LearningCreateCategoryPayload) => Promise<LearningCategory[]>
  updateLearningCategory: (payload: LearningUpdateCategoryPayload) => Promise<LearningCategory[]>
  deleteLearningCategory: (categoryId: string) => Promise<LearningCategory[]>
  listLearningNotes: () => Promise<LearningNoteSummary[]>
  searchLearningNotes: (query: string) => Promise<LearningSearchResult[]>
  getLearningNote: (noteId: string) => Promise<LearningNote | null>
  createLearningNote: (payload?: LearningCreateNotePayload) => Promise<LearningNote>
  updateLearningNote: (payload: LearningUpdateNotePayload) => Promise<LearningNote>
  deleteLearningNote: (noteId: string) => Promise<boolean>
}

export interface SkillElectronApi {
  listSkillCategories: () => Promise<SkillCategory[]>
  createSkillCategory: (payload: SkillCreateCategoryPayload) => Promise<SkillCategory[]>
  updateSkillCategory: (payload: SkillUpdateCategoryPayload) => Promise<SkillCategory[]>
  deleteSkillCategory: (categoryId: string) => Promise<SkillCategory[]>
  listSkills: () => Promise<SkillSummary[]>
  getSkill: (skillId: string) => Promise<Skill | null>
  createSkill: (payload?: SkillCreatePayload) => Promise<Skill>
  updateSkill: (payload: SkillUpdatePayload) => Promise<Skill>
  deleteSkill: (skillId: string) => Promise<boolean>
}

export interface BrowserAiElectronApi {
  getBrowserAiConfig: () => Promise<BrowserAiSnapshot>
  saveBrowserAiConfig: (config: BrowserAiConfig) => Promise<BrowserAiSnapshot>
  startBrowserAi: () => Promise<BrowserAiSnapshot>
  stopBrowserAi: () => Promise<BrowserAiSnapshot>
  testBrowserAiConnection: () => Promise<BrowserAiConnectionTestResult>
  openBrowserAiLogin: () => Promise<BrowserAiSnapshot>
  composeBrowserAiPreview: (payload: BrowserAiRunTaskPayload) => Promise<BrowserAiContextPreview>
  runBrowserAiTask: (payload: BrowserAiRunTaskPayload) => Promise<BrowserAiTaskResult>
  cancelBrowserAiTask: () => Promise<BrowserAiSnapshot>
  saveBrowserAiResult: (payload: BrowserAiSaveResultPayload) => Promise<import('./types').LearningNote>
  listBrowserAiTaskRecords: () => Promise<BrowserAiTaskRecordSummary[]>
  getBrowserAiTaskRecord: (recordId: string) => Promise<BrowserAiTaskRecord | null>
  saveBrowserAiTaskRecord: (payload: BrowserAiSaveTaskRecordPayload) => Promise<BrowserAiTaskRecord>
  deleteBrowserAiTaskRecord: (recordId: string) => Promise<boolean>
}

export interface BrowserScreenshotElectronApi {
  listBrowserScreenshotTargets: () => Promise<BrowserScreenshotTarget[]>
  startBrowserScreenshot: (request: BrowserScreenshotRequest) => Promise<BrowserScreenshotResult>
  cancelBrowserScreenshot: (taskId: string) => Promise<boolean>
  saveBrowserScreenshot: (pngBase64: string, suggestedName?: string) => Promise<boolean>
  openBrowserScreenshotInDefaultApp: (pngBase64: string, suggestedName?: string) => Promise<boolean>
  openBrowserScreenshotViewer: (payload: import('./types').BrowserScreenshotViewerPayload) => Promise<boolean>
  getBrowserScreenshotViewerData: () => Promise<import('./types').BrowserScreenshotViewerPayload | null>
  toggleBrowserScreenshotWindow: () => Promise<boolean>
  markBrowserScreenshotViewerReady: () => Promise<boolean>
  startPreviewPageCapture: (request: import('./types').PreviewPageCaptureRequest) => Promise<import('./types').PreviewPageCaptureResult>
  cancelPreviewPageCapture: () => Promise<boolean>
  onBrowserScreenshotTargetsChanged: ElectronApiSubscription<import('./types').BrowserScreenshotTargetsChanged>
}

export interface RuntimeElectronApi {
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<boolean>
  getCapability: () => Promise<Capability>
  listTmuxSessions: () => Promise<TmuxSessionInfo[]>
  killTmuxSession: (sessionName: string) => Promise<boolean>
  listTerminalProcesses: () => Promise<TerminalProcessInventory>
  listManagedProcesses: () => Promise<ManagedProcessSnapshot[]>
  stopAllTerminalProcesses: () => Promise<TerminalStopAllResult>
  startRuntime: (projectId: string, projectPath: string, profile?: AiRuntimeProfile | null, cli?: 'claude' | 'codex') => Promise<boolean>
  getRuntimeDiagnostics: (profile?: AiRuntimeProfile | null) => Promise<RuntimeDiagnostics>
  listRuntimeSessions: () => Promise<RuntimeSessionInfo[]>
  listRuntimeEntries: () => Promise<RuntimeEntry[]>
  openTerminal: (sessionName: string, statusHint?: string) => Promise<boolean>
  openPathTerminal: (folderPath: string, command?: string) => Promise<boolean>
  getInteractiveShellCommand: (useWsl: boolean) => Promise<{ command: string; shellKind: string }>
  openSshTerminal: (payload: OpenSshTerminalPayload) => Promise<OpenSshTerminalResult>
}

export interface ProcessPortsElectronApi {
  listProcessPorts: () => Promise<ProcessPortInventory>
}

export interface RunTaskElectronApi {
  getRunTaskConfig: (projectPath: string) => Promise<RunTaskConfigReadResult>
  saveRunTaskConfig: (projectPath: string, tasks: RunTaskConfigFile['tasks'], scanDirectories?: string[]) => Promise<RunTaskConfigReadResult>
  detectRunTaskCandidates: (projectPath: string, scanDirectories?: string[]) => Promise<RunTaskCandidate[]>
  startRunTask: (projectId: string, projectPath: string, task: RunTask) => Promise<boolean>
  startAllRunTasks: (projectId: string, projectPath: string, tasks?: RunTask[]) => Promise<{ started: boolean; error?: string }>
  stopRunTask: (projectId: string, taskId: string) => Promise<boolean>
  stopAllRunTasks: (projectId: string) => Promise<boolean>
  getRunTaskState: (projectId: string) => Promise<RunTaskProgressEvent | null>
  checkRunTaskDocker: (projectPath: string, tasks: RunTask[]) => Promise<{ required: boolean; running: boolean }>
  startDockerDaemon: (projectPath: string, tasks: RunTask[]) => Promise<{ ready: boolean; error?: string }>
}

export interface SubscriptionElectronApi {
  onProcessOutput: ElectronApiSubscription<ProcessOutputEvent>
  onRunTaskProgress: ElectronApiSubscription<RunTaskProgressEvent>
  onRunTaskConfigChanged: ElectronApiSubscription<string>
  onProcessStatus: ElectronApiSubscription<ProcessStatusEvent>
  onProcessExit: ElectronApiSubscription<ProcessExitEvent>
  onRuntimeStateChanged: ElectronApiSubscription<RuntimeStateChangedEvent>
  onAiCommitOutput: ElectronApiSubscription<ProcessOutputEvent>
  onAiCommitStatus: ElectronApiSubscription<AiCommitStatusEvent>
  onAgentHookEvent: ElectronApiSubscription<AgentHookEnvelope>
  onTranscriptImported: ElectronApiSubscription<TranscriptImportedEvent>
  onBrowserAiProgress: ElectronApiSubscription<import('./types').BrowserAiTaskProgressEvent>
  onBrowserScreenshotProgress: ElectronApiSubscription<BrowserScreenshotProgress>
  onBrowserScreenshotViewerData: ElectronApiSubscription<import('./types').BrowserScreenshotViewerPayload>
  onWindowState: ElectronApiSubscription<WindowStateEvent>
  onAppNavigate: ElectronApiSubscription<AppNavigateEvent>
  onCodeFocusSearch: ElectronApiSignalSubscription
  onCodeToggleViewMode: ElectronApiSignalSubscription
  onGlobalHomeShortcut: ElectronApiSignalSubscription
  onGlobalThemeShortcut: ElectronApiSignalSubscription
  onMarkdownDocumentOpenRequested: ElectronApiSubscription<MarkdownDocumentOpenRequest>
}

export type ElectronApi = CoreElectronApi &
  AgentLogsElectronApi &
  AiConnectionElectronApi &
  AiGatewayElectronApi &
  GitElectronApi &
  ProjectFileElectronApi &
  MarkdownDocumentElectronApi &
  DocLinkLibraryElectronApi &
  TranscriptElectronApi &
  LearningElectronApi &
  SkillElectronApi &
  BrowserAiElectronApi &
  BrowserScreenshotElectronApi &
  RuntimeElectronApi &
  ProcessPortsElectronApi &
  RunTaskElectronApi &
  SubscriptionElectronApi
