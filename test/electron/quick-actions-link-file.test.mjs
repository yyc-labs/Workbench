import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { createQuickActionLinkFile, quickActionArgs } = loadTsModule('src/core/electron/main/quick-actions/quickActionLinkFile.ts')

const EXE_PATH = 'C:/Program Files/Workbench/Workbench.exe'
const DESKTOP_DIR = 'C:/Users/me/Desktop'
const SHORTCUT_PATH = join(DESKTOP_DIR, 'Open app.lnk')
const WORKING_DIR = 'C:/Users/me/AppData/Roaming/Workbench'

const ACTION = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Open app',
  action: { type: 'open-project', projectPath: 'D:/repos/app' },
  icon: 'folder-open',
  group: 'project',
  enabled: true,
  order: 0,
  createdAt: 0,
  updatedAt: 0,
}

/**
 * In-memory stand-in for the OS: files map path -> details (or 'CORRUPT').
 * reservePath simulates fs.open 'wx' semantics; taken names throw EEXIST.
 */
function setup(overrides = {}) {
  const files = new Map(Object.entries(overrides.files ?? {}))
  const reserved = new Set()
  const writes = []
  const unlinked = []

  const linkFile = createQuickActionLinkFile({
    writeShortcutLink: (shortcutPath, operation, details) => {
      writes.push({ shortcutPath, operation, details })
      if (overrides.writeFails) return false
      // writeWrongTarget simulates the OS persisting a drifted target.
      files.set(shortcutPath, overrides.writeWrongTarget ? { ...details, target: overrides.writeWrongTarget } : { ...details })
      return true
    },
    readShortcutLink: (shortcutPath) => {
      if (overrides.readThrows) throw new Error('read failed')
      const details = files.get(shortcutPath)
      if (!details || details === 'CORRUPT' || details === 'RESERVED_EMPTY') throw new Error(`unreadable: ${shortcutPath}`)
      return details
    },
    reservePath: async (path) => {
      if (reserved.has(path) || files.has(path)) {
        const error = new Error(`EEXIST: ${path}`)
        error.code = 'EEXIST'
        throw error
      }
      reserved.add(path)
      // The reservation creates the file on disk (empty) until the shell write lands.
      files.set(path, 'RESERVED_EMPTY')
      return async () => {
        reserved.delete(path)
      }
    },
    existsSync: (path) => files.has(path),
    unlink: async (path) => {
      if (!files.has(path)) {
        const error = new Error(`ENOENT: ${path}`)
        error.code = 'ENOENT'
        throw error
      }
      unlinked.push(path)
      files.delete(path)
    },
  })
  return { linkFile, files, reserved, writes, unlinked }
}

const createOptions = { action: ACTION, exePath: EXE_PATH, desktopDir: DESKTOP_DIR, workingDirectory: WORKING_DIR }

test('quickActionArgs builds the launch argument', () => {
  assert.equal(quickActionArgs(ACTION.id), `--quick-action=${ACTION.id}`)
})

test('createShortcutLink writes the details and returns the candidate path', async () => {
  const { linkFile, writes } = setup()
  const shortcutPath = await linkFile.createShortcutLink(createOptions)
  assert.equal(shortcutPath, SHORTCUT_PATH)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].operation, 'create')
  assert.deepEqual(writes[0].details, {
    target: EXE_PATH,
    args: quickActionArgs(ACTION.id),
    cwd: WORKING_DIR,
    description: ACTION.name,
    icon: EXE_PATH,
    iconIndex: 0,
  })
})

test('createShortcutLink picks the next free candidate on name conflicts', async () => {
  const { linkFile } = setup({
    files: {
      [SHORTCUT_PATH]: { target: EXE_PATH },
      [join(DESKTOP_DIR, 'Open app (2).lnk')]: { target: EXE_PATH },
    },
  })
  const shortcutPath = await linkFile.createShortcutLink(createOptions)
  assert.equal(shortcutPath, join(DESKTOP_DIR, 'Open app (3).lnk'))
})

test('createShortcutLink cleans up the reserved file when the OS write fails', async () => {
  const { linkFile, files, unlinked } = setup({ writeFails: true })
  await assert.rejects(() => linkFile.createShortcutLink(createOptions), /Failed to write shortcut file/)
  assert.equal(files.size, 0)
  assert.deepEqual(unlinked, [SHORTCUT_PATH])
})

