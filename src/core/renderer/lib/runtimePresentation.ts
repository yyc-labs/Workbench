import type { AiExecutionMode, RuntimeEntry } from '../../shared/types'

export function isTmuxRuntimeMode(mode?: AiExecutionMode | null): boolean {
  return mode === 'windows-wsl' || mode === 'linux-native' || mode === 'macos-native'
}

export function isTmuxRuntimeEntry(entry?: RuntimeEntry | null, fallbackMode?: AiExecutionMode | null): boolean {
  if (entry?.mode) return isTmuxRuntimeMode(entry.mode)
  return isTmuxRuntimeMode(fallbackMode)
}
