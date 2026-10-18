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
  FloatingTerminalPanelState,
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
  ManagedProcessSnapshot,
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
  /** 终端集合面板（Ctrl+J）：面板几何与显隐（持久化进 config.floatingPanel）。 */
  floatingPanel: FloatingTerminalPanelState
  /** 主进程进程清单快照（terminal:list-all），由 Layer 轮询写入。 */
  terminalInventory: ManagedProcessSnapshot[]
  /** 集合面板当前选中的项目 tab。 */
  collectionActiveProjectId: string | null
  /** 集合面板当前激活的进程 key；null 时组件回落到该项目第一个终端。 */
  collectionActiveKey: string | null
  /** 乐观占位：已分配 key 但主进程清单尚未收录的启动中终端（会话内，不持久化）。 */
  collectionPendingTerminals: { processKey: string; projectId: string; title: string }[]
  /** 是否展示 ::toolbox 进程（会话内有效，不持久化）。 */
  collectionShowToolbox: boolean
  /** 跨页面聚焦请求：集合面板消费后清空（不持久化）。 */
  pendingTerminalFocus: { projectId: string; processKey: string } | null
  setTerminalInventory: (inventory: ManagedProcessSnapshot[]) => void
  /**
   * 集合面板开关：可见 → 整体隐藏（会话保活，可在 设置 → 日志 查看）；隐藏 → 唤醒。
   * contextProjectId 为项目路由上下文（`/project/:projectId`）：唤醒时定位到该项目，无终端则直接新建。
   */
  toggleTerminalCollection: (contextProjectId?: string) => Promise<void>
  /** 显示面板并聚焦指定项目的指定进程（processKey 为空则只定位项目）。 */
  revealTerminal: (projectId: string, processKey?: string) => void
  setCollectionActiveProject: (projectId: string) => void
  setCollectionActiveKey: (processKey: string) => void
  setCollectionShowToolbox: (visible: boolean) => void
  /** 给指定项目新建交互 shell 终端（processKey = `${projectId}::float::<n>`）并聚焦。 */
  addCollectionTerminal: (projectId: string, cwd: string) => Promise<boolean>
  /** 重命名终端；空标题删除覆盖条目并回落默认 title。 */
  renameTerminal: (projectId: string, processKey: string, title: string) => void
  /** 按 kind 分发停止逻辑；toolbox 与解析失败忽略。 */
  stopCollectionTerminal: (projectId: string, processKey: string) => void
  /** 一键停止全部项目全部终端（当前清单内的非 toolbox 进程）。 */
  stopAllCollectionTerminals: () => void
  /** 停止指定项目的全部终端（清单内非 toolbox + 启动中占位）。 */
  stopProjectTerminals: (projectId: string) => void
  setFloatingPanelDock: (dock: FloatingTerminalDock) => void
  setFloatingPanelSizeRatio: (sizeRatio: number) => void
  requestProjectTerminalFocus: (projectId: string, processKey: string) => void
  consumePendingTerminalFocus: () => { projectId: string; processKey: string } | null
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
