import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const runTasks = loadTsModule('src/core/shared/runTasks.ts')
const { RunTaskConfigStore, normalizeRunTasks, normalizeScanDirectories } = loadTsModule('src/core/electron/main/run-tasks/run-task-config-store.ts')
const { detectRunTaskCandidates } = loadTsModule('src/core/electron/main/run-tasks/run-task-detector.ts')

const { getEffectiveRunTasks, topoSortRunTasks, RunTaskCycleError, runTaskProcessKey, parseRunTaskProcessKey, getRunTaskStateUrls, getActiveRunTaskUrls, getPrimaryRunTaskUrl, isPrimaryRunTaskUrlPending } = runTasks

// ── process key helpers ──────────────────────────────────

test('run task process keys round-trip', () => {
  const key = runTaskProcessKey('proj-1', 'backend')
  assert.equal(key, 'proj-1::run::backend')
  assert.deepEqual(parseRunTaskProcessKey(key), { projectId: 'proj-1', taskId: 'backend' })
  assert.equal(parseRunTaskProcessKey('proj-1'), null)
  assert.equal(parseRunTaskProcessKey('proj-1::toolbox'), null)
  assert.equal(parseRunTaskProcessKey('::run::backend'), null)
})

// ── topoSortRunTasks ─────────────────────────────────────

test('topoSortRunTasks orders dependencies first', () => {
  const tasks = [
    { id: 'frontend', name: 'Frontend', command: 'npm run dev', dependsOn: ['backend'] },
    { id: 'backend', name: 'Backend', command: 'npm run dev', dependsOn: ['docker'] },
    { id: 'docker', name: 'Docker', command: 'docker compose up -d' },
  ]
  const sorted = topoSortRunTasks(tasks).map((task) => task.id)
  assert.deepEqual(sorted, ['docker', 'backend', 'frontend'])
})

test('topoSortRunTasks throws on direct cycle', () => {
  const tasks = [
    { id: 'a', name: 'A', command: 'a', dependsOn: ['b'] },
    { id: 'b', name: 'B', command: 'b', dependsOn: ['a'] },
  ]
  assert.throws(() => topoSortRunTasks(tasks), RunTaskCycleError)
})

test('topoSortRunTasks throws on indirect cycle', () => {
  const tasks = [
    { id: 'a', name: 'A', command: 'a', dependsOn: ['c'] },
    { id: 'b', name: 'B', command: 'b', dependsOn: ['a'] },
    { id: 'c', name: 'C', command: 'c', dependsOn: ['b'] },
  ]
  assert.throws(() => topoSortRunTasks(tasks), RunTaskCycleError)
})

test('topoSortRunTasks throws when a dependency is missing', () => {
  const tasks = [{ id: 'a', name: 'A', command: 'a', dependsOn: ['ghost'] }]
  assert.throws(() => topoSortRunTasks(tasks), RunTaskCycleError)
})

test('topoSortRunTasks rejects duplicate ids', () => {
  const tasks = [
    { id: 'a', name: 'A', command: 'a' },
    { id: 'a', name: 'A2', command: 'b' },
  ]
  assert.throws(() => topoSortRunTasks(tasks), RunTaskCycleError)
})

// ── normalizeRunTasks ────────────────────────────────────

test('normalizeRunTasks drops invalid entries and dedupes ids', () => {
  const normalized = normalizeRunTasks([null, 'nope', { id: '', command: 'x' }, { id: 'a', command: '' }, { id: 'a', name: 'First', command: 'npm run dev' }, { id: 'a', name: 'Second', command: 'npm start' }, { id: 'b', command: 'npm run dev', dependsOn: ['b', 'a', 'ghost'] }])
  assert.equal(normalized.length, 2)
  assert.equal(normalized[0].name, 'First')
  assert.equal(normalized[1].id, 'b')
  assert.deepEqual(normalized[1].dependsOn, ['a'])
})

