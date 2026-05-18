export type ProjectType =
  | 'next.js'
  | 'vite'
  | 'nuxt'
  | 'node'
  | 'django'
  | 'flask'
  | 'fastapi'
  | 'python'
  | 'unknown'

export type PackageManager = 'npm' | 'yarn' | 'pnpm'

export type BackendMode = 'tmux' | 'wsl-pty' | 'direct-pty' | 'spawn'

export type ProcessStatus = 'running' | 'stopped' | 'error' | 'detached'

export type CliTool = 'claude' | 'codex'

export interface ProjectDocLink {
  id: string
  title: string
  url: string
}

export interface ProjectInfo {
  id: string
  path: string
  name: string
  type: ProjectType
  command: string
  customCommand?: string
  packageManager?: PackageManager
  pinned?: boolean
  lastOpened?: number
  /** AI coding CLI tool preference — defaults to 'claude' */
  cli?: CliTool
  /** Project-specific documentation links for quick access */
  docLinks?: ProjectDocLink[]
}

export interface ProcessInfo {
  pid: number | null
  status: ProcessStatus
  startTime?: number
  error?: string
  backend?: BackendMode
}

export interface AppConfig {
  projects: SavedProject[]
  theme: 'system' | 'light' | 'dark'
  /** WSL-side launcher script path for runtime boot */
  runtimeLauncherScript?: string
  /** sessionName → projectId mapping for tmux recovery */
  sessions?: Record<string, string>
}

export interface SavedProject {
  path: string
  customCommand?: string
  pinned?: boolean
  lastOpened?: number
  /** AI coding CLI tool preference — defaults to 'claude' when absent */
  cli?: CliTool
  /** Project-specific documentation links for quick access */
  docLinks?: ProjectDocLink[]
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
