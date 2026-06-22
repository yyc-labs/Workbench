export type ProjectType =
  | 'next.js'
  | 'vite'
  | 'android'
  | 'nuxt'
  | 'node'
  | 'django'
  | 'flask'
  | 'fastapi'
  | 'python'
  | 'unknown'

export type PackageManager = 'npm' | 'yarn' | 'pnpm'

export type BackendMode = 'tmux' | 'wsl-pty' | 'direct-pty' | 'spawn'
export type AppLocale = 'system' | 'en-US' | 'zh-CN'

export type ProcessStatus = 'running' | 'stopping' | 'stopped' | 'error'
export type RunStartupMode = 'silent' | 'terminal'

export type CliTool = 'claude' | 'codex'
export type AiExecutionMode =
  | 'windows-wsl'
  | 'windows-native'
  | 'linux-native'
  | 'macos-native'
  | 'custom-script'
  | 'disabled'
export type AiShell = 'bash' | 'zsh' | 'pwsh' | 'powershell' | 'cmd' | 'sh'
export type StartupDefaultFilter =
  | { type: 'all' }
  | { type: 'pinned' }
  | { type: 'running' }
  | { type: 'uncategorized' }
  | { type: 'folder'; folderId: string }
  | { type: 'tag'; tagId: string }

export interface AiCommitConfig {
  enabled?: boolean
  apiBaseUrl?: string
  apiKey?: string
  model?: string
  wslPwshPath?: string
  split?: boolean
  splitMaxBatches?: number
  maxBullets?: number
}

export interface AiEnvironmentConfig {
  mode: AiExecutionMode
  wslDistro?: string
  shell?: AiShell
  runtimeEntrypoint?: string
  runtimeEntrypointHistory?: string[]
  runtimePassProjectPath?: boolean
  aiCommitEntrypoint?: string
}

export interface ClaudeBashrcConfig {
  anthropicBaseUrl: string
  anthropicAuthToken: string
  anthropicModel: string
  anthropicDefaultOpusModel: string
  anthropicDefaultSonnetModel: string
  anthropicDefaultHaikuModel: string
  claudeCodeSubagentModel: string
}

export interface ClaudeRuntimeProfile {
  id: string
  name: string
  config: ClaudeBashrcConfig
}

export type AiCommitStatus = 'idle' | 'running' | 'success' | 'error'

export interface AiCommitRunOverride {
  split?: boolean
  splitMaxBatches?: number
  maxBullets?: number
}

export type AiCommitUndoStatus = 'available' | 'closed' | 'expired' | 'undone'
export type AiCommitUndoCloseReason =
  | 'expired'
  | 'left-pane'
  | 'new-run'
  | 'manual'
  | 'undone'
  | 'head-changed'

export interface AiCommitUndoState {
  repoRoot: string
  runId: string
  beforeHead?: string
  afterHead: string
  commitCount: number
  status: AiCommitUndoStatus
  createdAt: number
  expiresAt: number
  authStartedAt?: number
  authExpiresAt?: number
  closedAt?: number
  closeReason?: AiCommitUndoCloseReason
}

export interface AiCommitTaskSnapshot {
  projectId: string
  repoRoot: string
  runId: string
  status: Exclude<AiCommitStatus, 'idle'>
  output: string
  startedAt: number
  updatedAt: number
  finishedAt?: number
  override?: AiCommitRunOverride
  undo?: AiCommitUndoState
  undoSuppressedAt?: number
  undoSuppressedReason?: AiCommitUndoCloseReason
}

export interface AiCommitUndoResult {
  projectId: string
  repoRoot: string
  ok: boolean
  checkedAt: number
  command: string
  output: string
  exitCode: number | null
  error?: string
  undo?: AiCommitUndoState
}

export type AgentHookProvider = 'claude-code' | 'codex-cli' | 'unknown'

export type AgentHookCanonicalEvent =
  | 'session-start'
  | 'session-end'
  | 'user-prompt-submit'
  | 'pre-tool-use'
  | 'permission-request'
  | 'post-tool-use'
  | 'post-tool-use-failure'
  | 'post-tool-batch'
  | 'stop'
  | 'stop-failure'
  | 'pre-compact'
  | 'post-compact'
  | 'subagent-start'
  | 'subagent-stop'
  | 'task-created'
  | 'task-completed'
  | 'notification'
  | 'file-changed'
  | 'cwd-changed'
  | 'config-change'
  | 'worktree-create'
  | 'worktree-remove'
  | 'teammate-idle'
  | 'unknown'

