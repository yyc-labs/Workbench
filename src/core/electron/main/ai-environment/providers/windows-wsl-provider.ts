import { createHash } from 'crypto'
import { basename } from 'path'
import { tmuxManager } from '../../tmux-manager'
import { wslBridge } from '../../wsl-bridge'
import type { AiShell, RuntimeDiagnostics, RuntimeSessionInfo } from '../../../../shared/types'
import type { AiExecutionProvider, ProviderContext } from '../provider-types'

function quoteBashSingle(input: string): string {
  return input.replace(/'/g, "'\\''")
}

function normalizeRuntimeCli(cli?: 'claude' | 'codex'): 'claude' | 'codex' {
  return cli === 'codex' ? 'codex' : 'claude'
}

function normalizeWslShell(shell?: string): AiShell {
  if (shell === 'pwsh') return 'pwsh'
  if (shell === 'zsh') return 'zsh'
  if (shell === 'sh') return 'sh'
  return 'bash'
}

function buildRuntimeSessionName(projectPath: string, cli?: 'claude' | 'codex'): string {
  const normalizedCli = normalizeRuntimeCli(cli)
  const wslPath = wslBridge.toWslPath(projectPath)
  if (normalizedCli === 'codex') {
    const legacyMd5 = createHash('md5').update(wslPath).digest('hex').slice(0, 6)
    return `${basename(projectPath)}-${legacyMd5}`
  }
  const cliAwareMd5 = createHash('md5')
    .update(`${normalizedCli}:${wslPath}`)
    .digest('hex')
    .slice(0, 6)
  return `${basename(projectPath)}-${normalizedCli}-${cliAwareMd5}`
}

function buildManagedRuntimeCommand(projectPath: string, cli: 'claude' | 'codex', context: ProviderContext): string {
  const sessionName = buildRuntimeSessionName(projectPath, cli)
  const projectWslPath = wslBridge.toWslPath(projectPath)
  const cliCommand = cli === 'codex' ? 'codex' : 'claude'
  const tmuxCommand = tmuxManager.attachOrCreateCommand(
    sessionName,
    `cd '${quoteBashSingle(projectWslPath)}' && exec ${cliCommand}`,
    projectWslPath
  )
  return `exec bash -ilc '${quoteBashSingle(tmuxCommand)}'`
}

export const windowsWslProvider: AiExecutionProvider = {
  mode: 'windows-wsl',
  label: 'Windows WSL',

  isSupported(context) {
    return context.capability.hostPlatform === 'windows' && context.capability.hasWsl
  },

  async diagnose(context): Promise<RuntimeDiagnostics> {
    const issues: string[] = []
    const hasWsl = context.capability.hasWsl
    const hasTmux = context.capability.hasTmux
    const distro = context.config.wslDistro || context.capability.wslDistro

    if (!hasWsl) issues.push('WSL is not available')
    if (!hasTmux) issues.push('tmux is not available in WSL')

    return {
      checkedAt: Date.now(),
      mode: 'windows-wsl',
      providerLabel: this.label,
      supported: hasWsl,
      hasWsl,
      hasTmux,
      distro,
      shell: normalizeWslShell(context.capability.wslShell),
      issues,
    }
  },

  async resolveRuntimeLaunch(context, input) {
    const sessionName = buildRuntimeSessionName(input.projectPath, input.cli)
    return {
      mode: 'windows-wsl',
      sessionName,
      providerLabel: this.label,
      supportsManagedSessions: true,
      startCommand: 'wsl.exe',
      startArgs: [
        '-d',
        context.config.wslDistro || context.capability.wslDistro || 'Ubuntu',
        '--',
        'bash',
        '-lc',
        buildManagedRuntimeCommand(input.projectPath, input.cli, context),
      ],
      detached: true,
      windowsHide: true,
      shell: false,
      openStrategy: 'wt-wsl-tmux',
      stopStrategy: 'tmux',
    }
  },

  async resolveAiCommitLaunch(context, input) {
    const quotedArgs = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      input.scriptWslPath || wslBridge.toWslPath(input.scriptPath),
      '-All',
      ...(input.cliConfig.enabled ? ['-UseAi'] : []),
      ...(input.cliConfig.split ? ['-Split', '-SplitMaxBatches', String(input.cliConfig.splitMaxBatches)] : []),
      '-MaxBullets',
      String(input.cliConfig.maxBullets),
      ...(input.cliConfig.apiBaseUrl ? ['-ApiBaseUrl', input.cliConfig.apiBaseUrl] : []),
      ...(input.cliConfig.apiKey ? ['-ApiKey', input.cliConfig.apiKey] : []),
      ...(input.cliConfig.model ? ['-Model', input.cliConfig.model] : []),
    ]
    const preferredPwsh = quoteBashSingle(input.cliConfig.wslPwshPath)
    const quoted = quotedArgs.map((item) => `'${quoteBashSingle(item)}'`).join(' ')
    const wslTargetPath = wslBridge.toWslPath(input.repoRoot)
    const command = [
      'set -euo pipefail',
      `cd '${quoteBashSingle(wslTargetPath)}'`,
      `if [ -x '${preferredPwsh}' ]; then`,
      `  exec '${preferredPwsh}' ${quoted}`,
      'else',
      `  exec pwsh ${quoted}`,
      'fi',
    ].join('\n')

    return {
      mode: 'windows-wsl',
      providerLabel: this.label,
      command: 'wsl.exe',
      args: [
        '-d',
        context.config.wslDistro || context.capability.wslDistro || 'Ubuntu',
        '--',
        'bash',
        '-lc',
        command,
      ],
      cwd: input.repoRoot,
      shell: false,
      outputLabel: 'wsl-pwsh',
    }
  },

  async listRuntimeSessions(): Promise<RuntimeSessionInfo[]> {
    const sessions = await tmuxManager.listLauncherSessions()
    return sessions.map((item) => ({
      sessionName: item.sessionName,
      projectId: item.projectId,
      createdAt: item.createdAt,
      status: item.status,
      mode: 'windows-wsl',
    }))
  },

  async stopRuntimeSession(_context, sessionName: string): Promise<boolean> {
    return tmuxManager.killSession(sessionName)
  },
}
