import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadTsModule } from '../../helpers/load-ts-module.mjs'

const mod = loadTsModule('src/core/electron/main/agent-history/scan-service.ts')
const typesMod = loadTsModule('src/core/electron/main/agent-history/providers/types.ts')
const rulesMod = loadTsModule('src/core/shared/rules.ts')
const localFsMod = loadTsModule('src/core/electron/main/agent-history/datasource/local-fs.ts')

const localFs = localFsMod.createLocalFsDataSource()
function fakeDsRegistry(source = localFs) {
  return { getFor: () => source }
}

const projectIdOf = (projectPath) => rulesMod.projectIdFromPath(projectPath)

function makeTempProject() {
  return mkdtempSync(join(tmpdir(), 'agent-history-scan-'))
}

function makeSession(agent, filePath, updatedAt, seq) {
  return {
    sessionKey: `ah-${agent}-${String(seq).padStart(3, '0')}`,
    agent,
    updatedAt,
    sessionId: `native-${seq}`,
    title: `t${seq}`,
    cwd: null,
    branch: null,
    model: null,
    createdAt: null,
    messageCount: 1,
    previewMessages: [],
    source: { filePath, mtimeMs: 1000, sizeBytes: 100, parserVersion: 1 },
  }
}

/** Fake provider serving canned sessions; counts parse invocations for cache/merge assertions. */
function fakeProvider(id, options = {}) {
  let parseCount = 0
  const provider = {
    id,
    parserVersion: 1,
    discover: async () => ({ candidates: (options.candidates ?? []).map((c) => ({ agent: id, ...c })), truncated: options.truncated ?? false }),
    parseSession: async (candidate, parseOptions) => {
      parseCount += 1
      options.onParse?.(candidate, parseOptions)
      const session = (options.sessions ?? new Map()).get(candidate.filePath)
      if (!session) throw new Error(`no fixture for ${candidate.filePath}`)
      return { ...session }
    },
    parseCalls: () => parseCount,
  }
  return provider
}

function fakeRegistry(providers) {
  return { all: () => providers, get: (agent) => providers.find((p) => p.id === agent) ?? null }
}

function makeService(projectPath, providers, options = {}) {
  return mod.createAgentHistoryScanService({
    loadConfig: () => ({ projects: [{ path: projectPath }] }),
    registry: fakeRegistry(providers),
    dataSourceRegistry: options.dataSourceRegistry ?? fakeDsRegistry(),
  })
}

function threeSessionProvider(id, projectPath, { mtimeMs = 1000 } = {}) {
  const sessions = new Map()
  const candidates = []
  const base = Date.parse('2026-10-20T10:00:00.000Z')
  for (let i = 0; i < 5; i++) {
    const filePath = join(projectPath, `${id}-${i}.jsonl`)
    candidates.push({ filePath, mtimeMs: mtimeMs + i, sizeBytes: 100 })
    sessions.set(filePath, makeSession(id, filePath, new Date(base + i * 1000).toISOString(), i))
  }
  return fakeProvider(id, { candidates, sessions })
}

// ---------- 分页正确性 ----------

test('pagination: pages never overlap or skip; last page has no cursor', async () => {
  const projectPath = makeTempProject()
  const provider = threeSessionProvider('claude', projectPath)
  const service = makeService(projectPath, [provider])

  const page1 = await service.listSessions({ projectId: projectIdOf(projectPath), limit: 2 })
  assert.equal(page1.sessions.length, 2)
  assert.equal(page1.hasMore, true)
  assert.ok(page1.nextCursor)
  assert.equal(provider.parseCalls(), 5)

  const page2 = await service.listSessions({ projectId: projectIdOf(projectPath), limit: 2, cursor: page1.nextCursor })
  const page3 = await service.listSessions({ projectId: projectIdOf(projectPath), limit: 2, cursor: page2.nextCursor })

  const keys = [...page1.sessions, ...page2.sessions, ...page3.sessions].map((s) => s.sessionKey)
  assert.equal(new Set(keys).size, 5)
  assert.equal(page2.hasMore, true)
  assert.equal(page3.hasMore, false)
  assert.equal(page3.nextCursor, null)
})

test('sorting: updatedAt desc with sessionKey asc tiebreak', async () => {
  const projectPath = makeTempProject()
  const sessions = new Map()
  const candidates = []
  for (let i = 0; i < 4; i++) {
    const filePath = join(projectPath, `c-${i}.jsonl`)
    candidates.push({ filePath, mtimeMs: 1000 + i, sizeBytes: 100 })
    // All same updatedAt → sessionKey asc decides.
    sessions.set(filePath, makeSession('claude', filePath, '2026-10-20T10:00:00.000Z', 10 - i))
  }
  const provider = fakeProvider('claude', { candidates, sessions })
  const service = makeService(projectPath, [provider])
  const result = await service.listSessions({ projectId: projectIdOf(projectPath), limit: 10 })
  const keys = result.sessions.map((s) => s.sessionKey)
  assert.deepEqual(keys, [...keys].sort())
})

