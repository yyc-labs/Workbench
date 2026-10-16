import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { describeQuickActionResult } = loadTsModule('src/core/renderer/lib/quickActionFeedback.ts')

const MESSAGES = {
  'quickActions.result.navigated': 'Opened the project.',
  'quickActions.result.taskStarted': 'Run task started.',
  'quickActions.result.opened': 'Opened.',
  'quickActions.error.not-found': 'This quick action no longer exists.',
  'quickActions.error.disabled': 'This quick action is disabled.',
  'quickActions.error.invalid-project': 'The project or directory does not exist.',
  'quickActions.error.invalid-task': 'The run task no longer exists in the project config.',
  'quickActions.error.invalid-spec': 'This action is not configured correctly.',
  'quickActions.error.exec-failed': 'Failed to execute the quick action.',
}

const t = (key) => MESSAGES[key] ?? key

test('success results map by kind', () => {
  assert.deepEqual(describeQuickActionResult(t, { ok: true, kind: 'navigated' }), { kind: 'success', message: 'Opened the project.' })
  assert.deepEqual(describeQuickActionResult(t, { ok: true, kind: 'task-started', taskIds: ['web'] }), { kind: 'success', message: 'Run task started.' })
  assert.deepEqual(describeQuickActionResult(t, { ok: true, kind: 'opened' }), { kind: 'success', message: 'Opened.' })
})

test('failure results map by error code', () => {
  assert.deepEqual(describeQuickActionResult(t, { ok: false, code: 'not-found' }), { kind: 'error', message: 'This quick action no longer exists.' })
  assert.deepEqual(describeQuickActionResult(t, { ok: false, code: 'disabled' }), { kind: 'error', message: 'This quick action is disabled.' })
  assert.deepEqual(describeQuickActionResult(t, { ok: false, code: 'invalid-project' }), { kind: 'error', message: 'The project or directory does not exist.' })
  assert.deepEqual(describeQuickActionResult(t, { ok: false, code: 'invalid-task' }), { kind: 'error', message: 'The run task no longer exists in the project config.' })
  assert.deepEqual(describeQuickActionResult(t, { ok: false, code: 'invalid-spec' }), { kind: 'error', message: 'This action is not configured correctly.' })
})

test('raw error text is carried as description', () => {
  assert.deepEqual(describeQuickActionResult(t, { ok: false, code: 'exec-failed', error: 'ENOENT' }), {
    kind: 'error',
    message: 'Failed to execute the quick action.',
    description: 'ENOENT',
  })
})

test('missing error text leaves description unset', () => {
  const feedback = describeQuickActionResult(t, { ok: false, code: 'exec-failed' })
  assert.equal('description' in feedback, false)
})
