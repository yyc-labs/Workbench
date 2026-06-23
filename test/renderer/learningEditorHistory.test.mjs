import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const {
  createLearningEditorHistoryState,
  pushLearningEditorSnapshot,
  updateLearningEditorSnapshotSelection,
} = loadTsModule('src/core/renderer/pages/learning/learningEditorHistory.ts')

test('preserves the pre-edit caret position for the first undo snapshot', () => {
  let state = createLearningEditorHistoryState('第一行\n第二行')

  state = updateLearningEditorSnapshotSelection(state, 4, 4)
  state = pushLearningEditorSnapshot(state, {
    value: '第一行X\n第二行',
    selectionStart: 5,
    selectionEnd: 5,
  }, 200)

  assert.equal(state.index, 1)
  assert.deepEqual(state.history[0], {
    value: '第一行\n第二行',
    selectionStart: 4,
    selectionEnd: 4,
  })
})

test('deduplicates identical snapshots', () => {
  let state = createLearningEditorHistoryState('内容', 2, 2)

  state = pushLearningEditorSnapshot(state, {
    value: '内容',
    selectionStart: 2,
    selectionEnd: 2,
  }, 200)

  assert.equal(state.index, 0)
  assert.equal(state.history.length, 1)
})
