import type {
  AgentLogDetail,
  AgentLogSource,
  AgentLogSummary,
  AiCommitTaskSnapshot,
  AiCommitUndoCloseReason,
  AiCommitUndoResult,
  AiGatewayBindingResult,
  AiGatewayClientCli,
  AiGatewayConfig,
  AiGatewayLogEntry,
  AiGatewaySaveConfigResult,
  AiGatewayStatus,
  ClaudeBashrcConfig,
  CodexEnvironmentScope,
  CodexGatewayBinding,
  CodexGatewayBindingResult,
  CodexGatewayBindingSaveInput,
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
  ProjectFileTreeOptions,
  ProjectFileTreeResult,
  ProjectFileWriteImageResult,
  ProjectFileWriteResult,
  ProjectInfo,
  ProcessInfo,
  AppConfig,
  ProjectFileExclusionsConfig,
  AppCacheLocationConfig,
  AppCacheLocationInfo,
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
  BrowserAiTaskProgressEvent,
  BrowserAiTaskStep,
  BrowserAiTaskResult,
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
  TranscriptCaptureInitialText,
  TranscriptImportedEvent,
  TranscriptExternalImportPayload,
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
  LearningNoteSummary,
  LearningUpdateCategoryPayload,
  LearningUpdateNotePayload,
  LearningNote,
  ProjectFileAutoLoadDecision,
  Skill,
  SkillCategory,
  SkillCreateCategoryPayload,
  SkillCreatePayload,
  SkillSummary,
  SkillUpdateCategoryPayload,
  SkillUpdatePayload,
} from '../../shared/types'
import type { ElectronApi } from '../../shared/electronApi'
import type { MarkdownDocumentDisplayMode, MarkdownDocumentHistoryEntry, MarkdownDocumentReadResult } from '../../shared/types'

