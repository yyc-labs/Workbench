import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../../helpers/load-ts-module.mjs'

const mod = loadTsModule('src/core/electron/main/agent-history/resume-service.ts')
const rulesMod = loadTsModule('src/core/shared/rules.ts')

const projectPath = 'D:/work/app'
const projectId = rulesMod.projectIdFromPath(projectPath)

function makeDeps(overrides = {}) {
  const started = []
  const cache = {
    listByProject: (projectId) => [
      {
        providerId: overrides.agent ?? 'claude',
        sessionKey: 'key-1',
        updatedAt: '2026-10-27T10:00:00.000Z',
        title: 't',
        dataJson: JSON.stringify({ sessionKey: 'key-1', agent: overrides.agent ?? 'claude', sessionId: overrides.sessionId ?? 'abc-123' }),
        filePath: 'x',
        mtimeMs: 1,
        sizeBytes: 1,
        parserVersion: 1,
        byteOffset: 1,
        prefixHash: null,
        scannedAt: '2026-10-27T10:00:00.000Z',
      },
    ],
  }
  const provider = {
    id: overrides.agent ?? 'claude',
    parserVersion: 1,
    capabilities: { preview: true, fullTranscript: true, incrementalRead: true, nativeResume: overrides.nativeResume ?? true },
    discover: async () => ({ candidates: [], truncated: false }),
    parseSession: async () => {
      throw new Error('not used')
    },
  }
  const deps = {
    loadConfig: () => ({ projects: [{ path: projectPath }] }),
    cache,
    providers: { all: () => [provider], get: (agent) => (agent === provider.id ? provider : null) },
    runtimeService: {
      startRuntime: async (pid, pp, profile, cli, resumeSessionId) => {
        started.push({ profile, cli, resumeSessionId })
        return overrides.launchOk ?? true
      },
    },
    ...overrides.deps,
  }
  return { deps, started, service: mod.createAgentHistoryResumeService(deps) }
}

test('resume: happy path builds a structured resume profile (args array, no shell)', async () => {
  const { service, started } = makeDeps()
  const result = await service.resume({ projectId, sessionKey: 'key-1' })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.provider, 'claude')
    assert.equal(result.executionEnvironment, 'windows')
  }
  assert.equal(started.length, 1)
  const { profile, cli, resumeSessionId } = started[0]
  assert.equal(cli, 'claude')
  assert.equal(resumeSessionId, 'abc-123')
  assert.deepEqual(profile.args, [])
  assert.equal(profile.command, 'claude')
})

test('resume: per-CLI arg shapes (codex subcommand, codebuddy -r)', async () => {
  const codex = makeDeps({ agent: 'codex', sessionId: 'cx-1' })
  await codex.service.resume({ projectId, sessionKey: 'key-1' })
  assert.deepEqual(codex.started[0].profile.args, [])

  const cb = makeDeps({ agent: 'codebuddy', sessionId: 'cb-1' })
  await cb.service.resume({ projectId, sessionKey: 'key-1' })
  assert.deepEqual(cb.started[0].profile.args, [])
})

test('resume: provider without nativeResume is rejected', async () => {
  const { service } = makeDeps({ nativeResume: false })
  const result = await service.resume({ projectId, sessionKey: 'key-1' })
  assert.deepEqual(result, { ok: false, reason: 'RESUME_UNSUPPORTED' })
})

test('resume: unsafe sessionId characters are rejected (P0-3 ④)', async () => {
  const { service } = makeDeps({ sessionId: 'abc; rm -rf /' })
  const result = await service.resume({ projectId, sessionKey: 'key-1' })
  assert.deepEqual(result, { ok: false, reason: 'NO_SESSION_ID' })
})

test('resume: missing session / launch failure reasons', async () => {
  const missing = makeDeps()
  const r1 = await missing.service.resume({ projectId, sessionKey: 'nope' })
  assert.deepEqual(r1, { ok: false, reason: 'SESSION_NOT_FOUND' })

  const failed = makeDeps({ launchOk: false })
  const r2 = await failed.service.resume({ projectId, sessionKey: 'key-1' })
  assert.deepEqual(r2, { ok: false, reason: 'LAUNCH_FAILED' })
})

test('isSafeResumeSessionId: whitelist format check', () => {
  assert.equal(mod.isSafeResumeSessionId('b89e5d44-a751-4e6f-bb1d-6506235ce2a5'), true)
  assert.equal(mod.isSafeResumeSessionId('abc_123.X'), true)
  assert.equal(mod.isSafeResumeSessionId('has space'), false)
  assert.equal(mod.isSafeResumeSessionId('$(cmd)'), false)
  assert.equal(mod.isSafeResumeSessionId(''), false)
})
