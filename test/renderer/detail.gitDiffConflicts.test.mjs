import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const {
  parseConflictMarkers,
  replaceConflictBlock,
} = loadTsModule('src/core/renderer/pages/detail/detail.gitDiffConflicts.ts')

test('detail git diff conflicts tracks source ranges for ours/theirs/base', () => {
  const content = [
    'prefix-1',
    'prefix-2',
    '<<<<<<< HEAD',
    'ours-1',
    'ours-2',
    '||||||| base',
    'base-1',
    '=======',
    'theirs-1',
    '>>>>>>> feature/demo',
    'suffix-1',
    '',
  ].join('\n')

  const { blocks } = parseConflictMarkers(content)
  assert.equal(blocks.length, 1)

  const [block] = blocks
  assert.deepEqual(block.oursRange, { startLine: 3, endLine: 4, lineCount: 2 })
  assert.deepEqual(block.theirsRange, { startLine: 3, endLine: 3, lineCount: 1 })
  assert.deepEqual(block.ancestorRange, { startLine: 3, endLine: 3, lineCount: 1 })
})

test('detail git diff conflicts replaces the active conflict block range', () => {
  const content = [
    'a',
    '<<<<<<< HEAD',
    'ours',
    '=======',
    'theirs',
    '>>>>>>> branch-x',
    'b',
    '',
  ].join('\n')

  const { blocks } = parseConflictMarkers(content)
  const next = replaceConflictBlock(content, blocks[0], 'resolved\n')
  assert.equal(next, ['a', 'resolved', 'b', ''].join('\n'))
})