declare global {
  interface Window {
    electronAPI: ElectronApi
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
  browserAi: BrowserAiSnapshot | null
  browserAiProgress: BrowserAiTaskProgressEvent | null
  browserAiSteps: BrowserAiTaskStep[]
  browserAiTaskRecords: BrowserAiTaskRecordSummary[]
  browserAiTaskRecord: BrowserAiTaskRecord | null
  skills: SkillSummary[]
  skillCategories: SkillCategory[]
  selectedSkill: Skill | null
  skillsLoading: boolean
  markdownDocumentHistory: MarkdownDocumentHistoryEntry[]
  markdownDocumentActive: MarkdownDocumentReadResult | null
  markdownDocumentValue: string
  markdownDocumentMode: MarkdownDocumentDisplayMode
  markdownDocumentLoading: boolean
  markdownDocumentSaving: boolean
  markdownDocumentError: string | null
  markdownDocumentConflict: boolean
  reloadMarkdownDocument: () => Promise<void>
  loadMarkdownDocumentHistory: () => Promise<void>
  openMarkdownDocument: (filePath: string) => Promise<void>
  setMarkdownDocumentValue: (value: string) => void
  setMarkdownDocumentMode: (mode: MarkdownDocumentDisplayMode) => void
  saveMarkdownDocument: () => Promise<void>
  removeMarkdownDocumentHistory: (filePath: string) => Promise<void>
  clearMarkdownDocumentHistory: () => Promise<void>

  loadConfig: () => Promise<void>
  setTheme: (theme: AppConfig['theme']) => Promise<void>
  setLocale: (locale: NonNullable<AppConfig['locale']>) => Promise<void>
  setLaunchOnLogin: (enabled: boolean) => Promise<void>
  setLaunchOnLoginDisplayMode: (mode: NonNullable<AppConfig['launchOnLoginDisplayMode']>) => Promise<void>
  setCloseWindowBehavior: (behavior: NonNullable<AppConfig['closeWindowBehavior']>) => Promise<void>
  setCodeFileExclusions: (exclusions: ProjectFileExclusionsConfig) => Promise<void>
  setCacheLocation: (cacheLocation: AppCacheLocationConfig) => Promise<void>
  setAiEnvironmentConfig: (aiEnvironment: NonNullable<AppConfig['aiEnvironment']>) => Promise<void>
  setRuntimeLauncherScript: (scriptPath: string) => Promise<void>
  setRuntimeKeepAliveOnQuit: (enabled: boolean) => Promise<void>
  setAiCommitConfig: (aiCommit: NonNullable<AppConfig['aiCommit']>) => Promise<void>
  setAiRuntimeProfiles: (profiles: AiRuntimeProfile[], activeProfileId: string) => Promise<void>
  loadCodexSettings: () => Promise<CodexSettingsSnapshot>
  saveCodexSettings: (payload: CodexSettingsInput) => Promise<CodexSettingsSnapshot>
  saveCodexGatewayBinding: (payload: CodexGatewayBindingSaveInput) => Promise<CodexGatewayBindingResult>
  setAgentLogConfig: (agentLogs: NonNullable<AppConfig['agentLogs']>) => Promise<void>
  setAgentHookConfig: (agentHooks: NonNullable<AppConfig['agentHooks']>) => Promise<void>
  setShortcutPreferences: (shortcutPreferences: NonNullable<AppConfig['shortcutPreferences']>) => Promise<void>
  setClaudeRuntimeProfiles: (profiles: ClaudeRuntimeProfile[], activeProfileId: string) => Promise<void>
  setDocLinkTags: (tags: ProjectDocTagOption[]) => Promise<void>
  initApp: () => Promise<void>
  addProject: (dirPath: string) => Promise<void>
  removeProject: (projectId: string) => Promise<void>
  startProject: (projectId: string, commandOverride?: string, processId?: string, useWsl?: boolean, cwdOverride?: string, runStartupModeOverride?: 'silent' | 'terminal') => Promise<boolean>
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
  loadBrowserAi: () => Promise<BrowserAiSnapshot>
  saveBrowserAiConfig: (config: BrowserAiConfig) => Promise<BrowserAiSnapshot>
  startBrowserAi: () => Promise<BrowserAiSnapshot>
  stopBrowserAi: () => Promise<BrowserAiSnapshot>
  testBrowserAiConnection: () => Promise<BrowserAiConnectionTestResult>
  openBrowserAiLogin: () => Promise<BrowserAiSnapshot>
  composeBrowserAiPreview: (payload: BrowserAiRunTaskPayload) => Promise<BrowserAiContextPreview>
  runBrowserAiTask: (payload: BrowserAiRunTaskPayload) => Promise<BrowserAiTaskResult>
  cancelBrowserAiTask: () => Promise<BrowserAiSnapshot>
  saveBrowserAiResult: (payload: BrowserAiSaveResultPayload) => Promise<LearningNote>
  loadBrowserAiTaskRecords: () => Promise<BrowserAiTaskRecordSummary[]>
  loadBrowserAiTaskRecord: (recordId: string) => Promise<BrowserAiTaskRecord | null>
  saveBrowserAiTaskRecord: (payload: BrowserAiSaveTaskRecordPayload) => Promise<BrowserAiTaskRecord>
  deleteBrowserAiTaskRecord: (recordId: string) => Promise<boolean>
  loadSkills: () => Promise<SkillSummary[]>
  loadSkillCategories: () => Promise<SkillCategory[]>
  loadSkill: (skillId: string) => Promise<Skill | null>
  createSkill: (payload: SkillCreatePayload) => Promise<Skill>
  updateSkill: (payload: SkillUpdatePayload) => Promise<Skill>
  deleteSkill: (skillId: string) => Promise<boolean>
  createSkillCategory: (payload: SkillCreateCategoryPayload) => Promise<SkillCategory[]>
  updateSkillCategory: (payload: SkillUpdateCategoryPayload) => Promise<SkillCategory[]>
  deleteSkillCategory: (categoryId: string) => Promise<SkillCategory[]>
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
  upsertTranscriptSession: (session: TranscriptSession, options?: { activate?: boolean; initialMode?: TranscriptViewerMode }) => void
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
  startRuntime: (projectId: string, profileId?: string) => Promise<void>
  stopRuntime: (projectId: string) => Promise<void>
  openTerminal: (projectId: string, statusHint?: string) => Promise<boolean>
}
