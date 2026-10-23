import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { ProjectFileServiceError, byteOffsetToUtf16Index, filterListedFilePaths, fuzzyPathMatch, normalizeContentSearchIncludeGlobs, normalizeImageExtension, normalizeListedRelativePath, normalizeRelativeInput, shouldSkipListedFilePath, validateRelativePathLooksSafe } =
  loadTsModule('src/core/electron/main/project-file/shared.ts')

test('byteOffsetToUtf16Index 将 rg 的字节偏移转换为字符索引', () => {
  // 中文占 3 字节：'abc' 的字节偏移 6 对应字符索引 2。
  assert.equal(byteOffsetToUtf16Index('中文abc测试', 6), 2)
  assert.equal(byteOffsetToUtf16Index('中文abc测试', 9), 5)
  // 纯 ASCII 行字节偏移即字符索引。
  assert.equal(byteOffsetToUtf16Index('const bot = 1', 6), 6)
  // emoji 为代理对：按 UTF-16 索引计（'😀' 占 4 字节 / 2 个 UTF-16 单元）。
  assert.equal(byteOffsetToUtf16Index('😀bot', 4), 2)
  // 越界与非有限值收敛到边界。
  assert.equal(byteOffsetToUtf16Index('中文abc', 999), 5)
  assert.equal(byteOffsetToUtf16Index('中文abc', 0), 0)
  assert.equal(byteOffsetToUtf16Index('中文abc', -3), 0)
  assert.equal(byteOffsetToUtf16Index('中文abc', Number.NaN), 0)
})

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

  const result = filterListedFilePaths(['src/main.ts', 'node_modules/pkg/index.js', 'a/b/c/d/e/f/g/h/i/deep.ts', 'docs/guide.md'])
  assert.deepEqual(result.acceptedPaths, ['src/main.ts', 'docs/guide.md'])
  assert.equal(result.skippedFiles, 2)
})

test('filterListedFilePaths honors custom maxFiles and keeps the default cap', () => {
  const paths = ['a.ts', 'b.ts', 'c.ts', 'd.ts']
  assert.deepEqual(filterListedFilePaths(paths, undefined, 2).acceptedPaths, ['a.ts', 'b.ts'])
  assert.deepEqual(filterListedFilePaths(paths, undefined, 100).acceptedPaths, paths)
  assert.deepEqual(filterListedFilePaths(paths).acceptedPaths, paths) // 默认 MAX_TREE_FILES，行为不回归
})

test('project file helpers normalize image extensions, search globs, and fuzzy path matches', () => {
  assert.equal(normalizeImageExtension('.jpeg'), 'jpg')
  assert.equal(normalizeImageExtension('bad/ext'), 'png')
  assert.deepEqual(normalizeContentSearchIncludeGlobs([' **/*.ts ', '', '**/*.ts', null, '**/*.tsx']), ['**/*.ts', '**/*.tsx'])
  assert.equal(fuzzyPathMatch('cwp', 'src/core/renderer/pages/code/CodeWorkspacePanel.tsx'), true)
  assert.equal(fuzzyPathMatch('zzzz', 'src/core/renderer/pages/code/CodeWorkspacePanel.tsx'), false)
})
