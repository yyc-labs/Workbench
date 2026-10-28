import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadTsModule } from '../../helpers/load-ts-module.mjs'

const mod = loadTsModule('src/core/electron/main/agent-history/handoff/handoff-service.ts')

const projectPath = 'D:/work/app'
const projectId = 'proj-x'

function makeService(overrides = {}) {
  const storageDir = mkdtempSync(join(tmpdir(), 'agent-history-handoff-'))
  const cache = {
    listByProject: (pid) => [
      {
        providerId: 'claude',
        sessionKey: 'key-1',
        updatedAt: '2026-10-27T10:00:00.000Z',
        title: '源会话',
        dataJson: JSON.stringify({
          sessionKey: 'key-1',
          agent: 'claude',
          updatedAt: '2026-10-27T10:00:00.000Z',
          title: '源会话标题',
          messageCount: 3,
          previewMessages: [
            { role: 'user', text: '第一条消息内容' },
            { role: 'assistant', text: '回复内容' },
          ],
        }),
        filePath: overrides.sourceFilePath ?? join(projectPath, 'a.jsonl'),
        mtimeMs: 1,
        sizeBytes: 1,
        parserVersion: 1,
        byteOffset: 1,
        prefixHash: null,
        scannedAt: '2026-10-27T10:00:00.000Z',
      },
    ],
  }
  const svc = mod.createAgentHistoryHandoffService({
    loadConfig: () => ({ projects: [{ path: projectPath }] }),
    cache,
    getStorageDir: () => storageDir,
    canTargetRead: overrides.canTargetRead ?? (() => true),
  })
  return { svc, storageDir }
}

const createArgs = {
  sourceProjectId: projectId,
  sourceSessionKey: 'key-1',
  targetAgent: 'codex',
  targetProjectId: projectId,
  mode: 'focused',
}

test('handoff: focused package built, delivered, confirmed (user action)', async () => {
  const { svc, storageDir } = makeService()
  const result = await svc.create(createArgs)
  assert.ok(result.ok)
  if (!result.ok) return
  // No startTargetRuntime in this fixture → manual delivery awaiting user load.
  assert.equal(result.record.status, 'pending')
  assert.equal(result.record.mechanism, 'manual')
  assert.ok(existsSync(result.record.packagePath))
  // Package content: digest with preview + note; NOT the raw file path dump.
  const body = await import('node:fs').then((fs) => fs.readFileSync(result.record.packagePath, 'utf8'))
  assert.ok(body.includes('第一条消息内容'))
  assert.ok(body.includes('Handoff context'))

  const list = svc.list()
  assert.equal(list.length, 1)
  assert.equal(list[0].status, 'pending')

  // User confirms load → confirmed.
  const confirmed = svc.confirm(result.record.id, true)
  assert.equal(confirmed?.status, 'confirmed')
  void storageDir
})

test('handoff: full mode with unreachable source degrades the mechanism (no dead path)', async () => {
  const { svc } = makeService({ canTargetRead: () => false })
  const result = await svc.create({ ...createArgs, mode: 'full' })
  assert.ok(result.ok)
  if (!result.ok) return
  // Cross-environment unreachable → mechanism downgrades to manual (inline digest, not a bare path).
  assert.equal(result.record.mechanism, 'manual')
})

test('handoff: missing source session rejected', async () => {
  const { svc } = makeService()
  const result = await svc.create({ ...createArgs, sourceSessionKey: 'nope' })
  assert.deepEqual(result, { ok: false, reason: 'SESSION_NOT_FOUND' })
})

test('handoff: unverifiable stays pending (delivered ≠ loaded, D11)', async () => {
  const { svc } = makeService()
  const result = await svc.create(createArgs)
  if (!result.ok) return
  // confirm(loaded=false) keeps it awaiting confirmation rather than failing the record.
  const rolled = svc.confirm(result.record.id, false)
  assert.ok(rolled?.status === 'delivered' || rolled?.status === 'pending')
})

