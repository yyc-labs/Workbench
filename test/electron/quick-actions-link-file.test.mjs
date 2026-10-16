import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { createQuickActionLinkFile, readShortcutTargetFromBuffer } = loadTsModule('src/core/electron/main/quick-actions/quickActionLinkFile.ts')

const EXE_PATH = 'C:/Program Files/Workbench/Workbench.exe'
const DESKTOP_DIR = 'C:/Users/me/Desktop'
const SHORTCUT_PATH = join(DESKTOP_DIR, 'Open app.lnk')

/** Builds a minimal shell-link buffer with a LinkInfo local base path. */
function buildLinkBuffer(targetPath, { unicode = false, hasTargetIdList = false } = {}) {
  const headerSize = 0x4c
  const linkInfoStart = headerSize
  const idListSize = hasTargetIdList ? 2 + 20 + 2 : 0 // one 20-byte item + terminator
  const linkInfoOffset = linkInfoStart + idListSize

  const targetBuffer = unicode ? Buffer.concat([Buffer.from(targetPath, 'utf16le'), Buffer.from([0, 0])]) : Buffer.concat([Buffer.from(targetPath, 'latin1'), Buffer.from([0])])
  const volumeIdSize = 0x10
  const linkInfoHeaderSize = 0x1c
  const linkInfoSize = linkInfoHeaderSize + volumeIdSize + targetBuffer.length + 1 // + CommonPathSuffix null

  const buffer = Buffer.alloc(linkInfoOffset + linkInfoSize)
  buffer.writeUInt32LE(headerSize, 0)
  buffer.write('0102140000000000c000000000000046', 4, 'hex')
  const flags = 0x02 | (unicode ? 0x80 : 0) | (hasTargetIdList ? 0x01 : 0)
  buffer.writeUInt32LE(flags, 0x14)
  buffer.writeUInt32LE(0x20, 0x18)

  let cursor = linkInfoStart
  if (hasTargetIdList) {
    buffer.writeUInt16LE(20, cursor)
    cursor += 2
    buffer.fill(0x1f, cursor, cursor + 20)
    cursor += 20
    buffer.writeUInt16LE(0, cursor)
    cursor += 2
  }

  buffer.writeUInt32LE(linkInfoSize, linkInfoOffset)
  buffer.writeUInt32LE(linkInfoHeaderSize, linkInfoOffset + 4)
  buffer.writeUInt32LE(0x01, linkInfoOffset + 8)
  buffer.writeUInt32LE(linkInfoHeaderSize, linkInfoOffset + 12)
  buffer.writeUInt32LE(linkInfoHeaderSize + volumeIdSize, linkInfoOffset + 16)
  buffer.writeUInt32LE(0, linkInfoOffset + 20)
  buffer.writeUInt32LE(linkInfoSize - 1, linkInfoOffset + 24)
  buffer.writeUInt32LE(volumeIdSize, linkInfoOffset + linkInfoHeaderSize)
  buffer.writeUInt32LE(3, linkInfoOffset + linkInfoHeaderSize + 4)
  buffer.writeUInt32LE(0x12345678, linkInfoOffset + linkInfoHeaderSize + 8)
  buffer.writeUInt32LE(0x10, linkInfoOffset + linkInfoHeaderSize + 12)
  targetBuffer.copy(buffer, linkInfoOffset + linkInfoHeaderSize + volumeIdSize)
  buffer.writeUInt8(0, linkInfoOffset + linkInfoSize - 1)
  return buffer
}

test('reads the local target from an ANSI shell link', () => {
  assert.equal(readShortcutTargetFromBuffer(buildLinkBuffer(EXE_PATH)), EXE_PATH)
})

test('reads the local target from a Unicode shell link', () => {
  assert.equal(readShortcutTargetFromBuffer(buildLinkBuffer(EXE_PATH, { unicode: true })), EXE_PATH)
})

test('reads the local target past a link target ID list', () => {
  assert.equal(readShortcutTargetFromBuffer(buildLinkBuffer(EXE_PATH, { hasTargetIdList: true })), EXE_PATH)
})

test('returns null for buffers that are not shell links', () => {
  assert.equal(readShortcutTargetFromBuffer(Buffer.alloc(10)), null)
  const bad = buildLinkBuffer(EXE_PATH)
  bad.writeUInt32LE(0x10, 0) // headerSize too small
  assert.equal(readShortcutTargetFromBuffer(bad), null)
  const noLinkInfo = buildLinkBuffer(EXE_PATH)
  noLinkInfo.writeUInt32LE(0, 0x14) // clear flags: no LinkInfo
  assert.equal(readShortcutTargetFromBuffer(noLinkInfo), null)
})

