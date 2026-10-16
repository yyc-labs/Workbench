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
