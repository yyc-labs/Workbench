import type { LaunchOnLoginDisplayMode } from '../../shared/types'

export const WINDOWS_AUTOSTART_ARG = '--autostart'
export const WINDOWS_AUTOSTART_SILENT_ARG = '--autostart-silent'

export function isWindowsAutostartLaunch(argv: string[]): boolean {
  return argv.includes(WINDOWS_AUTOSTART_ARG)
}

export function isSilentAutostartLaunch(argv: string[]): boolean {
  return argv.includes(WINDOWS_AUTOSTART_SILENT_ARG)
}

export function buildInteractiveRelaunchArgs(argv: string[]): string[] {
  return argv
    .slice(1)
    .filter((arg) => arg !== WINDOWS_AUTOSTART_ARG && arg !== WINDOWS_AUTOSTART_SILENT_ARG)
}

export function buildWindowsAutostartArgs(displayMode: LaunchOnLoginDisplayMode): string[] {
  return displayMode === 'tray'
    ? [WINDOWS_AUTOSTART_ARG, WINDOWS_AUTOSTART_SILENT_ARG]
    : [WINDOWS_AUTOSTART_ARG]
}
