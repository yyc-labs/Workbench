import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadTsModule } from '../../helpers/load-ts-module.mjs'

const searchMod = loadTsModule('src/core/electron/main/agent-history/fulltext/search-service.ts')
const extractMod = loadTsModule('src/core/electron/main/agent-history/fulltext/extract.ts')
const dbMod = loadTsModule('src/core/electron/main/agent-history/cache/db.ts')
const localFsMod = loadTsModule('src/core/electron/main/agent-history/datasource/local-fs.ts')

const localFs = localFsMod.createLocalFsDataSource()
const rulesMod = loadTsModule('src/core/shared/rules.ts')
const projectIdOf = (projectPath) => rulesMod.projectIdFromPath(projectPath)

test('escapeFtsQuery: query syntax characters neutralized', () => {
  const { escapeFtsQuery } = searchMod
  assert.equal(escapeFtsQuery('模型训练'), '"模型训练"')
  assert.equal(escapeFtsQuery('a!b'), '"a b"')
  // Phrase-quoting neutralizes operators: the whole query becomes one string.
  assert.ok(escapeFtsQuery('a OR b').startsWith('"') && escapeFtsQuery('a OR b').endsWith('"'))
  assert.equal(escapeFtsQuery('   '), '')
})

test('extract: three-format row mapping + head/tail truncation', async () => {
  const { extractSessionText, INDEX_TOTAL_MAX_BYTES } = extractMod
  const root = mkdtempSync(join(tmpdir(), 'agent-history-ft-'))
  const claudeFile = join(root, 'c.jsonl')
  writeFileSync(claudeFile, [JSON.stringify({ type: 'user', message: { role: 'user', content: '中文提问一' } }), JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '回复一' }] } })].join('\n'))
  const claude = await extractSessionText(localFs, 'claude', claudeFile, statSync(claudeFile).size)
  assert.deepEqual(
    claude.messages.map((m) => m.text),
    ['中文提问一', '回复一'],
  )
  assert.equal(claude.truncated, false)

  const cbFile = join(root, 'cb.jsonl')
  writeFileSync(cbFile, JSON.stringify({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '你好' }] }))
  const cb = await extractSessionText(localFs, 'codebuddy', cbFile, statSync(cbFile).size)
  assert.deepEqual(
    cb.messages.map((m) => m.text),
    ['你好'],
  )

  const cxFile = join(root, 'cx.jsonl')
  writeFileSync(cxFile, JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'codex 回复' }] } }))
  const cx = await extractSessionText(localFs, 'codex', cxFile, statSync(cxFile).size)
  assert.deepEqual(
    cx.messages.map((m) => m.text),
    ['codex 回复'],
  )

  // Oversized file → head+tail read, truncated flag.
  const bigFile = join(root, 'big.jsonl')
  writeFileSync(bigFile, 'x'.repeat(INDEX_TOTAL_MAX_BYTES + 1024))
  const big = await extractSessionText(localFs, 'claude', bigFile, INDEX_TOTAL_MAX_BYTES + 1024)
  assert.equal(big.truncated, true)
})

function makeSearchEnv(files) {
  const projectPath = mkdtempSync(join(tmpdir(), 'agent-history-search-'))
  for (const [name, body] of Object.entries(files)) writeFileSync(join(projectPath, name), body)
  const db = dbMod.openAgentHistoryCacheDb(join(mkdtempSync(join(tmpdir(), 'agent-history-search-db-')), 'cache.db'))
  const rowOf = (name, key, text) => ({
    providerId: 'claude',
    sessionKey: key,
    updatedAt: '2026-10-27T10:00:00.000Z',
    title: name,
    dataJson: JSON.stringify({ sessionKey: key, agent: 'claude', updatedAt: '2026-10-27T10:00:00.000Z', title: name, messageCount: 1, previewMessages: [] }),
    filePath: join(projectPath, name),
    mtimeMs: 1000,
    sizeBytes: 50,
    parserVersion: 1,
    byteOffset: 50,
    prefixHash: null,
    scannedAt: '2026-10-27T10:00:00.000Z',
  })
  db.upsertBatch(projectIdOf(root), [rowOf('a.jsonl', 'key-a', 'a'), rowOf('b.jsonl', 'key-b', 'b')])
  const svc = searchMod.createFulltextSearchService({
    loadConfig: () => ({ projects: [{ path: projectPath }] }),
    cache: db,
    dataSourceRegistry: { getFor: () => localFs },
  })
  return { db, svc, projectPath }
}

