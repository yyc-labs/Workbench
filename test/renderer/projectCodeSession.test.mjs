import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { appendProjectCodeTab, normalizeProjectCodeSession, sanitizeProjectCodeSessionByPaths } = loadTsModule('src/core/renderer/pages/code/useProjectCodeSession.ts')

test('appendProjectCodeTab keeps document session tabs unique and capped', () => {
  assert.deepEqual(appendProjectCodeTab(['a.ts', 'b.ts'], ' c.ts ', 2), ['b.ts', 'c.ts'])
  assert.deepEqual(appendProjectCodeTab(['a.ts'], 'a.ts', 2), ['a.ts'])
})

test('normalizeProjectCodeSession falls back to the last tab when activePath is missing', () => {
  const session = normalizeProjectCodeSession({
    tabs: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
  })

  assert.deepEqual(session, {
    tabs: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    activePath: 'src/c.ts',
    cursorPositions: undefined,
    contentSearchScope: undefined,
  })
})

test('normalizeProjectCodeSession preserves an explicit activePath when it exists in tabs', () => {
  const session = normalizeProjectCodeSession({
    tabs: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    activePath: 'src/b.ts',
  })

  assert.equal(session?.activePath, 'src/b.ts')
})

test('sanitizeProjectCodeSessionByPaths falls back to the last remaining tab when activePath is invalid', () => {
  const session = sanitizeProjectCodeSessionByPaths(
    {
      tabs: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      activePath: 'src/missing.ts',
    },
    new Set(['src/a.ts', 'src/c.ts']),
  )

  assert.deepEqual(session, {
    tabs: ['src/a.ts', 'src/c.ts'],
    activePath: 'src/c.ts',
    cursorPositions: undefined,
    contentSearchScope: undefined,
  })
})
