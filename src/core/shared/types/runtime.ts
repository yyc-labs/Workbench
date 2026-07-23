import type { AiExecutionMode, AiShell, BackendMode } from '../types'

/** Runtime and process domain contract. */
export interface Capability {
  hostPlatform: 'windows' | 'linux' | 'macos'
  backend: BackendMode
  hasPty: boolean
  hasWslInstalled?: boolean
  hasWsl: boolean
  hasTmux: boolean
  wslDistro?: string
  wslShell: string
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
  profileId?: string
  profileName?: string
  pid?: number | null
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

export type {
  AiExecutionMode,
  ManagedProcessSnapshot,
  ProcessInfo,
  ProcessStatus,
  RuntimeEntrypointConfig,
  RuntimeEntrypointTarget,
  RuntimeEntrypointWslPrefix,
} from '../types'
