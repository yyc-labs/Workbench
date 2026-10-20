import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { normalizeQuickActions, sanitizeQuickActionName, DEFAULT_QUICK_ACTIONS } = loadTsModule('src/core/electron/main/config/config-quick-actions.ts')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function action(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Open app',
    action: { type: 'open-project', projectPath: 'D:/repos/app' },
    icon: 'folder-open',
    group: 'project',
    enabled: true,
    order: 0,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

test('non-array shapes fall back to the default', () => {
  assert.deepEqual(normalizeQuickActions(undefined), DEFAULT_QUICK_ACTIONS)
  assert.deepEqual(normalizeQuickActions(null), DEFAULT_QUICK_ACTIONS)
  assert.deepEqual(normalizeQuickActions({ actions: 'nope' }), DEFAULT_QUICK_ACTIONS)
  assert.deepEqual(normalizeQuickActions({ actions: [] }).actions, [])
})

test('entries with unknown types or invalid required fields are dropped', () => {
  const result = normalizeQuickActions({
    actions: [
      action(),
      action({ id: '22222222-2222-4222-8222-222222222222', action: { type: 'launch-rocket' } }),
      action({ id: '33333333-3333-4333-8333-333333333333', action: { type: 'open-project', projectPath: '' } }),
      action({ id: '44444444-4444-4444-8444-444444444444', action: { type: 'open-url', url: 'ftp://example.com' } }),
      action({ id: '55555555-5555-4555-8555-555555555555', action: { type: 'run-task', projectPath: 'D:/repos/app', taskId: '' } }),
    ],
  })
  assert.equal(result.actions.length, 1)
  assert.equal(result.actions[0].id, '11111111-1111-4111-8111-111111111111')
})

test('duplicate ids keep the first entry and regenerate the rest', () => {
  const result = normalizeQuickActions({
    actions: [action(), action({ name: 'Second' })],
  })
  assert.equal(result.actions.length, 2)
  assert.equal(result.actions[0].id, '11111111-1111-4111-8111-111111111111')
  assert.match(result.actions[1].id, UUID)
  assert.notEqual(result.actions[1].id, result.actions[0].id)
})

test('invalid ids are regenerated', () => {
  const result = normalizeQuickActions({ actions: [action({ id: 'not-a-uuid' })] })
  assert.match(result.actions[0].id, UUID)
})

test('names are sanitized and empty names fall back to a placeholder', () => {
  const result = normalizeQuickActions({
    actions: [action({ id: '22222222-2222-4222-8222-222222222222', name: 'bad<>:"/\\|?*name' }), action({ id: '33333333-3333-4333-8333-333333333333', name: '   ' })],
  })
  assert.equal(result.actions[0].name, 'badname')
  assert.equal(result.actions[1].name, 'Untitled action')
})

test('icon and group fall back to the per-type derivation table', () => {
  const result = normalizeQuickActions({
    actions: [
      action({ id: '22222222-2222-4222-8222-222222222222', action: { type: 'run-task', projectPath: 'D:/repos/app' }, icon: 'nope', group: 'nope' }),
      action({ id: '33333333-3333-4333-8333-333333333333', action: { type: 'open-path', path: 'D:/repos/app' }, icon: 'play', group: 'task' }),
      action({ id: '44444444-4444-4444-8444-444444444444', action: { type: 'open-url', url: 'https://example.com' }, icon: 'bogus', group: 'bogus' }),
    ],
  })
  assert.deepEqual(
    result.actions.map((item) => [item.icon, item.group]),
    [
      ['play', 'task'],
      ['play', 'task'],
      ['globe', 'other'],
    ],
  )
})

test('orders are renumbered per group after a stable sort', () => {
  const result = normalizeQuickActions({
    actions: [action({ id: '22222222-2222-4222-8222-222222222222', order: 5 }), action({ id: '33333333-3333-4333-8333-333333333333', group: 'task', order: 7 }), action({ id: '44444444-4444-4444-8444-444444444444', group: 'task', order: 2 }), action({ id: '55555555-5555-4555-8555-555555555555', order: 3 })],
  })
  const byId = new Map(result.actions.map((item) => [item.id, item]))
  // project group: order 3 before order 5; task group: order 2 before order 7.
  assert.equal(byId.get('55555555-5555-4555-8555-555555555555').order, 0)
  assert.equal(byId.get('22222222-2222-4222-8222-222222222222').order, 1)
  assert.equal(byId.get('44444444-4444-4444-8444-444444444444').order, 0)
  assert.equal(byId.get('33333333-3333-4333-8333-333333333333').order, 1)
})

test('enabled falls back to true and invalid timestamps to now', () => {
  const before = Date.now()
  const result = normalizeQuickActions({ actions: [action({ enabled: 'yes', createdAt: 'yesterday', updatedAt: Number.NaN })] })
  const after = Date.now()
  assert.equal(result.actions[0].enabled, true)
  assert.ok(result.actions[0].createdAt >= before && result.actions[0].createdAt <= after)
  assert.ok(result.actions[0].updatedAt >= before && result.actions[0].updatedAt <= after)
})

test('desktopShortcutPath is removed when empty or non-string', () => {
  const result = normalizeQuickActions({
    actions: [action({ id: '22222222-2222-4222-8222-222222222222', desktopShortcutPath: '' }), action({ id: '33333333-3333-4333-8333-333333333333', desktopShortcutPath: 42 }), action({ id: '44444444-4444-4444-8444-444444444444', desktopShortcutPath: 'C:/Users/me/Desktop/Open app.lnk' })],
  })
  assert.equal('desktopShortcutPath' in result.actions[0], false)
  assert.equal('desktopShortcutPath' in result.actions[1], false)
  assert.equal(result.actions[2].desktopShortcutPath, 'C:/Users/me/Desktop/Open app.lnk')
})

test('sanitizeQuickActionName strips invalid characters and trims', () => {
  assert.equal(sanitizeQuickActionName('  a<b>c:d"e/f\\g|h?i*j  '), 'abcdefghij')
  assert.equal(sanitizeQuickActionName('ok name'), 'ok name')
  assert.equal(sanitizeQuickActionName('\u0001\u0002x'), 'x')
})

test('valid http and https urls survive normalization', () => {
  const result = normalizeQuickActions({
    actions: [action({ id: '22222222-2222-4222-8222-222222222222', action: { type: 'open-url', url: 'http://localhost:3000' } }), action({ id: '33333333-3333-4333-8333-333333333333', action: { type: 'open-url', url: 'https://example.com/path?a=1' } })],
  })
  assert.deepEqual(
    result.actions.map((item) => item.action.url),
    ['http://localhost:3000', 'https://example.com/path?a=1'],
  )
})

function scheduleOf(overrides = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    schedule: {
      kind: 'daily',
      times: ['09:00'],
      calendarMode: 'every-day',
      enabled: true,
      ...overrides,
    },
  }
}