function setup(overrides = {}) {
  const files = new Map(overrides.files ? Object.entries(overrides.files) : [])
  const scripts = []
  const unlinked = []
  const linkFile = createQuickActionLinkFile({
    runPowerShell: async (script) => {
      scripts.push(script)
      if (overrides.powerShellError) throw overrides.powerShellError
      if (overrides.powerShellWritesFile === false) return
      // Simulate WScript.Shell writing the .lnk file on Save().
      const match = script.match(/CreateShortcut\('([^']*)'\)/)
      if (match) {
        const target = match[1].replace(/''/g, "'")
        files.set(target, buildLinkBuffer(EXE_PATH))
      }
    },
    readFileSync: (target) => {
      const file = files.get(target)
      if (!file) {
        throw new Error(`ENOENT: ${target}`)
      }
      return file
    },
    existsSync: (target) => files.has(target),
    unlink: async (target) => {
      if (!files.has(target)) throw new Error(`ENOENT: ${target}`)
      unlinked.push(target)
      files.delete(target)
    },
  })
  return { linkFile, files, scripts, unlinked }
}

const ACTION = { id: '11111111-1111-4111-8111-111111111111', name: 'Open app', action: { type: 'open-project', projectPath: 'D:/repos/app' }, icon: 'folder-open', group: 'project', enabled: true, order: 0, createdAt: 0, updatedAt: 0 }

test('createShortcutLink writes the script and returns the path', async () => {
  const { linkFile, scripts } = setup()
  const shortcutPath = await linkFile.createShortcutLink({ action: ACTION, exePath: EXE_PATH, desktopDir: DESKTOP_DIR })
  assert.equal(shortcutPath, SHORTCUT_PATH)
  assert.equal(scripts.length, 1)
  assert.match(scripts[0], /--quick-action=11111111-1111-4111-8111-111111111111/)
  assert.match(scripts[0], /CreateShortcut/)
})

test('createShortcutLink substitutes every placeholder, IconLocation included', async () => {
  const { linkFile, scripts } = setup()
  await linkFile.createShortcutLink({ action: ACTION, exePath: EXE_PATH, desktopDir: DESKTOP_DIR })
  assert.doesNotMatch(scripts[0], /__[A-Z_]+__/)
  assert.match(scripts[0], /\$shortcut\.IconLocation = 'C:\/Program Files\/Workbench\/Workbench\.exe,0'/)
})

test('createShortcutLink appends a numeric suffix on name conflicts', async () => {
  const { linkFile } = setup({
    files: Object.fromEntries([
      [SHORTCUT_PATH, buildLinkBuffer(EXE_PATH)],
      [join(DESKTOP_DIR, 'Open app (2).lnk'), buildLinkBuffer(EXE_PATH)],
    ]),
  })
  const shortcutPath = await linkFile.createShortcutLink({ action: ACTION, exePath: EXE_PATH, desktopDir: DESKTOP_DIR })
  assert.equal(shortcutPath, join(DESKTOP_DIR, 'Open app (3).lnk'))
})

test('createShortcutLink throws when the file did not appear', async () => {
  const { linkFile } = setup({ powerShellWritesFile: false })
  await assert.rejects(() => linkFile.createShortcutLink({ action: ACTION, exePath: EXE_PATH, desktopDir: DESKTOP_DIR }), /was not created/)
})

test('checkShortcutState distinguishes valid / missing / drifted', () => {
  const { linkFile } = setup()
  assert.equal(linkFile.checkShortcutState(SHORTCUT_PATH, EXE_PATH), 'missing')

  const withValid = setup({ files: Object.fromEntries([[SHORTCUT_PATH, buildLinkBuffer(EXE_PATH)]]) })
  assert.equal(withValid.linkFile.checkShortcutState(SHORTCUT_PATH, EXE_PATH), 'valid')

  const drifted = setup({ files: Object.fromEntries([[SHORTCUT_PATH, buildLinkBuffer('D:/old/Workbench.exe')]]) })
  assert.equal(drifted.linkFile.checkShortcutState(SHORTCUT_PATH, EXE_PATH), 'drifted')
})

test('removeShortcutLink unlinks existing files and reports missing ones', async () => {
  const existing = setup({ files: Object.fromEntries([[SHORTCUT_PATH, buildLinkBuffer(EXE_PATH)]]) })
  assert.equal(await existing.linkFile.removeShortcutLink(SHORTCUT_PATH), true)
  assert.deepEqual(existing.unlinked, [SHORTCUT_PATH])

  const missing = setup()
  assert.equal(await missing.linkFile.removeShortcutLink(SHORTCUT_PATH), false)
})
