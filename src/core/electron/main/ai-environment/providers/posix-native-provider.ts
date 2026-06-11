import { createHash } from 'crypto'
import { basename } from 'path'
import { spawnSync } from 'child_process'
import type {
  AiExecutionMode,
  AiShell,
  RuntimeDiagnostics,
  RuntimeSessionInfo,
} from '../../../../shared/types'
import type { AiExecutionProvider, ProviderContext } from '../provider-types'

function normalizeRuntimeCli(cli?: 'claude' | 'codex'): 'claude' | 'codex' {
  return cli === 'codex' ? 'codex' : 'claude'
}

function buildRuntimeSessionName(projectPath: string, cli?: 'claude' | 'codex'): string {
  const normalizedCli = normalizeRuntimeCli(cli)
  const hash = createHash('md5').update(`${normalizedCli}:${projectPath}`).digest('hex').slice(0, 6)
  return `${basename(projectPath)}-${normalizedCli}-${hash}`
}

function resolveMode(context: ProviderContext): AiExecutionMode {
  return context.capability.hostPlatform === 'macos' ? 'macos-native' : 'linux-native'
}

function shellExecutable(context: ProviderContext): AiShell {
  return context.config.shell || (context.capability.hostPlatform === 'macos' ? 'zsh' : 'bash')
}

function shellLaunchFlag(shell: AiShell): string {
  return shell === 'bash' || shell === 'zsh' ? '-ilc' : '-lc'
}

async function listTmuxSessionsForPosix(mode: AiExecutionMode): Promise<RuntimeSessionInfo[]> {
  const result = spawnSync('tmux', ['list-sessions', '-F', '#{session_name}|#{session_created}|#{session_attached}'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 5000,
  })
  if (result.status !== 0 || !result.stdout) return []
  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [sessionName, createdUnix, attached] = line.split('|')
      return {
        sessionName,
        projectId: '',
        createdAt: Number.parseInt(createdUnix, 10) * 1000 || 0,
        status: attached !== '0' ? 'attached' : 'detached',
        mode,
      }
    })
}

export const posixNativeProvider: AiExecutionProvider = {
  mode: 'linux-native',
  label: 'Posix Native',

  isSupported(context) {
    return context.capability.hostPlatform === 'linux' || context.capability.hostPlatform === 'macos'
  },

  async diagnose(context): Promise<RuntimeDiagnostics> {
    const mode = resolveMode(context)
    const issues: string[] = []
    if (!context.capability.hasTmux) {
      issues.push('tmux is not available')
    }
    return {
      checkedAt: Date.now(),
      mode,
      providerLabel: context.capability.hostPlatform === 'macos' ? 'macOS Native' : 'Linux Native',
      runtimeEntrypoint: context.config.runtimeEntrypoint,
      supported: context.capability.hostPlatform === 'linux' || context.capability.hostPlatform === 'macos',
      hasWsl: false,
      hasTmux: context.capability.hasTmux,
      shell: shellExecutable(context),
      issues,
    }
  },

  async resolveRuntimeLaunch(context, input) {
    const shell = shellExecutable(context)
    const sessionName = buildRuntimeSessionName(input.projectPath, input.cli)
    const runtimeCommand = input.cli === 'codex' ? 'codex' : 'claude'
    const tmuxCommand = [
      `cd '${input.projectPath.replace(/'/g, "'\\''")}'`,
      `exec tmux new-session -A -s '${sessionName}' '${runtimeCommand}'`,
    ].join(' && ')
    return {
      mode: resolveMode(context),
      sessionName,
      providerLabel: context.capability.hostPlatform === 'macos' ? 'macOS Native' : 'Linux Native',
      supportsManagedSessions: true,
      startCommand: shell,
      startArgs: [shellLaunchFlag(shell), tmuxCommand],
      cwd: input.projectPath,
      shell: false,
      detached: true,
      openStrategy: 'posix-terminal-tmux',
      stopStrategy: 'tmux',
    }
  },

  async resolveAiCommitLaunch(context, input) {
    const shell = shellExecutable(context)
    const pwshArgs = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      input.scriptPath,
      '-All',
      ...(input.cliConfig.enabled ? ['-UseAi'] : []),
      ...(input.cliConfig.split ? ['-Split', '-SplitMaxBatches', String(input.cliConfig.splitMaxBatches)] : []),
      '-MaxBullets',
      String(input.cliConfig.maxBullets),
      ...(input.cliConfig.apiBaseUrl ? ['-ApiBaseUrl', input.cliConfig.apiBaseUrl] : []),
      ...(input.cliConfig.apiKey ? ['-ApiKey', input.cliConfig.apiKey] : []),
      ...(input.cliConfig.model ? ['-Model', input.cliConfig.model] : []),
    ]
    return {
      mode: resolveMode(context),
      providerLabel: context.capability.hostPlatform === 'macos' ? 'macOS Native' : 'Linux Native',
      command: 'pwsh',
      args: pwshArgs,
      cwd: input.repoRoot,
      shell: false,
      env: {
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
      },
      outputLabel: `native-${shell}`,
    }
  },

  async listRuntimeSessions(context): Promise<RuntimeSessionInfo[]> {
    return listTmuxSessionsForPosix(resolveMode(context))
  },

  async stopRuntimeSession(_context, sessionName: string): Promise<boolean> {
    const result = spawnSync('tmux', ['kill-session', '-t', sessionName], {
      stdio: 'ignore',
      timeout: 5000,
    })
    return result.status === 0
  },
}
