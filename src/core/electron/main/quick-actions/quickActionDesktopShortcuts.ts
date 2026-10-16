import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { promisify } from 'node:util'
import { app } from 'electron'
import type { QuickAction } from '../../../shared/types'
import { createQuickActionLinkFile } from './quickActionLinkFile'

const execFileAsync = promisify(execFile)
const POWERSHELL_TIMEOUT_MS = 20_000

/**
 * Wires the quick-action desktop shortcut capability to the OS: PowerShell
 * WScript.Shell for writing `.lnk` files, direct fs for reading/removing.
 * Desktop directory resolution goes through Electron (OneDrive-aware).
 */
export function createQuickActionDesktopShortcuts() {
  const linkFile = createQuickActionLinkFile({
    runPowerShell: async (script) => {
      await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true,
        timeout: POWERSHELL_TIMEOUT_MS,
      })
    },
    readFileSync: (target) => readFileSync(target),
    existsSync: (target) => existsSync(target),
    unlink: (target) => unlink(target),
  })

  return {
    createShortcutLink: (action: QuickAction) =>
      linkFile.createShortcutLink({
        action,
        exePath: process.execPath,
        desktopDir: app.getPath('desktop'),
      }),
    removeShortcutLink: (shortcutPath: string) => linkFile.removeShortcutLink(shortcutPath),
    checkShortcutState: (shortcutPath: string, exePath: string) => linkFile.checkShortcutState(shortcutPath, exePath),
  }
}
