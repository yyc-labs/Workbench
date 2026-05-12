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

export type ProcessStatus = 'running' | 'stopped' | 'error'

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
}

export interface AppConfig {
  projects: SavedProject[]
  theme: 'system' | 'light' | 'dark'
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
}