export type AgentHookFeishuNotifyEvent =
  | 'stop'
  | 'session-end'
  | 'permission-request'

export interface AgentHookEnvelope {
  schemaVersion: 1
  provider: AgentHookProvider
  providerEvent: string
  canonicalEvent: AgentHookCanonicalEvent
  eventId: string
  receivedAt: number
  sessionId?: string
  turnId?: string
  cwd?: string
  toolName?: string
  agentId?: string
  agentType?: string
  permissionMode?: string
  raw: unknown
}

export interface AgentHookGatewayConfig {
  enabled?: boolean
  host?: string
  port?: number
  token?: string
  maxBodyBytes?: number
  recentEventLimit?: number
  transcriptImport?: {
    enabled?: boolean
    token?: string
    openViewerByDefault?: boolean
  }
  feishu?: {
    enabled?: boolean
    appId?: string
    appSecret?: string
    receiveId?: string
    receiveIdType?: 'open_id' | 'user_id' | 'union_id' | 'email' | 'chat_id'
    notifyOn?: AgentHookFeishuNotifyEvent[]
  }
}

export interface AgentHookGatewayStatus {
  enabled: boolean
  running: boolean
  host: string
  port: number
  url: string
  tokenConfigured: boolean
  recentEventCount: number
  transcriptImportEnabled: boolean
  transcriptImportUrl: string
  transcriptProjectsUrl: string
  transcriptImportTokenConfigured: boolean
  error?: string
}

export type TranscriptSourceType =
  | 'process-output'
  | 'tmux-capture'
  | 'agent-hook'
  | 'manual-markdown'
  | 'imported-file'

export type TranscriptViewerMode = 'preview' | 'editor' | 'split'

export interface TranscriptMessageRange {
  startOffset: number
  endOffset: number
  startLine: number
  endLine: number
}

export interface TranscriptReference {
  id: string
  sessionId: string
  relativePath: string
  lineNumber?: number
  column?: number
  label: string
  rawText: string
  href: string
  messageRange: TranscriptMessageRange
}

export interface TranscriptSession {
  id: string
  projectId: string
  sourceType: TranscriptSourceType
  title: string
  rawText: string
  markdownText: string
  references: TranscriptReference[]
  createdAt: number
  updatedAt: number
}

export type LearningNoteStatus = 'draft' | 'organized'

export interface LearningCategory {
  id: string
  name: string
  parentId?: string
  sort: number
  createdAt: number
  updatedAt: number
}

export interface LearningNoteSummary {
  id: string
  title: string
  categoryId?: string
  tags: string[]
  status: LearningNoteStatus
  createdAt: number
  updatedAt: number
  excerpt: string
}

export interface LearningNote extends LearningNoteSummary {
  contentMd: string
}

export interface LearningCreateNotePayload {
  title?: string
  categoryId?: string
  tags?: string[]
  status?: LearningNoteStatus
  contentMd?: string
}

export interface LearningUpdateNotePayload {
  noteId: string
  title: string
  categoryId?: string
  tags: string[]
  status: LearningNoteStatus
  contentMd: string
}

export interface LearningCreateCategoryPayload {
  name: string
  parentId?: string
}

export interface TranscriptImportPayload {
  projectId: string
  sourceType: TranscriptSourceType
  rawText: string
  title?: string
  sourceLabel?: string
  processId?: string
  capturedAt?: number
}

export interface TranscriptUpdatePayload {
  projectId: string
  transcriptId: string
  rawText: string
  title?: string
}

export interface TranscriptGatewayImportPayload {
  projectId: string
  rawText: string
  title?: string
  sourceType?: TranscriptSourceType
  sourceLabel?: string
  processId?: string
  capturedAt?: number
  openViewer?: boolean
}

export interface TranscriptExternalImportPayload {
  projectId?: string
  projectPath?: string
  sourceType?: TranscriptSourceType
  rawText: string
  title?: string
  sourceLabel?: string
  processId?: string
  capturedAt?: number
  openViewer?: boolean
}

