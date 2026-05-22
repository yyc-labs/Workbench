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

export interface ProjectDocLink {
  id: string
  title: string
  url: string
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
  /** User-defined project folders */
  folders?: ProjectFolder[]
  /** User-defined project tags */
  tags?: ProjectTag[]
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
