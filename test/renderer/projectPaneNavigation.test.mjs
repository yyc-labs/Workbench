import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const {
  PROJECT_DETAIL_GESTURE_PANE_ORDER,
  resolveProjectDetailGestureTarget,
} = loadTsModule('src/core/renderer/lib/projectPaneNavigation.ts')

test('project detail gesture pane order includes transcript', () => {
  assert.deepEqual(PROJECT_DETAIL_GESTURE_PANE_ORDER, ['code', 'aicommit', 'transcript'])
})

test('resolveProjectDetailGestureTarget advances and rewinds across detail panes', () => {
  assert.equal(resolveProjectDetailGestureTarget('/project/demo/code', 'forward'), '/project/demo/aicommit')
  assert.equal(resolveProjectDetailGestureTarget('/project/demo/aicommit', 'forward'), '/project/demo/transcript')
  assert.equal(resolveProjectDetailGestureTarget('/project/demo/transcript', 'back'), '/project/demo/aicommit')
  assert.equal(resolveProjectDetailGestureTarget('/project/demo/code', 'back'), null)
})
