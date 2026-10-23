import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { createGitSnapshotDedupe } = loadTsModule('src/core/electron/main/git/git-snapshot-dedupe.ts')

// reader 在 readGitSnapshot 内部 await baseKey 之后才被调用，settle 前需让微任务跑完
const tick = () => new Promise((resolve) => setImmediate(resolve))

function createHarness({ normalizeRepoRoot, resolveExecutionMode } = {}) {
  const calls = []
  const deferreds = new Map()
  let nextId = 0
  const reader = (repoRoot, traceActionId, options) => {
    calls.push({ repoRoot, traceActionId, options })
    const id = ++nextId
    return new Promise((resolve, reject) => {
      deferreds.set(id, { resolve: (value) => resolve({ id, repoRoot, value }), reject })
    })
  }
  // 统一注入确定性 key helper：默认实现会探测 wsl.exe（约数百毫秒且环境相关），
  // 单测只验证去重/generation 逻辑本身。
  void normalizeRepoRoot
  void resolveExecutionMode
  const dedupe = createGitSnapshotDedupe({
    readGitRepositorySnapshot: reader,
    getDefaultWslDistro: () => 'Ubuntu',
    normalizeRepoRoot: async (root) => root,
    resolveExecutionMode: () => 'windows-native',
  })
  return {
    calls,
    dedupe,
    settle: (id, value) => deferreds.get(id).resolve(value),
    reject: (id, error) => deferreds.get(id).reject(error),
  }
}

test('并发同 key 请求共享同一次读取，完成后条目删除', async () => {
  const h = createHarness()
  const p1 = h.dedupe.readGitSnapshot('/repo', 'a')
  const p2 = h.dedupe.readGitSnapshot('/repo', 'b')
  await tick()
  assert.equal(h.calls.length, 1)
  h.settle(1, 'v1')
  const [r1, r2] = await Promise.all([p1, p2])
  assert.equal(r1, r2)
  // 完成后条目删除：再次发起触发新读取
  const p3 = h.dedupe.readGitSnapshot('/repo', 'c')
  await tick()
  assert.equal(h.calls.length, 2)
  h.settle(2, 'v3')
  await p3
})

test('light 与 full 是不同 key，不互享', async () => {
  const h = createHarness()
  const p1 = h.dedupe.readGitSnapshot('/repo', 'a', { lightweight: true })
  const p2 = h.dedupe.readGitSnapshot('/repo', 'b')
  await tick()
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[0].options?.lightweight, true)
  assert.equal(h.calls[1].options?.lightweight, undefined)
  h.settle(1, 'light')
  h.settle(2, 'full')
  const results = await Promise.all([p1, p2])
  assert.notEqual(results[0], results[1])
})

test('不同 repoRoot 不共享', async () => {
  const h = createHarness()
  const p1 = h.dedupe.readGitSnapshot('/repo-a')
  const p2 = h.dedupe.readGitSnapshot('/repo-b')
  await tick()
  assert.equal(h.calls.length, 2)
  h.settle(1, 'x')
  h.settle(2, 'y')
  await Promise.all([p1, p2])
})

test('失败不缓存：所有等待方收到拒绝，后续请求触发新读取', async () => {
  const h = createHarness()
  const p1 = h.dedupe.readGitSnapshot('/repo', 'a')
  const p2 = h.dedupe.readGitSnapshot('/repo', 'b')
  await tick()
  assert.equal(h.calls.length, 1)
  h.reject(1, new Error('boom'))
  await assert.rejects(p1, /boom/)
  await assert.rejects(p2, /boom/)
  const p3 = h.dedupe.readGitSnapshot('/repo', 'c')
  await tick()
  assert.equal(h.calls.length, 2)
  h.settle(2, 'ok')
  await p3
})

test('mutation 失效：bump 后新请求不共享在途旧结果', async () => {
  const h = createHarness()
  const p1 = h.dedupe.readGitSnapshot('/repo', 'precheck')
  await tick()
  await h.dedupe.invalidateGitSnapshot('/repo')
  const p2 = h.dedupe.readGitSnapshot('/repo', 'ui-refresh')
  await tick()
  assert.equal(h.calls.length, 2)
  h.settle(1, 'stale')
  h.settle(2, 'fresh')
  const stale = await p1
  const fresh = await p2
  assert.equal(stale.value, 'stale')
  assert.equal(fresh.value, 'fresh')
  // 旧条目在 settle 后已删除；新的读取正常发起新调用
  const p3 = h.dedupe.readGitSnapshot('/repo', 'late')
  await tick()
  assert.equal(h.calls.length, 3)
  h.settle(3, 'late')
  const late = await p3
  assert.equal(late.value, 'late')
})

test('失效时无在途请求也生效：后续读取仍正常', async () => {
  const h = createHarness()
  await h.dedupe.invalidateGitSnapshot('/repo')
  const p = h.dedupe.readGitSnapshot('/repo')
  await tick()
  h.settle(1, 'ok')
  const result = await p
  assert.equal(result.repoRoot, '/repo')
})
