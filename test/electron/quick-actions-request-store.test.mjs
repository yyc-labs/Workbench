import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { QuickActionRequestStore } = loadTsModule('src/core/electron/main/quick-actions/quickActionRequestStore.ts')

test('setFromArgv captures the quick action id from launch args', () => {
  const store = new QuickActionRequestStore()
  assert.equal(store.setFromArgv(['Workbench.exe', '--quick-action=11111111-1111-4111-8111-111111111111']), '11111111-1111-4111-8111-111111111111')
  assert.deepEqual(store.consume(), { id: '11111111-1111-4111-8111-111111111111' })
})

test('setFromArgv ignores argv without the quick action argument', () => {
  const store = new QuickActionRequestStore()
  assert.equal(store.setFromArgv(['Workbench.exe', '--autostart']), null)
  assert.equal(store.consume(), null)
})

test('consume clears the pending request', () => {
  const store = new QuickActionRequestStore()
  store.setFromArgv(['Workbench.exe', '--quick-action=abc'])
  assert.deepEqual(store.consume(), { id: 'abc' })
  assert.equal(store.consume(), null)
})

test('a later setFromArgv without the argument keeps the pending request', () => {
  const store = new QuickActionRequestStore()
  store.setFromArgv(['Workbench.exe', '--quick-action=abc'])
  assert.equal(store.setFromArgv(['Workbench.exe', '--other']), null)
  assert.deepEqual(store.consume(), { id: 'abc' })
})
