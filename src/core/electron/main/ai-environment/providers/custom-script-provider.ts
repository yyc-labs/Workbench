import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { homedir } from 'os'
import { basename } from 'path'
import type { AiEnvironmentConfig, AiExecutionMode, AiRuntimeProfile, RuntimeDiagnostics, RuntimeSessionInfo } from '../../../../shared/types'
import {
  isLikelyWslEntrypointPath,
  shouldUseWslForRuntimeEntrypoint,
} from '../../../../shared/runtimeEntrypoint'
import { normalizeWindowsHostPath } from '../../host-path'
import type { AiExecutionProvider } from '../provider-types'
import { wslBridge } from '../../wsl-bridge'
import { tmuxManager } from '../../tmux-manager'
import { buildWindowsTerminalShellLaunch } from '../../shell/windows-shell'
import {
  buildEnvPrefix,
  buildProfileAwareSessionName,
  buildProfileCommandLine,
  buildRuntimeProfileEnv,
  quoteWindowsShellArg,
} from '../runtime-profile-launch'

function quoteBashSingle(input: string): string {
  return input.replace(/'/g, "'\\''")
}

function expandHomeRelativePath(pathValue: string, homeDir?: string): string {
  const normalized = pathValue.trim()
  if (!normalized) return normalized
  if (!homeDir) return normalized

  if (normalized === '~') return homeDir
  if (normalized.startsWith('~/')) return `${homeDir}/${normalized.slice(2)}`
  if (normalized === '$HOME') return homeDir
  if (normalized.startsWith('$HOME/')) return `${homeDir}/${normalized.slice(6)}`
  if (normalized === '${HOME}') return homeDir
  if (normalized.startsWith('${HOME}/')) return `${homeDir}/${normalized.slice(8)}`
  return normalized
}

async function resolveWslHome(hasWsl: boolean, wslHome?: string): Promise<string | undefined> {
  if (wslHome) return wslHome
  if (!hasWsl) return undefined
  try {
    const resolved = await wslBridge.exec('printf %s "$HOME"', 5000)
    return resolved.trim() || undefined
  } catch {
    return undefined
  }
}

async function resolveCustomEntrypoint(
  pathValue: string | undefined,
  hostPlatform: 'windows' | 'linux' | 'macos',
  hasWsl: boolean,
  wslHome?: string,
): Promise<string> {
  const normalized = pathValue?.trim() || ''
  if (!normalized) return ''
  const homeDir = hostPlatform === 'windows'
    ? await resolveWslHome(hasWsl, wslHome)
    : process.env.HOME || homedir()
  return expandHomeRelativePath(normalized, homeDir)
}

function quotePosixPathForShell(pathValue: string): string {
  const normalized = pathValue.trim()
  if (!normalized) return "''"
  if (normalized === '~' || normalized === '$HOME' || normalized === '${HOME}') {
    return '"$HOME"'
  }
  if (normalized.startsWith('~/')) {
    return `"$HOME"'${quoteBashSingle(normalized.slice(1))}'`
  }
  if (normalized.startsWith('$HOME/')) {
    return `"$HOME"'${quoteBashSingle(normalized.slice(5))}'`
  }
  if (normalized.startsWith('${HOME}/')) {
    return `"$HOME"'${quoteBashSingle(normalized.slice(7))}'`
  }
  return `'${quoteBashSingle(normalized)}'`
}

function isPowerShellScript(pathValue: string): boolean {
  return /\.ps1$/i.test(pathValue)
}

function isCmdScript(pathValue: string): boolean {
  return /\.(cmd|bat)$/i.test(pathValue)
}

function shouldUseWslForConfigEntrypoint(config: Pick<AiEnvironmentConfig, 'runtimeEntrypointConfig' | 'runtimeEntrypoint'>): boolean {
  if (config.runtimeEntrypointConfig) return shouldUseWslForRuntimeEntrypoint(config)
  return isLikelyWslEntrypointPath(config.runtimeEntrypoint)
}

function checkPosixEntrypoint(pathValue: string): { exists: boolean; executable: boolean } {
  const shellPath = quotePosixPathForShell(pathValue)
  const result = spawnSync('bash', ['-lc', `[ -e ${shellPath} ] && [ -x ${shellPath} ] && echo EXISTS_EXEC || ([ -e ${shellPath} ] && echo EXISTS_NOEXEC) || echo MISSING`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 5000,
  })
  const stdout = result.stdout || ''
  return {
    exists: stdout.includes('EXISTS_EXEC') || stdout.includes('EXISTS_NOEXEC'),
    executable: stdout.includes('EXISTS_EXEC'),
  }
}

function resolveProjectPathArg(
  projectPath: string,
  hostPlatform: 'windows' | 'linux' | 'macos',
  targetEnvironment: 'host' | 'wsl',
  wslDistro?: string
): string {
  if (hostPlatform === 'windows') {
    if (targetEnvironment === 'wsl') return wslBridge.toWslPath(projectPath)
    return normalizeWindowsHostPath(projectPath, wslDistro)
  }
  return projectPath
}

function normalizeRuntimeCli(cli?: 'claude' | 'codex'): 'claude' | 'codex' {
  return cli === 'codex' ? 'codex' : 'claude'
}

function buildSessionHint(projectPath: string, cli?: 'claude' | 'codex'): string {
  const normalizedCli = normalizeRuntimeCli(cli)
  const hash = createHash('md5')
    .update(`${normalizedCli}:${projectPath}`)
    .digest('hex')
    .slice(0, 6)
  return `${basename(projectPath)}-${normalizedCli}-${hash}`
}

function buildRuntimeLaunchEnv(input: Parameters<AiExecutionProvider['resolveRuntimeLaunch']>[1], resolvedProjectPath: string): Record<string, string> {
  const cli = normalizeRuntimeCli(input.cli)
  return {
    AI_CLI: cli,
    AI_RUNTIME_CLI: cli,
    YYC_AI_RUNTIME_CLI: cli,
    AI_RUNTIME_PROJECT_PATH: resolvedProjectPath,
    YYC_AI_RUNTIME_PROJECT_PATH: resolvedProjectPath,
    AI_RUNTIME_SESSION_NAME: buildSessionHint(input.projectPath, cli),
    YYC_AI_RUNTIME_SESSION_NAME: buildSessionHint(input.projectPath, cli),
  }
}

function buildRuntimeScriptArgs(
  input: Parameters<AiExecutionProvider['resolveRuntimeLaunch']>[1],
  resolvedProjectPath: string,
  passProjectPath: boolean,
): string[] {
  return [
    ...(passProjectPath ? [resolvedProjectPath] : []),
    '--cli',
    normalizeRuntimeCli(input.cli),
  ]
}

function getCustomProfileCommand(profile?: AiRuntimeProfile | null): string {
  return profile?.kind === 'custom' ? profile.command?.trim() || '' : ''
}

function buildBashWrappedExec(entrypoint: string, args: string[], env?: Record<string, string>): string {
  const envPrefix = env
    ? Object.entries(env)
      .map(([key, value]) => `${key}='${quoteBashSingle(value)}'`)
      .join(' ')
    : ''
  const argv = [
    quotePosixPathForShell(entrypoint),
    ...args.map((item) => `'${quoteBashSingle(item)}'`),
  ].join(' ')
  return envPrefix ? `${envPrefix} exec ${argv}` : `exec ${argv}`
}

function buildAiCommitScriptArgs(input: Parameters<AiExecutionProvider['resolveAiCommitLaunch']>[1]): string[] {
  return [
    '-All',
    ...(input.cliConfig.enabled ? ['-UseAi'] : []),
    ...(input.cliConfig.split ? ['-Split', '-SplitMaxBatches', String(input.cliConfig.splitMaxBatches)] : []),
    '-MaxBullets',
    String(input.cliConfig.maxBullets),
    ...(input.cliConfig.apiBaseUrl ? ['-ApiBaseUrl', input.cliConfig.apiBaseUrl] : []),
    ...(input.cliConfig.apiKey ? ['-ApiKey', input.cliConfig.apiKey] : []),
    ...(input.cliConfig.model ? ['-Model', input.cliConfig.model] : []),
  ]
}

function buildPowerShellFileArgs(scriptPath: string, input: Parameters<AiExecutionProvider['resolveAiCommitLaunch']>[1]): string[] {
  return [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    ...buildAiCommitScriptArgs(input),
  ]
}

function resolveHostTmuxMode(hostPlatform: 'windows' | 'linux' | 'macos'): AiExecutionMode {
  if (hostPlatform === 'macos') return 'macos-native'
  return 'linux-native'
}

function listPosixTmuxSessions(mode: AiExecutionMode): RuntimeSessionInfo[] {
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

function buildWslPwshCommand(
  scriptPath: string,
  repoRoot: string,
  input: Parameters<AiExecutionProvider['resolveAiCommitLaunch']>[1],
): string {
  const quotedArgs = [
    "'-NoProfile'",
    "'-ExecutionPolicy'",
    "'Bypass'",
    "'-File'",
    quotePosixPathForShell(scriptPath),
    ...buildAiCommitScriptArgs(input).map((item) => `'${quoteBashSingle(item)}'`),
  ].join(' ')
  const preferredPwsh = quoteBashSingle(input.cliConfig.wslPwshPath)
  return [
    'set -euo pipefail',
    `cd '${quoteBashSingle(repoRoot)}'`,
    `if [ -x '${preferredPwsh}' ]; then`,
    `  exec '${preferredPwsh}' ${quotedArgs}`,
    'else',
    `  exec pwsh ${quotedArgs}`,
    'fi',
  ].join('\n')
}

function buildProfileTerminalCommand(
  resolvedProjectPath: string,
  launchEnv: Record<string, string>,
  commandLine: string,
): string {
  return [
    `cd '${quoteBashSingle(resolvedProjectPath)}'`,
    `${buildEnvPrefix(launchEnv)} ${commandLine}; exec bash -i`,
  ].join(' && ')
}

function quoteAppleScriptString(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function buildPosixTerminalProfileLaunch(
  hostPlatform: 'linux' | 'macos',
  command: string,
): { startCommand: string; startArgs: string[] } {
  if (hostPlatform === 'macos') {
    const bashCommand = `bash -ilc '${quoteBashSingle(command)}'`
    const appleScript = [
      'tell application "Terminal"',
      'activate',
      `do script "${quoteAppleScriptString(bashCommand)}"`,
      'end tell',
    ]
    return {
      startCommand: 'osascript',
      startArgs: appleScript.flatMap((line) => ['-e', line]),
    }
  }

  return {
    startCommand: 'x-terminal-emulator',
    startArgs: ['-e', 'bash', '-ilc', command],
  }
}

export const customScriptProvider: AiExecutionProvider = {
  mode: 'custom-script',
  label: 'Custom Script',

  isSupported() {
    return true
  },

  async diagnose(context): Promise<RuntimeDiagnostics> {
    const issues: string[] = []
    const profileCommand = getCustomProfileCommand(context.runtimeProfile)
    if (context.runtimeProfile?.kind === 'custom' && !profileCommand) {
      issues.push(`Runtime profile command is not configured: ${context.runtimeProfile.name}`)
      return {
        checkedAt: Date.now(),
        mode: 'custom-script',
        providerLabel: this.label,
        runtimeEntrypoint: undefined,
        supported: false,
        hasWsl: context.capability.hasWsl,
        hasTmux: context.capability.hasTmux,
        shell: context.config.shell,
        issues,
      }
    }
    if (profileCommand) {
      if (context.capability.hostPlatform === 'windows' && isLikelyWslEntrypointPath(profileCommand) && !context.capability.hasWsl) {
        issues.push('WSL is required to run a POSIX custom runtime command on Windows')
      }
      return {
        checkedAt: Date.now(),
        mode: 'custom-script',
        providerLabel: this.label,
        runtimeEntrypoint: profileCommand,
        supported: issues.length === 0,
        hasWsl: context.capability.hasWsl,
        hasTmux: context.capability.hasTmux,
        shell: context.config.shell,
        issues,
      }
    }

    const rawEntrypoint = context.config.runtimeEntrypoint?.trim()
    const expandedEntrypoint = rawEntrypoint
      ? await resolveCustomEntrypoint(
        rawEntrypoint,
        context.capability.hostPlatform,
        context.capability.hasWsl,
        context.capability.wslEnv?.HOME,
      )
      : undefined
    const useWslEntrypoint = shouldUseWslForConfigEntrypoint(context.config)
    let launcherScriptExists: boolean | undefined
    let launcherScriptExecutable: boolean | undefined

    if (!expandedEntrypoint) {
      issues.push('Runtime entrypoint is not configured')
    } else if (context.capability.hostPlatform === 'windows' && useWslEntrypoint) {
      if (!context.capability.hasWsl) {
        issues.push('WSL is required to run a POSIX custom runtime entrypoint on Windows')
      } else {
        try {
          const shellPath = quotePosixPathForShell(expandedEntrypoint)
          const flags = await wslBridge.exec(
            `[ -e ${shellPath} ] && [ -x ${shellPath} ] && echo EXISTS_EXEC || ([ -e ${shellPath} ] && echo EXISTS_NOEXEC) || echo MISSING`
          )
          launcherScriptExists = flags.includes('EXISTS_EXEC') || flags.includes('EXISTS_NOEXEC')
          launcherScriptExecutable = flags.includes('EXISTS_EXEC')
          if (flags.includes('EXISTS_NOEXEC')) {
            issues.push(`Runtime entrypoint is not executable: ${expandedEntrypoint}`)
          }
          if (flags.includes('MISSING')) {
            issues.push(`Runtime entrypoint not found: ${expandedEntrypoint}`)
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          issues.push(`Failed to check runtime entrypoint: ${message}`)
        }
      }
    } else if (expandedEntrypoint) {
      const flags = checkPosixEntrypoint(expandedEntrypoint)
      launcherScriptExists = flags.exists
      launcherScriptExecutable = flags.executable
      if (!flags.exists) {
        issues.push(`Runtime entrypoint not found: ${expandedEntrypoint}`)
      } else if (!flags.executable) {
        issues.push(`Runtime entrypoint is not executable: ${expandedEntrypoint}`)
      }
    }

    return {
      checkedAt: Date.now(),
      mode: 'custom-script',
      providerLabel: this.label,
      runtimeEntrypoint: expandedEntrypoint,
      supported: Boolean(expandedEntrypoint),
      hasWsl: context.capability.hasWsl,
      hasTmux: context.capability.hasTmux,
      launcherScript: expandedEntrypoint,
      launcherScriptExists,
      launcherScriptExecutable,
      shell: context.config.shell,
      issues,
    }
  },

  async resolveRuntimeLaunch(context, input) {
    const profileCommand = getCustomProfileCommand(input.profile)
    if (input.profile?.kind === 'custom' && !profileCommand) {
      throw new Error(`Runtime profile command is not configured: ${input.profile.name}`)
    }
    const rawEntrypoint = context.config.runtimeEntrypoint?.trim()
    const entrypoint = profileCommand || (rawEntrypoint
      ? await resolveCustomEntrypoint(
        rawEntrypoint,
        context.capability.hostPlatform,
        context.capability.hasWsl,
      context.capability.wslEnv?.HOME,
      )
      : '')
    const targetEnvironment: 'host' | 'wsl' =
      context.capability.hostPlatform === 'windows'
        && (
          profileCommand
            ? isLikelyWslEntrypointPath(entrypoint)
            : shouldUseWslForConfigEntrypoint(context.config)
        )
        ? 'wsl'
        : 'host'
    const resolvedProjectPath = resolveProjectPathArg(
      input.projectPath,
      context.capability.hostPlatform,
      targetEnvironment,
      context.config.wslDistro || context.capability.wslDistro,
    )
    const startArgs = profileCommand
      ? []
      : buildRuntimeScriptArgs(
        input,
        resolvedProjectPath,
        Boolean(context.config.runtimePassProjectPath),
      )
    const commandLine = profileCommand
      ? buildProfileCommandLine(
        input.profile,
        input.cli,
        resolvedProjectPath,
        context.capability.hostPlatform === 'windows' && targetEnvironment === 'host'
          ? quoteWindowsShellArg
          : undefined,
      )
      : buildBashWrappedExec(entrypoint, startArgs)
    const sessionHint = buildProfileAwareSessionName(
      input.projectPath,
      input.profile,
      input.cli,
      buildSessionHint,
      resolvedProjectPath,
    )
    const launchEnv = profileCommand
      ? buildRuntimeProfileEnv({
        profile: input.profile,
        fallbackCli: input.cli,
        projectPath: input.projectPath,
        resolvedProjectPath,
        sessionName: sessionHint,
        commandLine,
      })
      : buildRuntimeLaunchEnv(input, resolvedProjectPath)

    if (!entrypoint) {
      throw new Error('Custom runtime entrypoint is not configured')
    }

    if (profileCommand && context.capability.hostPlatform === 'windows' && targetEnvironment === 'wsl') {
      if (!context.capability.hasWsl) {
        throw new Error('WSL is required to run a POSIX custom runtime command on Windows')
      }
      const title = `${input.profile?.name?.trim() || 'AI Runtime'} Runtime`
      return {
        mode: 'custom-script',
        sessionName: sessionHint,
        providerLabel: this.label,
        supportsManagedSessions: false,
        startCommand: 'cmd.exe',
        startArgs: [
          '/d',
          '/c',
          'start',
          title,
          'wsl.exe',
          '-d',
          context.config.wslDistro || context.capability.wslDistro || 'Ubuntu',
          '--',
          'bash',
          '-ilc',
          buildProfileTerminalCommand(resolvedProjectPath, launchEnv, commandLine),
        ],
        env: launchEnv,
        shell: false,
        windowsHide: true,
        detached: false,
        openStrategy: 'not-supported',
        stopStrategy: 'not-supported',
      }
    }

    if (context.capability.hostPlatform === 'windows' && targetEnvironment === 'wsl') {
      if (!context.capability.hasWsl) {
        throw new Error('WSL is required to run a POSIX custom runtime entrypoint on Windows')
      }
      return {
        mode: 'custom-script',
        sessionName: sessionHint,
        providerLabel: this.label,
        supportsManagedSessions: false,
        startCommand: 'wsl.exe',
        startArgs: [
          '-d',
          context.config.wslDistro || context.capability.wslDistro || 'Ubuntu',
          '--',
          'bash',
          '-ilc',
          buildBashWrappedExec(entrypoint, startArgs, launchEnv),
        ],
        env: launchEnv,
        shell: false,
        windowsHide: true,
        detached: true,
        openStrategy: 'not-supported',
        stopStrategy: 'not-supported',
      }
    }

    if (profileCommand && (context.capability.hostPlatform === 'linux' || context.capability.hostPlatform === 'macos')) {
      const terminalLaunch = buildPosixTerminalProfileLaunch(
        context.capability.hostPlatform,
        buildProfileTerminalCommand(resolvedProjectPath, launchEnv, commandLine),
      )
      return {
        mode: 'custom-script',
        sessionName: sessionHint,
        providerLabel: this.label,
        supportsManagedSessions: false,
        startCommand: terminalLaunch.startCommand,
        startArgs: terminalLaunch.startArgs,
        cwd: resolvedProjectPath,
        env: launchEnv,
        shell: false,
        detached: true,
        openStrategy: 'not-supported',
        stopStrategy: 'not-supported',
      }
    }

    if (context.capability.hostPlatform === 'linux' || context.capability.hostPlatform === 'macos') {
      return {
        mode: 'custom-script',
        sessionName: sessionHint,
        providerLabel: this.label,
        supportsManagedSessions: false,
        startCommand: 'bash',
        startArgs: ['-ilc', buildBashWrappedExec(entrypoint, startArgs, launchEnv)],
        env: launchEnv,
        shell: false,
        detached: true,
        openStrategy: 'not-supported',
        stopStrategy: 'not-supported',
      }
    }

    if (profileCommand) {
      const terminalLaunch = buildWindowsTerminalShellLaunch(commandLine, {
        preferredShell: context.config.shell,
      })
      const title = `${input.profile?.name?.trim() || 'AI Runtime'} Runtime`
      return {
        mode: 'custom-script',
        sessionName: sessionHint,
        providerLabel: this.label,
        supportsManagedSessions: false,
        startCommand: 'cmd.exe',
        startArgs: [
          '/d',
          '/c',
          'start',
          title,
          terminalLaunch.shell.command,
          ...terminalLaunch.args,
        ],
        cwd: resolvedProjectPath,
        env: launchEnv,
        shell: false,
        windowsHide: true,
        detached: false,
        openStrategy: 'not-supported',
        stopStrategy: 'not-supported',
      }
    }

    return {
      mode: 'custom-script',
      sessionName: sessionHint,
      providerLabel: this.label,
      supportsManagedSessions: false,
      startCommand: entrypoint,
      startArgs,
      env: launchEnv,
      shell: false,
      detached: true,
      openStrategy: 'not-supported',
      stopStrategy: 'not-supported',
    }
  },

  async resolveAiCommitLaunch(context, input) {
    const rawEntrypoint = context.config.aiCommitEntrypoint?.trim()
    const entrypoint = rawEntrypoint
      ? await resolveCustomEntrypoint(
        rawEntrypoint,
        context.capability.hostPlatform,
        context.capability.hasWsl,
        context.capability.wslEnv?.HOME,
      )
      : input.scriptPath
    const scriptArgs = buildAiCommitScriptArgs(input)
    const hostRepoRoot = context.capability.hostPlatform === 'windows'
      ? normalizeWindowsHostPath(input.repoRoot, context.capability.wslDistro)
      : input.repoRoot

    if (context.capability.hostPlatform === 'windows' && isLikelyWslEntrypointPath(entrypoint)) {
      if (!context.capability.hasWsl) {
        throw new Error('WSL is required to run a POSIX custom AI Commit entrypoint on Windows')
      }

      const repoRootWslPath = wslBridge.toWslPath(input.repoRoot)
      const command = isPowerShellScript(entrypoint)
        ? buildWslPwshCommand(entrypoint, repoRootWslPath, input)
        : [
          'set -euo pipefail',
          `cd '${quoteBashSingle(repoRootWslPath)}'`,
          buildBashWrappedExec(entrypoint, scriptArgs),
        ].join('\n')

      return {
        mode: 'custom-script',
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
        cwd: hostRepoRoot,
        shell: false,
        outputLabel: isPowerShellScript(entrypoint) ? 'custom-script-wsl-pwsh' : 'custom-script-wsl',
      }
    }

    if (isPowerShellScript(entrypoint)) {
      return {
        mode: 'custom-script',
        providerLabel: this.label,
        command: 'pwsh',
        args: buildPowerShellFileArgs(entrypoint, input),
        cwd: hostRepoRoot,
        shell: false,
        env: context.capability.hostPlatform === 'windows'
          ? undefined
          : {
            LANG: 'C.UTF-8',
            LC_ALL: 'C.UTF-8',
          },
        outputLabel: 'custom-script-pwsh',
      }
    }

    if (context.capability.hostPlatform === 'windows' && isCmdScript(entrypoint)) {
      return {
        mode: 'custom-script',
        providerLabel: this.label,
        command: 'cmd.exe',
        args: ['/d', '/c', entrypoint, ...scriptArgs],
        cwd: hostRepoRoot,
        shell: false,
        outputLabel: 'custom-script-cmd',
      }
    }

    if (context.capability.hostPlatform === 'linux' || context.capability.hostPlatform === 'macos') {
      return {
        mode: 'custom-script',
        providerLabel: this.label,
        command: 'bash',
        args: ['-ilc', buildBashWrappedExec(entrypoint, scriptArgs)],
        cwd: input.repoRoot,
        shell: false,
        env: {
          LANG: 'C.UTF-8',
          LC_ALL: 'C.UTF-8',
        },
        outputLabel: 'custom-script-posix',
      }
    }

    return {
      mode: 'custom-script',
      providerLabel: this.label,
      command: entrypoint,
      args: scriptArgs,
      cwd: hostRepoRoot,
      shell: false,
      outputLabel: 'custom-script-direct',
    }
  },

  async listRuntimeSessions(context): Promise<RuntimeSessionInfo[]> {
    if (context.capability.hostPlatform === 'windows' && context.capability.hasWsl) {
      if (!await wslBridge.hasTmux()) return []
      const sessions = await tmuxManager.listLauncherSessions()
      return sessions.map((item) => ({
        sessionName: item.sessionName,
        projectId: item.projectId,
        createdAt: item.createdAt,
        status: item.status,
        mode: 'windows-wsl',
      }))
    }

    if (context.capability.hostPlatform === 'linux' || context.capability.hostPlatform === 'macos') {
      return listPosixTmuxSessions(resolveHostTmuxMode(context.capability.hostPlatform))
    }

    return []
  },

  async stopRuntimeSession(context, sessionName: string): Promise<boolean> {
    if (context.capability.hostPlatform === 'windows' && context.capability.hasWsl) {
      if (!await wslBridge.hasTmux()) return false
      return tmuxManager.killSession(sessionName)
    }

    if (context.capability.hostPlatform === 'linux' || context.capability.hostPlatform === 'macos') {
      const result = spawnSync('tmux', ['kill-session', '-t', sessionName], {
        stdio: 'ignore',
        timeout: 5000,
      })
      return result.status === 0
    }

    return false
  },
}
