import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { normalizeCodeSession } = loadTsModule('src/core/electron/main/config/config-code-session.ts')

test('normalizeCodeSession 保留并归一化 expandedDirectories（回归：重启后展开记忆被剥）', () => {
  const result = normalizeCodeSession({
    tabs: ['src/index.ts'],
    expandedDirectories: ['src\\components', 'src/', 'src', 'docs'],
  })
  assert.deepEqual(result?.expandedDirectories, ['docs', 'src', 'src/components'])
})

test('normalizeCodeSession 拒绝绝对路径、盘符与 .. 逃逸', () => {
  assert.equal(normalizeCodeSession({ tabs: [], expandedDirectories: ['/src', 'C:\\x', 'src/../src'] }), undefined)
  const mixed = normalizeCodeSession({ tabs: [], expandedDirectories: ['../evil', 'src'] })
  assert.deepEqual(mixed?.expandedDirectories, ['src'])
})

test('无 tabs 但含展开记忆的会话不被丢弃（空会话守卫须计入 expandedDirectories）', () => {
  const result = normalizeCodeSession({ tabs: [], expandedDirectories: ['src'] })
  assert.ok(result)
  assert.deepEqual(result.tabs, [])
  assert.deepEqual(result.expandedDirectories, ['src'])
})

test('normalizeCodeSession 对全空输入返回 undefined', () => {
  assert.equal(normalizeCodeSession(undefined), undefined)
  assert.equal(normalizeCodeSession('src'), undefined)
  assert.equal(normalizeCodeSession({}), undefined)
  assert.equal(normalizeCodeSession({ tabs: [] }), undefined)
  assert.equal(normalizeCodeSession({ tabs: [], expandedDirectories: [] }), undefined)
})

test('normalizeCodeSession 保持 tabs 去重与上限、activePath 归属 tabs', () => {
  const result = normalizeCodeSession({
    tabs: ['a.ts', 'a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'],
    activePath: 'e.ts',
  })
  assert.deepEqual(result?.tabs, ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'])
  assert.equal(result?.activePath, 'e.ts')
  // activePath 不在 tabs 中时回退首个 tab
  const fallback = normalizeCodeSession({ tabs: ['a.ts'], activePath: 'ghost.ts' })
  assert.equal(fallback?.activePath, 'a.ts')
})

test('normalizeCodeSession 保留并归一化 contentSearchHistory / contentSearchScope（回归：重启后被剥）', () => {
  const result = normalizeCodeSession({
    tabs: ['src/a.ts'],
    contentSearchHistory: ['  foo  ', 'foo', '', 'bar'],
    contentSearchScope: '  src, docs  ',
  })
  assert.deepEqual(result?.contentSearchHistory, ['foo', 'bar'])
  assert.equal(result?.contentSearchScope, 'src, docs')
})

test('normalizeCodeSession contentSearchHistory 上限 12、空值归一为 undefined', () => {
  const many = Array.from({ length: 20 }, (_unused, index) => `q${index}`)
  const capped = normalizeCodeSession({ tabs: [], contentSearchHistory: many })
  assert.equal(capped?.contentSearchHistory?.length, 12)
  // 全空白历史 + 空白 scope → 无任何有效内容 → 整个会话丢弃
  assert.equal(normalizeCodeSession({ tabs: [], contentSearchHistory: ['', '  '] }), undefined)
  assert.equal(normalizeCodeSession({ tabs: [], contentSearchScope: '   ' }), undefined)
  assert.equal(normalizeCodeSession({ tabs: [], contentSearchScope: '' }), undefined)
})

test('无 tabs 但含搜索历史/范围的会话不被丢弃（空会话守卫须计入这两个字段）', () => {
  const history = normalizeCodeSession({ tabs: [], contentSearchHistory: ['foo'] })
  assert.ok(history)
  assert.deepEqual(history.contentSearchHistory, ['foo'])
  const scope = normalizeCodeSession({ tabs: [], contentSearchScope: 'src' })
  assert.ok(scope)
  assert.equal(scope.contentSearchScope, 'src')
})

test('normalizeCodeSession cursorPositions 归一化与上限不变', () => {
  const positions = {}
  for (let index = 0; index < 65; index += 1) {
    positions[`p${index}.ts`] = { lineNumber: index + 1, column: 1 }
  }
  const result = normalizeCodeSession({ tabs: ['p0.ts'], cursorPositions: positions })
  assert.equal(Object.keys(result?.cursorPositions ?? {}).length, 60)
  // 非法光标条目被剔除
  const cleaned = normalizeCodeSession({ tabs: ['a.ts'], cursorPositions: { 'a.ts': { lineNumber: 'x', column: 1 } } })
  assert.equal(cleaned?.cursorPositions, undefined)
})
