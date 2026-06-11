import type { AiEnvironmentConfig, AiExecutionMode, Capability } from '../../../shared/types'

function normalizeRuntimeEntrypointHistory(
  history: AiEnvironmentConfig['runtimeEntrypointHistory'] | unknown,
  runtimeEntrypoint?: string
): string[] | undefined {
  const items = Array.isArray(history)
    ? history
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
    : []
  const primary = runtimeEntrypoint?.trim()
  const merged = primary ? [primary, ...items] : items
  const deduped = Array.from(new Set(merged))
  return deduped.length > 0 ? deduped : undefined
}

export function defaultModeForCapability(capability: Capability): AiExecutionMode {
  if (capability.hostPlatform === 'windows') {
    if (capability.hasWsl) return 'windows-wsl'
    return 'windows-native'
  }
  if (capability.hostPlatform === 'macos') return 'macos-native'
  return 'linux-native'
}

export function availableModesForCapability(capability: Capability): AiExecutionMode[] {
  if (capability.hostPlatform === 'windows') {
    const modes: AiExecutionMode[] = []
    if (capability.hasWsl) modes.push('windows-wsl')
    modes.push('windows-native', 'custom-script', 'disabled')
    return modes
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
    const runtimeEntrypointHistory = normalizeRuntimeEntrypointHistory(
      config.runtimeEntrypointHistory,
      config.runtimeEntrypoint
    )
    const runtimeEntrypoint = config.runtimeEntrypoint?.trim()
      || runtimeEntrypointHistory?.[0]
      || undefined
    return {
      mode: config.mode,
      wslDistro: config.wslDistro || (capability.hasWsl ? capability.wslDistro : undefined),
      shell: config.shell,
      runtimeEntrypoint,
      runtimeEntrypointHistory,
      runtimePassProjectPath: config.runtimePassProjectPath ?? true,
      aiCommitEntrypoint: config.aiCommitEntrypoint || legacy.aiCommitEntrypoint,
    }
  }

  return {
    mode: defaultModeForCapability(capability),
    wslDistro: capability.hasWsl ? capability.wslDistro : undefined,
    runtimeEntrypoint: legacy.runtimeLauncherScript?.trim() || undefined,
    runtimeEntrypointHistory: normalizeRuntimeEntrypointHistory(undefined, legacy.runtimeLauncherScript),
    runtimePassProjectPath: true,
    aiCommitEntrypoint: legacy.aiCommitEntrypoint,
  }
}