test('stale cursor after rescan falls back to a fresh first page', async () => {
  const projectPath = makeTempProject()
  const provider = threeSessionProvider('claude', projectPath)
  const service = makeService(projectPath, [provider])
  const page1 = await service.listSessions({ projectId: projectIdOf(projectPath), limit: 2 })
  // A cursor-less request triggers a new snapshot, invalidating page1.nextCursor.
  await service.listSessions({ projectId: projectIdOf(projectPath), limit: 2 })
  const stale = await service.listSessions({ projectId: projectIdOf(projectPath), limit: 2, cursor: page1.nextCursor })
  assert.equal(stale.sessions.length, 2)
  assert.deepEqual(
    stale.sessions.map((s) => s.sessionKey),
    page1.sessions.map((s) => s.sessionKey),
  )
})

// ---------- 上限与 isPartial / 文件安全 ----------

test('truncated discovery sets isPartial and RESULT_TRUNCATED issue', async () => {
  const projectPath = makeTempProject()
  const provider = threeSessionProvider('claude', projectPath)
  provider.discover = async () => ({ candidates: [], truncated: true })
  const service = makeService(projectPath, [provider])
  const result = await service.listSessions({ projectId: projectIdOf(projectPath) })
  assert.equal(result.isPartial, true)
  assert.ok(result.issues.some((issue) => issue.code === 'RESULT_TRUNCATED'))
})

test('oversized candidate is skipped with FILE_TOO_LARGE and never parsed', async () => {
  const projectPath = makeTempProject()
  const bigPath = join(projectPath, 'big.jsonl')
  const sessions = new Map([[bigPath, makeSession('claude', bigPath, '2026-10-20T10:00:00.000Z', 1)]])
  const provider = fakeProvider('claude', { candidates: [{ filePath: bigPath, mtimeMs: 1000, sizeBytes: 999_999_999 }], sessions })
  const service = makeService(projectPath, [provider])
  const result = await service.listSessions({ projectId: projectIdOf(projectPath) })
  assert.equal(result.sessions.length, 0)
  assert.equal(provider.parseCalls(), 0)
  assert.ok(result.issues.some((issue) => issue.code === 'FILE_TOO_LARGE'))
  assert.equal(result.isPartial, false)
})

test('parse failure degrades to INVALID_FORMAT issue without interrupting the scan', async () => {
  const projectPath = makeTempProject()
  const badPath = join(projectPath, 'bad.jsonl')
  const goodPath = join(projectPath, 'good.jsonl')
  const sessions = new Map([[goodPath, makeSession('claude', goodPath, '2026-10-20T10:00:00.000Z', 1)]])
  const provider = fakeProvider('claude', {
    candidates: [
      { filePath: badPath, mtimeMs: 1, sizeBytes: 1 },
      { filePath: goodPath, mtimeMs: 1, sizeBytes: 1 },
    ],
    sessions,
  })
  const originalParse = provider.parseSession
  provider.parseSession = async (candidate, options) => {
    if (candidate.filePath === badPath) throw new Error('boom')
    return originalParse(candidate, options)
  }
  const service = makeService(projectPath, [provider])
  const result = await service.listSessions({ projectId: projectIdOf(projectPath) })
  assert.equal(result.sessions.length, 1)
  assert.ok(result.issues.some((issue) => issue.code === 'INVALID_FORMAT'))
})

// ---------- 项目上下文 / WSL / resolveSessionPath 作用域 ----------

test('WSL project routes through the data source registry (empty state removed in stage 1)', async () => {
  const wslPath = '\\\\wsl.localhost\\Ubuntu\\home\\u\\proj'
  let routedEnvironment = null
  const dataSourceRegistry = {
    getFor: (context) => {
      routedEnvironment = context.executionEnvironment
      return localFs
    },
  }
  const provider = threeSessionProvider('claude', 'ignored')
  const service = makeService(wslPath, [provider], { dataSourceRegistry })
  const result = await service.listSessions({ projectId: projectIdOf(wslPath), limit: 10 })
  assert.equal(routedEnvironment, 'wsl')
  // The fake provider serves canned sessions regardless of environment; the
  // assertion proves the WSL branch now scans instead of short-circuiting.
  assert.ok(result.sessions.length > 0)
  assert.equal(result.hasMore, false)
})

