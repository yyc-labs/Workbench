import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadTsModule } from '../../helpers/load-ts-module.mjs'

const typesMod = loadTsModule('src/core/electron/main/agent-history/providers/types.ts')
const claudeMod = loadTsModule('src/core/electron/main/agent-history/providers/claude/provider.ts')
const codebuddyMod = loadTsModule('src/core/electron/main/agent-history/providers/codebuddy/provider.ts')
const codexMod = loadTsModule('src/core/electron/main/agent-history/providers/codex/provider.ts')
const normalizerMod = loadTsModule('src/core/electron/main/agent-history/path-normalizer.ts')
const localFsMod = loadTsModule('src/core/electron/main/agent-history/datasource/local-fs.ts')

/** Stage 1: all provider IO now goes through a data source routed per project context. */
const localFs = localFsMod.createLocalFsDataSource()

function makeTempRoot() {
  return mkdtempSync(join(tmpdir(), 'agent-history-test-'))
}

function contextOf(projectPath) {
  return { projectId: 'p1', nativePath: projectPath, executionEnvironment: 'windows' }
}

function candidateOf(filePath, mtimeMs = 1000, sizeBytes = 500) {
  return { agent: 'claude', filePath, mtimeMs, sizeBytes }
}

// ---------- bucket encoding / project isolation (路径与项目隔离) ----------

test('claude bucket encoding: non-alphanumeric to dash, case preserved', () => {
  assert.equal(normalizerMod.encodeClaudeBucketName('C:\\Users\\x'), 'C--Users-x')
  assert.equal(normalizerMod.encodeClaudeBucketName('D:\\work\\app'), 'D--work-app')
  assert.equal(normalizerMod.encodeClaudeBucketName('D:\\work\\application'), 'D--work-application')
})

test('codebuddy bucket encoding: lowercase, single dash, colon dropped', () => {
  assert.equal(normalizerMod.encodeCodebuddyBucketName('D:\\tools\\ide-electron'), 'd-tools-ide-electron')
  assert.equal(normalizerMod.encodeCodebuddyBucketName('D:\\work\\app'), 'd-work-app')
  assert.equal(normalizerMod.encodeCodebuddyBucketName('D:\\work\\application'), 'd-work-application')
})

test('bucket discovery only lists the project own bucket (similar names isolated)', async () => {
  const root = makeTempRoot()
  const projectsRoot = join(root, '.codebuddy', 'projects')
  const projectPath = join(root, 'work', 'app')
  const ownBucket = normalizerMod.encodeCodebuddyBucketName(projectPath)
  const otherBucket = normalizerMod.encodeCodebuddyBucketName(join(root, 'work', 'application'))
  assert.notEqual(ownBucket, otherBucket)
  mkdirSync(join(projectsRoot, ownBucket), { recursive: true })
  mkdirSync(join(projectsRoot, otherBucket), { recursive: true })
  writeFileSync(join(projectsRoot, ownBucket, 's1.jsonl'), '{}\n') // non-empty: stage 0 skips zero-byte files
  writeFileSync(join(projectsRoot, otherBucket, 's2.jsonl'), '{}\n')

  const provider = codebuddyMod.createCodebuddyAgentHistoryProvider({ getHomeDir: () => root })
  const result = await provider.discover(contextOf(projectPath), localFs)
  assert.equal(result.candidates.length, 1)
  assert.equal(result.truncated, false)
  assert.ok(result.candidates[0].filePath.endsWith('s1.jsonl'))
})

test('discovery skips symlinked session files (file safety)', async () => {
  const root = makeTempRoot()
  const projectsRoot = join(root, '.claude', 'projects')
  const projectPath = join(root, 'work', 'app')
  const bucket = normalizerMod.encodeClaudeBucketName(projectPath)
  mkdirSync(join(projectsRoot, bucket), { recursive: true })
  const outside = join(root, 'outside.jsonl')
  writeFileSync(outside, '')
  writeFileSync(join(projectsRoot, bucket, 'own.jsonl'), '{}\n')
  try {
    symlinkSync(outside, join(projectsRoot, bucket, 'link.jsonl'), 'file')
  } catch {
    // Windows without symlink privilege: skip the link part of this test.
  }
  const provider = claudeMod.createClaudeAgentHistoryProvider({ getHomeDir: () => root })
  const result = await provider.discover(contextOf(projectPath), localFs)
  assert.equal(result.candidates.length, 1)
  assert.ok(result.candidates[0].filePath.endsWith('own.jsonl'))
})

