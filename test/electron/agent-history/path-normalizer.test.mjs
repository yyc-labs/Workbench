import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadTsModule } from '../../helpers/load-ts-module.mjs'

const mod = loadTsModule('src/core/electron/main/agent-history/path-normalizer.ts')

test('normalizeWindowsPath unifies separators, casing and trailing separators', () => {
  assert.equal(mod.normalizeWindowsPath('D:/tools/ide-electron/'), 'd:\\tools\\ide-electron')
  assert.equal(mod.normalizeWindowsPath('D:\\Tools\\IDE-Electron'), 'd:\\tools\\ide-electron')
  assert.equal(mod.normalizeWindowsPath('d:\\tools\\ide\\\\electron'), 'd:\\tools\\ide\\electron')
})

test('pathIdentityEquals never matches by substring containment', () => {
  assert.equal(mod.pathIdentityEquals('D:\\work\\app', 'D:\\work\\app\\'), true)
  assert.equal(mod.pathIdentityEquals('D:\\work\\app', 'D:\\work\\application'), false)
  assert.equal(mod.pathIdentityEquals('D:\\work\\app', 'D:\\work\\app2'), false)
})

test('realpathNormalized returns null for missing paths and resolves existing ones', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-agent-history-'))
  try {
    const resolved = mod.realpathNormalized(dir)
    assert.equal(resolved, mod.normalizeWindowsPath(dir))
    assert.equal(mod.realpathNormalized(join(dir, 'does-not-exist')), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('encodeClaudeBucketName maps every non-alphanumeric char to dash, case preserved', () => {
  assert.equal(mod.encodeClaudeBucketName('C:\\Users\\yyc20\\Desktop\\code-work\\test'), 'C--Users-yyc20-Desktop-code-work-test')
  assert.equal(mod.encodeClaudeBucketName('D:\\tools\\ide-electron'), 'D--tools-ide-electron')
})

test('encodeCodebuddyBucketName lowercases, drops drive colon and collapses separator runs', () => {
  assert.equal(mod.encodeCodebuddyBucketName('D:\\tools\\ide-electron'), 'd-tools-ide-electron')
  assert.equal(mod.encodeCodebuddyBucketName('C:\\Users\\yyc20\\Desktop\\code-work\\test'), 'c-users-yyc20-desktop-code-work-test')
})

test('bucket encoders are not interchangeable between providers', () => {
  const cwd = 'D:\\tools\\ide-electron'
  assert.notEqual(mod.encodeClaudeBucketName(cwd), mod.encodeCodebuddyBucketName(cwd))
})
