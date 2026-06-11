import { spawnSync } from 'child_process'
import type { RuntimeDiagnostics } from '../../../../shared/types'
import type { AiExecutionProvider } from '../provider-types'
import { wslBridge } from '../../wsl-bridge'

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

function buildBashWrappedExec(entrypoint: string, args: string[]): string {
  const argv = [entrypoint, ...args]
    .map((item) => `'${quoteBashSingle(item)}'`)
    .join(' ')
  return `exec ${argv}`
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
    const startArgs = context.config.runtimePassProjectPath
      ? [resolveProjectPathArg(input.projectPath, context.capability.hostPlatform, context.capability.hasWsl)]
      : []

    if (!entrypoint) {
      throw new Error('Custom runtime entrypoint is not configured')
    }

    if (context.capability.hostPlatform === 'windows' && isLikelyWslPath(entrypoint)) {
      if (!context.capability.hasWsl) {
        throw new Error('WSL is required to run a POSIX custom runtime entrypoint on Windows')
      }
      return {
        mode: 'custom-script',
        sessionName: `custom-${Date.now()}`,
        providerLabel: this.label,
        supportsManagedSessions: false,
        startCommand: 'wsl.exe',
        startArgs: [
          '-d',
          context.config.wslDistro || context.capability.wslDistro || 'Ubuntu',
          '--',
          'bash',
          '-ilc',
          buildBashWrappedExec(entrypoint, startArgs),
        ],
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
        sessionName: `custom-${Date.now()}`,
        providerLabel: this.label,
        supportsManagedSessions: false,
        startCommand: 'bash',
        startArgs: ['-ilc', buildBashWrappedExec(entrypoint, startArgs)],
        shell: false,
        detached: true,
        openStrategy: 'not-supported',
        stopStrategy: 'not-supported',
      }
    }

    return {
      mode: 'custom-script',
      sessionName: `custom-${Date.now()}`,
      providerLabel: this.label,
      supportsManagedSessions: false,
      startCommand: entrypoint,
      startArgs,
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
}
