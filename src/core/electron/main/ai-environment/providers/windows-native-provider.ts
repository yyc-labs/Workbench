import { createHash } from 'crypto'
import { basename } from 'path'
import type { RuntimeDiagnostics } from '../../../../shared/types'
import { normalizeWindowsHostPath } from '../../host-path'
import {
  preferredWindowsShellForDiagnostics,
  resolveWindowsPowerShell,
} from '../../shell/windows-shell'
import type { AiExecutionProvider } from '../provider-types'
import {
  buildProfileAwareSessionName,
  buildProfileCommandLine,
  buildRuntimeProfileEnv,
  quoteWindowsShellArg,
} from '../runtime-profile-launch'

function normalizeRuntimeCli(cli?: 'claude' | 'codex'): 'claude' | 'codex' {
  return cli === 'codex' ? 'codex' : 'claude'
}

function preferredRuntimePowerShellCommand(shell?: string): string {
  return shell === 'powershell' ? 'powershell.exe' : 'pwsh.exe'
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
      shell: preferredWindowsShellForDiagnostics(context.config.shell),
      issues: [],
    }
  },

  async resolveRuntimeLaunch(context, input) {
    const hostProjectPath = normalizeWindowsHostPath(input.projectPath, context.capability.wslDistro)
    const sessionName = buildProfileAwareSessionName(
      input.projectPath,
      input.profile,
      input.cli,
      buildRuntimeSessionName,
      hostProjectPath,
    )
    const runtimeCommand = buildProfileCommandLine(input.profile, input.cli, hostProjectPath, quoteWindowsShellArg)
    const title = input.profile?.name?.trim()
      ? `${input.profile.name.trim()} Runtime`
      : input.cli === 'codex' ? 'Codex Runtime' : 'Claude Runtime'
    const launchEnv = buildRuntimeProfileEnv({
      profile: input.profile,
      fallbackCli: input.cli,
      projectPath: input.projectPath,
      resolvedProjectPath: hostProjectPath,
      sessionName,
      commandLine: runtimeCommand,
    })
    const runtimeShellCommand = preferredRuntimePowerShellCommand(context.config.shell)
    const runtimeShellArgs = ['-NoLogo', '-NoProfile', '-NoExit', '-Command', runtimeCommand]
    return {
      mode: 'windows-native',
      sessionName,
      providerLabel: this.label,
      // Windows Native is intentionally fire-and-forget for now:
      // open a local terminal directly instead of pretending we can reattach/close it reliably.
      supportsManagedSessions: false,
      startCommand: 'wt.exe',
      startArgs: ['-d', hostProjectPath, runtimeShellCommand, ...runtimeShellArgs],
      cwd: hostProjectPath,
      detached: true,
      windowsHide: false,
      shell: false,
      env: launchEnv,
      fallbackLaunches: [{
        startCommand: 'cmd.exe',
        startArgs: ['/d', '/c', 'start', title, runtimeShellCommand, ...runtimeShellArgs],
        cwd: hostProjectPath,
        detached: false,
        windowsHide: true,
        shell: false,
        env: launchEnv,
      }],
      openStrategy: 'not-supported',
      stopStrategy: 'not-supported',
    }
  },

  async resolveAiCommitLaunch(context, input) {
    const hostRepoRoot = normalizeWindowsHostPath(input.repoRoot)
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
    const resolvedShell = resolveWindowsPowerShell(context.config.shell)
    return {
      mode: 'windows-native',
      providerLabel: this.label,
      command: resolvedShell.command,
      args,
      cwd: hostRepoRoot,
      shell: false,
      outputLabel: resolvedShell.kind,
    }
  },
}