test('discovery of a missing bucket yields empty without error', async () => {
  const root = makeTempRoot()
  mkdirSync(join(root, '.claude', 'projects'), { recursive: true })
  const provider = claudeMod.createClaudeAgentHistoryProvider({ getHomeDir: () => root })
  const result = await provider.discover(contextOf(join(root, 'nope')), localFs)
  assert.deepEqual(result.candidates, [])
})

test('missing data source root raises SOURCE_UNAVAILABLE', async () => {
  const root = makeTempRoot()
  const provider = claudeMod.createClaudeAgentHistoryProvider({ getHomeDir: () => root })
  await assert.rejects(provider.discover(contextOf(join(root, 'x')), localFs), (error) => error.code === 'SOURCE_UNAVAILABLE')
})

// ---------- claude parsing (解析器) ----------

function writeClaudeFixture(filePath) {
  const lines = [
    JSON.stringify({ type: 'file-history-snapshot', messageId: 'x' }),
    JSON.stringify({ type: 'user', sessionId: 's-1', timestamp: '2026-10-20T10:00:00.000Z', cwd: 'D:\\proj\\app', gitBranch: 'main', isSidechain: false, message: { role: 'user', content: '帮我修 bug' } }),
    JSON.stringify({ type: 'user', sessionId: 's-1', timestamp: '2026-10-20T10:01:00.000Z', isSidechain: true, message: { role: 'user', content: 'sidechain noise' } }),
    JSON.stringify({ type: 'assistant', sessionId: 's-1', timestamp: '2026-10-20T10:02:00.000Z', cwd: 'D:\\proj\\app', gitBranch: 'main', message: { role: 'assistant', model: 'claude-x', content: [{ type: 'text', text: '已修复' }] } }),
    JSON.stringify({ type: 'system', isMeta: true, content: 'noise' }),
    JSON.stringify({ type: 'user', timestamp: '2026-10-20T10:04:00.000Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'result-only' }] } }),
  ]
  // truncated tail line must be skipped, not crash
  writeFileSync(filePath, lines.join('\n') + '\n{"type":"user","timestamp":"2026-10-20T10:0')
}

test('claude parser: whitelist rows, sidechain excluded, truncated tail skipped', async () => {
  const root = makeTempRoot()
  const file = join(root, 'session.jsonl')
  writeClaudeFixture(file)
  const provider = claudeMod.createClaudeAgentHistoryProvider({ getHomeDir: () => root })
  const session = await provider.parseSession(candidateOf(file), localFs)

  assert.equal(session.agent, 'claude')
  assert.equal(session.sessionId, 's-1')
  assert.equal(session.title, '帮我修 bug')
  assert.equal(session.branch, 'main')
  assert.equal(session.cwd, 'D:\\proj\\app')
  assert.equal(session.model, 'claude-x')
  assert.equal(session.messageCount, 3)
  assert.deepEqual(
    session.previewMessages.map((message) => message.role),
    ['user', 'system', 'assistant'],
  )
  // The trailing tool-result row still counts as activity time.
  assert.equal(session.updatedAt, '2026-10-20T10:04:00.000Z')
  assert.equal(session.createdAt, '2026-10-20T10:00:00.000Z')
  assert.deepEqual(
    session.previewMessages.map((m) => m.text),
    ['帮我修 bug', '已修复'],
  )
  assert.ok(session.sessionKey.startsWith('ah-claude-'))
})

test('claude parser: empty file falls back to mtime updatedAt', async () => {
  const root = makeTempRoot()
  const file = join(root, 'empty.jsonl')
  writeFileSync(file, '')
  const provider = claudeMod.createClaudeAgentHistoryProvider({ getHomeDir: () => root })
  const session = await provider.parseSession(candidateOf(file, 1234), localFs)
  assert.equal(session.messageCount, 0)
  assert.equal(session.title, null)
  assert.equal(session.updatedAt, new Date(1234).toISOString())
})

// ---------- codebuddy parsing ----------

function writeCodebuddyFixture(filePath) {
  const lines = [
    JSON.stringify({ type: 'file-history-snapshot' }),
    JSON.stringify({ id: 'm1', timestamp: 1761000000000, type: 'message', role: 'user', content: [{ type: 'input_text', text: '你好' }], sessionId: 'cb-1', cwd: 'D:\\proj\\app' }),
    JSON.stringify({ id: 'm2', timestamp: 1761000060000, type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '世界' }] }),
    JSON.stringify({ type: 'summary', summary: '会话标题' }),
  ]
  writeFileSync(filePath, lines.join('\n'))
}

