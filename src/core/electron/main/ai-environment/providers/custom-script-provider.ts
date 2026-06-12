import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { basename } from 'path'
import type { AiExecutionMode, RuntimeDiagnostics, RuntimeSessionInfo } from '../../../../shared/types'
import type { AiExecutionProvider } from '../provider-types'
import { wslBridge } from '../../wsl-bridge'
import { tmuxManager } from '../../tmux-manager'

function quoteBashSingle(input: string): string {
  return input.replace(/'/g, "'\\''")
}

function expandCustomEntrypoint(pathValue: string, hasWsl: boolean, wslHome?: string): string {
  const normalized = pathValue.trim()
  if (!normalized) return normalized
  if (!hasWsl || !wslHome) return normalized

  if (normalized === '~') return wslHome
  if (normalized.startsWith('~/')) return `${wslHome}/${normalized.slice(2)}`
  if (normalized === '$HOME') return wslHome
  if (normalized.startsWith('$HOME/')) return `${wslHome}/${normalized.slice(6)}`
  if (normalized === '${HOME}') return wslHome
  if (normalized.startsWith('${HOME}/')) return `${wslHome}/${normalized.slice(8)}`
  return normalized
}

function isLikelyWslPath(pathValue: string): boolean {
  return pathValue.startsWith('/') || pathValue.startsWith('~/') || pathValue === '~'
}

function isPowerShellScript(pathValue: string): boolean {
  return /\.ps1$/i.test(pathValue)
}

function isCmdScript(pathValue: string): boolean {
  return /\.(cmd|bat)$/i.test(pathValue)
}

function checkPosixEntrypoint(pathValue: string): { exists: boolean; executable: boolean } {
  const result = spawnSync('bash', ['-lc', `[ -e '${quoteBashSingle(pathValue)}' ] && [ -x '${quoteBashSingle(pathValue)}' ] && echo EXISTS_EXEC || ([ -e '${quoteBashSingle(pathValue)}' ] && echo EXISTS_NOEXEC) || echo MISSING`], {
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

function resolveProjectPathArg(projectPath: string, hostPlatform: 'windows' | 'linux' | 'macos', hasWsl: boolean): string {
  if (hostPlatform === 'windows' && hasWsl) {
    return wslBridge.toWslPath(projectPath)
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

function buildBashWrappedExec(entrypoint: string, args: string[], env?: Record<string, string>): string {
  const envPrefix = env
    ? Object.entries(env)
      .map(([key, value]) => `${key}='${quoteBashSingle(value)}'`)
      .join(' ')
    : ''
  const argv = [entrypoint, ...args]
    .map((item) => `'${quoteBashSingle(item)}'`)
    .join(' ')
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
  const quotedArgs = buildPowerShellFileArgs(scriptPath, input)
    .map((item) => `'${quoteBashSingle(item)}'`)
    .join(' ')
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

export const customScriptProvider: AiExecutionProvider = {
  mode: 'custom-script',
  label: 'Custom Script',

  isSupported() {
    return true
  },

  async diagnose(context): Promise<RuntimeDiagnostics> {
    const issues: string[] = []
    const rawEntrypoint = context.config.runtimeEntrypoint?.trim()
    const expandedEntrypoint = rawEntrypoint
      ? expandCustomEntrypoint(rawEntrypoint, context.capability.hasWsl, context.capability.wslEnv?.HOME)
      : undefined
    let launcherScriptExists: boolean | undefined
    let launcherScriptExecutable: boolean | undefined

    if (!expandedEntrypoint) {
      issues.push('Runtime entrypoint is not configured')
    } else if (context.capability.hostPlatform === 'windows' && isLikelyWslPath(expandedEntrypoint)) {
      if (!context.capability.hasWsl) {
        issues.push('WSL is required to run a POSIX custom runtime entrypoint on Windows')
      } else {
        try {
          const escaped = quoteBashSingle(expandedEntrypoint)
          const flags = await wslBridge.exec(
            `[ -e '${escaped}' ] && [ -x '${escaped}' ] && echo EXISTS_EXEC || ([ -e '${escaped}' ] && echo EXISTS_NOEXEC) || echo MISSING`
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
    const rawEntrypoint = context.config.runtimeEntrypoint?.trim()
    const entrypoint = rawEntrypoint
      ? expandCustomEntrypoint(rawEntrypoint, context.capability.hasWsl, context.capability.wslEnv?.HOME)
      : ''
    const resolvedProjectPath = resolveProjectPathArg(
      input.projectPath,
      context.capability.hostPlatform,
      context.capability.hasWsl,
    )
    const startArgs = context.config.runtimePassProjectPath ? [resolvedProjectPath] : []
    const launchEnv = buildRuntimeLaunchEnv(input, resolvedProjectPath)
    const sessionHint = launchEnv.AI_RUNTIME_SESSION_NAME

    if (!entrypoint) {
      throw new Error('Custom runtime entrypoint is not configured')
    }

    if (context.capability.hostPlatform === 'windows' && isLikelyWslPath(entrypoint)) {
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
      ? expandCustomEntrypoint(rawEntrypoint, context.capability.hasWsl, context.capability.wslEnv?.HOME)
      : input.scriptPath
    const scriptArgs = buildAiCommitScriptArgs(input)

    if (context.capability.hostPlatform === 'windows' && isLikelyWslPath(entrypoint)) {
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
        cwd: input.repoRoot,
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
        cwd: input.repoRoot,
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
        cwd: input.repoRoot,
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
      cwd: input.repoRoot,
      shell: false,
      outputLabel: 'custom-script-direct',
    }
  },

  async listRuntimeSessions(context): Promise<RuntimeSessionInfo[]> {
    if (!context.capability.hasTmux) return []

    if (context.capability.hostPlatform === 'windows' && context.capability.hasWsl) {
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
    if (!context.capability.hasTmux) return false

    if (context.capability.hostPlatform === 'windows' && context.capability.hasWsl) {
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
