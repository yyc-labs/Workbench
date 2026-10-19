import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { buildTerminalCollectionModel, resolveTerminalCollectionWake } = loadTsModule('src/core/renderer/lib/terminalCollectionModel.ts')

function snapshot(processId, startTime = 1) {
  return { processId, projectId: processId.split('::')[0], backend: 'host', pid: null, startTime }
}

test('groups terminals by project and sorts route project first', () => {
  const model = buildTerminalCollectionModel({
    inventory: [snapshot('beta'), snapshot('alpha::float::0', 2)],
    projects: [
      { id: 'alpha', path: '/alpha', name: 'Alpha', type: 'unknown', command: '', lastOpened: 100 },
      { id: 'beta', path: '/beta', name: 'Beta', type: 'unknown', command: '', lastOpened: 200 },
    ],
    routeProjectId: 'alpha',
  })
  assert.deepEqual(
    model.groups.map((group) => group.projectId),
    ['alpha', 'beta'],
  )
  assert.equal(model.activeProjectId, 'alpha')
  assert.equal(model.groups[0].terminals[0].title, 'Alpha')
})

test('route project appears even without terminals; falls back to first group otherwise', () => {
  const model = buildTerminalCollectionModel({
    inventory: [snapshot('alpha::float::0')],
    projects: [{ id: 'alpha', path: '/alpha', name: 'Alpha', type: 'unknown', command: '', lastOpened: 100 }],
    routeProjectId: 'ghost',
  })
  assert.deepEqual(
    model.groups.map((group) => group.projectId),
    ['ghost', 'alpha'],
  )
  assert.equal(model.activeProjectId, 'ghost')
  assert.equal(model.groups[0].terminals.length, 0)

  const noRoute = buildTerminalCollectionModel({
    inventory: [snapshot('alpha::float::0')],
    projects: [{ id: 'alpha', path: '/alpha', name: 'Alpha', type: 'unknown', command: '', lastOpened: 100 }],
  })
  assert.equal(noRoute.activeProjectId, 'alpha')
})

test('toolbox hidden by default and shown when requested', () => {
  const inventory = [snapshot('alpha'), snapshot('alpha::toolbox')]
  const projects = [{ id: 'alpha', path: '/alpha', name: 'Alpha', type: 'unknown', command: '' }]
  const hidden = buildTerminalCollectionModel({ inventory, projects })
  assert.equal(hidden.groups[0].terminals.length, 1)

  const shown = buildTerminalCollectionModel({ inventory, projects, showToolbox: true })
  assert.equal(shown.groups[0].terminals.length, 2)
})

test('title override wins and run task name applies', () => {
  const model = buildTerminalCollectionModel({
    inventory: [snapshot('alpha::float::0'), snapshot('alpha::run::build')],
    projects: [{ id: 'alpha', path: '/alpha', name: 'Alpha', type: 'unknown', command: '' }],
    runTaskConfigs: { alpha: { tasks: [{ id: 'build', name: 'Build', command: 'echo' }] } },
    runTaskStates: { alpha: { build: { state: 'running' } } },
    processes: { 'alpha::float::0': { status: 'stopped' } },
    titles: { alpha: { 'alpha::float::0': '我的终端' } },
  })
  const titles = model.groups[0].terminals.map((terminal) => terminal.title)
  // kind 排序：run → primary → float。
  assert.deepEqual(titles, ['Build', '我的终端'])
  assert.equal(model.groups[0].runningCount, 1)
})

test('duplicate float titles get ordinal suffix', () => {
  const model = buildTerminalCollectionModel({
    inventory: [snapshot('alpha::float::0'), snapshot('alpha::float::1'), snapshot('alpha')],
    projects: [{ id: 'alpha', path: '/alpha', name: 'Alpha', type: 'unknown', command: '' }],
  })
  const titles = model.groups[0].terminals.map((terminal) => terminal.title)
  // primary 与两个 float 默认同名「Alpha」→ 依次追加序号。
  assert.deepEqual(titles, ['Alpha', 'Alpha 2', 'Alpha 3'])
})

test('run task status comes from task state, others from processes', () => {
  const model = buildTerminalCollectionModel({
    inventory: [snapshot('alpha'), snapshot('alpha::run::build')],
    projects: [{ id: 'alpha', path: '/alpha', name: 'Alpha', type: 'unknown', command: '' }],
    runTaskStates: { alpha: { build: { state: 'failed', warning: 'boom', url: 'http://localhost:3000' } } },
    processes: { alpha: { status: 'running' } },
  })
  // kind 排序：run → primary。
  const [run, primary] = model.groups[0].terminals
  assert.equal(run.status, 'failed')
  assert.equal(run.warning, 'boom')
  assert.equal(run.url, 'http://localhost:3000')
  assert.equal(primary.status, 'running')
  assert.equal(model.groups[0].runningCount, 1)
})

test('unparsable keys are dropped; empty input yields empty model', () => {
  const model = buildTerminalCollectionModel({ inventory: [snapshot('::weird::key')], projects: [] })
  assert.deepEqual(model.groups, [])
  assert.equal(model.activeProjectId, null)
})