export interface TranscriptImportProjectTarget {
  projectId: string
  projectPath: string
  name: string
  customName?: string
  displayName: string
}

export interface TranscriptImportedEvent {
  session: TranscriptSession
  openViewer?: boolean
}

export interface TranscriptViewerRequest {
  projectId: string
  transcriptId: string
  initialMode?: TranscriptViewerMode
  host?: 'main-window' | 'secondary-window'
}

export interface TranscriptSessionSummary {
  id: string
  projectId: string
  sourceType: TranscriptSourceType
  title: string
  createdAt: number
  updatedAt: number
  referenceCount: number
}

export interface TranscriptShareImage {
  /** Placeholder token embedded in the snapshot HTML, replaced with a data URI in main. */
  placeholder: string
  /** Resolved file:// URL captured from the rendered preview. */
  fileUrl: string
}

export interface TranscriptShareStartPayload {
  projectId: string
  transcriptId: string
  title: string
  /** Self-contained HTML built in the renderer (styles inlined, file images as placeholders). */
  html: string
  /** file:// images that main must read and inline as data URIs before serving. */
  images?: TranscriptShareImage[]
}

export interface TranscriptShareEntry {
  token: string
  projectId: string
  transcriptId: string
  title: string
  url: string
  createdAt: number
}

export type TranscriptShareHostKind = 'wifi' | 'ethernet' | 'vpn' | 'virtual' | 'other'

export interface TranscriptShareHost {
  host: string
  interfaceName: string
  kind: TranscriptShareHostKind
}

export interface TranscriptShareStartResult {
  entry: TranscriptShareEntry
  /** Host:port the share server is listening on (LAN-reachable). */
  host: string
  port: number
  hosts: TranscriptShareHost[]
}

export interface TranscriptShareListResult {
  running: boolean
  host: string
  port: number
  hosts: TranscriptShareHost[]
  entries: TranscriptShareEntry[]
}

export type GitChangeKind =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted'
  | 'typechanged'
  | 'unknown'

export type GitChangeScope = 'staged' | 'unstaged' | 'untracked' | 'conflicted'

export interface GitChangedFile {
  path: string
  originalPath?: string
  indexStatus: string
  worktreeStatus: string
  kind: GitChangeKind
  scope: GitChangeScope
  staged: boolean
  unstaged: boolean
}

export interface GitBranchInfo {
  current: string
  upstream?: string
  upstreamGone: boolean
  oid?: string
  upstreamOid?: string
  ahead: number
  behind: number
  detached: boolean
  localBranches: string[]
  remoteBranches: string[]
}

export interface GitHistoryCommitInfo {
  hash: string
  shortHash: string
  subject: string
  authorName: string
  committedAt: string
  refs: string[]
  bullets: string[]
  filesChanged: number
}

export type GitRepositoryLoadState = 'unloaded' | 'loading' | 'loaded' | 'dirty' | 'error'

export interface GitRepositorySummary {
  id: string
  name: string
  repoRoot: string
  relativePath: string
  isNested: boolean
  parentRepoId?: string
  gitDirPath?: string
}

export interface GitRepositoryListResult {
  workspacePath: string
  repositories: GitRepositorySummary[]
  scannedAt: number
  truncated: boolean
  error?: string
}

export interface GitRepositorySnapshot {
  repoRoot: string
  isGitRepository: boolean
  repository?: GitRepositorySummary
  branch: GitBranchInfo
  changedFiles: GitChangedFile[]
  changedFileCount: number
  conflictedFileCount: number
  changedFilesSuppressed?: boolean
  recentCommits: GitHistoryCommitInfo[]
  checkedAt: number
  error?: string
}

export type GitOperationKind =
  | 'fetch'
  | 'pull'
  | 'push'
  | 'merge'
  | 'switch'
  | 'create-remote-branch'
  | 'create-local-branch'
  | 'delete-local-branch'
  | 'set-upstream'

export interface GitOperationRequest {
  repoRoot: string
  operation: GitOperationKind
  targetBranch?: string
  remoteName?: string
}

export interface GitOperationResult {
  repoRoot: string
  operation: GitOperationKind
  ok: boolean
  checkedAt: number
  command: string
  output: string
  exitCode: number | null
  skipped?: boolean
  error?: string
  targetBranch?: string
}

