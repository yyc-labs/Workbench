import type { ElectronApi } from '../../shared/electronApi'
import type { RunTask, RunTaskCandidate, RunTaskConfigFile, RunTaskConfigReadResult, RunTaskProgressEvent } from '../../shared/runTasks'
import type {
  AgentHookEnvelope,
  AgentHookGatewayStatus,
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
  AiRuntimeProfile,
  AppCacheLocationConfig,
  AppCacheLocationInfo,
  AppConfig,
  BrowserAiConfig,
  BrowserAiConnectionTestResult,
  BrowserAiContextPreview,
  BrowserAiRunTaskPayload,
  BrowserAiSaveResultPayload,
  BrowserAiSaveTaskRecordPayload,
  BrowserAiSnapshot,
  BrowserAiTaskProgressEvent,
  BrowserAiTaskRecord,
  BrowserAiTaskRecordSummary,
  BrowserAiTaskResult,
  BrowserAiTaskStep,
  BrowserDataCleanupResult,
  BrowserDataMaintenanceInfo,
  Capability,
  ClaudeBashrcConfig,
  ClaudeRuntimeProfile,
  CodexEnvironmentScope,
  CodexGatewayBinding,
  CodexGatewayBindingResult,
  CodexGatewayBindingSaveInput,
  CodexSettingsInput,
  CodexSettingsSaveResult,
  CodexSettingsSnapshot,
  DocLinkLibraryFile,
  FloatingTerminalDock,
  FloatingTerminalInstance,
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
  MarkdownDocumentHistoryEntry,
  MarkdownDocumentReadResult,
  ProcessInfo,
  ProjectCodeFileDrawerState,
  ProjectCodeSession,
  ProjectDocLink,
  ProjectDocTagOption,
  ProjectFileAutoLoadDecision,
  ProjectFileContentSearchOptions,
  ProjectFileContentSearchResponse,
  ProjectFileExclusionsConfig,
  ProjectFileNode,
  ProjectFileReadResult,
  ProjectFileStatResult,
  ProjectFileTreeOptions,
  ProjectFileTreeResult,
  ProjectFileWriteImageResult,
  ProjectFileWriteResult,
  ProjectFolder,
  ProjectInfo,
  ProjectTag,
  QuickAction,
  QuickActionCreateInput,
  QuickActionResult,
  QuickActionUpdateInput,
  QuickActionView,
  RuntimeDiagnostics,
  RuntimeEntry,
  RuntimeSessionInfo,
  SessionRuntime,
  SharedDocLink,
  SharedDocLinkGroup,
  Skill,
  SkillCategory,
  SkillCreateCategoryPayload,
  SkillCreatePayload,
  SkillSummary,
  SkillUpdateCategoryPayload,
  SkillUpdatePayload,
  StartupDefaultFilter,
  TerminalProcessInventory,
  TerminalStopAllResult,
  TmuxSessionInfo,
  TranscriptCaptureInitialText,
  TranscriptExternalImportPayload,
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
  UpsertSharedDocLinkInput,
} from '../../shared/types'
import type { MarkdownDocumentCompatibility, MarkdownDocumentComplexity, MarkdownDocumentDisplayMode } from '../pages/markdown-document/markdownDocumentTypes'

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
  /** 浮动终端实例（会话内状态；几何持久化进 config.floatingTerminals）。 */
  floatingTerminals: FloatingTerminalInstance[]
  config: AppConfig
  searchQuery: string
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
  markdownDocumentDirty: boolean
  markdownDocumentCompatibility: MarkdownDocumentCompatibility | null
  markdownDocumentComplexity: MarkdownDocumentComplexity | null
  markdownDocumentLoading: boolean
  markdownDocumentSaving: boolean
  markdownDocumentError: string | null
  markdownDocumentConflict: boolean
  reloadMarkdownDocument: () => Promise<void>
  loadMarkdownDocumentHistory: () => Promise<void>
  openMarkdownDocument: (filePath: string, options?: { refreshHistory?: boolean }) => Promise<void>
  setMarkdownDocumentValue: (value: string) => void
  setMarkdownDocumentMode: (mode: MarkdownDocumentDisplayMode) => void
  saveMarkdownDocument: () => Promise<void>
  removeMarkdownDocumentHistory: (filePath: string) => Promise<void>
  clearMarkdownDocumentHistory: () => Promise<void>
  sharedDocLinkGroups: SharedDocLinkGroup[]
  sharedDocLinks: SharedDocLink[]
  docLinkLibraryLoaded: boolean
  docLinkLibraryError: string | null
  loadDocLinkLibrary: () => Promise<void>
  createDocLinkGroup: (name: string) => Promise<void>
  renameDocLinkGroup: (groupId: string, name: string) => Promise<void>
  removeDocLinkGroup: (groupId: string) => Promise<void>
  upsertSharedDocLink: (input: UpsertSharedDocLinkInput) => Promise<DocLinkLibraryFile | null>
  removeSharedDocLink: (linkId: string) => Promise<void>
  reorderSharedDocLinks: (groupId: string, orderedLinkIds: string[]) => Promise<void>
  setSharedDocLinkSecret: (linkId: string, secret: string) => Promise<void>
  clearSharedDocLinkSecret: (linkId: string) => Promise<void>
  getSharedDocLinkSecret: (linkId: string) => Promise<string | null>
  setProjectSharedDocLinkGroups: (projectId: string, groupIds: string[]) => Promise<void>

  quickActions: QuickActionView[]
  quickActionsLoading: boolean
  loadQuickActions: () => Promise<void>
  createQuickAction: (input: QuickActionCreateInput) => Promise<QuickAction>
  updateQuickAction: (id: string, input: QuickActionUpdateInput) => Promise<QuickAction>
  deleteQuickAction: (id: string) => Promise<boolean>
  executeQuickAction: (request: { id: string } | { spec: QuickActionCreateInput['action'] }) => Promise<QuickActionResult>
  reorderQuickAction: (id: string, direction: 'up' | 'down') => Promise<void>
  createQuickActionDesktopShortcut: (id: string) => Promise<string>
  removeQuickActionDesktopShortcut: (id: string) => Promise<boolean>

  loadConfig: () => Promise<void>
  setTheme: (theme: AppConfig['theme']) => Promise<void>
  setLocale: (locale: NonNullable<AppConfig['locale']>) => Promise<void>
  setLaunchOnLogin: (enabled: boolean) => Promise<void>
  setLaunchOnLoginDisplayMode: (mode: NonNullable<AppConfig['launchOnLoginDisplayMode']>) => Promise<void>
  setCloseWindowBehavior: (behavior: NonNullable<AppConfig['closeWindowBehavior']>) => Promise<void>
  setCodeFileExclusions: (exclusions: ProjectFileExclusionsConfig) => Promise<void>
  setCodeTreeAutoLoadFileLimit: (limit: number) => Promise<void>
  setFilePreviewLimits: (limits: Partial<Pick<AppConfig, 'imagePreviewLimitMb' | 'pdfPreviewLimitMb' | 'audioPreviewLimitMb' | 'videoPreviewLimitMb'>>) => Promise<void>
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
  /** 13.4 浮动终端：新增实例并启动交互 shell（processKey = `${projectId}::float::<n>`）。 */
  addFloatingTerminal: (projectId: string, cwd: string) => Promise<boolean>
  /** 单面板多标签：当前激活的标签实例 id。 */
  activeFloatingTerminalId: string | null
  setActiveFloatingTerminal: (id: string) => void
  /** 把已在运行的进程（如 ::script:: 脚本）挂进面板显示：同 key 已挂过则激活，否则新增标签。 */
  attachFloatingTerminal: (input: { processKey: string; projectId: string; cwd: string; useWsl: boolean; title: string }) => void
  /** 标签 ×：终止该终端会话并移除标签。 */
  closeFloatingTerminal: (id: string) => void
  /** 一键关闭：终止全部会话并清空面板。 */
  closeAllFloatingTerminals: () => void
  /** 隐藏整个面板但保留所有会话（可在 /settings/logs 查看）。 */
  hideAllFloatingTerminals: () => void
  setFloatingTerminalDock: (id: string, dock: FloatingTerminalDock, sizeRatio?: number) => void
  setFloatingTerminalSizeRatio: (id: string, sizeRatio: number) => void
  focusFloatingTerminal: (id: string) => void
  toggleFloatingTerminals: () => Promise<void>
  reconnectFloatingTerminal: (id: string) => Promise<boolean>
  /** 恢复持久化的浮动终端：仅保留主进程仍存活的会话，死会话清空。 */
  hydrateFloatingTerminals: () => Promise<void>
  runTaskConfigs: Record<string, RunTaskConfigFile | null>
  runTaskStates: Record<string, RunTaskProgressEvent['tasks']>
  loadRunTaskConfig: (projectId: string, projectPath: string) => Promise<RunTaskConfigReadResult>
  saveRunTaskConfig: (projectId: string, projectPath: string, tasks: RunTask[], scanDirectories?: string[]) => Promise<RunTaskConfigReadResult>
  /** Reload the cached config after the project's run-task config file changed on disk. */
  handleRunTaskConfigChanged: (projectPath: string) => Promise<void>
  detectRunTaskCandidates: (projectPath: string, scanDirectories?: string[]) => Promise<RunTaskCandidate[]>
  startRunTask: (projectId: string, projectPath: string, task: RunTask) => Promise<boolean>
  startAllRunTasks: (projectId: string, projectPath: string) => Promise<{ started: boolean; error?: string }>
  stopRunTask: (projectId: string, taskId: string) => Promise<boolean>
  stopAllRunTasks: (projectId: string) => Promise<boolean>
  updateRunTaskStates: (event: RunTaskProgressEvent) => void
  /** Adopt scheduler-side run task states; settles stale active entries (missed progress events). */
  reconcileRunTaskStates: () => Promise<void>
  /** Global "Docker is not running — start it?" prompt visibility. */
  dockerPrompt: boolean
  requestDockerLaunch: (projectPath: string, tasks: RunTask[]) => Promise<boolean>
  cancelDockerLaunch: () => void
  confirmDockerLaunch: () => Promise<void>
  loadRuntimeEntries: () => Promise<void>
  appendOutput: (projectId: string, data: string) => void
  clearOutput: (projectId: string) => void
  updateProcessStatus: (projectId: string, status: string) => void
  handleProcessExit: (projectId: string, code: number | null) => void
  sendInput: (projectId: string, data: string) => void
  setSearchQuery: (query: string) => void
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
