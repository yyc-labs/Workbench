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
  /** sessionName → projectId mapping for tmux recovery */
  sessions?: Record<string, string>
}

export interface SavedProject {
  path: string
  customCommand?: string
  pinned?: boolean
  lastOpened?: number
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