export interface GitSetFileStageRequest {
  repoRoot: string
  filePath: string
  stage: boolean
}

export interface GitSetFileStageResult {
  repoRoot: string
  ok: boolean
  checkedAt: number
  command: string
  output: string
  exitCode: number | null
  error?: string
}

export interface GitFileDiffRequest {
  repoRoot: string
  filePath: string
  staged: boolean
}

export interface GitOutputLimitInfo {
  limitBytes: number
  totalBytes: number
  keptBytes: number
}

export interface GitFileDiffResult {
  repoRoot: string
  ok: boolean
  checkedAt: number
  command: string
  output: string
  exitCode: number | null
  staged: boolean
  error?: string
  outputLimit?: GitOutputLimitInfo
}

export interface GitConflictFileRequest {
  repoRoot: string
  filePath: string
}

export interface GitConflictStageContent {
  stage: 1 | 2 | 3
  label: 'base' | 'ours' | 'theirs'
  exists: boolean
  output: string
  error?: string
  outputLimit?: GitOutputLimitInfo
}

export interface GitConflictFileResult {
  repoRoot: string
  ok: boolean
  checkedAt: number
  command: string
  output: string
  exitCode: number | null
  filePath: string
  workingTreeContent: string
  hasConflictMarkers: boolean
  stageContents: GitConflictStageContent[]
  error?: string
}

export interface GitResolveConflictRequest {
  repoRoot: string
  filePath: string
  content: string
  markResolved?: boolean
}

export interface GitResolveConflictResult {
  repoRoot: string
  ok: boolean
  checkedAt: number
  command: string
  output: string
  exitCode: number | null
  error?: string
}

export type ProjectDocLinkTag = string

export type ProjectDocLinkKind = 'url' | 'ssh'
export type ProjectDocLinkSshRoute = 'wsl' | 'windows'

export interface ProjectDocLink {
  id: string
  title: string
  url?: string
  kind?: ProjectDocLinkKind
  /** Resource type tag for this project material link. */
  tag?: ProjectDocLinkTag
  /** Optional plain-text note for this documentation link. */
  note?: string
  /** Optional account/username hint associated with this link. */
  account?: string
  /** SSH host when this doc link represents an SSH connection. */
  sshHost?: string
  /** SSH port when this doc link represents an SSH connection. */
  sshPort?: number
  /** SSH username when this doc link represents an SSH connection. */
  sshUsername?: string
  /** Preferred SSH route when opening this connection. */
  sshRoute?: ProjectDocLinkSshRoute
  /** True when a password/secret is saved in OS secure storage for this link. */
  hasSecret?: boolean
}

export interface ProjectDocTagOption {
  value: ProjectDocLinkTag
  label: string
  sortOrder: number
}

export interface ProjectFolder {
  id: string
  name: string
  color?: string
  sortOrder: number
}

export interface ProjectTag {
  id: string
  name: string
  color?: string
  sortOrder: number
}

export interface ProjectCodeFileDrawerState {
  /** User pinned file paths (project-relative) */
  favorites: string[]
  /** Recently opened file paths (project-relative, newest first) */
  recents: string[]
}

export interface ProjectCodeCursorPosition {
  lineNumber: number
  column: number
}

export interface ProjectCodeSession {
  /** Recently opened file tabs in Code page, newest first */
  tabs: string[]
  /** Active tab path when session snapshot was saved */
  activePath?: string
  /** Last known cursor positions by project-relative file path */
  cursorPositions?: Record<string, ProjectCodeCursorPosition>
  /** Recent content search queries in Code page (newest first) */
  contentSearchHistory?: string[]
  /** Scope globs used by content search in Code page */
  contentSearchScope?: string
}