test('pending terminals appear immediately as starting placeholders', () => {
  const model = buildTerminalCollectionModel({
    inventory: [],
    projects: [{ id: 'alpha', path: '/alpha', name: 'Alpha', type: 'unknown', command: '' }],
    pendingTerminals: [{ processKey: 'alpha::float::0', projectId: 'alpha', title: 'Alpha' }],
  })
  assert.equal(model.groups.length, 1)
  assert.equal(model.groups[0].terminals.length, 1)
  assert.equal(model.groups[0].terminals[0].status, 'starting')
  // starting 不计入运行数。
  assert.equal(model.groups[0].runningCount, 0)
})

test('pending placeholder is dropped once the inventory catches up, and sorts last', () => {
  const model = buildTerminalCollectionModel({
    inventory: [snapshot('alpha'), snapshot('alpha::float::0')],
    projects: [{ id: 'alpha', path: '/alpha', name: 'Alpha', type: 'unknown', command: '' }],
    pendingTerminals: [{ processKey: 'alpha::float::0', projectId: 'alpha', title: 'Alpha' }],
  })
  assert.equal(model.groups[0].terminals.length, 2)

  const stillPending = buildTerminalCollectionModel({
    inventory: [snapshot('alpha')],
    projects: [{ id: 'alpha', path: '/alpha', name: 'Alpha', type: 'unknown', command: '' }],
    pendingTerminals: [{ processKey: 'alpha::float::5', projectId: 'alpha', title: 'Alpha' }],
  })
  // kind 排序：primary 在前，float 占位排末尾。
  assert.deepEqual(
    stillPending.groups[0].terminals.map((terminal) => [terminal.kind, terminal.status]),
    [
      ['primary', 'running'],
      ['float', 'starting'],
    ],
  )
})

// ── Ctrl+J 唤醒决策（2026-10-18 用户规则） ────────────────────────────────

function wakeInput(overrides = {}) {
  return {
    contextProjectId: null,
    activeProjectId: null,
    recentProjectIds: [],
    pendingProjectIds: [],
    inventoryProcessIds: [],
    ...overrides,
  }
}

test('wake: non-project route with any existing session never creates a terminal', () => {
  // 非项目路由，别的项目有会话、目标项目没有 → 只唤醒，不新建。
  const decision = resolveTerminalCollectionWake(
    wakeInput({
      activeProjectId: 'beta',
      recentProjectIds: ['alpha', 'beta'],
      inventoryProcessIds: ['beta::float::0'],
    }),
  )
  assert.deepEqual(decision, { action: 'wake', projectId: 'beta' })
})

test('wake: non-project route prefers the active project, else most recent project with sessions', () => {
  // 上次激活项目没有会话 → 落到最近打开的有会话项目。
  const decision = resolveTerminalCollectionWake(
    wakeInput({
      activeProjectId: 'alpha',
      recentProjectIds: ['alpha', 'beta', 'gamma'],
      inventoryProcessIds: ['gamma::float::0'],
    }),
  )
  assert.deepEqual(decision, { action: 'wake', projectId: 'gamma' })
})

test('wake: non-project route without any session creates one (last active ?? most recent)', () => {
  assert.deepEqual(resolveTerminalCollectionWake(wakeInput({ activeProjectId: 'beta', recentProjectIds: ['alpha', 'beta'] })), { action: 'create', projectId: 'beta' })
  assert.deepEqual(resolveTerminalCollectionWake(wakeInput({ recentProjectIds: ['alpha', 'beta'] })), { action: 'create', projectId: 'alpha' })
  assert.deepEqual(resolveTerminalCollectionWake(wakeInput()), { action: 'none' })
})

test('wake: project route creates a terminal when that project has none', () => {
  // 项目路由保持原语义：该项目没有终端就直接新建，保证项目内 Ctrl+J 可见。
  const decision = resolveTerminalCollectionWake(
    wakeInput({
      contextProjectId: 'alpha',
      recentProjectIds: ['alpha', 'beta'],
      inventoryProcessIds: ['beta::float::0'],
    }),
  )
  assert.deepEqual(decision, { action: 'create', projectId: 'alpha' })
})

test('wake: project route with sessions wakes that project; toolbox-only counts as no session', () => {
  assert.deepEqual(resolveTerminalCollectionWake(wakeInput({ contextProjectId: 'alpha', inventoryProcessIds: ['alpha::float::0'] })), { action: 'wake', projectId: 'alpha' })
  // toolbox 只读：不算会话，项目路由仍新建。
  assert.deepEqual(resolveTerminalCollectionWake(wakeInput({ contextProjectId: 'alpha', inventoryProcessIds: ['alpha::toolbox'] })), { action: 'create', projectId: 'alpha' })
  // 非项目路由只有 toolbox → 视为无会话。
  assert.deepEqual(resolveTerminalCollectionWake(wakeInput({ recentProjectIds: ['alpha'], inventoryProcessIds: ['alpha::toolbox'] })), { action: 'create', projectId: 'alpha' })
})

test('wake: pending placeholders count as sessions in non-project routes', () => {
  const decision = resolveTerminalCollectionWake(
    wakeInput({
      recentProjectIds: ['alpha', 'beta'],
      pendingProjectIds: ['beta'],
    }),
  )
  assert.deepEqual(decision, { action: 'wake', projectId: 'beta' })
})