test('handoff: idempotency — unchanged re-clicks reuse the same record and file', async () => {
  const launches = []
  const { svc } = makeService({
    canTargetRead: () => true,
  })
  // startTargetRuntime 注入：makeService 未含该 deps——直接重建一个带启动回调的服务
  const storageDir = mkdtempSync(join(tmpdir(), 'agent-history-handoff-idem-'))
  const cache = {
    listByProject: () => [
      {
        providerId: 'claude',
        sessionKey: 'key-1',
        updatedAt: '2026-10-27T10:00:00.000Z',
        title: '源会话',
        dataJson: JSON.stringify({ sessionKey: 'key-1', agent: 'claude', updatedAt: '2026-10-27T10:00:00.000Z', title: '源会话标题', messageCount: 1, previewMessages: [{ role: 'user', text: '内容' }] }),
        filePath: join(projectPath, 'a.jsonl'),
        mtimeMs: 1,
        sizeBytes: 1,
        parserVersion: 1,
        byteOffset: 1,
        prefixHash: null,
        scannedAt: '2026-10-27T10:00:00.000Z',
      },
    ],
  }
  const svc2 = mod.createAgentHistoryHandoffService({
    loadConfig: () => ({ projects: [{ path: projectPath }] }),
    cache,
    getStorageDir: () => storageDir,
    canTargetRead: () => true,
    startTargetRuntime: async (input) => {
      launches.push(input)
      return true
    },
  })

  const r1 = await svc2.create({ ...createArgs, sourceProjectId: 'proj-x' })
  const r2 = await svc2.create({ ...createArgs, sourceProjectId: 'proj-x' })
  const r3 = await svc2.create({ ...createArgs, sourceProjectId: 'proj-x' })
  assert.ok(r1.ok && r2.ok && r3.ok)
  assert.equal(r1.record.id, r2.record.id)
  assert.equal(r2.record.id, r3.record.id)
  // One launch, one package file, one record — not three.
  assert.equal(launches.length, 1)
  const handoffDir = join(storageDir, 'agent-history', 'handoff')
  const mdFiles = readdirSync(handoffDir).filter((f) => f.endsWith('.md'))
  assert.equal(mdFiles.length, 1)
  assert.equal(svc2.list().length, 1)
})

test('handoff: changed content (new preview) produces a NEW record', async () => {
  const storageDir = mkdtempSync(join(tmpdir(), 'agent-history-handoff-chg-'))
  let previewText = '第一版内容'
  const cache = {
    listByProject: () => [
      {
        providerId: 'claude',
        sessionKey: 'key-1',
        updatedAt: '2026-10-27T10:00:00.000Z',
        title: '源会话',
        dataJson: JSON.stringify({ sessionKey: 'key-1', agent: 'claude', updatedAt: '2026-10-27T10:00:00.000Z', title: '源会话标题', messageCount: 1, previewMessages: [{ role: 'user', text: previewText }] }),
        filePath: join(projectPath, 'a.jsonl'),
        mtimeMs: 1,
        sizeBytes: 1,
        parserVersion: 1,
        byteOffset: 1,
        prefixHash: null,
        scannedAt: '2026-10-27T10:00:00.000Z',
      },
    ],
  }
  const svc = mod.createAgentHistoryHandoffService({
    loadConfig: () => ({ projects: [{ path: projectPath }] }),
    cache,
    getStorageDir: () => storageDir,
    canTargetRead: () => true,
    startTargetRuntime: async () => true,
  })
  const r1 = await svc.create({ ...createArgs, sourceProjectId: 'proj-x' })
  previewText = '第二版内容（会话有新消息）'
  const r2 = await svc.create({ ...createArgs, sourceProjectId: 'proj-x' })
  assert.ok(r1.ok && r2.ok)
  assert.notEqual(r1.record.id, r2.record.id, 'changed content → new id/record')
})
