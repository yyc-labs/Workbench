import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadTsModule } from '../../helpers/load-ts-module.mjs'

const mod = loadTsModule('src/core/electron/main/agent-history/providers/dynamic/dynamic-provider.ts')
const loaderMod = loadTsModule('src/core/electron/main/agent-history/providers/dynamic/loader.ts')
const localFsMod = loadTsModule('src/core/electron/main/agent-history/datasource/local-fs.ts')

const localFs = localFsMod.createLocalFsDataSource()

const validConfig = {
  id: 'gemini',
  name: 'Gemini CLI',
  datasource: 'local',
  homeRelativeDir: '.gemini/sessions',
  filePattern: '\\.jsonl$',
  recursive: true,
  lineMapping: {
    typeField: 'type',
    messageTypes: ['message'],
    sessionId: 'sessionId',
    cwd: 'cwd',
    role: 'role',
    text: 'text',
    timestamp: 'timestamp',
  },
  resume: { executableId: 'claude', args: [], sessionIdArg: { index: 0 } },
  capabilities: { preview: true, fullTranscript: true, nativeResume: true },
}

test('schema validation: valid config passes', () => {
  const result = mod.validateDynamicProviderConfig(validConfig)
  assert.ok(result.ok)
})

test('schema validation: matrix of invalid configs rejected', () => {
  const cases = [
    [{ ...validConfig, id: 'Bad_ID' }, 'id'],
    [{ ...validConfig, datasource: 'ssh' }, 'datasource'],
    [{ ...validConfig, lineMapping: { ...validConfig.lineMapping, typeField: 'type; drop' } }, 'typeField'],
    [{ ...validConfig, resume: { executableId: 'arbitrary-binary', args: [] } }, 'executableId'],
    [{ ...validConfig, resume: { executableId: 'claude', args: 'string' } }, 'args'],
    [{ ...validConfig, extraField: 'smuggled' }, 'unknown field'],
    [{ ...validConfig, capabilities: { nativeResume: 'yes' } }, 'nativeResume'],
  ]
  for (const [config, reasonPart] of cases) {
    const result = mod.validateDynamicProviderConfig(config)
    assert.equal(result.ok, false, JSON.stringify(reasonPart))
    if (!result.ok) assert.ok(result.reason.includes(reasonPart))
  }
})

test('security assertion: provider JSON cannot carry a shell channel', () => {
  // P0-3: even a hand-crafted config with shell-looking strings is either
  // rejected or reduced to structured args (no command/shell field exists).
  const sneaky = { ...validConfig, command: 'cmd.exe /c evil', shell: 'sh -c evil', resume: { executableId: 'claude', args: ['&&', 'evil'] } }
  const result = mod.validateDynamicProviderConfig(sneaky)
  assert.equal(result.ok, false, 'unknown fields (command/shell) must be rejected outright')
})

test('dynamic provider: discovery + parsing through line mapping', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-history-dyn-'))
  const sessionsDir = join(root, '.gemini', 'sessions')
  mkdirSync(sessionsDir, { recursive: true })
  writeFileSync(
    join(sessionsDir, 'g1.jsonl'),
    [
      JSON.stringify({ type: 'message', role: 'user', sessionId: 'gm-1', cwd: 'D:/work', text: 'gemini 提问', timestamp: '2026-10-27T10:00:00.000Z' }),
      JSON.stringify({ type: 'message', role: 'assistant', sessionId: 'gm-1', text: 'gemini 回复', timestamp: '2026-10-27T10:01:00.000Z' }),
      JSON.stringify({ type: 'noise' }),
    ].join('\n'),
  )
  const provider = mod.createDynamicAgentHistoryProvider(validConfig, { getHomeDir: () => root, getWslHomeDir: async () => null })

  const context = { projectId: 'p', nativePath: 'D:/work', executionEnvironment: 'windows' }
  const discovered = await provider.discover(context, localFs)
  assert.equal(discovered.candidates.length, 1)
  assert.equal(discovered.truncated, false)

  const session = await provider.parseSession(discovered.candidates[0], localFs)
  assert.equal(session.agent, 'gemini')
  assert.equal(session.sessionId, 'gm-1')
  assert.equal(session.messageCount, 2)
  assert.equal(session.title, 'gemini 提问')
  // Dynamic resume capability requires a valid resume config → available here.
  assert.equal(provider.capabilities.nativeResume, true)
  // Dynamic mappings cannot prove incremental safety → forced off (plan §4 stage 8).
  assert.equal(provider.capabilities.incrementalRead, false)
})

test('loader: valid file registers, invalid file surfaces an issue and is skipped', async () => {
  const storageDir = mkdtempSync(join(tmpdir(), 'agent-history-loader-'))
  const dir = join(storageDir, 'agent-history', 'providers')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'gemini.provider.json'), JSON.stringify(validConfig))
  writeFileSync(join(dir, 'broken.provider.json'), JSON.stringify({ id: 'x' }))
  writeFileSync(join(dir, 'not-json.provider.json'), '{invalid')
  writeFileSync(join(dir, 'ignored.txt'), 'not a provider')
  const result = loaderMod.loadDynamicProviders(storageDir, { getHomeDir: () => tmpdir(), getWslHomeDir: async () => null })
  assert.equal(result.providers.length, 1)
  assert.equal(result.providers[0].id, 'gemini')
  assert.equal(result.issues.length, 2)
})