test('createShortcutLink cleans up when read-back verification fails', async () => {
  // The OS writes a drifted target; verification must reject and clean up.
  const { linkFile, files, unlinked } = setup({ writeWrongTarget: 'D:/somewhere/else.exe' })
  await assert.rejects(() => linkFile.createShortcutLink(createOptions), /Shortcut target verification failed/)
  assert.equal(files.size, 0)
  assert.deepEqual(unlinked, [SHORTCUT_PATH])
})

test('createShortcutLink cleans up when read-back is unreadable', async () => {
  const { linkFile, files } = setup({ readThrows: true })
  await assert.rejects(() => linkFile.createShortcutLink(createOptions), /read failed/)
  assert.equal(files.size, 0)
})

test('rewriteShortcutLink writes at the recorded path and verifies', async () => {
  const { linkFile, writes } = setup({
    files: { [SHORTCUT_PATH]: { target: 'D:/old/Workbench.exe', args: quickActionArgs(ACTION.id) } },
  })
  const result = await linkFile.rewriteShortcutLink({ action: ACTION, exePath: EXE_PATH, shortcutPath: SHORTCUT_PATH, workingDirectory: WORKING_DIR })
  assert.equal(result, SHORTCUT_PATH)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].shortcutPath, SHORTCUT_PATH)
})

test('rewriteShortcutLink failure leaves the pre-existing file untouched', async () => {
  const { linkFile, files, unlinked } = setup({
    files: { [SHORTCUT_PATH]: { target: 'D:/old/Workbench.exe', args: quickActionArgs(ACTION.id) } },
    writeFails: true,
  })
  await assert.rejects(() => linkFile.rewriteShortcutLink({ action: ACTION, exePath: EXE_PATH, shortcutPath: SHORTCUT_PATH, workingDirectory: WORKING_DIR }), /Failed to rewrite/)
  assert.ok(files.has(SHORTCUT_PATH))
  assert.deepEqual(unlinked, [])
})

test('checkShortcutState: valid when exe and action id match (case-insensitive path)', () => {
  const { linkFile } = setup({ files: { [SHORTCUT_PATH]: { target: 'c:/program files/workbench/workbench.exe', args: quickActionArgs(ACTION.id) } } })
  assert.equal(linkFile.checkShortcutState(SHORTCUT_PATH, { exePath: EXE_PATH, quickActionId: ACTION.id }), 'valid')
})

test('checkShortcutState: missing when the file is gone', () => {
  const { linkFile } = setup()
  assert.equal(linkFile.checkShortcutState(SHORTCUT_PATH, { exePath: EXE_PATH, quickActionId: ACTION.id }), 'missing')
})

test('checkShortcutState: drifted when the target moved', () => {
  const { linkFile } = setup({ files: { [SHORTCUT_PATH]: { target: 'D:/old/Workbench.exe', args: quickActionArgs(ACTION.id) } } })
  assert.equal(linkFile.checkShortcutState(SHORTCUT_PATH, { exePath: EXE_PATH, quickActionId: ACTION.id }), 'drifted')
})

test('checkShortcutState: drifted when the action id differs', () => {
  const { linkFile } = setup({ files: { [SHORTCUT_PATH]: { target: EXE_PATH, args: '--quick-action=other' } } })
  assert.equal(linkFile.checkShortcutState(SHORTCUT_PATH, { exePath: EXE_PATH, quickActionId: ACTION.id }), 'drifted')
})

test('checkShortcutState: unreadable when the read throws', () => {
  const { linkFile } = setup({ files: { [SHORTCUT_PATH]: 'CORRUPT' } })
  assert.equal(linkFile.checkShortcutState(SHORTCUT_PATH, { exePath: EXE_PATH, quickActionId: ACTION.id }), 'unreadable')
})

test('removeShortcutLink unlinks existing files and reports missing ones', async () => {
  const existing = setup({ files: { [SHORTCUT_PATH]: { target: EXE_PATH } } })
  assert.equal(await existing.linkFile.removeShortcutLink(SHORTCUT_PATH), true)
  assert.deepEqual(existing.unlinked, [SHORTCUT_PATH])

  const missing = setup()
  assert.equal(await missing.linkFile.removeShortcutLink(SHORTCUT_PATH), false)
})
