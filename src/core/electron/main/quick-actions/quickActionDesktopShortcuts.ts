import { existsSync } from 'node:fs'
import { open, unlink } from 'node:fs/promises'
import { app, shell } from 'electron'
import type { QuickAction } from '../../../shared/types'
import { createQuickActionLinkFile } from './quickActionLinkFile'

/**
 * Wires the quick-action desktop shortcut capability to the OS via the
 * Electron shell API (writeShortcutLink / readShortcutLink); fs is used only
 * for atomic candidate reservation and removal. Desktop directory resolution
 * goes through Electron (OneDrive-aware).
 */
export function createQuickActionDesktopShortcuts() {
  const linkFile = createQuickActionLinkFile({
    writeShortcutLink: (shortcutPath, operation, details) => shell.writeShortcutLink(shortcutPath, operation, details),
    readShortcutLink: (shortcutPath) => shell.readShortcutLink(shortcutPath),
    reservePath: async (path) => {
      // 'wx' = create-exclusive: atomic reservation, EEXIST when the name is taken.
      const handle = await open(path, 'wx')
      return async () => {
        await handle.close()
      }
    },
    existsSync: (target) => existsSync(target),
    unlink: (target) => unlink(target),
  })

  // Stable, writable working directory for launched processes. The quick-action
  // executors all pass explicit cwd/project paths, so a neutral default (not
  // the desktop) keeps child processes independent of the shortcut's location.
  const workingDirectory = app.getPath('userData')

  return {
    createShortcutLink: (action: QuickAction) =>
      linkFile.createShortcutLink({
        action,
        exePath: process.execPath,
        desktopDir: app.getPath('desktop'),
        workingDirectory,
      }),
    rewriteShortcutLink: (action: QuickAction, shortcutPath: string) =>
      linkFile.rewriteShortcutLink({
        action,
        exePath: process.execPath,
        shortcutPath,
        workingDirectory,
      }),
    removeShortcutLink: (shortcutPath: string) => linkFile.removeShortcutLink(shortcutPath),
    checkShortcutState: (shortcutPath: string, expected: { quickActionId: string }) => linkFile.checkShortcutState(shortcutPath, { exePath: process.execPath, quickActionId: expected.quickActionId }),
  }
}
