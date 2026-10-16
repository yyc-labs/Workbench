import { app } from 'electron'
import type { AppConfig } from '../../shared/types'
import { buildWindowsAutostartArgs, isSilentAutostartLaunch, isWindowsAutostartLaunch, parseQuickActionArg, WINDOWS_AUTOSTART_ARG, WINDOWS_AUTOSTART_SILENT_ARG } from './launchArgs'

export { isSilentAutostartLaunch, isWindowsAutostartLaunch, parseQuickActionArg, WINDOWS_AUTOSTART_ARG, WINDOWS_AUTOSTART_SILENT_ARG }

function supportsWindowsLaunchOnLogin(): boolean {
  return process.platform === 'win32' && app.isPackaged
}

export function syncWindowsLaunchOnLogin(config: AppConfig): void {
  if (!supportsWindowsLaunchOnLogin()) return

  try {
    app.setLoginItemSettings({
      openAtLogin: config.launchOnLogin === true,
      path: process.execPath,
      args: buildWindowsAutostartArgs(config.launchOnLoginDisplayMode ?? 'tray'),
    })
  } catch {
    // Best effort only.
  }
}
