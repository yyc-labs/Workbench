import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { buildContentSearchTreeData, buildMatchLineDisplay, findCommonAncestorDirectory } = loadTsModule('src/core/renderer/pages/code/code.contentSearchTree.ts')

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

function match(lineText, column, endColumn) {
  return { lineNumber: 1, column, endColumn, lineText }
}

test('短行原样展示，不加省略号', () => {
  const display = buildMatchLineDisplay(match('const a = 1', 7, 8))
  assert.deepEqual(display, { text: 'const a = 1', ellipsisBefore: false, ellipsisAfter: false, matchStart: 6, matchEnd: 7 })
})

test('高亮切片即匹配文字本身（长行开窗后依然对齐）', () => {
  const line = `${'A'.repeat(90)}MATCH${'B'.repeat(90)}`
  const display = buildMatchLineDisplay(match(line, 91, 96))
  assert.equal(display.text.slice(display.matchStart, display.matchEnd), 'MATCH')
})

test('长行以匹配为中心开窗，前后都省略', () => {
  const line = `${'A'.repeat(90)}MATCH${'B'.repeat(90)}`
  const display = buildMatchLineDisplay(match(line, 91, 96))
  assert.ok(display.text.includes('MATCH'))
  assert.equal(display.ellipsisBefore, true)
  assert.equal(display.ellipsisAfter, true)
  // 匹配前的可见上下文约等于匹配后的（居中）。
  const offset = display.text.indexOf('MATCH')
  assert.ok(Math.abs(offset - (display.text.length - offset - 5)) <= 2)
})

test('匹配靠近行首：只省略后面', () => {
  const line = `MATCH${'B'.repeat(200)}`
  const display = buildMatchLineDisplay(match(line, 1, 6))
  assert.ok(display.text.startsWith('MATCH'))
  assert.equal(display.ellipsisBefore, false)
  assert.equal(display.ellipsisAfter, true)
})

test('匹配靠近行尾：只省略前面', () => {
  const line = `${'B'.repeat(200)}MATCH`
  const display = buildMatchLineDisplay(match(line, 201, 206))
  assert.ok(display.text.endsWith('MATCH'))
  assert.equal(display.ellipsisBefore, true)
  assert.equal(display.ellipsisAfter, false)
})

test('CJK 按双倍宽度计，匹配仍在窗口内', () => {
  const line = `${'中'.repeat(20)}匹配${'中'.repeat(38)}`
  const display = buildMatchLineDisplay(match(line, 21, 23))
  assert.ok(display.text.includes('匹配'))
  assert.equal(display.ellipsisBefore, true)
  assert.equal(display.ellipsisAfter, true)
})

test('列号超出文本长度时兜底展示行尾', () => {
  const display = buildMatchLineDisplay(match('A'.repeat(80), 200, 205))
  assert.equal(display.ellipsisBefore, true)
  assert.equal(display.ellipsisAfter, false)
  assert.ok(display.text.length > 0)
  // 匹配位置越界时相对偏移收敛到文本末尾，不会渲染出负区间。
  assert.equal(display.matchStart, display.text.length)
  assert.equal(display.matchEnd, display.text.length)
})
