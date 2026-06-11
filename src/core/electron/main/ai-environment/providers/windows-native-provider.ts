import { createHash } from 'crypto'
import { basename } from 'path'
import type { RuntimeDiagnostics } from '../../../../shared/types'
import type { AiExecutionProvider } from '../provider-types'

function normalizeRuntimeCli(cli?: 'claude' | 'codex'): 'claude' | 'codex' {
  return cli === 'codex' ? 'codex' : 'claude'
}

function buildRuntimeSessionName(projectPath: string, cli?: 'claude' | 'codex'): string {
  const normalizedCli = normalizeRuntimeCli(cli)
  const hash = createHash('md5').update(`${normalizedCli}:${projectPath}`).digest('hex').slice(0, 6)
  return `${basename(projectPath)}-${normalizedCli}-${hash}`
}

export const windowsNativeProvider: AiExecutionProvider = {
  mode: 'windows-native',
  label: 'Windows Native',

  isSupported(context) {
    return context.capability.hostPlatform === 'windows'
  },

  async diagnose(context): Promise<RuntimeDiagnostics> {
    return {
      checkedAt: Date.now(),
      mode: 'windows-native',
      providerLabel: this.label,
      runtimeEntrypoint: context.config.runtimeEntrypoint,
      supported: context.capability.hostPlatform === 'windows',
      hasWsl: context.capability.hasWsl,
      hasTmux: false,
      shell: context.config.shell || 'cmd',
      issues: [],
    }
  },

  async resolveRuntimeLaunch(context, input) {
    const sessionName = buildRuntimeSessionName(input.projectPath, input.cli)
    const runtimeCommand = input.cli === 'codex' ? 'codex' : 'claude'
    const title = input.cli === 'codex' ? 'Codex Runtime' : 'Claude Runtime'
    return {
      mode: 'windows-native',
      sessionName,
      providerLabel: this.label,
      // Windows Native is intentionally fire-and-forget for now:
      // open a local terminal directly instead of pretending we can reattach/close it reliably.
      supportsManagedSessions: false,
      startCommand: 'cmd.exe',
      startArgs: [
        '/d',
        '/c',
        'start',
        title,
        'cmd.exe',
        '/d',
        '/k',
        runtimeCommand,
      ],
      cwd: input.projectPath,
      detached: false,
      windowsHide: true,
      shell: false,
      openStrategy: 'not-supported',
      stopStrategy: 'not-supported',
    }
  },

  async resolveAiCommitLaunch(_context, input) {
    const args = [
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
      mode: 'windows-native',
      providerLabel: this.label,
      command: 'pwsh',
      args,
      cwd: input.repoRoot,
      shell: false,
      outputLabel: 'pwsh',
    }
  },
}
