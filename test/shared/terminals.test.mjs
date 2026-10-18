import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { parseTerminalProcessKey, resolveTerminalTabTitle, sortProjectsByRecency, matchProjectQuery } = loadTsModule('src/core/shared/terminals.ts')
const { parseRunTaskProcessKey, runTaskProcessKey } = loadTsModule('src/core/shared/runTasks.ts')

// ── parseTerminalProcessKey ─────────────────────────────

test('parseTerminalProcessKey parses primary (bare projectId)', () => {
  assert.deepEqual(parseTerminalProcessKey('proj-1'), { projectId: 'proj-1', kind: 'primary' })
  assert.deepEqual(parseTerminalProcessKey('my.project-2'), { projectId: 'my.project-2', kind: 'primary' })
})

test('parseTerminalProcessKey parses toolbox', () => {
  assert.deepEqual(parseTerminalProcessKey('proj-1::toolbox'), { projectId: 'proj-1', kind: 'toolbox' })
})

test('parseTerminalProcessKey parses run keys with special taskId', () => {
  assert.deepEqual(parseTerminalProcessKey('proj-1::run::backend'), { projectId: 'proj-1', kind: 'run', token: 'backend' })
  assert.deepEqual(parseTerminalProcessKey('proj-1::run::dev:server'), { projectId: 'proj-1', kind: 'run', token: 'dev:server' })
  assert.deepEqual(parseTerminalProcessKey('proj-1::run::default'), { projectId: 'proj-1', kind: 'run', token: 'default' })
})

test('parseTerminalProcessKey parses script and float ordinals', () => {
  assert.deepEqual(parseTerminalProcessKey('proj-1::script::0'), { projectId: 'proj-1', kind: 'script', token: '0' })
  assert.deepEqual(parseTerminalProcessKey('proj-1::script::12'), { projectId: 'proj-1', kind: 'script', token: '12' })
  assert.deepEqual(parseTerminalProcessKey('proj-1::float::1'), { projectId: 'proj-1', kind: 'float', token: '1' })
  assert.deepEqual(parseTerminalProcessKey('proj-1::float::7'), { projectId: 'proj-1', kind: 'float', token: '7' })
})

test('parseTerminalProcessKey rejects malformed keys', () => {
  assert.equal(parseTerminalProcessKey(''), null)
  assert.equal(parseTerminalProcessKey('::float::1'), null)
  assert.equal(parseTerminalProcessKey('p::run::'), null)
  assert.equal(parseTerminalProcessKey('p::script::abc'), null)
  assert.equal(parseTerminalProcessKey('p::float::'), null)
  assert.equal(parseTerminalProcessKey('p::unknown::1'), null)
  assert.equal(parseTerminalProcessKey('::toolbox'), null)
})

test('parseTerminalProcessKey run branch agrees with parseRunTaskProcessKey', () => {
  const key = runTaskProcessKey('proj-1', 'dev:server')
  const runParsed = parseRunTaskProcessKey(key)
  const parsed = parseTerminalProcessKey(key)
  assert.equal(parsed.kind, 'run')
  assert.equal(parsed.projectId, runParsed.projectId)
  assert.equal(parsed.token, runParsed.taskId)
})

// ── resolveTerminalTabTitle ─────────────────────────────

test('resolveTerminalTabTitle: override wins over everything', () => {
  const title = resolveTerminalTabTitle({
    kind: 'float',
    projectName: 'My App',
    instanceTitle: 'My App',
    override: '  Renamed  ',
    ordinalLabel: 'Terminal #1',
  })
  assert.equal(title, 'Renamed')
})