test('normalizeRunTasks validates readiness payloads', () => {
  const normalized = normalizeRunTasks([
    { id: 'p', command: 'x', readiness: { strategy: 'port', port: 8080, timeoutMs: 1000 } },
    { id: 'bad-port', command: 'x', readiness: { strategy: 'port' } },
    { id: 'bad-strategy', command: 'x', readiness: { strategy: 'magic' } },
    { id: 'd', command: 'x', readiness: { strategy: 'delay', delayMs: 1500 } },
  ])
  assert.equal(normalized.length, 4)
  assert.deepEqual(normalized[0].readiness, { strategy: 'port', port: 8080, timeoutMs: 1000 })
  assert.equal(normalized[1].readiness, undefined)
  assert.equal(normalized[2].readiness, undefined)
  assert.deepEqual(normalized[3].readiness, { strategy: 'delay', delayMs: 1500 })
})

test('normalizeRunTasks keeps only explicit disabled state and enabled defaults to on', () => {
  const normalized = normalizeRunTasks([
    { id: 'a', command: 'a', enabled: false },
    { id: 'b', command: 'b', enabled: true },
    { id: 'c', command: 'c' },
  ])
  assert.equal(normalized[0].enabled, false)
  assert.equal(normalized[1].enabled, undefined)
  assert.equal(normalized[2].enabled, undefined)
})

test('normalizeRunTasks keeps stopCommand and drops blank values', () => {
  const normalized = normalizeRunTasks([
    { id: 'a', command: 'docker compose up -d', stopCommand: '  docker compose down  ' },
    { id: 'b', command: 'b', stopCommand: '   ' },
    { id: 'c', command: 'c' },
  ])
  assert.equal(normalized[0].stopCommand, 'docker compose down')
  assert.equal(normalized[1].stopCommand, undefined)
  assert.equal(normalized[2].stopCommand, undefined)
})

test('normalizeRunTasks keeps primaryUrl only when explicitly true', () => {
  const normalized = normalizeRunTasks([
    { id: 'a', command: 'a', primaryUrl: true },
    { id: 'b', command: 'b', primaryUrl: false },
    { id: 'c', command: 'c' },
  ])
  assert.equal(normalized[0].primaryUrl, true)
  assert.equal(normalized[1].primaryUrl, undefined)
  assert.equal(normalized[2].primaryUrl, undefined)
})

test('normalizeScanDirectories keeps relative escape-free paths only', () => {
  assert.deepEqual(normalizeScanDirectories(['services/api', 'tools\\cli', '', '.', '..', '/abs/path', 'C:\\temp', 'a/../../b', 'x/', 'services/api']), ['services/api', 'tools/cli', 'x'])
  assert.deepEqual(normalizeScanDirectories('nope'), [])
  assert.deepEqual(normalizeScanDirectories(undefined), [])
})

// ── getEffectiveRunTasks ─────────────────────────────────

test('getEffectiveRunTasks uses the config file when present', () => {
  const config = { version: 1, tasks: [{ id: 'web', name: 'Web', command: 'npm run dev' }] }
  const result = getEffectiveRunTasks({ command: 'npm start' }, config)
  assert.equal(result.fromConfig, true)
  assert.equal(result.tasks.length, 1)
  assert.equal(result.tasks[0].task.id, 'web')
})

test('getEffectiveRunTasks synthesizes a default task from legacy fields', () => {
  const result = getEffectiveRunTasks({ command: 'npm start', customCommand: 'pnpm dev', runWorkingDirectory: 'apps/web' }, null)
  assert.equal(result.fromConfig, false)
  assert.equal(result.tasks.length, 1)
  assert.deepEqual(result.tasks[0].task, {
    id: 'default',
    name: 'default',
    command: 'pnpm dev',
    cwd: 'apps/web',
    isDefault: true,
  })
})

test('getEffectiveRunTasks returns no tasks for a bare project', () => {
  const result = getEffectiveRunTasks({}, null)
  assert.deepEqual(result.tasks, [])
})

// ── RunTaskConfigStore ───────────────────────────────────