export interface ProjectInfo {
  id: string
  path: string
  name: string
  /** Optional user-defined display title; falls back to `name` when absent. */
  customName?: string
  type: ProjectType
  /** Optional user-defined display type; falls back to detected `type` when absent. */
  customType?: string
  command: string
  customCommand?: string
  /** Optional cwd used by Run actions. Empty/missing means project root. */
  runWorkingDirectory?: string
  /** Run button startup behavior — defaults to 'silent' when absent. */
  runStartupMode?: RunStartupMode
  packageManager?: PackageManager
  pinned?: boolean
  lastOpened?: number
  /** AI coding CLI tool preference — defaults to 'claude' */
  cli?: CliTool
  /** Project-specific documentation links for quick access */
  docLinks?: ProjectDocLink[]
  /** User-defined folder classification */
  folderId?: string
  /** User-defined tags */
  tagIds?: string[]
  /** Last file opened in Code page, stored as project-relative path */
  lastCodeFile?: string
  /** Last selected markdown view mode in Code page (edit/preview/split) */
  lastMarkdownPreviewMode?: 'edit' | 'preview' | 'split'
  /** Drawer state for code file quick access */
  codeFileDrawerState?: ProjectCodeFileDrawerState
  /** Per-project Code page session snapshot (recent tabs + cursor positions) */
  codeSession?: ProjectCodeSession
}

export interface ProcessInfo {
  pid: number | null
  status: ProcessStatus
  startTime?: number
  error?: string
  backend?: BackendMode
}

export interface ManagedProcessSnapshot {
  /** Internal process key used by renderer store (projectId or projectId::toolbox). */
  processId: string
  /** Project id passed from renderer startProcess call. */
  projectId: string
  backend: BackendMode
  pid: number | null
  startTime: number
  /** tmux session name when backend is tmux. */
  sessionName?: string
}

export interface TerminalProcessInventory {
  checkedAt: number
  managedProcesses: ManagedProcessSnapshot[]
  runtimeSessions: RuntimeSessionInfo[]
  tmuxSessions: TmuxSessionInfo[]
}

export interface TerminalStopAllResult {
  managedStopped: number
  tmuxKilled: number
  tmuxSkipped: number
}

export interface AppConfig {
  projects: SavedProject[]
  theme: 'system' | 'light' | 'dark'
  locale?: AppLocale
  /** Removed project metadata snapshots kept for same-path restore on re-add. */
  removedProjects?: RemovedProjectSnapshot[]
  /** User-defined project folders */
  folders?: ProjectFolder[]
  /** User-defined project tags */
  tags?: ProjectTag[]
  /** Global project material categories (tabs) shared by all projects */
  docLinkTags?: ProjectDocTagOption[]
  /** Sidebar filter selected by default when Home opens */
  startupDefaultFilter?: StartupDefaultFilter
  /** AI Runtime / AI Commit execution environment selection */
  aiEnvironment?: AiEnvironmentConfig
  /** Saved Claude runtime shell profiles for quick switching */
  claudeRuntimeProfiles?: ClaudeRuntimeProfile[]
  /** Active Claude runtime profile id */
  activeClaudeRuntimeProfileId?: string
  /** Legacy runtime launcher script path kept only for old-config migration */
  runtimeLauncherScript?: string
  /** Keep runtime tmux sessions alive when app quits */
  runtimeKeepAliveOnQuit?: boolean
  /** AI-assisted git commit configuration */
  aiCommit?: AiCommitConfig
  /** Local lifecycle hook gateway for Claude Code and Codex CLI events */
  agentHooks?: AgentHookGatewayConfig
  /** sessionName → projectId mapping for tmux recovery */
  sessions?: Record<string, string>
}

export interface SavedProject {
  path: string
  /** Optional user-defined display title; falls back to detected path basename when absent. */
  customName?: string
  /** Optional user-defined display type; falls back to detected type when absent. */
  customType?: string
  customCommand?: string
  /** Optional cwd used by Run actions. Empty/missing means project root. */
  runWorkingDirectory?: string
  /** Run button startup behavior — defaults to 'silent' when absent. */
  runStartupMode?: RunStartupMode
  pinned?: boolean
  lastOpened?: number
  /** AI coding CLI tool preference — defaults to 'claude' when absent */
  cli?: CliTool
  /** Project-specific documentation links for quick access */
  docLinks?: ProjectDocLink[]
  /** User-defined folder classification */
  folderId?: string
  /** User-defined tags */
  tagIds?: string[]
  /** Last file opened in Code page, stored as project-relative path */
  lastCodeFile?: string
  /** Last selected markdown view mode in Code page (edit/preview/split) */
  lastMarkdownPreviewMode?: 'edit' | 'preview' | 'split'
  /** Drawer state for code file quick access */
  codeFileDrawerState?: ProjectCodeFileDrawerState
  /** Per-project Code page session snapshot (recent tabs + cursor positions) */
  codeSession?: ProjectCodeSession
}

