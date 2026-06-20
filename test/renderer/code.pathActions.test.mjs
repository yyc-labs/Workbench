import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const {
  joinProjectPath,
  normalizeRelativePathForCopy,
  removeRelativePathSlashes,
  resolveFileParentFolderPath,
  resolveTreeNodeFolderPath,
} = loadTsModule('src/core/renderer/pages/code/code.pathActions.ts')

test('code path actions normalize relative paths for copy', () => {
  assert.equal(normalizeRelativePathForCopy(' src\\core//renderer/pages/code/CodeWorkspacePanel.tsx '), 'src/core/renderer/pages/code/CodeWorkspacePanel.tsx')
  assert.equal(normalizeRelativePathForCopy('README.md'), 'README.md')
  assert.equal(normalizeRelativePathForCopy(''), '')
})

test('code path actions remove path separators for slashless copy', () => {
  assert.equal(removeRelativePathSlashes(' src\\core//renderer/pages/code/CodeWorkspacePanel.tsx '), 'srccorerendererpagescodeCodeWorkspacePanel.tsx')
  assert.equal(removeRelativePathSlashes('README.md'), 'README.md')
  assert.equal(removeRelativePathSlashes('docs\\\\'), 'docs')
})

test('code path actions still resolve project paths for tree nodes', () => {
  assert.equal(joinProjectPath('/repo', 'src\\main.ts'), '/repo/src/main.ts')
  assert.equal(resolveFileParentFolderPath('/repo', 'src/pages/Home.tsx'), '/repo/src/pages')
  assert.equal(resolveTreeNodeFolderPath('/repo', 'src/pages', 'directory'), '/repo/src/pages')
  assert.equal(resolveTreeNodeFolderPath('/repo', 'src/pages/Home.tsx', 'file'), '/repo/src/pages')
})
