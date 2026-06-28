import type { AiEnvironmentConfig, Capability, CodexEnvironmentScope } from './types'
import {
  isClearlyWindowsEntrypointPath,
  isLikelyWslEntrypointPath,
  shouldUseWslForRuntimeEntrypoint,
} from './runtimeEntrypoint'

type CodexScopeDescriptor = Pick<CodexEnvironmentScope, 'hostPlatform' | 'runtimeMode' | 'target'>

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

  if (hostPlatform === 'windows') {
    if (runtimeMode === 'windows-wsl') {
      return { hostPlatform, runtimeMode, target: 'wsl' }
    }

    if (runtimeMode === 'custom-script') {
      const entrypoint = aiEnvironment?.runtimeEntrypoint?.trim() || ''
      if (aiEnvironment?.runtimeEntrypointConfig) {
        return {
          hostPlatform,
          runtimeMode,
          target: shouldUseWslForRuntimeEntrypoint(aiEnvironment) ? 'wsl' : 'native',
        }
      }
      if (!entrypoint) {
        return { hostPlatform, runtimeMode, target: 'native' }
      }
      if (isLikelyWslEntrypointPath(entrypoint)) {
        return { hostPlatform, runtimeMode, target: 'wsl' }
      }
      if (isClearlyWindowsEntrypointPath(entrypoint)) {
        return { hostPlatform, runtimeMode, target: 'native' }
      }

      return { hostPlatform, runtimeMode, target: 'native' }
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
