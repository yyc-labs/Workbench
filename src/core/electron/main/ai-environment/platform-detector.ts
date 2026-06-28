import type { AiEnvironmentConfig, AiExecutionMode, Capability } from '../../../shared/types'
import {
  composeRuntimeEntrypointConfig,
  normalizeRuntimeEntrypointConfig,
  normalizeRuntimeEntrypointHistoryEntries,
  runtimeEntrypointConfigsToHistory,
} from '../../../shared/runtimeEntrypoint'

function hasHostWslOption(capability: Capability): boolean {
  return Boolean(capability.hasWsl || capability.hasWslInstalled)
}

export function defaultModeForCapability(capability: Capability): AiExecutionMode {
  if (capability.hostPlatform === 'windows') {
    return 'windows-native'
  }
  if (capability.hostPlatform === 'macos') return 'macos-native'
  return 'linux-native'
}

export function availableModesForCapability(capability: Capability): AiExecutionMode[] {
  if (capability.hostPlatform === 'windows') {
    return hasHostWslOption(capability)
      ? ['windows-native', 'windows-wsl', 'custom-script', 'disabled']
      : ['windows-native', 'custom-script', 'disabled']
  }
  return [
    capability.hostPlatform === 'macos' ? 'macos-native' : 'linux-native',
    'custom-script',
    'disabled',
  ]
}

export function migrateLegacyEnvironment(
  config: Partial<AiEnvironmentConfig> | undefined,
  capability: Capability,
  legacy: {
    runtimeLauncherScript?: string
    aiCommitEntrypoint?: string
  }
): AiEnvironmentConfig {
  if (config?.mode) {
    const runtimeEntrypointConfig = normalizeRuntimeEntrypointConfig(
      config.runtimeEntrypointConfig,
      config.runtimeEntrypoint,
    )
    const runtimeEntrypointHistoryEntries = normalizeRuntimeEntrypointHistoryEntries(
      config.runtimeEntrypointHistoryEntries,
      config.runtimeEntrypointHistory,
      runtimeEntrypointConfig ?? config.runtimeEntrypoint,
    )
    const runtimeEntrypointHistory = runtimeEntrypointConfigsToHistory(runtimeEntrypointHistoryEntries)
    const runtimeEntrypoint = composeRuntimeEntrypointConfig(runtimeEntrypointConfig)
      || runtimeEntrypointHistory?.[0]
      || undefined
    return {
      mode: config.mode,
      wslDistro: config.wslDistro || ((capability.hasWsl || capability.hasWslInstalled) ? capability.wslDistro : undefined),
      shell: config.shell,
      runtimeEntrypointConfig: runtimeEntrypointConfig ?? (
        runtimeEntrypoint ? normalizeRuntimeEntrypointConfig(undefined, runtimeEntrypoint) : undefined
      ),
      runtimeEntrypoint,
      runtimeEntrypointHistoryEntries,
      runtimeEntrypointHistory,
      runtimePassProjectPath: config.runtimePassProjectPath ?? true,
      aiCommitEntrypoint: config.aiCommitEntrypoint || legacy.aiCommitEntrypoint,
    }
  }

  const runtimeEntrypointConfig = normalizeRuntimeEntrypointConfig(undefined, legacy.runtimeLauncherScript)
  const runtimeEntrypointHistoryEntries = normalizeRuntimeEntrypointHistoryEntries(
    undefined,
    undefined,
    runtimeEntrypointConfig,
  )

  return {
    mode: defaultModeForCapability(capability),
    wslDistro: (capability.hasWsl || capability.hasWslInstalled) ? capability.wslDistro : undefined,
    runtimeEntrypointConfig,
    runtimeEntrypoint: composeRuntimeEntrypointConfig(runtimeEntrypointConfig) || undefined,
    runtimeEntrypointHistoryEntries,
    runtimeEntrypointHistory: runtimeEntrypointConfigsToHistory(runtimeEntrypointHistoryEntries),
    runtimePassProjectPath: true,
    aiCommitEntrypoint: legacy.aiCommitEntrypoint,
  }
}
