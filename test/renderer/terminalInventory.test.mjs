import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { shouldApplyInventoryUpdate, applyInventoryUpsert, applyInventoryRemove, filterPendingTerminals, reduceTerminalInventoryEvent, reduceTerminalInventorySnapshot } = loadTsModule('src/core/renderer/lib/terminalInventory.ts')

function snapshot(processId, startTime = 1) {
  return { processId, projectId: processId.split('::')[0], backend: 'host', pid: null, startTime }
}

test('shouldApplyInventoryUpdate only accepts newer revisions', () => {
  assert.equal(shouldApplyInventoryUpdate(0, 1), true)
  assert.equal(shouldApplyInventoryUpdate(5, 6), true)
  // 旧快照/重复事件不得覆盖较新状态。
  assert.equal(shouldApplyInventoryUpdate(5, 5), false)
  assert.equal(shouldApplyInventoryUpdate(5, 4), false)
})

test('applyInventoryUpsert appends new keys and replaces in place', () => {
  const base = [snapshot('alpha', 1), snapshot('beta', 2)]

  const appended = applyInventoryUpsert(base, snapshot('gamma', 3))
  assert.deepEqual(
    appended.map((item) => item.processId),
    ['alpha', 'beta', 'gamma'],
  )

  // 同 key 原地替换：保持顺序，内容以新快照为准（如 tmux sessionName 补写）。
  const updated = applyInventoryUpsert(base, { ...snapshot('beta', 2), sessionName: 'wb-beta' })
  assert.deepEqual(
    updated.map((item) => item.processId),
    ['alpha', 'beta'],
  )
  assert.equal(updated[1].sessionName, 'wb-beta')
  assert.equal(base[1].sessionName, undefined, '输入数组不被修改')
})

test('applyInventoryRemove drops the key and keeps identity when absent', () => {
  const base = [snapshot('alpha', 1), snapshot('beta', 2)]

  const removed = applyInventoryRemove(base, 'alpha')
  assert.deepEqual(
    removed.map((item) => item.processId),
    ['beta'],
  )

  // key 不存在：返回原引用，避免触发无意义的状态更新。
  assert.equal(applyInventoryRemove(base, 'ghost'), base)
})

test('reduceTerminalInventoryEvent skips upserts for closing keys until remove confirms', () => {
  const base = [snapshot('alpha')]
  const closing = ['alpha::float::0']

  // 迟到注册（start 刚注册）的 upsert 不收录，等 remove 确认。
  const upserted = reduceTerminalInventoryEvent(base, closing, {
    type: 'upsert',
    revision: 5,
    process: snapshot('alpha::float::0'),
  })
  assert.deepEqual(
    upserted.inventory.map((item) => item.processId),
    ['alpha'],
  )
  assert.deepEqual(upserted.closingKeys, ['alpha::float::0'])

  // remove 确认：条目移除（如已不在则无操作）并退出 closing 组。
  const removed = reduceTerminalInventoryEvent(upserted.inventory, upserted.closingKeys, {
    type: 'remove',
    revision: 6,
    processKey: 'alpha::float::0',
  })
  assert.deepEqual(
    removed.inventory.map((item) => item.processId),
    ['alpha'],
  )
  assert.deepEqual(removed.closingKeys, [])
})

test('reduceTerminalInventoryEvent applies non-closing upserts and natural removes normally', () => {
  const empty = reduceTerminalInventoryEvent([], [], { type: 'upsert', revision: 1, process: snapshot('beta') })
  assert.deepEqual(
    empty.inventory.map((item) => item.processId),
    ['beta'],
  )

  const removed = reduceTerminalInventoryEvent(empty.inventory, [], { type: 'remove', revision: 2, processKey: 'beta' })
  assert.deepEqual(removed.inventory, [])
})

test('reduceTerminalInventorySnapshot filters closing keys', () => {
  const processes = [snapshot('alpha'), snapshot('alpha::float::0')]
  // 停止窗口内主进程 Map 可能仍有该进程；不过滤会把正在关闭的终端复活。
  const filtered = reduceTerminalInventorySnapshot(processes, ['alpha::float::0'])
  assert.deepEqual(
    filtered.map((item) => item.processId),
    ['alpha'],
  )

  // 无 closing key 时原样返回（拷贝）。
  assert.deepEqual(reduceTerminalInventorySnapshot(processes, []), processes)
})

test('filterPendingTerminals clears placeholders once the inventory catches up', () => {
  const pending = [
    { processKey: 'alpha::float::0', projectId: 'alpha', title: 'Alpha' },
    { processKey: 'alpha::float::1', projectId: 'alpha', title: 'Alpha' },
  ]

  const caughtUp = filterPendingTerminals(pending, [snapshot('alpha::float::0', 5)])
  assert.deepEqual(
    caughtUp.map((item) => item.processKey),
    ['alpha::float::1'],
  )

  // 没有占位需要清理时返回原引用。
  const emptyPending = []
  assert.equal(filterPendingTerminals(pending, []), pending)
  assert.equal(filterPendingTerminals(emptyPending, [snapshot('alpha::float::0')]), emptyPending)
})
