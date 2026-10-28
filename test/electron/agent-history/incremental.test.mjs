import assert from 'node:assert/strict'
import { mkdtempSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadTsModule } from '../../helpers/load-ts-module.mjs'

const claudeMod = loadTsModule('src/core/electron/main/agent-history/providers/claude/provider.ts')
const incrementalMod = loadTsModule('src/core/electron/main/agent-history/providers/shared/incremental-parser.ts')
const localFsMod = loadTsModule('src/core/electron/main/agent-history/datasource/local-fs.ts')

const localFs = localFsMod.createLocalFsDataSource()

function claudeLine(i, extra = {}) {
  return JSON.stringify({ type: 'user', sessionId: 's-inc', timestamp: new Date(Date.parse('2026-10-27T10:00:00.000Z') + i * 1000).toISOString(), cwd: 'D:\\proj\\app', gitBranch: 'main', isSidechain: false, message: { role: 'user', content: `第 ${i} 条消息 — 中文内容` }, ...extra }) + '\n'
}
function claudeAssistantLine(i, text) {
  return JSON.stringify({ type: 'assistant', sessionId: 's-inc', timestamp: new Date(Date.parse('2026-10-27T10:00:00.000Z') + i * 1000).toISOString(), cwd: 'D:\\proj\\app', gitBranch: 'main', message: { role: 'assistant', model: 'claude-x', content: [{ type: 'text', text }] } }) + '\n'
}

const provider = claudeMod.createClaudeAgentHistoryProvider({ getHomeDir: () => tmpdir() })

async function fullParse(file) {
  const st = statSync(file)
  return provider.parseSession({ agent: 'claude', filePath: file, mtimeMs: st.mtimeMs, sizeBytes: st.size }, localFs)
}

test('incremental core: splitCompleteLines excludes trailing half-line by bytes', () => {
  const { splitCompleteLines, hashBuffer } = incrementalMod
  const good = Buffer.from('a\nb\nc\n', 'utf8')
  assert.deepEqual(splitCompleteLines(good), { lines: ['a', 'b', 'c'], consumedBytes: 6 })
  const half = Buffer.from('a\nb\n中', 'utf8') // trailing multi-byte half-line
  const r = splitCompleteLines(half)
  assert.deepEqual(r.lines, ['a', 'b'])
  assert.equal(r.consumedBytes, 4) // 'a\nb\n' = 4 bytes; the half-line must not be consumed
  assert.equal(hashBuffer(Buffer.from('x')).length, 16)
})

test('golden: incremental continuation matches a full parse field-by-field', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-history-inc-'))
  const file = join(root, 's.jsonl')
  writeFileSync(file, claudeLine(0) + claudeAssistantLine(1, '回复一') + claudeLine(2))

  const full1 = await fullParse(file)
  assert.ok(full1.source)
  const { hashFileByChunks } = incrementalMod
  const st1 = statSync(file)
  const prefixHash = await hashFileByChunks(localFs, file, st1.size)
  assert.ok(prefixHash)

  // Append like a live CLI would.
  const appended = claudeAssistantLine(3, '回复二') + claudeLine(4) + claudeAssistantLine(5, '回复三')
  writeFileSync(file, claudeLine(0) + claudeAssistantLine(1, '回复一') + claudeLine(2) + appended)
  const st2 = statSync(file)
  utimesSync(file, st2.atime, new Date(st2.mtimeMs + 5000))

  const baseline = { session: full1, byteOffset: st1.size, prefixHash }
  const resumed = await provider.parseIncremental({ agent: 'claude', filePath: file, mtimeMs: st2.mtimeMs, sizeBytes: st2.size }, localFs, baseline)
  assert.ok(resumed, 'verified incremental path must succeed on pure append')

  const full2 = await fullParse(file)
  // Golden: every public field must equal a full parse (D8 acceptance).
  for (const key of ['sessionKey', 'agent', 'updatedAt', 'sessionId', 'title', 'cwd', 'branch', 'model', 'createdAt', 'updatedAt', 'messageCount']) {
    assert.equal(resumed.session[key], full2[key], `field ${key}`)
  }
  assert.deepEqual(resumed.session.previewMessages, full2.previewMessages)
  assert.equal(resumed.session.source.byteOffset, st2.size)
  assert.equal(resumed.byteOffset, st2.size)
})