test('codebuddy parser: epoch-ms timestamps normalized, summary row as title', async () => {
  const root = makeTempRoot()
  const file = join(root, 'cb.jsonl')
  writeCodebuddyFixture(file)
  const provider = codebuddyMod.createCodebuddyAgentHistoryProvider({ getHomeDir: () => root })
  const session = await provider.parseSession({ agent: 'codebuddy', filePath: file, mtimeMs: 1000, sizeBytes: 500 }, localFs)

  assert.equal(session.agent, 'codebuddy')
  assert.equal(session.sessionId, 'cb-1')
  assert.equal(session.title, '会话标题')
  assert.equal(session.messageCount, 3)
  assert.deepEqual(
    session.previewMessages.map((message) => message.role),
    ['system', 'user', 'assistant'],
  )
  assert.equal(session.createdAt, new Date(1761000000000).toISOString())
  assert.equal(session.updatedAt, new Date(1761000060000).toISOString())
  assert.deepEqual(
    session.previewMessages.map((m) => m.text),
    ['你好', '世界'],
  )
  assert.ok(session.sessionKey.startsWith('ah-codebuddy-'))
})

test('codebuddy parser renders configured image blobs before the message text', async () => {
  const root = makeTempRoot()
  const file = join(root, 'cb-image.jsonl')
  const row = {
    id: 'image-message',
    timestamp: 1761000000000,
    type: 'message',
    role: 'user',
    content: [
      { type: 'input_text', text: '设置一个最大高度' },
      { type: 'image_blob_ref', blob_id: 'blob-1', blob_path: 'C:\\Users\\x\\.codebuddy\\blobs\\47\\image.png' },
    ],
  }
  writeFileSync(file, JSON.stringify(row))
  const provider = codebuddyMod.createCodebuddyAgentHistoryProvider({ getHomeDir: () => root })
  const session = await provider.parseSession({ agent: 'codebuddy', filePath: file, mtimeMs: 1000, sizeBytes: 500 }, localFs)
  assert.match(session.previewMessages[0].text, /^<image path=/)
  assert.match(session.previewMessages[0].text, /设置一个最大高度$/)
})

test('codebuddy parser: missing summary falls back to first user prompt', async () => {
  const root = makeTempRoot()
  const file = join(root, 'cb2.jsonl')
  writeFileSync(file, JSON.stringify({ id: 'm1', timestamp: 1761000000000, type: 'message', role: 'user', content: [{ type: 'input_text', text: '  首条 prompt 内容  ' }] }))
  const provider = codebuddyMod.createCodebuddyAgentHistoryProvider({ getHomeDir: () => root })
  const session = await provider.parseSession({ agent: 'codebuddy', filePath: file, mtimeMs: 1000, sizeBytes: 500 }, localFs)
  assert.equal(session.title, '首条 prompt 内容')
})

// ---------- codex parsing + head filtering ----------