test('valid schedules survive normalization with derived defaults', () => {
  const result = normalizeQuickActions({
    actions: [action(scheduleOf()), action({ id: '33333333-3333-4333-8333-333333333333', schedule: { kind: 'weekly', times: ['23:59'], weekdays: [3, 1, 3, 7, -1], enabled: true } }), action({ id: '44444444-4444-4444-8444-444444444444', schedule: { kind: 'once', times: ['00:00'], date: '2999-12-31', enabled: true } })],
  })
  assert.deepEqual(result.actions[0].schedule, { kind: 'daily', times: ['09:00'], calendarMode: 'every-day', enabled: true })
  // weekdays 去重排序并过滤 0-6 之外值；calendarMode 缺省 every-day。
  assert.deepEqual(result.actions[1].schedule, { kind: 'weekly', times: ['23:59'], weekdays: [1, 3], calendarMode: 'every-day', enabled: true })
  assert.deepEqual(result.actions[2].schedule, { kind: 'once', times: ['00:00'], date: '2999-12-31', calendarMode: 'every-day', enabled: true })
})

test('times are deduped, sorted and capped', () => {
  const result = normalizeQuickActions({
    actions: [action(scheduleOf({ times: ['18:00', '09:00', '09:00', '12:30'] })), action({ id: '33333333-3333-4333-8333-333333333333', schedule: { kind: 'daily', times: ['00:00', '01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00', '08:00', '09:00'], enabled: true } })],
  })
  assert.deepEqual(result.actions[0].schedule.times, ['09:00', '12:30', '18:00'])
  // 超过上限（8）截断，保留最早的 8 个。
  assert.equal(result.actions[1].schedule.times.length, 8)
  assert.equal(result.actions[1].schedule.times[7], '07:00')
})

