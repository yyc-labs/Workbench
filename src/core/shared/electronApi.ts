import type {
  AgentHookEnvelope,
  AgentHookGatewayStatus,
  AgentLogDetail,
  AgentLogSource,
  AgentLogSummary,
  AiCommitRunOverride,
  AiConnectionTestRequest,
  AiConnectionTestResult,
  AiCommitTaskSnapshot,
  AiCommitUndoCloseReason,
  AiCommitUndoResult,
  AiGatewayBindingResult,
  AiGatewayClientCli,
  AiGatewayConfig,
  AiGatewayLogEntry,
  AiGatewaySaveConfigResult,
  AiGatewayStatus,
  AppCacheLocationInfo,
  AppConfig,
  BrowserDataCleanupResult,
  BrowserDataMaintenanceInfo,
  BrowserAiConfig,
  BrowserAiConnectionTestResult,
  BrowserAiContextPreview,
  BrowserAiRunTaskPayload,
  BrowserAiSaveTaskRecordPayload,
  BrowserAiSaveResultPayload,
  BrowserAiSnapshot,
  BrowserAiTaskRecord,
  BrowserAiTaskRecordSummary,
  BrowserAiTaskResult,
  Capability,
  ClaudeBashrcConfig,
  CodexEnvironmentScope,
  CodexGatewayBinding,
  CodexGatewayBindingResult,
  CodexGatewayBindingSaveInput,
  CodexSettingsInput,
  CodexSettingsSaveResult,
  CodexSettingsSnapshot,
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
  LearningUpdateCategoryPayload,
  LearningUpdateNotePayload,
  Skill,
  SkillCategory,
  SkillCreateCategoryPayload,
  SkillCreatePayload,
  SkillSummary,
  SkillUpdateCategoryPayload,
  SkillUpdatePayload,
  ProcessInfo,
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
  ProjectInfo,
  RuntimeDiagnostics,
  RuntimeEntry,
  RuntimeSessionInfo,
  TerminalProcessInventory,
  TerminalStopAllResult,
  TmuxSessionInfo,
  TranscriptCaptureInitialText,
  TranscriptExternalImportPayload,
  TranscriptFileReference,
  TranscriptGatewayImportPayload,
  TranscriptImportPayload,
  TranscriptImportedEvent,
  TranscriptSession,
  TranscriptSessionSummary,
  TranscriptShareListResult,
  TranscriptShareStartPayload,
  TranscriptShareStartResult,
  TranscriptUpdatePayload,
} from './types'
import type { AiRuntimeProfile } from './types'

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
  searchProjectFiles: (projectPath: string, query: string) => Promise<ProjectFileNode[]>
  searchProjectContent: (projectPath: string, query: string, options?: ProjectFileContentSearchOptions) => Promise<ProjectFileContentSearchResponse>
  readProjectFile: (projectPath: string, relativePath: string) => Promise<ProjectFileReadResult>
  statProjectFile: (projectPath: string, relativePath: string) => Promise<ProjectFileStatResult>
  writeProjectFile: (projectPath: string, relativePath: string, content: string, expectedMtimeMs?: number) => Promise<ProjectFileWriteResult>
  writeProjectImageFile: (projectPath: string, targetDirectoryRelativePath: string, extension: string, dataBase64: string) => Promise<ProjectFileWriteImageResult>
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

export interface RuntimeElectronApi {
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<boolean>
  getCapability: () => Promise<Capability>
  listTmuxSessions: () => Promise<TmuxSessionInfo[]>
  killTmuxSession: (sessionName: string) => Promise<boolean>
  listTerminalProcesses: () => Promise<TerminalProcessInventory>
  stopAllTerminalProcesses: () => Promise<TerminalStopAllResult>
  startRuntime: (projectId: string, projectPath: string, profile?: AiRuntimeProfile | null, cli?: 'claude' | 'codex') => Promise<boolean>
  getRuntimeDiagnostics: (profile?: AiRuntimeProfile | null) => Promise<RuntimeDiagnostics>
  listRuntimeSessions: () => Promise<RuntimeSessionInfo[]>
  listRuntimeEntries: () => Promise<RuntimeEntry[]>
  openTerminal: (sessionName: string, statusHint?: string) => Promise<boolean>
  openPathTerminal: (folderPath: string, command?: string) => Promise<boolean>
  openSshTerminal: (payload: OpenSshTerminalPayload) => Promise<OpenSshTerminalResult>
}

export interface SubscriptionElectronApi {
  onProcessOutput: ElectronApiSubscription<ProcessOutputEvent>
  onProcessStatus: ElectronApiSubscription<ProcessStatusEvent>
  onProcessExit: ElectronApiSubscription<ProcessExitEvent>
  onRuntimeStateChanged: ElectronApiSubscription<RuntimeStateChangedEvent>
  onAiCommitOutput: ElectronApiSubscription<ProcessOutputEvent>
  onAiCommitStatus: ElectronApiSubscription<AiCommitStatusEvent>
  onAgentHookEvent: ElectronApiSubscription<AgentHookEnvelope>
  onTranscriptImported: ElectronApiSubscription<TranscriptImportedEvent>
  onBrowserAiProgress: ElectronApiSubscription<import('./types').BrowserAiTaskProgressEvent>
  onWindowState: ElectronApiSubscription<WindowStateEvent>
  onAppNavigate: ElectronApiSubscription<AppNavigateEvent>
  onCodeFocusSearch: ElectronApiSignalSubscription
  onCodeToggleViewMode: ElectronApiSignalSubscription
  onGlobalHomeShortcut: ElectronApiSignalSubscription
  onGlobalThemeShortcut: ElectronApiSignalSubscription
}

export type ElectronApi = CoreElectronApi & AgentLogsElectronApi & AiConnectionElectronApi & AiGatewayElectronApi & GitElectronApi & ProjectFileElectronApi & TranscriptElectronApi & LearningElectronApi & SkillElectronApi & BrowserAiElectronApi & RuntimeElectronApi & SubscriptionElectronApi
