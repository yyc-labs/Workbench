import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../../helpers/load-ts-module.mjs'

const mod = loadTsModule('src/core/electron/main/agent-history/watch-service.ts')

function fakeSource() {
  const listeners = []
  let closed = false
  return {
    source: {
      watch: (dir, listener) => {
        listeners.push(listener)
        return {
          close: () => {
            closed = true
          },
        }
      },
    },
    emit: (event) => {
      for (const l of listeners) l(event)
    },
    isClosed: () => closed,
    listenerCount: () => listeners.length,
  }
}

function makeDeps(overrides = {}) {
  const notified = []
  const bursts = []
  return {
    deps: {
      resolveWatchRoots: async (projectId) => [{ dirKey: 'root-a', dataSource: fakeSource().source }],
      onBurst: async (projectId) => {
        bursts.push(projectId)
      },
      notifyChanged: (hint) => notified.push(hint),
      debounceMs: 30,
      ...overrides,
    },
    notified,
    bursts,
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('watch: shared listener across projects with reference counting', async () => {
  const sources = []
  const svc = mod.createAgentHistoryWatchService({
    resolveWatchRoots: async (projectId) => {
      if (sources[projectId] === undefined) sources[projectId] = fakeSource()
      return [{ dirKey: 'root-a', dataSource: sources[projectId].source }]
    },
    onBurst: async () => {},
    notifyChanged: () => {},
  })
  await svc.watch('p1')
  await svc.watch('p2')
  // Same root → ONE shared listener for two projects.
  assert.equal(sources['p1'].listenerCount(), 1)
  await svc.unwatch('p1')
  assert.equal(sources['p1'].isClosed(), false, 'p2 still references the dir')
  await svc.unwatch('p2')
  assert.equal(sources['p1'].isClosed(), true, 'refcount zero closes the handle')
  assert.equal(svc.watchedProjectCount(), 0)
})

test('watch: debounced bursts collapse and notify once per project', async () => {
  const fake = fakeSource()
  const { deps, notified, bursts } = makeDeps({ resolveWatchRoots: async () => [{ dirKey: 'root-a', dataSource: fake.source }] })
  const svc = mod.createAgentHistoryWatchService(deps)
  await svc.watch('p1')
  fake.emit({ eventType: 'change', filename: 'a.jsonl' })
  fake.emit({ eventType: 'change', filename: 'b.jsonl' })
  fake.emit({ eventType: 'change', filename: 'c.jsonl' })
  await wait(120)
  assert.equal(bursts.length, 1, 'three rapid events → one verification run')
  assert.equal(notified.length, 1)
  assert.equal(notified[0].projectId, 'p1')
  assert.ok(notified[0].bursts >= 1)
})

test('watch: idempotent watch() does not stack listeners', async () => {
  const fake = fakeSource()
  const svc = mod.createAgentHistoryWatchService({
    resolveWatchRoots: async () => [{ dirKey: 'root-a', dataSource: fake.source }],
    onBurst: async () => {},
    notifyChanged: () => {},
  })
  await svc.watch('p1')
  await svc.watch('p1')
  assert.equal(fake.listenerCount(), 1)
})

test('watch: source without watch capability degrades silently', async () => {
  const svc = mod.createAgentHistoryWatchService({
    resolveWatchRoots: async () => [],
    onBurst: async () => {},
    notifyChanged: () => {},
  })
  await svc.watch('p1')
  assert.equal(svc.watchedProjectCount(), 1) // registered but nothing to watch
  svc.unwatch('p1')
  assert.equal(svc.watchedProjectCount(), 0)
})

test('watch: root resolution failure degrades without throwing', async () => {
  const svc = mod.createAgentHistoryWatchService({
    resolveWatchRoots: async () => {
      throw new Error('provider root unavailable')
    },
    onBurst: async () => {},
    notifyChanged: () => {},
  })
  await svc.watch('p1')
  assert.equal(svc.watchedProjectCount(), 1)
})

test('watch: fs.watch throwing at registration degrades for that dir', async () => {
  const svc = mod.createAgentHistoryWatchService({
    resolveWatchRoots: async () => [
      {
        dirKey: 'root-bad',
        dataSource: {
          watch: () => {
            throw new Error('EISDIR')
          },
        },
      },
    ],
    onBurst: async () => {},
    notifyChanged: () => {},
  })
  await svc.watch('p1')
  assert.equal(svc.watchedProjectCount(), 1)
})