test('counterexample: same-size mid-file rewrite falls back to full (hash mismatch)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-history-inc-'))
  const file = join(root, 's.jsonl')
  const base = claudeLine(0) + claudeLine(1) + claudeLine(2)
  writeFileSync(file, base)
  const full1 = await fullParse(file)
  const st1 = statSync(file)
  const { hashFileByChunks } = incrementalMod
  const prefixHash = await hashFileByChunks(localFs, file, st1.size)

  // Rewrite line 1 in place (same size), keep first line identical.
  const rewritten = claudeLine(0) + claudeLine(1).replace('第 1 条消息', '第 9 条消息') + claudeLine(2)
  assert.equal(Buffer.byteLength(rewritten), Buffer.byteLength(base), 'test fixture must be same-size')
  writeFileSync(file, rewritten)
  const st2 = statSync(file)
  utimesSync(file, st2.atime, new Date(st2.mtimeMs + 5000))

  const resumed = await provider.parseIncremental({ agent: 'claude', filePath: file, mtimeMs: st2.mtimeMs, sizeBytes: st2.size }, localFs, { session: full1, byteOffset: st1.size, prefixHash })
  assert.equal(resumed, null, 'mid-file rewrite must fall back to full parse')
})

test('counterexample: grow-with-rewrite (first line unchanged) falls back to full', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-history-inc-'))
  const file = join(root, 's.jsonl')
  const base = claudeLine(0) + claudeLine(1) + claudeLine(2)
  writeFileSync(file, base)
  const full1 = await fullParse(file)
  const st1 = statSync(file)
  const { hashFileByChunks } = incrementalMod
  const prefixHash = await hashFileByChunks(localFs, file, st1.size)

  // Rewrite the MIDDLE line (different byte length) and append — size grows, first line unchanged.
  writeFileSync(file, claudeLine(0) + claudeLine(1).replace('第 1 条消息', '重写后的更长内容xx') + claudeLine(2) + claudeLine(3))
  const st2 = statSync(file)
  utimesSync(file, st2.atime, new Date(st2.mtimeMs + 5000))

  const resumed = await provider.parseIncremental({ agent: 'claude', filePath: file, mtimeMs: st2.mtimeMs, sizeBytes: st2.size }, localFs, { session: full1, byteOffset: st1.size, prefixHash })
  assert.equal(resumed, null, 'grow-with-rewrite must fall back to full parse')
})

test('counterexample: offset not on a record boundary falls back to full', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-history-inc-'))
  const file = join(root, 's.jsonl')
  writeFileSync(file, claudeLine(0) + claudeLine(1))
  const full1 = await fullParse(file)
  const st1 = statSync(file)
  const { hashFileByChunks } = incrementalMod
  const prefixHash = await hashFileByChunks(localFs, file, st1.size)
  // Simulate a corrupted cached offset that does not sit at a NEWLINE.
  const resumed = await provider.parseIncremental({ agent: 'claude', filePath: file, mtimeMs: st1.mtimeMs, sizeBytes: st1.size }, localFs, { session: full1, byteOffset: st1.size - 3, prefixHash })
  assert.equal(resumed, null)
})

test('counterexample: shrunk file falls back to full', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-history-inc-'))
  const file = join(root, 's.jsonl')
  writeFileSync(file, claudeLine(0) + claudeLine(1) + claudeLine(2))
  const full1 = await fullParse(file)
  const st1 = statSync(file)
  const { hashFileByChunks } = incrementalMod
  const prefixHash = await hashFileByChunks(localFs, file, st1.size)
  writeFileSync(file, claudeLine(0))
  const st2 = statSync(file)
  const resumed = await provider.parseIncremental({ agent: 'claude', filePath: file, mtimeMs: st2.mtimeMs, sizeBytes: st2.size }, localFs, { session: full1, byteOffset: st1.size, prefixHash })
  assert.equal(resumed, null)
})

test('half-line tail: incremental consumes only complete records', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-history-inc-'))
  const file = join(root, 's.jsonl')
  writeFileSync(file, claudeLine(0) + claudeLine(1))
  const full1 = await fullParse(file)
  const st1 = statSync(file)
  const { hashFileByChunks } = incrementalMod
  const prefixHash = await hashFileByChunks(localFs, file, st1.size)
  // Append a complete line followed by an interrupted half-line.
  writeFileSync(file, claudeLine(0) + claudeLine(1) + claudeLine(2) + claudeLine(3).slice(0, 20))
  const st2 = statSync(file)
  utimesSync(file, st2.atime, new Date(st2.mtimeMs + 5000))
  const resumed = await provider.parseIncremental({ agent: 'claude', filePath: file, mtimeMs: st2.mtimeMs, sizeBytes: st2.size }, localFs, { session: full1, byteOffset: st1.size, prefixHash })
  assert.ok(resumed, 'complete lines before the half-line must be consumed')
  assert.equal(resumed.session.messageCount, full1.messageCount + 1)
  assert.equal(resumed.byteOffset, st1.size + Buffer.byteLength(claudeLine(2)), 'half-line bytes stay unconsumed')
})
