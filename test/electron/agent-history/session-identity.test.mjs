import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../../helpers/load-ts-module.mjs'

const mod = loadTsModule('src/core/electron/main/agent-history/session-identity.ts')

const base = {
  agent: 'claude',
  namespaceId: 'win32',
  filePath: 'd:\\tools\\ide-electron-bucket\\session-1.jsonl',
  nativeSessionId: 'abc-123',
}

test('createSessionKey is stable for identical input', () => {
  assert.equal(mod.createSessionKey(base), mod.createSessionKey({ ...base }))
})

test('createSessionKey separates agents, namespaces, paths and native ids', () => {
  assert.notEqual(mod.createSessionKey(base), mod.createSessionKey({ ...base, agent: 'codex' }))
  assert.notEqual(mod.createSessionKey(base), mod.createSessionKey({ ...base, namespaceId: 'wsl:ubuntu' }))
  assert.notEqual(mod.createSessionKey(base), mod.createSessionKey({ ...base, filePath: 'd:\\other\\session-1.jsonl' }))
  assert.notEqual(mod.createSessionKey(base), mod.createSessionKey({ ...base, nativeSessionId: 'abc-456' }))
})

test('createSessionKey hides raw paths and is URL-safe', () => {
  const key = mod.createSessionKey(base)
  assert.ok(!key.includes('tools'))
  assert.ok(!key.includes('session-1'))
  assert.match(key, /^ah-claude-[a-f0-9]{24}$/)
})

test('createSessionKey accepts missing native session id', () => {
  const key = mod.createSessionKey({ ...base, nativeSessionId: null })
  assert.match(key, /^ah-claude-[a-f0-9]{24}$/)
  assert.equal(key, mod.createSessionKey({ ...base, nativeSessionId: null }))
})