test('resolveSessionPath validates project scope before exposing a path', async () => {
  const projectA = makeTempProject()
  const projectB = makeTempProject()
  const providerA = threeSessionProvider('claude', projectA)
  const service = mod.createAgentHistoryScanService({
    loadConfig: () => ({ projects: [{ path: projectA }, { path: projectB }] }),
    registry: fakeRegistry([providerA]),
    dataSourceRegistry: fakeDsRegistry(),
  })

  assert.deepEqual(service.resolveSessionPath('nope', 'ah-x'), { ok: false, reason: 'PROJECT_MISMATCH' })
  assert.deepEqual(service.resolveSessionPath(projectIdOf(projectA), 'ah-unknown'), { ok: false, reason: 'SESSION_NOT_FOUND' })

  const listed = await service.listSessions({ projectId: projectIdOf(projectA), limit: 10 })
  const first = listed.sessions[0]
  const resolved = service.resolveSessionPath(projectIdOf(projectA), first.sessionKey)
  assert.equal(resolved.ok, true)
  assert.ok(resolved.filePath.endsWith('.jsonl'))

  // Cross-project request for a key that belongs to project A must be rejected.
  assert.deepEqual(service.resolveSessionPath(projectIdOf(projectB), first.sessionKey), { ok: false, reason: 'SESSION_NOT_FOUND' })
})

test('agent filter narrows both sessions and issues', async () => {
  const projectPath = makeTempProject()
  const codex = threeSessionProvider('codex', projectPath)
  codex.discover = async () => ({ candidates: [], truncated: true })
  const service = makeService(projectPath, [codex])
  const result = await service.listSessions({ projectId: projectIdOf(projectPath), agent: 'codex' })
  assert.ok(result.issues.every((issue) => issue.agent === 'codex'))
  assert.ok(result.issues.some((issue) => issue.code === 'RESULT_TRUNCATED'))
})

// ---------- 扫描生命周期：合并 / 缓存 / 取消 ----------

test('same-project concurrent requests merge into one scan', async () => {
  const projectPath = makeTempProject()
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const provider = threeSessionProvider('claude', projectPath)
  const originalParse = provider.parseSession
  provider.parseSession = async (candidate, options) => {
    await gate
    return originalParse(candidate, options)
  }
  const service = makeService(projectPath, [provider])
  const pendingA = service.listSessions({ projectId: projectIdOf(projectPath), limit: 10 })
  const pendingB = service.listSessions({ projectId: projectIdOf(projectPath), limit: 10 })
  await new Promise((resolve) => setTimeout(resolve, 20))
  release()
  const [a, b] = await Promise.all([pendingA, pendingB])
  assert.equal(provider.parseCalls(), 5)
  assert.equal(a.scannedAt, b.scannedAt)
})

test('parse cache: unchanged files are not re-parsed; mtime change re-parses', async () => {
  const projectPath = makeTempProject()
  let mtimeMs = 1000
  const provider = threeSessionProvider('claude', projectPath, { mtimeMs })
  provider.discover = async () => ({
    candidates: Array.from({ length: 5 }, (_, i) => ({ agent: 'claude', filePath: join(projectPath, `claude-${i}.jsonl`), mtimeMs, sizeBytes: 100 })),
    truncated: false,
  })
  const service = makeService(projectPath, [provider])
  await service.listSessions({ projectId: projectIdOf(projectPath), limit: 10 })
  assert.equal(provider.parseCalls(), 5)
  await service.listSessions({ projectId: projectIdOf(projectPath), limit: 10 })
  assert.equal(provider.parseCalls(), 5)

  mtimeMs = 9000
  await service.listSessions({ projectId: projectIdOf(projectPath), limit: 10 })
  assert.equal(provider.parseCalls(), 10)
})

test('cancelScan aborts the in-flight scan signal', async () => {
  const projectPath = makeTempProject()
  const observed = []
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const provider = threeSessionProvider('claude', projectPath)
  const originalParse = provider.parseSession
  provider.parseSession = async (candidate, dataSource, options) => {
    observed.push(options?.signal ?? null)
    await gate
    return originalParse(candidate, dataSource, options)
  }
  const service = makeService(projectPath, [provider])
  const pending = service.listSessions({ projectId: projectIdOf(projectPath), limit: 10 })
  await new Promise((resolve) => setTimeout(resolve, 10))
  service.cancelScan(projectIdOf(projectPath))
  release()
  await pending
  // Cancel must stop new parses from starting (some candidates may never be picked up).
  assert.ok(observed.length >= 1 && observed.length < 5)
  assert.ok(observed.every((signal) => signal?.aborted === true))
})

test('unknown project id raises for the IPC layer', async () => {
  const service = makeService(makeTempProject(), [])
  await assert.rejects(service.listSessions({ projectId: 'missing' }))
})

assert.ok(typesMod.AgentHistoryFileError)
