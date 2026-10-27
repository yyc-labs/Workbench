import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { joinProjectPath } = loadTsModule('src/core/renderer/lib/projectPaths.ts')

const { defaultSelectedZipName, normalizeRelativePathForCopy, projectNameFromPath, removeRelativePathSlashes, resolveFileParentFolderPath, resolveTreeNodeFolderPath } = loadTsModule('src/core/renderer/pages/code/code.pathActions.ts')

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

test('projectNameFromPath extracts the last path segment for windows and posix project paths', () => {
  assert.equal(projectNameFromPath('D:\\tools\\ide-electron'), 'ide-electron')
  assert.equal(projectNameFromPath('D:\\tools\\ide-electron\\'), 'ide-electron')
  assert.equal(projectNameFromPath('/home/user/my-repo'), 'my-repo')
  assert.equal(projectNameFromPath('/home/user/my-repo/'), 'my-repo')
  assert.equal(projectNameFromPath('  D:\\a b\\c  '), 'c')
  assert.equal(projectNameFromPath(''), '')
  assert.equal(projectNameFromPath('   '), '')
})

test('defaultSelectedZipName matches the main-process naming convention', () => {
  // 与主进程 defaultSelectedZipName 同语义：{项目名}-selected.zip，空项目路径回退 selected.zip。
  assert.equal(defaultSelectedZipName('D:\\tools\\ide-electron'), 'ide-electron-selected.zip')
  assert.equal(defaultSelectedZipName('/home/user/my-repo'), 'my-repo-selected.zip')
  assert.equal(defaultSelectedZipName(''), 'selected.zip')
})

test('code path actions still resolve project paths for tree nodes', () => {
  assert.equal(joinProjectPath('/repo', 'src\\main.ts'), '/repo/src/main.ts')
  assert.equal(resolveFileParentFolderPath('/repo', 'src/pages/Home.tsx'), '/repo/src/pages')
  assert.equal(resolveTreeNodeFolderPath('/repo', 'src/pages', 'directory'), '/repo/src/pages')
  assert.equal(resolveTreeNodeFolderPath('/repo', 'src/pages/Home.tsx', 'file'), '/repo/src/pages')
})
