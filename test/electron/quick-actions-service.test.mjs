import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { createQuickActionService } = loadTsModule('src/core/electron/main/quick-actions/quickActionService.ts')

const PROJECT_PATH = 'D:/repos/app'

function setup(overrides = {}) {
  let stored = { actions: [] }
  let uuidCounter = 0
  const navigations = []
  const windowVisibleCalls = []
  const openedPaths = []
  const openedUrls = []
  const createdShortcuts = []
  const removedShortcuts = []

  const runTaskService = {
    startCalls: [],
    startAllCalls: [],
    config: {
      config: {
        version: 1,
        tasks: [
          { id: 'web', name: 'web', command: 'npm run dev' },
          { id: 'api', name: 'api', command: 'npm run api' },
        ],
      },
    },
    getConfig(projectPath) {
      return overrides.configError ? { config: null, error: 'invalid-json' } : this.config
    },
    async start(projectId, projectPath, task) {
      this.startCalls.push({ projectId, projectPath, task })
      return true
    },
    async startAll(projectId, projectPath, config) {
      this.startAllCalls.push({ projectId, projectPath, config })
      return overrides.startAllResult ?? { started: true }
    },
  }

  const desktopShortcuts = overrides.desktopShortcutsDisabled
    ? undefined
    : {
        createShortcutLink: async (action) => {
          createdShortcuts.push(action.id)
          return `C:/Users/me/Desktop/${action.name}.lnk`
        },
        removeShortcutLink: async (shortcutPath) => {
          removedShortcuts.push(shortcutPath)
          return true
        },
        checkShortcutState: (shortcutPath, exePath) => overrides.shortcutState ?? 'valid',
      }

  const service = createQuickActionService({
    loadConfig: () => ({ quickActions: stored }),
    updateConfig: async (partial) => {
      stored = partial.quickActions
      return { quickActions: stored }
    },
    getRunTaskService: () => (overrides.runTaskServiceNull ? null : runTaskService),
    validateProjectPath: (projectPath) => projectPath === PROJECT_PATH,
    navigateMainWindow: (pathname) => navigations.push(pathname),
    ensureWindowVisible: () => windowVisibleCalls.push(true),
    hasMainWindow: () => overrides.hasMainWindow ?? true,
    openPath: async (target) => {
      openedPaths.push(target)
      return overrides.openPathError ?? ''
    },
    openExternal: async (url) => {
      openedUrls.push(url)
      if (overrides.openExternalError) throw overrides.openExternalError
    },
    randomUUID: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`,
    isWorkday: () => true,
    now: () => new Date(2026, 0, 15, 12, 0, 0),
    ...(desktopShortcuts ? { desktopShortcuts } : {}),
  })

  return { service, navigations, windowVisibleCalls, openedPaths, openedUrls, runTaskService, createdShortcuts, removedShortcuts, getStored: () => stored }
}

test('create appends to the group end, derives icon/group and persists', async () => {
  const { service, getStored } = setup()
  const created = await service.create({ name: 'Open app', action: { type: 'open-project', projectPath: PROJECT_PATH } })
  assert.equal(created.id, '00000000-0000-4000-8000-000000000001')
  assert.equal(created.icon, 'folder-open')
  assert.equal(created.group, 'project')
  assert.equal(created.order, 0)
  assert.equal(created.enabled, true)
  assert.equal(getStored().actions.length, 1)

  const second = await service.create({ name: 'Open app 2', action: { type: 'open-project', projectPath: PROJECT_PATH } })
  assert.equal(second.order, 1)
  assert.equal(getStored().actions.length, 2)
})

test('update patches fields and replaces the spec; unknown id throws', async () => {
  const { service } = setup()
  const created = await service.create({ name: 'Task', action: { type: 'run-task', projectPath: PROJECT_PATH } })
  const updated = await service.update(created.id, { name: 'Renamed', enabled: false, action: { type: 'run-task', projectPath: PROJECT_PATH, taskId: 'web' } })
  assert.equal(updated.name, 'Renamed')
  assert.equal(updated.enabled, false)
  assert.deepEqual(updated.action, { type: 'run-task', projectPath: PROJECT_PATH, taskId: 'web' })
  assert.ok(updated.updatedAt >= created.updatedAt)
  await assert.rejects(() => service.update('missing-id', { name: 'x' }))
})

test('delete removes the entry and returns false for unknown ids', async () => {
  const { service } = setup()
  const created = await service.create({ name: 'Open app', action: { type: 'open-project', projectPath: PROJECT_PATH } })
  assert.equal(await service.delete(created.id), true)
  assert.equal(await service.delete(created.id), false)
})

test('list reports the placeholder shortcut state', async () => {
  const { service } = setup()
  await service.create({ name: 'Open app', action: { type: 'open-project', projectPath: PROJECT_PATH } })
  const list = service.list()
  assert.equal(list.length, 1)
  assert.equal(list[0].shortcutState, 'none')
})

test('execute by id validates existence and enabled flag', async () => {
  const { service, navigations } = setup()
  const created = await service.create({ name: 'Open app', action: { type: 'open-project', projectPath: PROJECT_PATH } })
  assert.deepEqual(await service.execute({ id: 'missing' }), { ok: false, code: 'not-found' })

  await service.update(created.id, { enabled: false })
  assert.deepEqual(await service.execute({ id: created.id }), { ok: false, code: 'disabled' })

  await service.update(created.id, { enabled: true })
  assert.deepEqual(await service.execute({ id: created.id }), { ok: true, kind: 'navigated' })
  assert.deepEqual(navigations, [`/project/${'p' + Math.abs(hashOf(PROJECT_PATH)).toString(36)}/code`])
})

test('execute open-project navigates to the project code pane and focuses the window', async () => {
  const { service, navigations, windowVisibleCalls } = setup()
  await service.execute({ spec: { type: 'open-project', projectPath: PROJECT_PATH } })
  assert.equal(navigations.length, 1)
  assert.match(navigations[0], /^\/project\/p[0-9a-z]+\/code$/)
  assert.deepEqual(windowVisibleCalls, [true])
})

test('execute open-project rejects unknown projects', async () => {
  const { service } = setup()
  assert.deepEqual(await service.execute({ spec: { type: 'open-project', projectPath: 'D:/nope' } }), { ok: false, code: 'invalid-project' })
})

test('execute run-task with taskId starts only that task', async () => {
  const { service, runTaskService } = setup()
  const result = await service.execute({ spec: { type: 'run-task', projectPath: PROJECT_PATH, taskId: 'web' } })
  assert.deepEqual(result, { ok: true, kind: 'task-started', taskIds: ['web'] })
  assert.equal(runTaskService.startCalls.length, 1)
  assert.equal(runTaskService.startCalls[0].projectId, hashIdOf(PROJECT_PATH))
  assert.equal(runTaskService.startAllCalls.length, 0)
})

test('execute run-task without taskId starts all tasks', async () => {
  const { service, runTaskService } = setup()
  const result = await service.execute({ spec: { type: 'run-task', projectPath: PROJECT_PATH } })
  assert.deepEqual(result, { ok: true, kind: 'task-started', taskIds: ['web', 'api'] })
  assert.equal(runTaskService.startAllCalls.length, 1)
  assert.equal(runTaskService.startCalls.length, 0)
})

test('execute run-task reports invalid-task for unknown task ids', async () => {
  const { service } = setup()
  assert.deepEqual(await service.execute({ spec: { type: 'run-task', projectPath: PROJECT_PATH, taskId: 'ghost' } }), { ok: false, code: 'invalid-task' })
})

test('execute run-task surfaces startAll failures and config read errors', async () => {
  const failed = setup({ startAllResult: { started: false, error: 'No run tasks configured.' } })
  const failedResult = await failed.service.execute({ spec: { type: 'run-task', projectPath: PROJECT_PATH } })
  assert.equal(failedResult.ok, false)
  assert.equal(failedResult.code, 'exec-failed')
  assert.match(failedResult.error, /No run tasks configured/)

  const broken = setup({ configError: true })
  const brokenResult = await broken.service.execute({ spec: { type: 'run-task', projectPath: PROJECT_PATH, taskId: 'web' } })
  assert.equal(brokenResult.code, 'exec-failed')

  const noService = setup({ runTaskServiceNull: true })
  const noServiceResult = await noService.service.execute({ spec: { type: 'run-task', projectPath: PROJECT_PATH } })
  assert.equal(noServiceResult.code, 'exec-failed')
})

test('execute open-path opens existing paths and rejects missing ones', async () => {
  const { service, openedPaths } = setup()
  assert.deepEqual(await service.execute({ spec: { type: 'open-path', path: 'C:/Windows' } }), { ok: true, kind: 'opened' })
  assert.deepEqual(openedPaths, ['C:/Windows'])
  assert.deepEqual(await service.execute({ spec: { type: 'open-path', path: 'C:/definitely-missing-path-xyz' } }), { ok: false, code: 'invalid-project' })
})

test('execute open-path surfaces shell.openPath errors', async () => {
  const { service } = setup({ openPathError: 'ENOENT' })
  const result = await service.execute({ spec: { type: 'open-path', path: 'C:/Windows' } })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'exec-failed')
})

test('execute open-url enforces the http/https whitelist', async () => {
  const { service, openedUrls } = setup()
  assert.deepEqual(await service.execute({ spec: { type: 'open-url', url: 'https://example.com' } }), { ok: true, kind: 'opened' })
  assert.deepEqual(openedUrls, ['https://example.com'])
  assert.deepEqual(await service.execute({ spec: { type: 'open-url', url: 'file:///C:/Windows' } }), { ok: false, code: 'invalid-spec' })
  assert.deepEqual(await service.execute({ spec: { type: 'open-url', url: 'not-a-url' } }), { ok: false, code: 'invalid-spec' })
})

test('execute open-url surfaces openExternal failures', async () => {
  const { service } = setup({ openExternalError: new Error('boom') })
  const result = await service.execute({ spec: { type: 'open-url', url: 'https://example.com' } })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'exec-failed')
  assert.match(result.error, /boom/)
})

test('createDesktopShortcut writes the link and persists the path', async () => {
  const { service, createdShortcuts, getStored } = setup()
  const created = await service.create({ name: 'Open app', action: { type: 'open-project', projectPath: PROJECT_PATH } })
  const { shortcutPath } = await service.createDesktopShortcut(created.id)
  assert.equal(shortcutPath, 'C:/Users/me/Desktop/Open app.lnk')
  assert.deepEqual(createdShortcuts, [created.id])
  const stored = getStored().actions.find((item) => item.id === created.id)
  assert.equal(stored.desktopShortcutPath, shortcutPath)
})

test('createDesktopShortcut throws for unknown ids and without the capability', async () => {
  const { service } = setup()
  await assert.rejects(() => service.createDesktopShortcut('missing'), /not found/)

  const noCapability = setup({ desktopShortcutsDisabled: true })
  const created = await noCapability.service.create({ name: 'Open app', action: { type: 'open-project', projectPath: PROJECT_PATH } })
  await assert.rejects(() => noCapability.service.createDesktopShortcut(created.id), /not available/)
})

test('removeDesktopShortcut unlinks the file and clears the stored path', async () => {
  const { service, removedShortcuts, getStored } = setup()
  const created = await service.create({ name: 'Open app', action: { type: 'open-project', projectPath: PROJECT_PATH } })
  await service.createDesktopShortcut(created.id)
  assert.equal(await service.removeDesktopShortcut(created.id), true)
  assert.deepEqual(removedShortcuts, ['C:/Users/me/Desktop/Open app.lnk'])
  assert.equal('desktopShortcutPath' in getStored().actions.find((item) => item.id === created.id), false)
  // Second removal is a no-op.
  assert.equal(await service.removeDesktopShortcut(created.id), false)
})

test('list reports valid/missing shortcut states and none without a path', async () => {
  const { service } = setup({ shortcutState: 'valid' })
  const created = await service.create({ name: 'Open app', action: { type: 'open-project', projectPath: PROJECT_PATH } })
  assert.equal(service.list()[0].shortcutState, 'none')
  await service.createDesktopShortcut(created.id)
  assert.equal(service.list()[0].shortcutState, 'valid')

  const drifted = setup({ shortcutState: 'drifted' })
  const created2 = await drifted.service.create({ name: 'Open app', action: { type: 'open-project', projectPath: PROJECT_PATH } })
  await drifted.service.createDesktopShortcut(created2.id)
  // drifted (relocated install) surfaces as missing so the UI shows the badge.
  assert.equal(drifted.service.list()[0].shortcutState, 'missing')
})

test('repairDesktopShortcuts rebuilds invalid shortcuts and skips valid ones', async () => {
  const broken = setup({ shortcutState: 'missing' })
  const created = await broken.service.create({ name: 'Open app', action: { type: 'open-project', projectPath: PROJECT_PATH } })
  await broken.service.createDesktopShortcut(created.id)
  await broken.service.repairDesktopShortcuts()
  assert.equal(broken.createdShortcuts.length, 2)

  const healthy = setup({ shortcutState: 'valid' })
  const created2 = await healthy.service.create({ name: 'Open app', action: { type: 'open-project', projectPath: PROJECT_PATH } })
  await healthy.service.createDesktopShortcut(created2.id)
  await healthy.service.repairDesktopShortcuts()
  assert.equal(healthy.createdShortcuts.length, 1)
})

test('delete removes a stale shortcut file best-effort', async () => {
  const { service, getStored } = setup()
  const created = await service.create({ name: 'Open app', action: { type: 'open-project', projectPath: PROJECT_PATH } })
  await service.createDesktopShortcut(created.id)
  assert.equal(await service.delete(created.id), true)
  assert.equal(getStored().actions.length, 0)
})

function dailySchedule(overrides = {}) {
  return { kind: 'daily', times: ['09:00'], calendarMode: 'every-day', enabled: true, ...overrides }
}

test('create persists the schedule and update replaces or clears it', async () => {
  const { service, getStored } = setup()
  const created = await service.create({
    name: 'Morning standup',
    action: { type: 'run-task', projectPath: PROJECT_PATH },
    schedule: dailySchedule(),
  })
  assert.deepEqual(created.schedule, dailySchedule())
  assert.deepEqual(getStored().actions[0].schedule, dailySchedule())

  const replaced = await service.update(created.id, { schedule: dailySchedule({ kind: 'weekly', weekdays: [1, 3] }) })
  assert.deepEqual(replaced.schedule, dailySchedule({ kind: 'weekly', weekdays: [1, 3] }))

  const cleared = await service.update(created.id, { schedule: null })
  assert.equal('schedule' in cleared, false)
  assert.equal('schedule' in getStored().actions[0], false)
})

test('execute with silent navigates without focusing and skips when no window exists', async () => {
  const { service, navigations, windowVisibleCalls } = setup()
  const created = await service.create({ name: 'Open app', action: { type: 'open-project', projectPath: PROJECT_PATH } })

  // 手动触发（无 silent）：ensureWindowVisible 照旧。
  assert.deepEqual(await service.execute({ id: created.id }), { ok: true, kind: 'navigated' })
  assert.deepEqual(windowVisibleCalls, [true])

  // silent 有窗口：只导航，不 ensureWindowVisible。
  assert.deepEqual(await service.execute({ id: created.id }, { silent: true }), { ok: true, kind: 'navigated' })
  assert.equal(navigations.length, 2)
  assert.deepEqual(windowVisibleCalls, [true])

  // silent 无窗口：跳过执行并记 no-window 失败。
  const noWindow = setup({ hasMainWindow: false })
  const created2 = await noWindow.service.create({ name: 'Open app', action: { type: 'open-project', projectPath: PROJECT_PATH } })
  const result = await noWindow.service.execute({ id: created2.id }, { silent: true })
  assert.deepEqual(result, { ok: false, code: 'no-window' })
  assert.equal(noWindow.navigations.length, 0)
  assert.deepEqual(noWindow.windowVisibleCalls, [])
})

test('setScheduleRunStamp writes run state and clears fields with undefined', async () => {
  const { service, getStored } = setup()
  const created = await service.create({
    name: 'Daily',
    action: { type: 'run-task', projectPath: PROJECT_PATH },
    schedule: dailySchedule({ nextRetryAt: 111, attemptCount: 2 }),
  })

  await service.setScheduleRunStamp(created.id, { lastRunAt: 500, lastRunDate: '2026-01-15', attemptCount: 0, nextRetryAt: undefined })
  let stored = getStored().actions[0].schedule
  assert.equal(stored.lastRunAt, 500)
  assert.equal(stored.lastRunDate, '2026-01-15')
  assert.equal(stored.attemptCount, 0)
  assert.equal('nextRetryAt' in stored, false)

  // 失败重试：写 attemptCount/nextRetryAt，不碰 lastRunDate。
  await service.setScheduleRunStamp(created.id, { lastAttemptAt: 900, attemptCount: 1, nextRetryAt: 960 })
  stored = getStored().actions[0].schedule
  assert.equal(stored.lastRunDate, '2026-01-15')
  assert.equal(stored.lastAttemptAt, 900)
  assert.equal(stored.attemptCount, 1)
  assert.equal(stored.nextRetryAt, 960)

  // 多时间点：runSlots 记录当天已成功执行的时间点，attemptTime 标记重试归属。
  await service.setScheduleRunStamp(created.id, { lastRunAt: 800, lastRunDate: '2026-01-15', runSlots: ['09:00'] })
  stored = getStored().actions[0].schedule
  assert.deepEqual(stored.runSlots, ['09:00'])
  await service.setScheduleRunStamp(created.id, { lastAttemptAt: 950, attemptTime: '18:00', attemptCount: 1, nextRetryAt: 1010 })
  stored = getStored().actions[0].schedule
  assert.equal(stored.attemptTime, '18:00')
  // 未包含的 runSlots 保持不动。
  assert.deepEqual(stored.runSlots, ['09:00'])

  // once 消耗：enabled 置 false。
  const once = await service.create({
    name: 'Once',
    action: { type: 'run-task', projectPath: PROJECT_PATH },
    schedule: { kind: 'once', times: ['09:00'], date: '2026-03-10', calendarMode: 'every-day', enabled: true },
  })
  await service.setScheduleRunStamp(once.id, { lastRunAt: 700, lastRunDate: '2026-03-10', attemptCount: 0, enabled: false })
  stored = getStored().actions.find((item) => item.id === once.id).schedule
  assert.equal(stored.enabled, false)

  // 未知 id / 无 schedule 的条目：静默跳过。
  await service.setScheduleRunStamp('missing-id', { lastRunAt: 1 })
  const plain = await service.create({ name: 'Plain', action: { type: 'open-path', path: 'C:/Windows' } })
  await service.setScheduleRunStamp(plain.id, { lastRunAt: 1 })
  assert.equal('schedule' in getStored().actions.find((item) => item.id === plain.id), false)
})

test('list computes scheduleNextRunAt only for enabled schedules', async () => {
  const { service } = setup()
  // 2026-01-15 12:00（注入时钟）之后的下一次 daily 09:00 = 2026-01-16 09:00。
  const created = await service.create({
    name: 'Daily',
    action: { type: 'run-task', projectPath: PROJECT_PATH },
    schedule: dailySchedule(),
  })
  assert.equal(service.list()[0].scheduleNextRunAt, new Date(2026, 0, 16, 9, 0).getTime())

  // 未启用：不计算。
  await service.update(created.id, { schedule: dailySchedule({ enabled: false }) })
  assert.equal(service.list()[0].scheduleNextRunAt, undefined)

  // once 已过：undefined。
  const once = await service.create({
    name: 'Once past',
    action: { type: 'run-task', projectPath: PROJECT_PATH },
    schedule: { kind: 'once', times: ['09:00'], date: '2026-01-10', calendarMode: 'every-day', enabled: true },
  })
  assert.equal(service.list().find((item) => item.id === once.id).scheduleNextRunAt, undefined)
})

test('readActions exposes stored actions without view enrichment', async () => {
  const { service } = setup()
  await service.create({ name: 'Open app', action: { type: 'open-project', projectPath: PROJECT_PATH } })
  const actions = service.readActions()
  assert.equal(actions.length, 1)
  assert.equal(actions[0].name, 'Open app')
  assert.equal('shortcutState' in actions[0], false)
})

/** Mirrors shared/rules.ts projectIdFromPath for navigation assertions. */
function hashOf(filePath) {
  let hash = 0
  for (let i = 0; i < filePath.length; i++) {
    const char = filePath.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return hash
}

function hashIdOf(filePath) {
  return `p${Math.abs(hashOf(filePath)).toString(36)}`
}
