import { join } from 'node:path'
import type { QuickAction } from '../../../shared/types'
import { sanitizeQuickActionName } from '../config/config-quick-actions'

/**
 * Desktop `.lnk` shortcut file operations for quick actions.
 *
 * All reads/writes go through the Electron shell API (`writeShortcutLink` /
 * `readShortcutLink`) injected via deps — no PowerShell, no hand-rolled Shell
 * Link binary parsing. fs is used only for atomic candidate reservation (wx)
 * and removal. All side effects are injected so the module stays
 * unit-testable without Electron.
 */

/** Structural subset of Electron's ShortcutDetails (electron is not imported here). */
export type ShortcutDetailsLike = {
  target: string
  args?: string
  cwd?: string
  description?: string
  icon?: string
  iconIndex?: number
}

export type QuickActionLinkFileDeps = {
  /** Electron shell.writeShortcutLink; false return = the OS refused the write. 'create' overwrites an existing file. */
  writeShortcutLink: (shortcutPath: string, operation: 'create', details: ShortcutDetailsLike) => boolean
  /** Electron shell.readShortcutLink; throws when the file is unreadable or corrupt. */
  readShortcutLink: (shortcutPath: string) => ShortcutDetailsLike
  /**
   * Atomically reserves a candidate path via fs.open(path, 'wx') (fails with
   * EEXIST when taken) and returns a release callback that closes the handle.
   * The reserved empty file is then overwritten in place by writeShortcutLink.
   */
  reservePath: (path: string) => Promise<() => Promise<void>>
  existsSync: (path: string) => boolean
  unlink: (path: string) => Promise<void>
}

/**
 * 'valid' = points at this exe with this action id; 'missing' = file gone;
 * 'drifted' = readable but points elsewhere or carries a different action id;
 * 'unreadable' = read failed (corrupt or permission-denied) — distinct from
 * 'missing' so callers can log the real cause instead of flattening it.
 */
export type ShortcutLinkState = 'valid' | 'missing' | 'drifted' | 'unreadable'

/** Launch argument carried by every quick-action `.lnk`. */
export function quickActionArgs(id: string): string {
  return `--quick-action=${id}`
}

/** Windows paths compare case-insensitively; normalize separators/case/trailing slash. */
function normalizeForCompare(value: string): string {
  return value
    .replace(/[/\\]+$/, '')
    .replace(/\//g, '\\')
    .toLowerCase()
}

export function createQuickActionLinkFile(deps: QuickActionLinkFileDeps) {
  function buildDetails(action: QuickAction, exePath: string, workingDirectory: string): ShortcutDetailsLike {
    return {
      target: exePath,
      args: quickActionArgs(action.id),
      cwd: workingDirectory,
      description: action.name,
      icon: exePath,
      iconIndex: 0,
    }
  }

  /** Reads the `.lnk` back and asserts it points at exePath + this action id. */
  function verifyShortcutLink(shortcutPath: string, action: QuickAction, exePath: string): void {
    // readShortcutLink throws on unreadable/corrupt files — callers clean up.
    const details = deps.readShortcutLink(shortcutPath)
    if (normalizeForCompare(details.target) !== normalizeForCompare(exePath)) {
      throw new Error(`Shortcut target verification failed: ${details.target}`)
    }
    if ((details.args ?? '') !== quickActionArgs(action.id)) {
      throw new Error(`Shortcut arguments verification failed: ${details.args ?? ''}`)
    }
  }

  /**
   * Reserves the first free candidate name: `Name.lnk`, `Name (2).lnk`, …
   * The wx reservation is atomic, so a name taken between check and write can
   * never be overwritten — the loser of the race simply moves to the next
   * candidate.
   */
  async function reserveCandidatePath(desktopDir: string, name: string): Promise<string> {
    const baseName = sanitizeQuickActionName(name) || 'Quick action'
    let candidate = join(desktopDir, `${baseName}.lnk`)
    let suffix = 2
    while (true) {
      try {
        const release = await deps.reservePath(candidate)
        await release()
        return candidate
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error
        candidate = join(desktopDir, `${baseName} (${suffix}).lnk`)
        suffix += 1
        if (suffix > 100) throw new Error('Too many shortcut files with the same name.')
      }
    }
  }

  /**
   * Creates the `.lnk` at a fresh candidate name and returns its absolute
   * path. On any failure the reserved file is removed so no half-created
   * shortcut is left behind.
   */
  async function createShortcutLink(options: { action: QuickAction; exePath: string; desktopDir: string; workingDirectory: string }): Promise<string> {
    const { action, exePath, desktopDir, workingDirectory } = options
    const candidate = await reserveCandidatePath(desktopDir, action.name)
    try {
      if (!deps.writeShortcutLink(candidate, 'create', buildDetails(action, exePath, workingDirectory))) {
        throw new Error(`Failed to write shortcut file at ${candidate}`)
      }
      verifyShortcutLink(candidate, action, exePath)
      return candidate
    } catch (error) {
      await deps.unlink(candidate).catch(() => undefined)
      throw error
    }
  }

  /**
   * Rewrites the `.lnk` directly at a recorded path (drift repair: the app
   * moved, the file drifted). Unlike createShortcutLink there is no candidate
   * search and no cleanup-on-failure — the pre-existing file is left as-is
   * when the rewrite fails.
   */
  async function rewriteShortcutLink(options: { action: QuickAction; exePath: string; shortcutPath: string; workingDirectory: string }): Promise<string> {
    const { action, exePath, shortcutPath, workingDirectory } = options
    if (!deps.writeShortcutLink(shortcutPath, 'create', buildDetails(action, exePath, workingDirectory))) {
      throw new Error(`Failed to rewrite shortcut file at ${shortcutPath}`)
    }
    verifyShortcutLink(shortcutPath, action, exePath)
    return shortcutPath
  }

  function checkShortcutState(shortcutPath: string, expected: { exePath: string; quickActionId: string }): ShortcutLinkState {
    if (!deps.existsSync(shortcutPath)) return 'missing'
    let details: ShortcutDetailsLike
    try {
      details = deps.readShortcutLink(shortcutPath)
    } catch {
      return 'unreadable'
    }
    if (normalizeForCompare(details.target) !== normalizeForCompare(expected.exePath)) return 'drifted'
    if ((details.args ?? '') !== quickActionArgs(expected.quickActionId)) return 'drifted'
    return 'valid'
  }

  async function removeShortcutLink(shortcutPath: string): Promise<boolean> {
    try {
      await deps.unlink(shortcutPath)
      return true
    } catch {
      return false
    }
  }

  return {
    createShortcutLink,
    rewriteShortcutLink,
    checkShortcutState,
    removeShortcutLink,
  }
}

export type QuickActionLinkFile = ReturnType<typeof createQuickActionLinkFile>
