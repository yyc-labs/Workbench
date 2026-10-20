import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { createWorkspacePersistenceCoordinator, flushWithOutcome, WORKSPACE_PERSISTENCE_DEBOUNCE_MS, WORKSPACE_PERSISTENCE_MAX_WAIT_MS, WORKSPACE_PERSISTENCE_FLUSH_TIMEOUT_MS } = loadTsModule('src/core/electron/main/config/workspace-persistence.ts')

const tick = async (times = 6) => {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function createHarness({ debounceMs = WORKSPACE_PERSISTENCE_DEBOUNCE_MS, maxWaitMs = WORKSPACE_PERSISTENCE_MAX_WAIT_MS, startClock = 1000 } = {}) {
  let clock = startClock
  let snapshot = 'v0'
  let concurrent = 0
  let maxConcurrent = 0
  const timers = []
  const writes = []
  // writeGates: 按写入顺序消费的挂起闸门（缺省立即完成）。
  const writeGates = []
  const coordinator = createWorkspacePersistenceCoordinator(
    async (serialized) => {
      writes.push(serialized)
      concurrent += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      try {
        const gate = writeGates.length > 0 ? writeGates.shift() : null
        if (gate) await gate.promise
      } finally {
        concurrent -= 1
      }
    },
    () => snapshot,
    {
      debounceMs,
      maxWaitMs,
      now: () => clock,
      setTimer: (fn, ms) => {
        const handle = { fn, due: clock + ms }
        timers.push(handle)
        return handle
      },
      clearTimer: (handle) => {
        const index = timers.indexOf(handle)
        if (index >= 0) timers.splice(index, 1)
      },
      log: () => undefined,
    },
  )
  return {
    coordinator,
    writes,
    timers,
    get maxConcurrent() {
      return maxConcurrent
    },
    setSnapshot(value) {
      snapshot = value
    },
    /** 让第 n 次（从 0 计）写入挂起，返回其 deferred */
    gateWrite(index) {
      const gate = deferred()
      writeGates[index] = gate
      return gate
    },
    /** flushWithOutcome 的定时器注入：与协调器共享同一 timers 数组，便于 fireDue 驱动 */
    setTimerAdapter: (fn, ms) => {
      const handle = { fn, due: clock + ms }
      timers.push(handle)
      return handle
    },
    clearTimerAdapter: (handle) => {
      const index = timers.indexOf(handle)
      if (index >= 0) timers.splice(index, 1)
    },
    advance(ms) {
      clock += ms
    },
    fireDue() {
      const due = timers.filter((handle) => handle.due <= clock)
      for (const handle of due) {
        const index = timers.indexOf(handle)
        if (index >= 0) timers.splice(index, 1)
        handle.fn()
      }
      return due.length
    },
    pendingTimers() {
      return timers.length
    },
  }
}

test('用例 1：单次 markDirty，debounce 到期前不写；到期写一次', async () => {
  const h = createHarness()
  h.coordinator.markDirty('t1')
  assert.equal(h.writes.length, 0)
  assert.equal(h.coordinator.getStatus().phase, 'scheduled')
  assert.equal(h.pendingTimers(), 2) // debounce + maxWait

  h.advance(299)
  assert.equal(h.fireDue(), 0)
  assert.equal(h.writes.length, 0)

  h.advance(1)
  assert.equal(h.fireDue(), 1) // 仅 debounce 到期
  await tick()
  assert.equal(h.writes.length, 1)
  assert.equal(h.writes[0], 'v0')
  const status = h.coordinator.getStatus()
  assert.equal(status.revision, 1)
  assert.equal(status.persistedRevision, 1)
  assert.equal(status.phase, 'idle')
  assert.equal(status.firstDirtyAt, null)
})

test('用例 2：debounce 窗口内连续 4 次 markDirty，只写 1 次且内容为第 4 次快照', async () => {
  const h = createHarness()
  for (let i = 1; i <= 4; i += 1) {
    h.setSnapshot(`v${i}`)
    h.coordinator.markDirty(`burst-${i}`)
    h.advance(100)
    h.fireDue()
  }
  assert.equal(h.writes.length, 0)

  h.advance(300)
  assert.equal(h.fireDue(), 1)
  await tick()
  assert.equal(h.writes.length, 1)
  assert.equal(h.writes[0], 'v4')
  const status = h.coordinator.getStatus()
  assert.equal(status.revision, 4)
  assert.equal(status.persistedRevision, 4)
})

test('用例 3：持续 markDirty（间隔 < debounceMs）超过 maxWaitMs，maxWait 到点强制写', async () => {
  const h = createHarness()
  h.coordinator.markDirty('start') // maxWait 自此刻起算，不随后续修改重置
  let markCount = 1
  // 每 200ms 修改一次（< 300ms debounce），持续到 maxWait（2000ms）到期
  while (h.coordinator.getStatus().revision < 10) {
    h.advance(200)
    assert.equal(h.fireDue(), 0) // debounce 每次都被重置，永不到期
    h.setSnapshot(`v${markCount}`)
    h.coordinator.markDirty(`tick-${markCount}`)
    markCount += 1
  }
  h.advance(200) // clock = 1000 + 2000
  const fired = h.fireDue()
  assert.equal(fired, 1) // 只有 maxWait 到期
  await tick()
  assert.equal(h.writes.length, 1)
  assert.equal(h.writes[0], `v${markCount - 1}`)
  const status = h.coordinator.getStatus()
  assert.equal(status.revision, 10)
  assert.equal(status.persistedRevision, 10)
  assert.equal(status.phase, 'idle')
})

test('用例 4：写进行中再来 markDirty：不并发；首个写完成后自动再写一次最新快照', async () => {
  const h = createHarness()
  const gate = h.gateWrite(0)
  h.setSnapshot('v1')
  h.coordinator.markDirty('first')
  h.advance(WORKSPACE_PERSISTENCE_DEBOUNCE_MS)
  assert.equal(h.fireDue(), 1)
  await tick(2)
  assert.equal(h.writes.length, 1)
  assert.equal(h.coordinator.getStatus().phase, 'writing')
  assert.equal(h.maxConcurrent, 1)

  // 首个写仍在途时再来修改：不得并发第二个写
  h.setSnapshot('v2')
  h.coordinator.markDirty('during-write')
  await tick(2)
  assert.equal(h.writes.length, 1)
  assert.equal(h.maxConcurrent, 1)

  gate.resolve()
  await tick()
  assert.equal(h.writes.length, 2)
  assert.equal(h.writes[1], 'v2') // latest-wins：第二轮写最新快照
  assert.equal(h.maxConcurrent, 1)
  const status = h.coordinator.getStatus()
  assert.equal(status.revision, 2)
  assert.equal(status.persistedRevision, 2)
  assert.equal(status.phase, 'idle')
})

test('用例 5：flush() 在 debounce 未到期时立即提交并等待完成', async () => {
  const h = createHarness()
  h.coordinator.markDirty('manual')
  await h.coordinator.flush()
  assert.equal(h.writes.length, 1)
  assert.equal(h.pendingTimers(), 0) // 定时器被清理
})

test('用例 6：flush() 无脏数据时为 no-op（不调 write）', async () => {
  const h = createHarness()
  await h.coordinator.flush()
  await h.coordinator.flush()
  assert.equal(h.writes.length, 0)
  const status = h.coordinator.getStatus()
  assert.equal(status.revision, 0)
  assert.equal(status.persistedRevision, 0)
  assert.equal(status.phase, 'idle')
})

test('用例 7：write 失败：phase=failed、lastError 记录、脏状态保留；下次 markDirty 后重试成功', async () => {
  const h = createHarness()
  const gate = h.gateWrite(0)
  h.coordinator.markDirty('boom')
  const flushing = h.coordinator.flush()
  await tick(2)
  assert.equal(h.writes.length, 1)
  gate.reject(new Error('disk full'))
  await assert.rejects(flushing, /disk full/)

  let status = h.coordinator.getStatus()
  assert.equal(status.phase, 'failed')
  assert.equal(status.revision, 1)
  assert.equal(status.persistedRevision, 0) // 脏状态保留
  assert.match(status.lastError, /disk full/)

  // 失败不自动重试
  await tick()
  assert.equal(h.writes.length, 1)

  // 下一次 markDirty 触发重试并成功
  h.coordinator.markDirty('retry')
  h.advance(WORKSPACE_PERSISTENCE_DEBOUNCE_MS)
  h.fireDue()
  await tick()
  assert.equal(h.writes.length, 2)
  status = h.coordinator.getStatus()
  assert.equal(status.phase, 'idle')
  assert.equal(status.persistedRevision, 2)
  assert.equal(status.lastError, null)
})

test('用例 8：getStatus 的 revision/persistedRevision 推进正确', async () => {
  const h = createHarness()
  let status = h.coordinator.getStatus()
  assert.deepEqual(status, { revision: 0, persistedRevision: 0, phase: 'idle', firstDirtyAt: null, lastError: null })

  h.coordinator.markDirty('one')
  status = h.coordinator.getStatus()
  assert.equal(status.revision, 1)
  assert.equal(status.persistedRevision, 0)
  assert.equal(status.phase, 'scheduled')
  assert.equal(status.firstDirtyAt, 1000)

  h.advance(WORKSPACE_PERSISTENCE_DEBOUNCE_MS)
  h.fireDue()
  await tick()
  status = h.coordinator.getStatus()
  assert.equal(status.revision, 1)
  assert.equal(status.persistedRevision, 1)
  assert.equal(status.firstDirtyAt, null)

  h.advance(500)
  h.coordinator.markDirty('two')
  h.coordinator.markDirty('three')
  status = h.coordinator.getStatus()
  assert.equal(status.revision, 3)
  assert.equal(status.persistedRevision, 1)
  assert.equal(status.firstDirtyAt, 1800) // 本轮首次变脏时间，不随第二次 markDirty 重置

  h.advance(WORKSPACE_PERSISTENCE_DEBOUNCE_MS)
  h.fireDue()
  await tick()
  status = h.coordinator.getStatus()
  assert.equal(status.revision, 3)
  assert.equal(status.persistedRevision, 3)
})

test('用例 9：flush 期间再次 markDirty，flush 返回前完成第二轮写入', async () => {
  const h = createHarness()
  h.coordinator.markDirty('first')
  const flushing = h.coordinator.flush()
  h.setSnapshot('v1')
  h.coordinator.markDirty('second')
  await flushing
  assert.equal(h.writes.length, 2)
  assert.equal(h.writes[0], 'v0')
  assert.equal(h.writes[1], 'v1')
  assert.equal(h.coordinator.getStatus().persistedRevision, 2)
  assert.equal(h.pendingTimers(), 0)
})

test('用例 10：写未完成时定时器 flush 与退出 flush 同时到达，只有一个调度循环', async () => {
  const h = createHarness()
  const gate = h.gateWrite(0)
  h.setSnapshot('v1')
  h.coordinator.markDirty('source')

  h.advance(WORKSPACE_PERSISTENCE_DEBOUNCE_MS)
  assert.equal(h.fireDue(), 1) // 定时器触发 flush（循环启动，写挂起）
  await tick(2)
  assert.equal(h.writes.length, 1)

  // 退出 flush 与定时器来源并发：必须返回同一调度循环
  const exitFlush = h.coordinator.flush()
  gate.resolve()
  await Promise.all([exitFlush])
  await tick()
  assert.equal(h.writes.length, 1) // 无重复写入
  assert.equal(h.coordinator.getStatus().persistedRevision, 1)
})

test('用例 10b：写失败时定时器 flush 与退出 flush 都收到同一 rejection，且无计划外重试', async () => {
  const h = createHarness()
  const gate = h.gateWrite(0)
  h.coordinator.markDirty('source')
  h.advance(WORKSPACE_PERSISTENCE_DEBOUNCE_MS)
  h.fireDue()
  await tick(2)

  const exitFlush = h.coordinator.flush()
  gate.reject(new Error('io error'))
  await assert.rejects(exitFlush, /io error/)
  await tick(4)
  assert.equal(h.writes.length, 1) // 失败后不自动重试
  assert.equal(h.coordinator.getStatus().phase, 'failed')
})

test('用例 11：flushWithOutcome 的 saved / failed / timeout 三分支', async () => {
  // saved
  {
    const h = createHarness()
    h.coordinator.markDirty('ok')
    const outcome = await flushWithOutcome(h.coordinator.flush, WORKSPACE_PERSISTENCE_FLUSH_TIMEOUT_MS)
    assert.deepEqual(outcome, { status: 'saved' })
    assert.equal(h.writes.length, 1)
  }
  // failed
  {
    const h = createHarness()
    const gate = h.gateWrite(0)
    h.coordinator.markDirty('boom')
    const flushing = h.coordinator.flush()
    await tick(2)
    const outcomePromise = flushWithOutcome(() => flushing, WORKSPACE_PERSISTENCE_FLUSH_TIMEOUT_MS)
    gate.reject(new Error('nope'))
    const outcome = await outcomePromise
    assert.equal(outcome.status, 'failed')
    assert.match(String(outcome.error), /nope/)
  }
  // timeout
  {
    const h = createHarness()
    const gate = h.gateWrite(0)
    h.coordinator.markDirty('slow')
    const flushing = h.coordinator.flush()
    await tick(2)
    let settled = 'pending'
    const outcomePromise = flushWithOutcome(() => flushing, WORKSPACE_PERSISTENCE_FLUSH_TIMEOUT_MS, h.setTimerAdapter, h.clearTimerAdapter).then((outcome) => {
      settled = outcome.status
      return outcome
    })
    // 假定时器驱动超时分支
    h.advance(WORKSPACE_PERSISTENCE_FLUSH_TIMEOUT_MS)
    assert.equal(h.fireDue(), 1)
    const outcome = await outcomePromise
    assert.equal(outcome.status, 'timeout')
    assert.equal(settled, 'timeout')
    // timeout 时不取消在途写入：persistedRevision 未推进（不得伪造版本号一致性）
    assert.equal(h.coordinator.getStatus().persistedRevision, 0)
    // 原写入任务后续完成时文件仍完好
    gate.resolve()
    await tick()
    assert.equal(h.writes.length, 1)
    assert.equal(h.coordinator.getStatus().persistedRevision, 1)
  }
})

test('用例 18：退出超时不假装保存——persistedRevision 未推进、退出流程不挂起、后续写完成文件完好', async () => {
  const h = createHarness()
  const gate = h.gateWrite(0)
  h.setSnapshot('final')
  h.coordinator.markDirty('last-change')
  const flushing = h.coordinator.flush()
  await tick(2)
  assert.equal(h.writes.length, 1)

  // 退出屏障：3000ms 超时后必须返回，不挂起退出流程
  const start = Date.now()
  const outcomePromise = flushWithOutcome(() => flushing, WORKSPACE_PERSISTENCE_FLUSH_TIMEOUT_MS, h.setTimerAdapter, h.clearTimerAdapter)
  h.advance(WORKSPACE_PERSISTENCE_FLUSH_TIMEOUT_MS)
  h.fireDue()
  const outcome = await outcomePromise
  assert.equal(outcome.status, 'timeout')
  assert.ok(Date.now() - start < WORKSPACE_PERSISTENCE_FLUSH_TIMEOUT_MS + 1000)

  const status = h.coordinator.getStatus()
  assert.equal(status.revision, 1)
  assert.equal(status.persistedRevision, 0) // 绝不伪造版本号一致性
  assert.equal(status.phase, 'writing')

  // 在途写入最终完成：文件内容为退出前最新快照
  gate.resolve()
  await tick()
  assert.equal(h.writes.length, 1)
  assert.equal(h.writes[0], 'final')
  assert.equal(h.coordinator.getStatus().persistedRevision, 1)
  assert.equal(h.coordinator.getStatus().phase, 'idle')
})

test('常量：单一事实源数值与计划一致', () => {
  assert.equal(WORKSPACE_PERSISTENCE_DEBOUNCE_MS, 300)
  assert.equal(WORKSPACE_PERSISTENCE_MAX_WAIT_MS, 2000)
  assert.equal(WORKSPACE_PERSISTENCE_FLUSH_TIMEOUT_MS, 3000)
})
