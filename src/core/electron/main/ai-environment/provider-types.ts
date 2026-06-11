import type {
  AiCommitConfig,
  AiEnvironmentConfig,
  AiExecutionMode,
  AiShell,
  Capability,
  CliTool,
  RuntimeDiagnostics,
  RuntimeSessionInfo,
} from '../../../shared/types'

export type RuntimeLaunchPlan = {
  mode: AiExecutionMode
  sessionName: string
  providerLabel: string
  supportsManagedSessions: boolean
  startCommand: string
  startArgs: string[]
  cwd?: string
  shell?: false
  windowsHide?: boolean
  detached?: boolean
  env?: Record<string, string>
  openStrategy: 'wt-wsl-tmux' | 'wt-native-title' | 'posix-terminal-tmux' | 'not-supported'
  stopStrategy: 'tmux' | 'process' | 'not-supported'
}

export type AiCommitLaunchPlan = {
  mode: AiExecutionMode
  providerLabel: string
  command: string
  args: string[]
  cwd: string
  shell?: false
  env?: Record<string, string>
  outputLabel: string
}

export type ProviderContext = {
  capability: Capability
  config: AiEnvironmentConfig
  aiCommitConfig: AiCommitConfig
}

export interface AiExecutionProvider {
  readonly mode: AiExecutionMode
  readonly label: string
  isSupported(context: ProviderContext): Promise<boolean> | boolean
  diagnose(context: ProviderContext): Promise<RuntimeDiagnostics>
  resolveRuntimeLaunch(context: ProviderContext, input: {
    projectId: string
    projectPath: string
    cli: CliTool
  }): Promise<RuntimeLaunchPlan>
  resolveAiCommitLaunch(context: ProviderContext, input: {
    repoRoot: string
    scriptPath: string
    scriptWslPath?: string | null
    cliConfig: Required<Pick<AiCommitConfig, 'enabled' | 'apiBaseUrl' | 'apiKey' | 'model'>> & {
      split: boolean
      splitMaxBatches: number
      maxBullets: number
      wslPwshPath: string
    }
  }): Promise<AiCommitLaunchPlan>
  listRuntimeSessions?(context: ProviderContext): Promise<RuntimeSessionInfo[]>
  stopRuntimeSession?(context: ProviderContext, sessionName: string): Promise<boolean>
}

export function normalizeConfiguredShell(shell?: AiShell): AiShell | undefined {
  if (!shell) return undefined
  return shell
}
