import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const {
  ProjectFileServiceError,
  filterListedFilePaths,
  fuzzyPathMatch,
  normalizeContentSearchIncludeGlobs,
  normalizeImageExtension,
  normalizeListedRelativePath,
  normalizeRelativeInput,
  shouldSkipListedFilePath,
  validateRelativePathLooksSafe,
} = loadTsModule('src/core/electron/main/project-file/shared.ts')

test('normalizeRelativeInput accepts safe relative paths and rejects traversal or absolute paths', () => {
  assert.equal(normalizeRelativeInput(' ./src\\pages//Home.tsx '), 'src/pages/Home.tsx')
  assert.throws(() => normalizeRelativeInput(''), ProjectFileServiceError)
  assert.throws(() => normalizeRelativeInput('../secrets.env'), /Path traversal/)
  assert.throws(() => normalizeRelativeInput('/etc/passwd'), /Absolute paths/)
  assert.throws(() => validateRelativePathLooksSafe('C:\\Users\\me\\secret.txt'), /Windows absolute paths/)
})

test('normalizeListedRelativePath and filterListedFilePaths remove unsafe or excluded project entries', () => {
  assert.equal(normalizeListedRelativePath('src\\main.ts'), 'src/main.ts')
  assert.equal(normalizeListedRelativePath('../outside.ts'), null)
  assert.equal(normalizeListedRelativePath('/absolute.ts'), null)

  assert.equal(shouldSkipListedFilePath('src/main.ts'), false)
  assert.equal(shouldSkipListedFilePath('node_modules/pkg/index.js'), true)
  assert.equal(shouldSkipListedFilePath('.DS_Store'), true)

  const result = filterListedFilePaths([
    'src/main.ts',
    'node_modules/pkg/index.js',
    'a/b/c/d/e/f/g/h/i/deep.ts',
    'docs/guide.md',
  ])
  assert.deepEqual(result.acceptedPaths, ['src/main.ts', 'docs/guide.md'])
  assert.equal(result.skippedFiles, 2)
})

test('project file helpers normalize image extensions, search globs, and fuzzy path matches', () => {
  assert.equal(normalizeImageExtension('.jpeg'), 'jpg')
  assert.equal(normalizeImageExtension('bad/ext'), 'png')
  assert.deepEqual(
    normalizeContentSearchIncludeGlobs([' **/*.ts ', '', '**/*.ts', null, '**/*.tsx']),
    ['**/*.ts', '**/*.tsx']
  )
  assert.equal(fuzzyPathMatch('cwp', 'src/core/renderer/pages/code/CodeWorkspacePanel.tsx'), true)
  assert.equal(fuzzyPathMatch('zzzz', 'src/core/renderer/pages/code/CodeWorkspacePanel.tsx'), false)
})
