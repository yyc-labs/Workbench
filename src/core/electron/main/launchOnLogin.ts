import { app } from 'electron'
import type { AppConfig } from '../../shared/types'

export const WINDOWS_AUTOSTART_ARG = '--autostart'
export const WINDOWS_AUTOSTART_SILENT_ARG = '--autostart-silent'

function supportsWindowsLaunchOnLogin(): boolean {
  return process.platform === 'win32' && app.isPackaged
}

export function syncWindowsLaunchOnLogin(config: AppConfig): void {
  if (!supportsWindowsLaunchOnLogin()) return

  try {
    app.setLoginItemSettings({
      openAtLogin: config.launchOnLogin === true,
      path: process.execPath,
      args: [WINDOWS_AUTOSTART_ARG, WINDOWS_AUTOSTART_SILENT_ARG],
    })
  } catch {
    // Best effort only.
  }
}

export function isWindowsAutostartLaunch(argv: string[]): boolean {
  return argv.includes(WINDOWS_AUTOSTART_ARG)
}

export function isSilentAutostartLaunch(argv: string[]): boolean {
  return argv.includes(WINDOWS_AUTOSTART_SILENT_ARG)
}