export interface RemovedProjectSnapshot extends SavedProject {
  removedAt: number
}

export interface DetectionRule {
  type: ProjectType
  priority: number
  matchPatterns: string[]
  defaultCommand: string
  fallbackCommand?: string
  requiresAll?: boolean
  /** If set, package.json must contain this dependency (in dependencies or devDependencies) */
  requireDep?: string
}

export interface PtySize {
  cols: number
  rows: number
}

export interface Capability {
  hostPlatform: 'windows' | 'linux' | 'macos'
  backend: BackendMode
  hasPty: boolean
  hasWsl: boolean
  hasTmux: boolean
  wslDistro?: string
  wslShell: string
  /** Full WSL environment captured at boot via bash -ilc env. */
  wslEnv?: Record<string, string>
}

export interface TmuxSessionInfo {
  sessionName: string
  projectId: string
  createdAt: number
  status: 'attached' | 'detached' | 'dead'
}

export interface RecoveredSession {
  sessionName: string
  projectId: string
  cwd: string
  status: 'detached'
  createdAt: number
}

/** Runtime session status — mirrors tmux reality, NOT user-facing labels.
 *  UI layer maps: attached→Active, detached→Background, stopped→Offline. */
export type RuntimeStatus = 'attached' | 'detached' | 'stopped'

export interface SessionRuntime {
  projectId: string
  sessionName: string
  status: RuntimeStatus
  createdAt: number
}

export interface RuntimeEntry {
  projectId: string
  sessionName: string
  createdAt: number
  lastOpened: number
  mode?: AiExecutionMode
  /** Dedicated host process pid for providers like Windows Native. */
  pid?: number | null
  /** Host process start timestamp used to guard against pid reuse. */
  pidStartedAt?: number | null
}

export interface RuntimeRegistry {
  entries: Record<string, RuntimeEntry>
}

export interface RuntimeSessionInfo {
  sessionName: string
  projectId: string
  createdAt: number
  status: 'attached' | 'detached' | 'dead'
  mode: AiExecutionMode
}

export interface RuntimeDiagnostics {
  checkedAt: number
  mode: AiExecutionMode
  providerLabel: string
  runtimeEntrypoint?: string
  supported: boolean
  hasWsl: boolean
  hasTmux: boolean
  distro?: string
  launcherScript?: string
  launcherScriptExists?: boolean
  launcherScriptExecutable?: boolean
  shell?: AiShell
  availableModes?: AiExecutionMode[]
  issues: string[]
}

export type ProjectFileNodeKind = 'file' | 'directory'

export interface ProjectFileNode {
  name: string
  relativePath: string
  kind: ProjectFileNodeKind
  hasChildren?: boolean
  isLoaded?: boolean
  children?: ProjectFileNode[]
}

export interface ProjectFileTreeResult {
  rootPath: string
  directoryRelativePath: string | null
  nodes: ProjectFileNode[]
  skipped: {
    directories: number
    files: number
  }
}

export interface ProjectFileReadResult {
  relativePath: string
  content: string
  size: number
  mtimeMs: number
  language: string
  encoding: 'utf-8'
}

export interface ProjectFileWriteResult {
  relativePath: string
  size: number
  mtimeMs: number
}

export interface ProjectFileWriteImageResult {
  relativePath: string
  size: number
  mtimeMs: number
}

export interface ProjectFileStatResult {
  relativePath: string
  size: number
  mtimeMs: number
}

export interface ProjectFileContentMatch {
  lineNumber: number
  column: number
  endColumn: number
  lineText: string
}

export interface ProjectFileContentSearchResult {
  relativePath: string
  name: string
  matchCount: number
  matches: ProjectFileContentMatch[]
}

export interface ProjectFileContentSearchResponse {
  files: ProjectFileContentSearchResult[]
  totalMatches: number
  limited: boolean
}

export interface ProjectFileContentSearchOptions {
  caseSensitive?: boolean
  includeGlobs?: string[]
}
