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

export type ProcessStatus = 'running' | 'stopping' | 'stopped' | 'error'
export type RunStartupMode = 'silent' | 'terminal'

export type CliTool = 'claude' | 'codex'
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

export interface ClaudeBashrcConfig {
  anthropicBaseUrl: string
  anthropicAuthToken: string
  anthropicModel: string
  anthropicDefaultOpusModel: string
  anthropicDefaultSonnetModel: string
  anthropicDefaultHaikuModel: string
  claudeCodeSubagentModel: string
  claudeCodeEffortLevel: string
}

export type AiCommitStatus = 'idle' | 'running' | 'success' | 'error'

export interface AiCommitRunOverride {
  split?: boolean
  splitMaxBatches?: number
  maxBullets?: number
}

export interface AiCommitTaskSnapshot {
  projectId: string
  projectPath: string
  runId: string
  status: Exclude<AiCommitStatus, 'idle'>
  output: string
  startedAt: number
  updatedAt: number
  finishedAt?: number
  override?: AiCommitRunOverride
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

export interface GitWorkspaceSnapshot {
  projectPath: string
  isGitRepository: boolean
  branch: GitBranchInfo
  changedFiles: GitChangedFile[]
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
  projectPath: string
  operation: GitOperationKind
  targetBranch?: string
  remoteName?: string
}

export interface GitOperationResult {
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
  projectPath: string
  filePath: string
  stage: boolean
}

export interface GitSetFileStageResult {
  ok: boolean
  checkedAt: number
  command: string
  output: string
  exitCode: number | null
  error?: string
}

export interface GitFileDiffRequest {
  projectPath: string
  filePath: string
  staged: boolean
}

export interface GitFileDiffResult {
  ok: boolean
  checkedAt: number
  command: string
  output: string
  exitCode: number | null
  staged: boolean
  error?: string
}

export interface GitConflictFileRequest {
  projectPath: string
  filePath: string
}

export interface GitConflictStageContent {
  stage: 1 | 2 | 3
  label: 'base' | 'ours' | 'theirs'
  exists: boolean
  output: string
  error?: string
}

export interface GitConflictFileResult {
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
  projectPath: string
  filePath: string
  content: string
  markResolved?: boolean
}

export interface GitResolveConflictResult {
  ok: boolean
  checkedAt: number
  command: string
  output: string
  exitCode: number | null
  error?: string
}

export type ProjectDocLinkTag = string

export interface ProjectDocLink {
  id: string
  title: string
  url: string
  /** Resource type tag for this project material link. */
  tag?: ProjectDocLinkTag
  /** Optional plain-text note for this documentation link. */
  note?: string
  /** Optional account/username hint associated with this link. */
  account?: string
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
  /** WSL-side launcher script path for runtime boot */
  runtimeLauncherScript?: string
  /** Keep runtime tmux sessions alive when app quits */
  runtimeKeepAliveOnQuit?: boolean
  /** AI-assisted git commit configuration */
  aiCommit?: AiCommitConfig
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
}

export interface RuntimeRegistry {
  entries: Record<string, RuntimeEntry>
}

export interface RuntimeDiagnostics {
  checkedAt: number
  hasWsl: boolean
  hasTmux: boolean
  distro?: string
  launcherScript: string
  launcherScriptExists: boolean
  launcherScriptExecutable: boolean
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