function writeCodexFixture(filePath, cwd) {
  const lines = [
    JSON.stringify({ timestamp: '2026-10-21T01:00:00.000Z', type: 'session_meta', payload: { id: 'cx-1', timestamp: '2026-10-21T01:00:00.000Z', cwd, originator: 'codex', cli_version: '1.0', git: { branch: 'dev' } } }),
    JSON.stringify({ timestamp: '2026-10-21T01:00:01.000Z', type: 'turn_context', payload: { cwd, model: 'gpt-5' } }),
    JSON.stringify({ timestamp: '2026-10-21T01:00:01.500Z', type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'You are Codex, a runtime instruction' }] } }),
    JSON.stringify({ timestamp: '2026-10-21T01:00:02.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<user_instructions>wrapped</user_instructions>' }] } }),
    JSON.stringify({ timestamp: '2026-10-21T01:00:03.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '列出文件' }] } }),
    JSON.stringify({ timestamp: '2026-10-21T01:00:04.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '好的' }] } }),
    JSON.stringify({ timestamp: '2026-10-21T01:00:05.000Z', type: 'event_msg', payload: { type: 'turn_started' } }),
    JSON.stringify({ timestamp: '2026-10-21T01:00:06.000Z', type: 'response_item', payload: { type: 'function_call', name: 'ls' } }),
  ]
  writeFileSync(filePath, lines.join('\n'))
}

test('codex parser: meta/turn_context/message mapping, synthetic user text filtered', async () => {
  const root = makeTempRoot()
  const file = join(root, 'rollout.jsonl')
  writeCodexFixture(file, 'D:\\proj\\app')
  const provider = codexMod.createCodexAgentHistoryProvider({ getCodexHome: () => root })
  const session = await provider.parseSession({ agent: 'codex', filePath: file, mtimeMs: 1000, sizeBytes: 500 }, localFs)

  assert.equal(session.agent, 'codex')
  assert.equal(session.sessionId, 'cx-1')
  assert.equal(session.cwd, 'D:\\proj\\app')
  assert.equal(session.branch, 'dev')
  assert.equal(session.model, 'gpt-5')
  assert.equal(session.title, '列出文件')
  assert.equal(session.messageCount, 3)
  assert.deepEqual(
    session.previewMessages.map((message) => message.role),
    ['system', 'user', 'assistant'],
  )
  assert.equal(session.updatedAt, '2026-10-21T01:00:04.000Z')
  assert.ok(session.sessionKey.startsWith('ah-codex-'))
})

test('codex parser prefers the Codex session index thread_name for the session title', async () => {
  const root = makeTempRoot()
  const file = join(root, 'rollout.jsonl')
  writeCodexFixture(file, 'D:\\proj\\app')
  writeFileSync(join(root, 'session_index.jsonl'), JSON.stringify({ id: 'cx-1', thread_name: '会话真实标题' }))
  const provider = codexMod.createCodexAgentHistoryProvider({ getCodexHome: () => root })
  const session = await provider.parseSession({ agent: 'codex', filePath: file, mtimeMs: 1000, sizeBytes: 500 }, localFs)
  assert.equal(session.title, '会话真实标题')
})

test('codex parser falls back to the state database title when the session index has no entry', async () => {
  const root = makeTempRoot()
  const file = join(root, 'rollout.jsonl')
  writeCodexFixture(file, 'D:\\proj\\app')
  const db = new DatabaseSync(join(root, 'state_5.sqlite'))
  db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT NOT NULL)')
  db.prepare('INSERT INTO threads (id, title) VALUES (?, ?)').run('cx-1', '数据库中的会话标题')
  db.close()
  writeFileSync(join(root, 'session_index.jsonl'), '')
  const provider = codexMod.createCodexAgentHistoryProvider({ getCodexHome: () => root })
  const session = await provider.parseSession({ agent: 'codex', filePath: file, mtimeMs: 1000, sizeBytes: 500 }, localFs)
  assert.equal(session.title, '数据库中的会话标题')
})

test('codex message paging returns the newest page then earlier messages without retaining the transcript', async () => {
  const root = makeTempRoot()
  const file = join(root, 'rollout.jsonl')
  writeCodexFixture(file, 'D:\\proj\\app')
  const provider = codexMod.createCodexAgentHistoryProvider({ getCodexHome: () => root })
  const candidate = { agent: 'codex', filePath: file, mtimeMs: 1000, sizeBytes: 500 }
  const newest = await provider.readMessages(candidate, localFs, 3, 1)
  assert.equal(newest.total, 3)
  assert.deepEqual(
    newest.messages.map((message) => message.text),
    ['好的'],
  )
  const older = await provider.readMessages(candidate, localFs, 1, 1)
  assert.deepEqual(
    older.messages.map((message) => message.text),
    ['You are Codex, a runtime instruction'],
  )
  assert.equal(older.messages[0].role, 'system')
})

test('codex discovery: head-read filters by exact project cwd, nested date dirs', async () => {
  const root = makeTempRoot()
  const projectPath = join(root, 'proj', 'app')
  mkdirSync(join(root, 'sessions', '2026', '10', '20'), { recursive: true })
  mkdirSync(join(root, 'sessions', '2026', '10', '21'), { recursive: true })
  writeCodexFixture(join(root, 'sessions', '2026', '10', '20', 'rollout-a.jsonl'), projectPath)
  writeCodexFixture(join(root, 'sessions', '2026', '10', '21', 'rollout-b.jsonl'), join(root, 'other', 'project'))

  const provider = codexMod.createCodexAgentHistoryProvider({ getCodexHome: () => root })
  const result = await provider.discover(contextOf(projectPath), localFs)
  assert.equal(result.candidates.length, 1)
  assert.ok(result.candidates[0].filePath.endsWith('rollout-a.jsonl'))
})

test('codex discovery: changed head invalidates cached decision (same size rewrite)', async () => {
  const root = makeTempRoot()
  const projectPath = join(root, 'proj', 'app')
  const sessionsDir = join(root, 'sessions', '2026', '10', '20')
  mkdirSync(sessionsDir, { recursive: true })
  const file = join(sessionsDir, 'rollout-a.jsonl')
  writeCodexFixture(file, projectPath)
  const provider = codexMod.createCodexAgentHistoryProvider({ getCodexHome: () => root })

  const first = await provider.discover(contextOf(projectPath), localFs)
  assert.equal(first.candidates.length, 1)

  // Rewrite with a different cwd (same file length) and bump mtime.
  const otherCwd = projectPath.slice(0, -1)
  writeCodexFixture(file, otherCwd)
  const stat = await import('node:fs').then((fs) => fs.statSync(file))
  utimesSync(file, stat.atime, new Date(Date.now() + 5000))

  const second = await provider.discover(contextOf(projectPath), localFs)
  assert.equal(second.candidates.length, 0)
})

test('codex session_meta missing → file never matches any project', async () => {
  const root = makeTempRoot()
  const projectPath = join(root, 'proj', 'app')
  const sessionsDir = join(root, 'sessions')
  mkdirSync(sessionsDir, { recursive: true })
  writeFileSync(join(sessionsDir, 'rollout-no-meta.jsonl'), JSON.stringify({ timestamp: '2026-10-21T01:00:00.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [] } }))
  const provider = codexMod.createCodexAgentHistoryProvider({ getCodexHome: () => root })
  const result = await provider.discover(contextOf(projectPath), localFs)
  assert.equal(result.candidates.length, 0)
})

// ---------- sessionKey (同 sessionId 不同数据源不冲突) ----------

test('same native sessionId across agents yields distinct stable keys', () => {
  const identityMod = loadTsModule('src/core/electron/main/agent-history/session-identity.ts')
  const a = identityMod.createSessionKey({ agent: 'claude', namespaceId: 'win32', filePath: 'd:\\x\\a.jsonl', nativeSessionId: 'same' })
  const b = identityMod.createSessionKey({ agent: 'codex', namespaceId: 'win32', filePath: 'd:\\x\\a.jsonl', nativeSessionId: 'same' })
  const a2 = identityMod.createSessionKey({ agent: 'claude', namespaceId: 'win32', filePath: 'd:\\x\\a.jsonl', nativeSessionId: 'same' })
  assert.notEqual(a, b)
  assert.equal(a, a2)
  const derived = identityMod.createSessionKey({ agent: 'claude', namespaceId: 'win32', filePath: 'd:\\x\\a.jsonl', nativeSessionId: null })
  assert.ok(derived.startsWith('ah-claude-'))
})

test('AgentHistoryFileError carries issue code', () => {
  const error = new typesMod.AgentHistoryFileError('FILE_TOO_LARGE', 'too big')
  assert.equal(error.code, 'FILE_TOO_LARGE')
  assert.ok(error instanceof Error)
})

assert.ok(existsSync(tmpdir()))
