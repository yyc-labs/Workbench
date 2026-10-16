import { join } from 'node:path'
import type { QuickAction } from '../../../shared/types'
import { sanitizeQuickActionName } from '../config/config-quick-actions'

/**
 * Desktop `.lnk` shortcut file operations for quick actions.
 *
 * Writing goes through the WScript.Shell COM (present on every Windows
 * install) instead of hand-rolling the binary Shell Link format — no new
 * dependencies, correct icons/arguments for free. Reading parses the format
 * synchronously so shortcut state checks stay cheap and side-effect free.
 * All side effects are injected so the module stays unit-testable.
 */

export type QuickActionLinkFileDeps = {
  /** Runs a PowerShell script; resolves when it exits successfully. */
  runPowerShell: (script: string) => Promise<void>
  readFileSync: (path: string) => Buffer
  existsSync: (path: string) => boolean
  unlink: (path: string) => Promise<void>
}

/** PowerShell single-quoted string escaping: ' → ''. */
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

const CREATE_SHORTCUT_TEMPLATE = [
  '$shell = New-Object -COM WScript.Shell',
  '$shortcut = $shell.CreateShortcut(__PATH__)',
  '$shortcut.TargetPath = __TARGET__',
  '$shortcut.Arguments = __ARGS__',
  '$shortcut.WorkingDirectory = __WORKING_DIR__',
  '$shortcut.IconLocation = __ICON__',
  '$shortcut.Description = __DESCRIPTION__',
  '$shortcut.Save()',
].join('\n')

/** 'valid' = file exists and points at exePath; 'missing' = file gone; 'drifted' = points elsewhere. */
export type ShortcutLinkState = 'valid' | 'missing' | 'drifted'

const LINK_FLAG_HAS_TARGET_ID_LIST = 0x01
const LINK_FLAG_HAS_LINK_INFO = 0x02
const LINK_FLAG_IS_UNICODE = 0x80
const LINK_INFO_FLAG_VOLUME_AND_LOCAL_BASE = 0x01

function readNullTerminatedString(buffer: Buffer, offset: number, unicode: boolean): string | null {
  if (offset < 0 || offset >= buffer.length) return null
  if (unicode) {
    let cursor = offset
    while (cursor + 1 < buffer.length && buffer.readUInt16LE(cursor) !== 0) cursor += 2
    if (cursor + 1 >= buffer.length) return null
    return buffer.toString('utf16le', offset, cursor)
  }
  let cursor = offset
  while (cursor < buffer.length && buffer[cursor] !== 0) cursor += 1
  if (cursor >= buffer.length) return null
  return buffer.toString('latin1', offset, cursor)
}

/**
 * Synchronously extracts the local target path from a `.lnk` buffer.
 * Returns null when the file is not a parsable shell link.
 */
export function readShortcutTargetFromBuffer(buffer: Buffer): string | null {
  if (buffer.length < 0x4c) return null
  // HeaderSize is authoritative: structures start right after it.
  const headerSize = buffer.readUInt32LE(0)
  if (headerSize < 0x4c || headerSize > buffer.length) return null
  const flags = buffer.readUInt32LE(0x14)
  const isUnicode = (flags & LINK_FLAG_IS_UNICODE) !== 0
  let offset = headerSize

  if (flags & LINK_FLAG_HAS_TARGET_ID_LIST) {
    while (offset + 2 <= buffer.length) {
      const itemSize = buffer.readUInt16LE(offset)
      offset += 2
      if (itemSize === 0) break
      offset += itemSize
    }
  }

  if (flags & LINK_FLAG_HAS_LINK_INFO) {
    const linkInfoStart = offset
    if (linkInfoStart + 0x1c > buffer.length) return null
    const linkInfoFlags = buffer.readUInt32LE(linkInfoStart + 8)
    const localBasePathOffset = buffer.readUInt32LE(linkInfoStart + 16)
    if (linkInfoFlags & LINK_INFO_FLAG_VOLUME_AND_LOCAL_BASE) {
      return readNullTerminatedString(buffer, linkInfoStart + localBasePathOffset, isUnicode)
    }
  }

  return null
}

export function createQuickActionLinkFile(deps: QuickActionLinkFileDeps) {
  async function writeShortcutLink(options: { shortcutPath: string; targetPath: string; args: string; workingDirectory: string; description: string }): Promise<void> {
    const script = CREATE_SHORTCUT_TEMPLATE.replace('__PATH__', psQuote(options.shortcutPath))
      .replace('__TARGET__', psQuote(options.targetPath))
      .replace('__ICON__', psQuote(`${options.targetPath},0`))
      .replace('__ARGS__', psQuote(options.args))
      .replace('__WORKING_DIR__', psQuote(options.workingDirectory))
      .replace('__DESCRIPTION__', psQuote(options.description))
    await deps.runPowerShell(script)
  }

  /** Synchronous target read; null when the file is missing or unparsable. */
  function readShortcutTarget(shortcutPath: string): string | null {
    try {
      if (!deps.existsSync(shortcutPath)) return null
      return readShortcutTargetFromBuffer(deps.readFileSync(shortcutPath))
    } catch {
      return null
    }
  }

  /**
   * Creates the `.lnk` and returns its absolute path. Same-name conflicts get a
   * ` (2)`, ` (3)`, … suffix instead of overwriting.
   */
  async function createShortcutLink(options: { action: QuickAction; exePath: string; desktopDir: string }): Promise<string> {
    const { action, exePath, desktopDir } = options
    const baseName = sanitizeQuickActionName(action.name) || 'Quick action'
    let candidate = join(desktopDir, `${baseName}.lnk`)
    let suffix = 2
    while (deps.existsSync(candidate)) {
      candidate = join(desktopDir, `${baseName} (${suffix}).lnk`)
      suffix += 1
      if (suffix > 100) throw new Error('Too many shortcut files with the same name.')
    }
    await writeShortcutLink({
      shortcutPath: candidate,
      targetPath: exePath,
      args: `--quick-action=${action.id}`,
      workingDirectory: desktopDir,
      description: action.name,
    })
    if (!deps.existsSync(candidate)) {
      throw new Error(`Shortcut file was not created at ${candidate}`)
    }
    return candidate
  }

  function checkShortcutState(shortcutPath: string, exePath: string): ShortcutLinkState {
    const target = readShortcutTarget(shortcutPath)
    if (target === null) return 'missing'
    return target === exePath ? 'valid' : 'drifted'
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
    checkShortcutState,
    removeShortcutLink,
    readShortcutTarget,
    writeShortcutLink,
  }
}

export type QuickActionLinkFile = ReturnType<typeof createQuickActionLinkFile>