test('RunTaskConfigStore round-trips and reports missing files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ywb-config-'))
  try {
    const store = new RunTaskConfigStore()
    assert.deepEqual(store.readConfig(dir), { config: null })

    const tasks = [
      { id: 'docker', name: 'Docker', command: 'docker compose up -d', readiness: { strategy: 'exit' } },
      { id: 'web', name: 'Web', command: 'npm run dev', dependsOn: ['docker'], readiness: { strategy: 'url' } },
    ]
    const written = store.writeConfig(dir, tasks, ['services/api', 'tools/cli'])
    assert.equal(written.config.version, 1)
    assert.equal(written.config.tasks.length, 2)
    assert.deepEqual(written.config.scanDirectories, ['services/api', 'tools/cli'])

    const read = store.readConfig(dir)
    assert.deepEqual(read.config.tasks, tasks)
    assert.deepEqual(read.config.scanDirectories, ['services/api', 'tools/cli'])
    assert.equal(typeof read.config.updatedAt, 'number')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('RunTaskConfigStore reads the legacy root .yworkbench.json as fallback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ywb-config-'))
  try {
    const store = new RunTaskConfigStore()
    const legacy = { version: 1, tasks: [{ id: 'web', name: 'Web', command: 'npm run dev' }] }
    writeFileSync(join(dir, '.yworkbench.json'), JSON.stringify(legacy), 'utf8')

    const read = store.readConfig(dir)
    assert.equal(read.config.tasks.length, 1)
    assert.equal(read.config.tasks[0].id, 'web')

    // Writing migrates the config into .yworkbench/run-tasks.json without
    // touching the legacy file.
    store.writeConfig(dir, legacy.tasks)
    assert.ok(mkdirExists(join(dir, '.yworkbench', 'run-tasks.json')))
    assert.equal(JSON.parse(readFileSync(join(dir, '.yworkbench', 'run-tasks.json'), 'utf8')).tasks.length, 1)
    assert.ok(readFileSync(join(dir, '.yworkbench.json'), 'utf8').length > 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function mkdirExists(target) {
  try {
    return statSync(target).isFile()
  } catch {
    return false
  }
}

test('RunTaskConfigStore tolerates corrupted files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ywb-config-'))
  try {
    mkdirSync(join(dir, '.yworkbench'), { recursive: true })
    writeFileSync(join(dir, '.yworkbench', 'run-tasks.json'), '{ not json', 'utf8')
    const store = new RunTaskConfigStore()
    const result = store.readConfig(dir)
    assert.equal(result.config, null)
    assert.equal(result.error, 'invalid-json')

    writeFileSync(join(dir, '.yworkbench', 'run-tasks.json'), '"just a string"', 'utf8')
    assert.equal(store.readConfig(dir).error, 'invalid-structure')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('RunTaskConfigStore rejects cyclic graphs and empty task lists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ywb-config-'))
  try {
    const store = new RunTaskConfigStore()
    assert.throws(() => store.writeConfig(dir, []))
    assert.throws(() =>
      store.writeConfig(dir, [
        { id: 'a', name: 'A', command: 'a', dependsOn: ['b'] },
        { id: 'b', name: 'B', command: 'b', dependsOn: ['a'] },
      ]),
    )
    // Corrupted file must remain untouched after a failed write.
    assert.equal(store.readConfig(dir).config, null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── run task URL helpers ─────────────────────────────────

test('getRunTaskStateUrls prefers urls and falls back to the legacy url field', () => {
  assert.deepEqual(getRunTaskStateUrls(undefined), [])
  assert.deepEqual(getRunTaskStateUrls({ state: 'ready', url: 'http://localhost:3000' }), ['http://localhost:3000'])
  assert.deepEqual(getRunTaskStateUrls({ state: 'ready', url: 'http://localhost:3000', urls: ['http://localhost:3000', 'http://localhost:5173'] }), ['http://localhost:3000', 'http://localhost:5173'])
  assert.deepEqual(getRunTaskStateUrls({ state: 'stopped' }), [])
})

test('getActiveRunTaskUrls flattens multi-URL tasks with the primary link first', () => {
  const config = {
    version: 1,
    tasks: [
      { id: 'web', name: 'Web', command: 'npm run dev', primaryUrl: true },
      { id: 'api', name: 'API', command: 'npm run dev' },
    ],
  }
  const states = {
    api: { state: 'ready', url: 'http://localhost:4000', urls: ['http://localhost:4000', 'http://localhost:4001'] },
    web: { state: 'running', url: 'http://localhost:3000', urls: ['http://localhost:3000', 'http://localhost:3001'] },
    docker: { state: 'ready' },
    stopped: { state: 'stopped', url: 'http://localhost:9999', urls: ['http://localhost:9999'] },
  }
  assert.deepEqual(getActiveRunTaskUrls(config, states), ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:4000', 'http://localhost:4001'])
  assert.equal(getPrimaryRunTaskUrl(config, states), 'http://localhost:3000')
})

test('getActiveRunTaskUrls leads with the primary URL even when collected later', () => {
  const config = {
    version: 1,
    tasks: [{ id: 'web', name: 'Web', command: 'pnpm run dev', primaryUrl: true }],
  }
  const states = {
    web: { state: 'ready', url: 'http://localhost:5173', urls: ['http://192.168.1.5:5173', 'http://localhost:5173'] },
  }
  assert.deepEqual(getActiveRunTaskUrls(config, states), ['http://localhost:5173', 'http://192.168.1.5:5173'])
})

test('isPrimaryRunTaskUrlPending holds while the primary task is alive without a URL', () => {
  const config = {
    version: 1,
    tasks: [
      { id: 'web', name: 'Web', command: 'pnpm run dev', primaryUrl: true },
      { id: 'api', name: 'API', command: 'npm run dev' },
    ],
  }

  // Not started yet / ramping — pending.
  assert.equal(isPrimaryRunTaskUrlPending(config, undefined), true)
  assert.equal(isPrimaryRunTaskUrlPending(config, { web: { state: 'waiting' }, api: { state: 'ready', url: 'http://localhost:4000' } }), true)
  assert.equal(isPrimaryRunTaskUrlPending(config, { web: { state: 'starting' } }), true)
  // Session carry flips starting to running without a URL — still pending.
  assert.equal(isPrimaryRunTaskUrlPending(config, { web: { state: 'running' }, api: { state: 'ready', url: 'http://localhost:4000' } }), true)

  // Published — released.
  assert.equal(isPrimaryRunTaskUrlPending(config, { web: { state: 'ready', url: 'http://localhost:5173' } }), false)
  // Settled — stop waiting (task will never publish).
  assert.equal(isPrimaryRunTaskUrlPending(config, { web: { state: 'failed', error: 'x' } }), false)
  assert.equal(isPrimaryRunTaskUrlPending(config, { web: { state: 'stopped' } }), false)
  // No primaryUrl task — never pending.
  assert.equal(isPrimaryRunTaskUrlPending(null, undefined), false)
  assert.equal(isPrimaryRunTaskUrlPending({ version: 1, tasks: [{ id: 'a', name: 'A', command: 'a' }] }, undefined), false)
})

test('getActiveRunTaskUrls falls back to the legacy single url field', () => {
  const states = {
    a: { state: 'ready', url: 'http://localhost:3000' },
    b: { state: 'running', url: 'http://localhost:4000' },
  }
  assert.deepEqual(getActiveRunTaskUrls(null, states), ['http://localhost:3000', 'http://localhost:4000'])
})

// ── detectRunTaskCandidates ──────────────────────────────

function makeProjectTree() {
  const dir = mkdtempSync(join(tmpdir(), 'ywb-detect-'))
  // Root package.json: dev/test scripts; only dev passes the whitelist.
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'root', scripts: { dev: 'vite', test: 'vitest', postinstall: 'patch' } }), 'utf8')
  // pnpm workspace with one sub package exposing a dev script.
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n', 'utf8')
  mkdirSync(join(dir, 'apps', 'web'), { recursive: true })
  writeFileSync(join(dir, 'apps', 'web', 'package.json'), JSON.stringify({ name: 'web', scripts: { dev: 'next dev' } }), 'utf8')
  mkdirSync(join(dir, 'apps', 'edge'), { recursive: true })
  // No dev script in apps/edge — must not produce a candidate.
  writeFileSync(join(dir, 'apps', 'edge', 'package.json'), JSON.stringify({ name: 'edge', scripts: { build: 'x' } }), 'utf8')
  // docker-compose with two services.
  writeFileSync(join(dir, 'docker-compose.yml'), 'services:\n  api:\n    image: api\n  db:\n    image: postgres\n', 'utf8')
  // Python sub project in a conventional directory.
  mkdirSync(join(dir, 'server', 'pysvc'), { recursive: true })
  writeFileSync(join(dir, 'server', 'pysvc', 'requirements.txt'), 'flask\n', 'utf8')
  writeFileSync(join(dir, 'server', 'pysvc', 'main.py'), 'print(1)\n', 'utf8')
  // Ignored directory must not leak candidates.
  mkdirSync(join(dir, 'node_modules', 'leak'), { recursive: true })
  writeFileSync(join(dir, 'node_modules', 'leak', 'package.json'), JSON.stringify({ name: 'leak', scripts: { dev: 'x' } }), 'utf8')
  return dir
}

test('detectRunTaskCandidates scans all four sources with dedupe', () => {
  const dir = makeProjectTree()
  try {
    const candidates = detectRunTaskCandidates(dir)

    const byLabel = new Map(candidates.map((candidate) => [candidate.key, candidate]))

    // Root package script (whitelist keeps dev, drops test/postinstall).
    // The pnpm-workspace.yaml at the root implies the pnpm runner.
    const rootScript = candidates.find((c) => c.key === 'package-script::::pnpm run dev')
    assert.ok(rootScript, 'root dev script candidate missing')
    assert.equal(rootScript.source, 'package-script')
    assert.equal(rootScript.command, 'pnpm run dev')
    assert.equal(byLabel.get('package-script::::npm run dev'), undefined)

    // Workspace candidate for apps/web (same command as a package-script candidate
    // would produce — workspace wins and the package-script duplicate is dropped).
    const workspace = candidates.find((c) => c.source === 'workspace')
    assert.ok(workspace, 'workspace candidate missing')
    assert.equal(workspace.cwd, 'apps/web')
    assert.equal(workspace.command, 'pnpm run dev')
    assert.equal(
      candidates.find((c) => c.source === 'package-script' && c.cwd === 'apps/web'),
      undefined,
    )

    // docker-compose: one candidate per service plus the whole group.
    const compose = candidates.filter((c) => c.source === 'docker-compose')
    assert.deepEqual(compose.map((c) => c.command).sort(), ['docker compose up -d', 'docker compose up -d api', 'docker compose up -d db'])
    assert.ok(compose.every((c) => c.suggestedReadiness.strategy === 'exit'))

    // Python candidate from a conventional directory.
    const python = candidates.find((c) => c.source === 'common-dir' && c.command === 'python main.py')
    assert.ok(python, 'python candidate missing')
    assert.equal(python.cwd, 'server/pysvc')

    // Nothing leaks from node_modules.
    assert.ok(candidates.every((c) => !(c.cwd ?? '').includes('node_modules')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('detectRunTaskCandidates prefers pnpm/yarn runners from lockfiles', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ywb-detect-'))
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }), 'utf8')
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '', 'utf8')
    const candidates = detectRunTaskCandidates(dir)
    assert.equal(candidates[0].command, 'pnpm run dev')

    rmSync(join(dir, 'pnpm-lock.yaml'))
    writeFileSync(join(dir, 'yarn.lock'), '', 'utf8')
    const yarnCandidates = detectRunTaskCandidates(dir)
    assert.equal(yarnCandidates[0].command, 'yarn dev')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('detectRunTaskCandidates returns empty for missing or invalid projects', () => {
  assert.deepEqual(detectRunTaskCandidates(join(tmpdir(), 'ywb-missing-does-not-exist')), [])
  const dir = mkdtempSync(join(tmpdir(), 'ywb-detect-'))
  try {
    writeFileSync(join(dir, 'package.json'), '{ broken', 'utf8')
    assert.deepEqual(detectRunTaskCandidates(dir), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('detectRunTaskCandidates probes user-selected scan directories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ywb-detect-'))
  try {
    // A sub-project outside the conventional directory names and workspace globs.
    mkdirSync(join(dir, 'tools', 'cli'), { recursive: true })
    writeFileSync(join(dir, 'tools', 'cli', 'package.json'), JSON.stringify({ name: 'cli', scripts: { dev: 'tsx watch' } }), 'utf8')

    // Not found without extra scan directories.
    assert.ok(!detectRunTaskCandidates(dir).some((c) => c.cwd === 'tools/cli'))

    // Found once the user selects the directory.
    const found = detectRunTaskCandidates(dir, ['tools/cli'])
    const candidate = found.find((c) => c.cwd === 'tools/cli')
    assert.ok(candidate, 'scan-directory candidate missing')
    assert.equal(candidate.command, 'npm run dev')

    // Escaping paths are ignored.
    const escaped = detectRunTaskCandidates(dir, ['../outside', '/abs/path'])
    assert.ok(escaped.every((c) => !(c.cwd ?? '').includes('..')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