test('resolveTerminalTabTitle: float falls to instanceTitle, then projectName', () => {
  assert.equal(resolveTerminalTabTitle({ kind: 'float', projectName: 'My App', instanceTitle: '  Shell  ', ordinalLabel: 'Terminal #1' }), 'Shell')
  assert.equal(resolveTerminalTabTitle({ kind: 'float', projectName: 'My App', instanceTitle: '   ', ordinalLabel: 'Terminal #1' }), 'My App')
  assert.equal(resolveTerminalTabTitle({ kind: 'float', projectName: null, ordinalLabel: 'Terminal #2' }), 'Terminal #2')
})

test('resolveTerminalTabTitle: run falls taskName -> taskId -> projectName -> ordinalLabel', () => {
  assert.equal(resolveTerminalTabTitle({ kind: 'run', projectName: 'My App', taskName: 'Backend', taskId: 'backend', ordinalLabel: 'Terminal #1' }), 'Backend')
  assert.equal(resolveTerminalTabTitle({ kind: 'run', projectName: 'My App', taskName: '  ', taskId: 'backend', ordinalLabel: 'Terminal #1' }), 'backend')
  assert.equal(resolveTerminalTabTitle({ kind: 'run', projectName: 'My App', ordinalLabel: 'Terminal #1' }), 'My App')
  assert.equal(resolveTerminalTabTitle({ kind: 'run', projectName: null, ordinalLabel: 'Terminal #1' }), 'Terminal #1')
})

test('resolveTerminalTabTitle: script never uses projectName', () => {
  assert.equal(resolveTerminalTabTitle({ kind: 'script', projectName: 'My App', ordinalLabel: 'Script #3' }), 'Script #3')
})

test('resolveTerminalTabTitle: primary uses projectName then ordinalLabel', () => {
  assert.equal(resolveTerminalTabTitle({ kind: 'primary', projectName: 'My App', ordinalLabel: 'Terminal #1' }), 'My App')
  assert.equal(resolveTerminalTabTitle({ kind: 'primary', projectName: null, ordinalLabel: 'Terminal #1' }), 'Terminal #1')
})

// ── sortProjectsByRecency ───────────────────────────────

test('sortProjectsByRecency sorts by lastOpened desc, missing last', () => {
  const input = [{ id: 'a', lastOpened: 100 }, { id: 'b' }, { id: 'c', lastOpened: 300 }, { id: 'd', lastOpened: 200 }]
  const sorted = sortProjectsByRecency(input)
  assert.deepEqual(
    sorted.map((p) => p.id),
    ['c', 'd', 'a', 'b'],
  )
})

test('sortProjectsByRecency keeps stable order for equal values', () => {
  const input = [
    { id: 'a', lastOpened: 100 },
    { id: 'b', lastOpened: 100 },
    { id: 'c', lastOpened: 100 },
  ]
  const sorted = sortProjectsByRecency(input)
  assert.deepEqual(
    sorted.map((p) => p.id),
    ['a', 'b', 'c'],
  )
})

test('sortProjectsByRecency does not mutate input', () => {
  const input = [
    { id: 'a', lastOpened: 100 },
    { id: 'b', lastOpened: 300 },
  ]
  const snapshot = [...input]
  const sorted = sortProjectsByRecency(input)
  assert.notEqual(sorted, input)
  assert.deepEqual(input, snapshot)
})

// ── matchProjectQuery ───────────────────────────────────

test('matchProjectQuery: empty query matches all', () => {
  assert.equal(matchProjectQuery({ name: 'App', path: 'D:/x/app' }, ''), true)
  assert.equal(matchProjectQuery({ name: 'App', path: 'D:/x/app' }, '   '), true)
})

test('matchProjectQuery matches name/customName/path case-insensitively', () => {
  const project = { name: 'ide-electron', customName: 'Workbench', path: 'D:/Tools/ide-electron' }
  assert.equal(matchProjectQuery(project, 'IDE'), true)
  assert.equal(matchProjectQuery(project, 'work'), true)
  assert.equal(matchProjectQuery(project, 'tools'), true)
  assert.equal(matchProjectQuery(project, 'nomatch'), false)
})