test('legacy single time migrates to a one-element times list', () => {
  const result = normalizeQuickActions({
    actions: [action({ id: '33333333-3333-4333-8333-333333333333', schedule: { kind: 'daily', time: '07:30', enabled: true } })],
  })
  assert.deepEqual(result.actions[0].schedule.times, ['07:30'])
  assert.equal('time' in result.actions[0].schedule, false)
})

test('invalid schedules are dropped entirely', () => {
  const result = normalizeQuickActions({
    actions: [
      action(scheduleOf({ kind: 'hourly' })),
      action({ id: '33333333-3333-4333-8333-333333333333', schedule: { kind: 'daily', times: ['9:00'], enabled: true } }),
      action({ id: '44444444-4444-4444-8444-444444444444', schedule: { kind: 'daily', times: ['25:00'], enabled: true } }),
      action({ id: '55555555-5555-4555-8555-555555555555', schedule: { kind: 'daily', times: [], enabled: true } }),
      action({ id: '66666666-6666-4666-8666-666666666666', schedule: { kind: 'once', times: ['09:00'], date: 'not-a-date', enabled: true } }),
      action({ id: '77777777-7777-4777-8777-777777777777', schedule: { kind: 'once', times: ['09:00'], enabled: true } }),
      action({ id: '88888888-8888-4888-8888-888888888888', schedule: 'nope' }),
    ],
  })
  assert.equal(
    result.actions.every((item) => !('schedule' in item)),
    true,
  )
})

test('past once dates force enabled=false as a fallback', () => {
  const result = normalizeQuickActions({
    actions: [action(scheduleOf({ kind: 'once', date: '2020-01-01', times: ['09:00'] }))],
  })
  assert.equal(result.actions[0].schedule.enabled, false)
  assert.equal(result.actions[0].schedule.date, '2020-01-01')
})

test('schedule runtime fields are cleaned by validity', () => {
  const result = normalizeQuickActions({
    actions: [
      action(
        scheduleOf({
          lastRunAt: 1000,
          lastAttemptAt: 'yesterday',
          attemptTime: '9:00',
          nextRetryAt: Number.NaN,
          lastRunDate: '2026-13-99',
          runSlots: ['09:00', 'nope'],
          attemptCount: 9,
        }),
      ),
      action({ id: '33333333-3333-4333-8333-333333333333', schedule: { kind: 'daily', times: ['09:00'], enabled: true, attemptCount: 2.5, lastRunDate: '2026-01-15', lastAttemptAt: 500, runSlots: ['09:00'] } }),
    ],
  })
  // 非有限/非法字段移除，合法字段保留。
  assert.deepEqual(result.actions[0].schedule, { kind: 'daily', times: ['09:00'], calendarMode: 'every-day', enabled: true, lastRunAt: 1000 })
  assert.deepEqual(result.actions[1].schedule, {
    kind: 'daily',
    times: ['09:00'],
    calendarMode: 'every-day',
    enabled: true,
    lastRunDate: '2026-01-15',
    lastAttemptAt: 500,
    runSlots: ['09:00'],
  })
})

test('runSlots only survives together with a valid lastRunDate', () => {
  const result = normalizeQuickActions({
    actions: [action(scheduleOf({ runSlots: ['09:00'], lastRunDate: undefined }))],
  })
  assert.equal('runSlots' in result.actions[0].schedule, false)
})

test('weekly without weekdays means every day', () => {
  const result = normalizeQuickActions({
    actions: [action(scheduleOf({ kind: 'weekly', weekdays: [] })), action({ id: '33333333-3333-4333-8333-333333333333', schedule: { kind: 'weekly', times: ['09:00'], enabled: true } })],
  })
  assert.equal('weekdays' in result.actions[0].schedule, false)
  assert.equal('weekdays' in result.actions[1].schedule, false)
})
