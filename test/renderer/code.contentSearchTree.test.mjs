import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { buildContentSearchTreeData, findCommonAncestorDirectory } = loadTsModule('src/core/renderer/pages/code/code.contentSearchTree.ts')

function fileResult(relativePath, matchCount = 1) {
  const name = relativePath.split('/').pop()
  return {
    relativePath,
    name,
    matchCount,
    matches: Array.from({ length: Math.min(matchCount, 40) }, (_, index) => ({
      lineNumber: index + 1,
      column: 1,
      endColumn: 5,
      lineText: `line ${index + 1}`,
    })),
  }
}

function findNode(nodes, relativePath) {
  for (const node of nodes) {
    if (node.relativePath === relativePath) return node
    if (node.kind === 'directory') {
      const found = findNode(node.children, relativePath)
      if (found) return found
    }
  }
  return null
}

test('findCommonAncestorDirectory：取最深公共目录', () => {
  assert.equal(findCommonAncestorDirectory(['src/core/renderer/pages/code/a.ts', 'src/core/renderer/pages/home/b.ts']), 'src/core/renderer/pages')
  assert.equal(findCommonAncestorDirectory(['src/a.ts', 'src/b.ts']), 'src')
  assert.equal(findCommonAncestorDirectory(['src/core/a.ts', 'src/b.ts']), 'src')
  assert.equal(findCommonAncestorDirectory(['a.ts', 'b.ts']), '')
  assert.equal(findCommonAncestorDirectory(['src/a.ts']), 'src')
  assert.equal(findCommonAncestorDirectory([]), '')
})

test('共同祖先为根：根节点 label 即完整路径，层级挂载命中文件', () => {
  const nodes = buildContentSearchTreeData([fileResult('src/core/renderer/pages/code/a.ts', 3), fileResult('src/core/renderer/pages/home/b.ts', 2)])

  assert.equal(nodes.length, 1)
  const head = nodes[0]
  assert.equal(head.kind, 'directory')
  assert.equal(head.relativePath, 'src/core/renderer/pages')
  assert.equal(head.name, 'src/core/renderer/pages')
  assert.deepEqual(
    head.children.map((child) => child.name),
    ['code', 'home'],
  )

  const code = findNode(nodes, 'src/core/renderer/pages/code')
  assert.equal(code.kind, 'directory')
  assert.equal(code.name, 'code')
  assert.deepEqual(
    code.children.map((child) => child.name),
    ['a.ts'],
  )

  const fileA = findNode(nodes, 'src/core/renderer/pages/code/a.ts')
  assert.equal(fileA.kind, 'file')
  assert.equal(fileA.matchCount, 3)
  assert.equal(fileA.matches.length, 3)
})

test('无公共目录时顶层直接挂文件夹与文件', () => {
  const nodes = buildContentSearchTreeData([fileResult('src/a.ts'), fileResult('README.md')])
  assert.deepEqual(
    nodes.map((node) => [node.kind, node.name]),
    [
      ['directory', 'src'],
      ['file', 'README.md'],
    ],
  )
})

test('目录在前、文件在后按名称排序', () => {
  const nodes = buildContentSearchTreeData([fileResult('pkg/zeta.ts'), fileResult('pkg/alpha.ts'), fileResult('pkg/sub/m.ts'), fileResult('pkg/beta dir/n.ts')])
  const pkg = nodes[0]
  assert.deepEqual(
    pkg.children.map((child) => child.name),
    ['beta dir', 'sub', 'alpha.ts', 'zeta.ts'],
  )
})

test('直接位于共同祖先下的文件挂到根节点', () => {
  const nodes = buildContentSearchTreeData([fileResult('src/core/index.ts'), fileResult('src/core/util/helper.ts')])
  assert.equal(nodes.length, 1)
  assert.equal(nodes[0].relativePath, 'src/core')
  assert.deepEqual(
    nodes[0].children.map((child) => child.name),
    ['util', 'index.ts'],
  )
})

test('空输入返回空树', () => {
  assert.deepEqual(buildContentSearchTreeData([]), [])
})
