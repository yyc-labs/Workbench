import type { AiEnvironmentConfig, Capability, CodexEnvironmentScope } from './types'

type CodexScopeDescriptor = Pick<CodexEnvironmentScope, 'hostPlatform' | 'runtimeMode' | 'target'>

function isLikelyWslPath(pathValue: string): boolean {
  const normalized = pathValue.trim()
  return normalized.startsWith('/')
    || normalized.startsWith('~/')
    || normalized === '~'
    || normalized === '$HOME'
    || normalized.startsWith('$HOME/')
    || normalized === '${HOME}'
    || normalized.startsWith('${HOME}/')
}

function isClearlyWindowsPath(pathValue: string): boolean {
  const normalized = pathValue.trim()
  return /^[A-Za-z]:[\\/]/.test(normalized) || /^\\\\/.test(normalized)
}

function inferHostPlatform(
  capability: Capability | null,
  runtimeMode: AiEnvironmentConfig['mode'],
): Capability['hostPlatform'] {
  if (capability?.hostPlatform) return capability.hostPlatform
  if (runtimeMode === 'windows-wsl' || runtimeMode === 'windows-native') return 'windows'
  if (runtimeMode === 'macos-native') return 'macos'
  return 'linux'
}

export function resolveCodexScopeDescriptor(
  capability: Capability | null,
  aiEnvironment?: AiEnvironmentConfig,
): CodexScopeDescriptor {
  const runtimeMode = aiEnvironment?.mode ?? 'disabled'
  const hostPlatform = inferHostPlatform(capability, runtimeMode)

  if (hostPlatform === 'windows' && capability?.hasWsl) {
    if (runtimeMode === 'windows-wsl') {
      return { hostPlatform, runtimeMode, target: 'wsl' }
    }

    if (runtimeMode === 'custom-script') {
      const entrypoint = aiEnvironment?.runtimeEntrypoint?.trim() || ''
      if (!entrypoint) {
        return { hostPlatform, runtimeMode, target: 'wsl' }
      }
      if (isLikelyWslPath(entrypoint)) {
        return { hostPlatform, runtimeMode, target: 'wsl' }
      }
      if (isClearlyWindowsPath(entrypoint)) {
        return { hostPlatform, runtimeMode, target: 'native' }
      }

      return { hostPlatform, runtimeMode, target: 'wsl' }
    }
  }

  return {
    hostPlatform,
    runtimeMode,
    target: 'native',
  }
}

export function getCodexScopeCacheKey(
  scope: Pick<CodexEnvironmentScope, 'hostPlatform' | 'runtimeMode' | 'target'>,
): string {
  return `${scope.hostPlatform}:${scope.runtimeMode}:${scope.target}`
}

