import { app } from 'electron'
import type { AppConfig } from '../../shared/types'
import {
  WINDOWS_AUTOSTART_ARG,
  WINDOWS_AUTOSTART_SILENT_ARG,
  buildWindowsAutostartArgs,
  isSilentAutostartLaunch,
  isWindowsAutostartLaunch,
} from './launchArgs'

export {
  WINDOWS_AUTOSTART_ARG,
  WINDOWS_AUTOSTART_SILENT_ARG,
  isSilentAutostartLaunch,
  isWindowsAutostartLaunch,
}

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
