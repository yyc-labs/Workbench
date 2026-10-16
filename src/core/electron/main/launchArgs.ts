import type { LaunchOnLoginDisplayMode } from '../../shared/types'

export const WINDOWS_AUTOSTART_ARG = '--autostart'
export const WINDOWS_AUTOSTART_SILENT_ARG = '--autostart-silent'
/** Desktop `.lnk` shortcuts pass the quick action id via this launch argument. */
export const QUICK_ACTION_ARG_PREFIX = '--quick-action='

export function isWindowsAutostartLaunch(argv: string[]): boolean {
  return argv.includes(WINDOWS_AUTOSTART_ARG)
}

export function isSilentAutostartLaunch(argv: string[]): boolean {
  return argv.includes(WINDOWS_AUTOSTART_SILENT_ARG)
}

/** Returns the quick action id carried by the first `--quick-action=` argument, or null. */
export function parseQuickActionArg(argv: readonly string[]): string | null {
  for (const argument of argv) {
    if (typeof argument !== 'string' || !argument.startsWith(QUICK_ACTION_ARG_PREFIX)) continue
    const id = argument.slice(QUICK_ACTION_ARG_PREFIX.length).trim()
    if (id) return id
  }
  return null
}

export function buildInteractiveRelaunchArgs(argv: string[]): string[] {
  return argv.slice(1).filter((arg) => arg !== WINDOWS_AUTOSTART_ARG && arg !== WINDOWS_AUTOSTART_SILENT_ARG && !arg.startsWith(QUICK_ACTION_ARG_PREFIX))
}

export function buildWindowsAutostartArgs(displayMode: LaunchOnLoginDisplayMode): string[] {
  return displayMode === 'tray' ? [WINDOWS_AUTOSTART_ARG, WINDOWS_AUTOSTART_SILENT_ARG] : [WINDOWS_AUTOSTART_ARG]
}
