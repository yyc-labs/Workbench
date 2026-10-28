import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadTsModule } from '../../helpers/load-ts-module.mjs'

const dbMod = loadTsModule('src/core/electron/main/agent-history/cache/db.ts')
const scanMod = loadTsModule('src/core/electron/main/agent-history/scan-service.ts')
const rulesMod = loadTsModule('src/core/shared/rules.ts')
const localFsMod = loadTsModule('src/core/electron/main/agent-history/datasource/local-fs.ts')

const localFs = localFsMod.createLocalFsDataSource()

function tempDbPath() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-history-cache-'))
  return join(dir, 'cache.db')
}

function row(overrides = {}) {
  return {
    providerId: 'claude',
    sessionKey: 'ah-claude-x1',
    updatedAt: '2026-10-27T10:00:00.000Z',
    title: 't1',
    dataJson: JSON.stringify({ sessionKey: 'ah-claude-x1', agent: 'claude', updatedAt: '2026-10-27T10:00:00.000Z', title: 't1' }),
    filePath: 'C:/x/a.jsonl',
    mtimeMs: 1000,
    sizeBytes: 100,
    parserVersion: 1,
    byteOffset: 100,
    prefixHash: null,
    scannedAt: '2026-10-27T10:00:00.000Z',
    ...overrides,
  }
}

test('cache: upsert/list/get roundtrip with composite primary key', () => {
  const db = dbMod.openAgentHistoryCacheDb(tempDbPath())
  try {
    db.upsertBatch('p1', [row(), row({ providerId: 'codex', sessionKey: 'ah-claude-x1', title: 'codex-same-key' }), row({ sessionKey: 'ah-claude-x2', updatedAt: '2026-10-27T11:00:00.000Z', title: 'newer' })])
    // Same sessionKey under a different provider does not collide.
    assert.equal(db.listByProject('p1').length, 3)
    assert.equal(db.get('p1', 'codex', 'ah-claude-x1').title, 'codex-same-key')
    // Same key in another project is independent.
    db.upsertBatch('p2', [row({ title: 'other-project' })])
    assert.equal(db.get('p2', 'claude', 'ah-claude-x1').title, 'other-project')
    assert.equal(db.get('p1', 'claude', 'ah-claude-x1').title, 't1')
  } finally {
    db.close()
  }
})

test('cache: upsertBatch is a short transaction; slow samples recorded only when slow', () => {
  const db = dbMod.openAgentHistoryCacheDb(tempDbPath())
  try {
    const rows = Array.from({ length: 1500 }, (_, i) => row({ sessionKey: 'k' + i }))
    db.upsertBatch('p1', rows)
    assert.equal(db.listByProject('p1').length, 1500)
    assert.ok(db.slowTxnSamples().every((s) => s.durationMs < 50_000))
  } finally {
    db.close()
  }
})

test('cache: reconcile deletes stale rows only for the given project', () => {
  const db = dbMod.openAgentHistoryCacheDb(tempDbPath())
  try {
    db.upsertBatch('p1', [row({ sessionKey: 'keep' }), row({ sessionKey: 'stale' })])
    db.upsertBatch('p2', [row({ sessionKey: 'stale', title: 'keep-other-project' })])
    const deleted = db.reconcile('p1', [{ providerId: 'claude', sessionKey: 'keep' }])
    assert.equal(deleted, 1)
    assert.equal(db.get('p1', 'claude', 'stale'), null)
    assert.equal(db.get('p1', 'claude', 'keep').sessionKey, 'keep')
    // Other projects untouched.
    assert.equal(db.get('p2', 'claude', 'stale').title, 'keep-other-project')
  } finally {
    db.close()
  }
})

test('cache: corrupt db keeps a .corrupt copy and rebuilds', () => {
  const dbPath = tempDbPath()
  writeFileSync(dbPath, 'this is not a sqlite database at all........')
  const db = dbMod.openAgentHistoryCacheDb(dbPath)
  try {
    db.upsertBatch('p1', [row()])
    const files = readdirSync(join(dbPath, '..')).filter((f) => f.startsWith('cache.db.corrupt'))
    assert.ok(files.length >= 1, 'corrupt copy must be kept, not silently overwritten')
    assert.equal(db.get('p1', 'claude', 'ah-claude-x1').title, 't1')
  } finally {
    db.close()
  }
})

test('cache: clearAll only clears rebuildable data', () => {
  const db = dbMod.openAgentHistoryCacheDb(tempDbPath())
  try {
    db.upsertBatch('p1', [row()])
    db.setMeta('lastScan:p1', '2026-10-27T10:00:00.000Z')
    db.clearAll()
    assert.equal(db.listByProject('p1').length, 0)
    assert.equal(db.getMeta('lastScan:p1'), '2026-10-27T10:00:00.000Z')
  } finally {
    db.close()
  }
})

// ---------- scan-service integration: cache-first + persist + reconcile ----------

