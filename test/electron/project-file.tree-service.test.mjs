import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const {
  listProjectDirectoryFiles,
  listProjectFiles,
} = loadTsModule('src/core/electron/main/project-file/tree-service.ts')

test('listProjectFiles keeps directories lazy without probing descendants', async () => {
  const projectPath = mkdtempSync(join(tmpdir(), 'project-file-tree-'))
  mkdirSync(join(projectPath, 'empty-dir'))
  mkdirSync(join(projectPath, 'nested-dir', 'child'), { recursive: true })
  writeFileSync(join(projectPath, 'nested-dir', 'child', 'index.ts'), 'export {}', 'utf8')

  const tree = await listProjectFiles(projectPath)
  const emptyDir = tree.nodes.find((node) => node.relativePath === 'empty-dir')
  const nestedDir = tree.nodes.find((node) => node.relativePath === 'nested-dir')

  assert.equal(tree.directoryRelativePath, null)
  assert.equal(emptyDir?.kind, 'directory')
  assert.equal(emptyDir?.isLoaded, false)
  assert.equal(emptyDir?.hasChildren, true)
  assert.equal(nestedDir?.kind, 'directory')
  assert.equal(nestedDir?.isLoaded, false)
  assert.equal(nestedDir?.hasChildren, true)

  const emptyDirChildren = await listProjectDirectoryFiles(projectPath, 'empty-dir')
  assert.deepEqual(emptyDirChildren.nodes, [])
})
