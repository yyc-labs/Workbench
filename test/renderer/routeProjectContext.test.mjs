import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { getProjectIdFromPath } = loadTsModule('src/core/renderer/lib/routeProjectContext.ts')

test('getProjectIdFromPath resolves project detail panes', () => {
  assert.equal(getProjectIdFromPath('/project/demo/code'), 'demo')
  assert.equal(getProjectIdFromPath('/project/demo/transcript'), 'demo')
  assert.equal(getProjectIdFromPath('/project/demo'), 'demo')
})

test('getProjectIdFromPath returns undefined outside project routes', () => {
  assert.equal(getProjectIdFromPath('/'), undefined)
  assert.equal(getProjectIdFromPath('/settings/logs'), undefined)
  assert.equal(getProjectIdFromPath('/markdown'), undefined)
  assert.equal(getProjectIdFromPath('/project'), undefined)
  assert.equal(getProjectIdFromPath('/projects/demo/code'), undefined)
})