function fakeProviderWithFiles(id, files) {
  const sessions = new Map()
  const candidates = []
  for (const [filePath, body] of files) {
    candidates.push({ filePath, mtimeMs: 1000, sizeBytes: body.length })
    sessions.set(filePath, {
      sessionKey: `ah-${id}-${filePath.replace(/\W/g, '')}`,
      agent: id,
      updatedAt: '2026-10-27T10:00:00.000Z',
      sessionId: null,
      title: filePath,
      cwd: null,
      branch: null,
      model: null,
      createdAt: null,
      messageCount: 1,
      previewMessages: [],
      source: { filePath, mtimeMs: 1000, sizeBytes: body.length, parserVersion: 1 },
    })
  }
  return { id, parserVersion: 1, discover: async () => ({ candidates, truncated: false }), parseSession: async (c) => ({ ...sessions.get(c.filePath) }) }
}

test('scan-service: cache-first serve + background refresh persists new snapshot', async () => {
  const projectPath = mkdtempSync(join(tmpdir(), 'agent-history-cache-scan-'))
  const fileA = join(projectPath, 'a.jsonl')
  const fileB = join(projectPath, 'b.jsonl')
  writeFileSync(fileA, '{}')
  writeFileSync(fileB, '{}')
  let files = new Map([[fileA, '{}']])
  let provider = fakeProviderWithFiles('claude', files)
  const db = dbMod.openAgentHistoryCacheDb(tempDbPath())
  const service = scanMod.createAgentHistoryScanService({
    loadConfig: () => ({ projects: [{ path: projectPath }] }),
    registry: { all: () => [provider], get: () => provider },
    dataSourceRegistry: { getFor: () => localFs },
    cache: db,
  })
  const projectId = rulesMod.projectIdFromPath(projectPath)

  // Cold start: cache empty → real scan → persisted.
  const first = await service.listSessions({ projectId, limit: 10 })
  assert.equal(first.sessions.length, 1)
  assert.equal(first.cacheHit ?? false, false)
  assert.equal(db.listByProject(projectId).length, 1)

  // New file appears; cached view still serves the OLD list instantly…
  files = new Map([
    [fileA, '{}'],
    [fileB, '{}'],
  ])
  provider = fakeProviderWithFiles('claude', files)
  const cached = await service.listSessions({ projectId, limit: 10 })
  assert.equal(cached.cacheHit, true)
  assert.equal(cached.sessions.length, 1)
  // …and after the background refresh lands, a fresh call serves the new snapshot.
  await new Promise((resolve) => setTimeout(resolve, 200))
  const refreshed = await service.listSessions({ projectId, limit: 10 })
  assert.equal(refreshed.cacheHit, true)
  assert.equal(refreshed.sessions.length, 2)
  db.close()
})

test('scan-service: reconcile does not run after a partial scan', async () => {
  const projectPath = mkdtempSync(join(tmpdir(), 'agent-history-cache-partial-'))
  const fileA = join(projectPath, 'a.jsonl')
  writeFileSync(fileA, '{}')
  const files = new Map([[fileA, '{}']])
  const db = dbMod.openAgentHistoryCacheDb(tempDbPath())
  const provider = fakeProviderWithFiles('claude', files)
  const service = scanMod.createAgentHistoryScanService({
    loadConfig: () => ({ projects: [{ path: projectPath }] }),
    registry: { all: () => [provider], get: () => provider },
    dataSourceRegistry: { getFor: () => localFs },
    cache: db,
  })
  const projectId = rulesMod.projectIdFromPath(projectPath)
  await service.listSessions({ projectId, limit: 10 })
  assert.equal(db.listByProject(projectId).length, 1)

  // Partial scan: only b.jsonl discovered → row for a.jsonl must SURVIVE reconcile skip.
  const partialProvider = {
    id: 'claude',
    parserVersion: 1,
    discover: async () => ({ candidates: [{ filePath: join(projectPath, 'b.jsonl'), mtimeMs: 1000, sizeBytes: 2 }], truncated: true }),
    parseSession: async (c) => ({
      sessionKey: 'ah-claude-' + c.filePath.replace(/\W/g, ''),
      agent: 'claude',
      updatedAt: '2026-10-27T10:00:00.000Z',
      sessionId: null,
      title: c.filePath,
      cwd: null,
      branch: null,
      model: null,
      createdAt: null,
      messageCount: 1,
      previewMessages: [],
      source: { filePath: c.filePath, mtimeMs: 1000, sizeBytes: c.sizeBytes, parserVersion: 1 },
    }),
  }
  const service2 = scanMod.createAgentHistoryScanService({
    loadConfig: () => ({ projects: [{ path: projectPath }] }),
    registry: { all: () => [partialProvider], get: () => partialProvider },
    dataSourceRegistry: { getFor: () => localFs },
    cache: db,
  })
  // Cache-first serves old rows instantly and refreshes in the background; wait for the refresh to land.
  void service2.listSessions({ projectId, limit: 10 })
  const deadline = Date.now() + 3000
  while (Date.now() < deadline && db.get(projectId, 'claude', 'ah-claude-' + join(projectPath, 'b.jsonl').replace(/\W/g, '')) === null) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.equal(db.listByProject(projectId).length, 2, 'partial scan must not delete the missing row')
  db.close()
})