test('search: trigram hits aggregate per session; index builds lazily', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-history-search-src-'))
  const fileA = join(root, 'a.jsonl')
  const fileB = join(root, 'b.jsonl')
  writeFileSync(fileA, JSON.stringify({ type: 'user', message: { role: 'user', content: '我们讨论了模型训练的细节' } }) + '\n' + JSON.stringify({ type: 'user', message: { role: 'user', content: '再次提到模型训练' } }))
  writeFileSync(fileB, JSON.stringify({ type: 'user', message: { role: 'user', content: '无关内容' } }))

  const db = dbMod.openAgentHistoryCacheDb(join(mkdtempSync(join(tmpdir(), 'agent-history-search-db2-')), 'cache.db'))
  const rowOf = (filePath, key, title) => ({
    providerId: 'claude',
    sessionKey: key,
    updatedAt: '2026-10-27T10:00:00.000Z',
    title,
    dataJson: JSON.stringify({ sessionKey: key, agent: 'claude', updatedAt: '2026-10-27T10:00:00.000Z', title, messageCount: 2, previewMessages: [] }),
    filePath,
    mtimeMs: 1000,
    sizeBytes: statSize(filePath),
    parserVersion: 1,
    byteOffset: statSize(filePath),
    prefixHash: null,
    scannedAt: '2026-10-27T10:00:00.000Z',
  })
  const statSize = (p) => 100
  // sizeBytes must be real for extract; recompute honestly.
  const { statSync } = await import('node:fs')
  const realSize = (p) => statSync(p).size
  db.upsertBatch(
    projectIdOf(root),
    [rowOf(fileA, 'key-a', '会话A'), rowOf(fileB, 'key-b', '会话B')].map((row) => ({ ...row, sizeBytes: realSize(row.filePath), byteOffset: realSize(row.filePath) })),
  )

  const svc = searchMod.createFulltextSearchService({
    loadConfig: () => ({ projects: [{ path: root }] }),
    cache: db,
    dataSourceRegistry: { getFor: () => localFs },
  })
  const result = await svc.search({ projectId: projectIdOf(root), query: '模型训练' })
  // One hit per session (message aggregation) — session A has two matching messages.
  assert.equal(result.hits.length, 1)
  assert.equal(result.hits[0].sessionKey, 'key-a')
  assert.ok(result.hits[0].snippets.length >= 1 && result.hits[0].snippets.length <= 3)
  assert.equal(result.coverage.status, 'complete')
  assert.equal(result.degraded, 'none')
  db.close()
})

test('search: 2-char query degrades to metadata-only with explicit notice', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-history-search-src3-'))
  const db = dbMod.openAgentHistoryCacheDb(join(mkdtempSync(join(tmpdir(), 'agent-history-search-db3-')), 'cache.db'))
  db.upsertBatch(projectIdOf(root), [
    {
      providerId: 'claude',
      sessionKey: 'key-t',
      updatedAt: '2026-10-27T10:00:00.000Z',
      title: '训练计划',
      dataJson: JSON.stringify({ sessionKey: 'key-t', agent: 'claude' }),
      filePath: join(root, 'a.jsonl'),
      mtimeMs: 1000,
      sizeBytes: 10,
      parserVersion: 1,
      byteOffset: 10,
      prefixHash: null,
      scannedAt: '2026-10-27T10:00:00.000Z',
    },
  ])
  const svc = searchMod.createFulltextSearchService({ loadConfig: () => ({ projects: [{ path: root }] }), cache: db, dataSourceRegistry: { getFor: () => localFs } })
  const result = await svc.search({ projectId: projectIdOf(root), query: '训练' })
  assert.equal(result.degraded, 'short-query-metadata-only')
  assert.equal(result.hits.length, 1)
  assert.equal(result.hits[0].title, '训练计划')
  db.close()
})

test('search: coverage discloses unindexed sessions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-history-search-src4-'))
  const file = join(root, 'a.jsonl')
  // Valid rows whose text can never match the query → indexed, 0 hits, and
  // a second UNINDEXED session proves the coverage disclosure.
  writeFileSync(file, JSON.stringify({ type: 'user', message: { role: 'user', content: '可被索引的正文' } }))
  const db = dbMod.openAgentHistoryCacheDb(join(mkdtempSync(join(tmpdir(), 'agent-history-search-db4-')), 'cache.db'))
  db.upsertBatch(projectIdOf(root), [
    {
      providerId: 'claude',
      sessionKey: 'key-u',
      updatedAt: '2026-10-27T10:00:00.000Z',
      title: '未索引',
      dataJson: JSON.stringify({ sessionKey: 'key-u', agent: 'claude' }),
      filePath: file,
      mtimeMs: 1000,
      sizeBytes: statSync(file).size,
      parserVersion: 1,
      byteOffset: statSync(file).size,
      prefixHash: null,
      scannedAt: '2026-10-27T10:00:00.000Z',
    },
    {
      providerId: 'claude',
      sessionKey: 'key-u2',
      updatedAt: '2026-10-27T09:00:00.000Z',
      title: '永远不会被索引',
      dataJson: JSON.stringify({ sessionKey: 'key-u2', agent: 'claude' }),
      filePath: join(root, 'missing.jsonl'),
      mtimeMs: 1000,
      sizeBytes: 10,
      parserVersion: 1,
      byteOffset: 10,
      prefixHash: null,
      scannedAt: '2026-10-27T10:00:00.000Z',
    },
  ])
  const svc = searchMod.createFulltextSearchService({ loadConfig: () => ({ projects: [{ path: root }] }), cache: db, dataSourceRegistry: { getFor: () => localFs } })
  // Query something that cannot match the metadata: unindexed body text is disclosed.
  const result = await svc.search({ projectId: projectIdOf(root), query: '完全不存在的长查询词' })
  assert.equal(result.coverage.status, 'partial')
  assert.ok(result.coverage.excluded.some((e) => e.reason === 'NOT_INDEXED'))
  db.close()
})
