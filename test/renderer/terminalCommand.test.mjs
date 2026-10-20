import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { sendTerminalCommand } = loadTsModule('src/core/renderer/lib/terminalCommand.ts')

function createHarness() {
  const listeners = new Set()
  const sent = []
  let unsubscribeCount = 0
  return {
    sent,
    get unsubscribeCount() {
      return unsubscribeCount
    },
    hooks: {
      onOutput: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
          unsubscribeCount += 1
        }
      },
      sendInput: (processKey, data) => sent.push({ processKey, data }),
    },
    emit: (projectId, data) => {
      for (const listener of [...listeners]) listener({ projectId, data })
    },
  }
}

test('sendTerminalCommand sends on first output of the target process', () => {
  const h = createHarness()
  sendTerminalCommand('p::script::0', 'node "a.js"', h.hooks)
  assert.deepEqual(h.sent, [])

  // 其他进程的输出不触发发送
  h.emit('p::script::1', 'PS> ')
  assert.deepEqual(h.sent, [])

  h.emit('p::script::0', 'PS> ')
  assert.deepEqual(h.sent, [{ processKey: 'p::script::0', data: 'node "a.js"\r' }])
  // 发送后立即退订，后续输出不再触发
  assert.equal(h.unsubscribeCount, 1)
  h.emit('p::script::0', 'more output')
  assert.equal(h.sent.length, 1)
})

test('sendTerminalCommand ignores empty output chunks', () => {
  const h = createHarness()
  sendTerminalCommand('k', 'cmd', h.hooks)
  h.emit('k', '')
  assert.deepEqual(h.sent, [])
  h.emit('k', 'x')
  assert.equal(h.sent.length, 1)
})

test('sendTerminalCommand falls back to timeout send', async () => {
  const h = createHarness()
  sendTerminalCommand('k', 'python "t.py"', h.hooks, 10)
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.deepEqual(h.sent, [{ processKey: 'k', data: 'python "t.py"\r' }])
  assert.equal(h.unsubscribeCount, 1)
})

test('sendTerminalCommand cancel prevents send and is idempotent', async () => {
  const h = createHarness()
  const cancel = sendTerminalCommand('k', 'cmd', h.hooks, 10)
  cancel()
  cancel()
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.deepEqual(h.sent, [])
  assert.equal(h.unsubscribeCount, 1)
})
