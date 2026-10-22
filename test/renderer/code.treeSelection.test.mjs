import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const {
  areAllFileEntries,
  buildContextMenuSnapshot,
  buildNodeLookup,
  buildValidIdSet,
  collectFlatResultIds,
  collectNodeIdsInTreeOrder,
  dedupeByNormalizedPath,
  filterValidSelectedIds,
  getVisibleRangeIds,
  joinLines,
  orderSelectedIds,
  planActiveSync,
  pruneEntriesForArchive,
  toAbsolutePathItems,
  toNameItems,
  toggleSelectionId,
} = loadTsModule('src/core/renderer/pages/code/code.treeSelection.ts')

function node(relativePath, kind, children) {
  const name = relativePath.split('/').pop()
  return children ? { name, relativePath, kind, children } : { name, relativePath, kind }
}

// 树结构（父先子 DFS）：
// src/
//   index.ts
//   utils/
//     helper.ts
// test/
//   index.ts
const treeNodes = [node('src', 'directory', [node('src/index.ts', 'file'), node('src/utils', 'directory', [node('src/utils/helper.ts', 'file')])]), node('test', 'directory', [node('test/index.ts', 'file')])]

test('collectNodeIdsInTreeOrder walks DFS preorder including directories', () => {
  assert.deepEqual(collectNodeIdsInTreeOrder(treeNodes), ['src', 'src/index.ts', 'src/utils', 'src/utils/helper.ts', 'test', 'test/index.ts'])
})

test('collectFlatResultIds keeps the flat array order', () => {
  const flatNodes = [node('b/x.ts', 'file'), node('a/y.ts', 'file')]
  assert.deepEqual(collectFlatResultIds(flatNodes), ['b/x.ts', 'a/y.ts'])
})

test('buildNodeLookup and buildValidIdSet cover nested descendants', () => {
  const lookup = buildNodeLookup(treeNodes)
  assert.equal(lookup.get('src/utils/helper.ts')?.kind, 'file')
  assert.equal(lookup.has('src/missing.ts'), false)
  const valid = buildValidIdSet(treeNodes)
  assert.equal(valid.has('src/utils'), true)
  assert.equal(valid.has('src/utils/helper.ts'), true)
  assert.equal(valid.has('nope.ts'), false)
})

test('toggleSelectionId adds and removes without touching other ids', () => {
  const selected = new Set(['a', 'b'])
  const added = toggleSelectionId(selected, 'c')
  assert.deepEqual([...added], ['a', 'b', 'c'])
  const removed = toggleSelectionId(added, 'a')
  assert.deepEqual([...removed], ['b', 'c'])
  // 原集合不被修改
  assert.deepEqual([...selected], ['a', 'b'])
})

test('getVisibleRangeIds returns a closed interval in both directions', () => {
  const visible = ['src', 'src/index.ts', 'src/utils', 'test', 'test/index.ts']
  assert.deepEqual(getVisibleRangeIds(visible, 'src/index.ts', 'test'), ['src/index.ts', 'src/utils', 'test'])
  assert.deepEqual(getVisibleRangeIds(visible, 'test', 'src/index.ts'), ['src/index.ts', 'src/utils', 'test'])
})

test('getVisibleRangeIds falls back to single target when anchor is invalid', () => {
  const visible = ['src', 'src/index.ts']
  assert.deepEqual(getVisibleRangeIds(visible, 'gone.ts', 'src/index.ts'), ['src/index.ts'])
  assert.deepEqual(getVisibleRangeIds(visible, null, 'src/index.ts'), ['src/index.ts'])
})

test('orderSelectedIds filters without reordering', () => {
  const ordered = ['src', 'src/index.ts', 'src/utils', 'src/utils/helper.ts', 'test', 'test/index.ts']
  const selected = new Set(['test/index.ts', 'src/index.ts'])
  assert.deepEqual(orderSelectedIds(ordered, selected), ['src/index.ts', 'test/index.ts'])
})

test('filterValidSelectedIds drops stale ids in traversal order', () => {
  const valid = new Set(['src/index.ts', 'test/index.ts'])
  assert.deepEqual(filterValidSelectedIds(new Set(['src/index.ts', 'deleted.ts', 'test/index.ts']), valid), ['src/index.ts', 'test/index.ts'])
})

test('dedupeByNormalizedPath keeps first occurrence and order', () => {
  const items = [{ relativePath: 'src/index.ts' }, { relativePath: 'test/index.ts' }, { relativePath: 'src\\index.ts' }, { relativePath: ' src/index.ts ' }]
  const deduped = dedupeByNormalizedPath(items)
  assert.equal(deduped.length, 2)
  assert.deepEqual(
    deduped.map((item) => item.relativePath),
    ['src/index.ts', 'test/index.ts'],
  )
})

test('toAbsolutePathItems and toNameItems reuse existing path helpers', () => {
  const items = [{ relativePath: 'src/index.ts' }, { relativePath: 'test/index.ts' }]
  assert.deepEqual(toAbsolutePathItems(items, 'D:\\repo'), [{ relativePath: 'D:\\repo\\src\\index.ts' }, { relativePath: 'D:\\repo\\test\\index.ts' }])
  assert.deepEqual(toAbsolutePathItems(items, '/repo'), [{ relativePath: '/repo/src/index.ts' }, { relativePath: '/repo/test/index.ts' }])
  assert.deepEqual(toNameItems(items), [{ relativePath: 'index.ts' }, { relativePath: 'index.ts' }])
})

test('joinLines joins with single newline and no padding', () => {
  assert.equal(joinLines([{ relativePath: 'src/index.ts' }, { relativePath: 'test/index.ts' }]), 'src/index.ts\ntest/index.ts')
  assert.equal(joinLines([{ relativePath: 'src/index.ts' }]), 'src/index.ts')
  assert.equal(joinLines([]), '')
})

test('buildContextMenuSnapshot uses the selected set ordered by output order when target is selected', () => {
  const snapshot = buildContextMenuSnapshot({
    target: { relativePath: 'test/index.ts', name: 'index.ts', kind: 'file' },
    selectedIds: new Set(['test/index.ts', 'src/index.ts']),
    orderedNodeIds: collectNodeIdsInTreeOrder(treeNodes),
    nodeLookup: buildNodeLookup(treeNodes),
    projectPath: 'D:\\repo',
    scopeKey: 'D:\\repo::tree::',
  })
  assert.deepEqual(
    snapshot.selectedItems.map((item) => item.id),
    ['src/index.ts', 'test/index.ts'],
  )
  assert.deepEqual(snapshot.selectedItems[0], { id: 'src/index.ts', relativePath: 'src/index.ts', name: 'index.ts', kind: 'file' })
  assert.equal(snapshot.projectPath, 'D:\\repo')
  assert.equal(snapshot.scopeKey, 'D:\\repo::tree::')
})

test('buildContextMenuSnapshot drops stale ids missing from current nodes', () => {
  const snapshot = buildContextMenuSnapshot({
    target: { relativePath: 'src/index.ts', name: 'index.ts', kind: 'file' },
    selectedIds: new Set(['src/index.ts', 'deleted.ts']),
    orderedNodeIds: collectNodeIdsInTreeOrder(treeNodes),
    nodeLookup: buildNodeLookup(treeNodes),
    projectPath: 'D:\\repo',
    scopeKey: 'scope',
  })
  assert.deepEqual(
    snapshot.selectedItems.map((item) => item.id),
    ['src/index.ts'],
  )
})

test('buildContextMenuSnapshot builds a single-item snapshot when target is not selected', () => {
  const snapshot = buildContextMenuSnapshot({
    target: { relativePath: 'src/utils', name: 'utils', kind: 'directory' },
    selectedIds: new Set(['test/index.ts']),
    orderedNodeIds: collectNodeIdsInTreeOrder(treeNodes),
    nodeLookup: buildNodeLookup(treeNodes),
    projectPath: 'D:\\repo',
    scopeKey: 'scope',
  })
  assert.deepEqual(snapshot.selectedItems, [{ id: 'src/utils', relativePath: 'src/utils', name: 'utils', kind: 'directory' }])
})

test('buildContextMenuSnapshot falls back to the target when the whole selected set is stale', () => {
  const snapshot = buildContextMenuSnapshot({
    target: { relativePath: 'gone.ts', name: 'gone.ts', kind: 'file' },
    selectedIds: new Set(['gone.ts']),
    orderedNodeIds: collectNodeIdsInTreeOrder(treeNodes),
    nodeLookup: buildNodeLookup(treeNodes),
    projectPath: 'D:\\repo',
    scopeKey: 'scope',
  })
  assert.deepEqual(snapshot.selectedItems, [{ id: 'gone.ts', relativePath: 'gone.ts', name: 'gone.ts', kind: 'file' }])
})

test('buildContextMenuSnapshot snapshot is immutable for the menu lifetime', () => {
  const orderedNodeIds = collectNodeIdsInTreeOrder(treeNodes)
  const snapshot = buildContextMenuSnapshot({
    target: { relativePath: 'src/index.ts', name: 'index.ts', kind: 'file' },
    selectedIds: new Set(['src/index.ts']),
    orderedNodeIds,
    nodeLookup: buildNodeLookup(treeNodes),
    projectPath: 'D:\\repo',
    scopeKey: 'scope',
  })
  const before = JSON.stringify(snapshot)
  // 菜单打开后树选择变化不影响该次快照（快照不再引用任何树状态）。
  assert.equal(JSON.stringify(snapshot), before)
  assert.equal(Object.isFrozen(snapshot.selectedItems), false)
  assert.equal(snapshot.selectedItems.length, 1)
})

test('buildContextMenuSnapshot uses the flat display order in flat mode', () => {
  const flatNodes = [node('b/x.ts', 'file'), node('a/y.ts', 'file')]
  const snapshot = buildContextMenuSnapshot({
    target: { relativePath: 'a/y.ts', name: 'y.ts', kind: 'file' },
    selectedIds: new Set(['a/y.ts', 'b/x.ts']),
    orderedNodeIds: collectFlatResultIds(flatNodes),
    nodeLookup: buildNodeLookup(flatNodes),
    projectPath: 'D:\\repo',
    scopeKey: 'scope::flat::',
  })
  assert.deepEqual(
    snapshot.selectedItems.map((item) => item.id),
    ['b/x.ts', 'a/y.ts'],
  )
})

test('planActiveSync resets on scope change regardless of active', () => {
  const valid = new Set(['src/index.ts'])
  assert.equal(planActiveSync({ activeId: 'src/index.ts', validIds: valid, selectedIds: new Set(['src/index.ts']), scopeChanged: true }), 'reset')
  assert.equal(planActiveSync({ activeId: null, validIds: valid, selectedIds: new Set(), scopeChanged: true }), 'reset')
})

test('planActiveSync no-ops when active is empty or outside current nodes', () => {
  const valid = new Set(['src/index.ts'])
  assert.equal(planActiveSync({ activeId: null, validIds: valid, selectedIds: new Set(['src/index.ts']), scopeChanged: false }), 'noop')
  assert.equal(planActiveSync({ activeId: 'flat-only.ts', validIds: valid, selectedIds: new Set(['flat-only.ts']), scopeChanged: false }), 'noop')
})

test('planActiveSync keeps multi-selection when active is already selected', () => {
  const valid = new Set(['src/index.ts', 'src/utils/helper.ts'])
  assert.equal(planActiveSync({ activeId: 'src/index.ts', validIds: valid, selectedIds: new Set(['src/index.ts', 'src/utils/helper.ts']), scopeChanged: false }), 'keep')
})

test('planActiveSync never writes selection for an unselected active (2026-10-22 revision)', () => {
  const valid = new Set(['src/index.ts', 'src/utils/helper.ts'])
  // 普通点击打开文件 / 外部标签切换改 active：active 不进入 selection，也不清空既有选择。
  assert.equal(planActiveSync({ activeId: 'src/utils/helper.ts', validIds: valid, selectedIds: new Set(['src/index.ts']), scopeChanged: false }), 'noop')
  assert.equal(planActiveSync({ activeId: 'src/utils/helper.ts', validIds: valid, selectedIds: new Set(), scopeChanged: false }), 'noop')
})

function archiveFile(relativePath) {
  const segments = relativePath.split('/')
  return { id: relativePath, relativePath, name: segments[segments.length - 1], kind: 'file' }
}

function archiveDirectory(relativePath) {
  const segments = relativePath.split('/')
  return { id: relativePath, relativePath, name: segments[segments.length - 1], kind: 'directory' }
}

test('pruneEntriesForArchive dedupes by normalized path and keeps first occurrence order', () => {
  const pruned = pruneEntriesForArchive([archiveFile('src/a.ts'), archiveFile('src\\a.ts'), archiveFile('src/b.ts')])
  assert.deepEqual(
    pruned.map((entry) => entry.relativePath),
    ['src/a.ts', 'src/b.ts'],
  )
})

test('pruneEntriesForArchive drops descendants covered by a selected directory', () => {
  // 目录 + 其后代文件/子孙目录同时选中：只保留目录本身，避免重复打包。
  const pruned = pruneEntriesForArchive([archiveFile('src/utils/helper.ts'), archiveDirectory('src/utils'), archiveFile('src/utils/deep/nested.ts')])
  assert.deepEqual(
    pruned.map((entry) => entry.relativePath),
    ['src/utils'],
  )
})

test('pruneEntriesForArchive drops descendant directories and keeps the ancestor directory', () => {
  const pruned = pruneEntriesForArchive([archiveDirectory('src'), archiveFile('src/index.ts'), archiveDirectory('src/utils'), archiveFile('src/utils/helper.ts')])
  assert.deepEqual(
    pruned.map((entry) => entry.relativePath),
    ['src'],
  )
})

test('pruneEntriesForArchive keeps sibling directories and only drops covered files', () => {
  // src/utils 与 src/core 互为兄弟：两个目录都保留；src/utils 的后代文件被目录吸收。
  const pruned = pruneEntriesForArchive([archiveDirectory('src/utils'), archiveDirectory('src/core'), archiveFile('src/utils/helper.ts')])
  assert.deepEqual(
    pruned.map((entry) => entry.relativePath),
    ['src/utils', 'src/core'],
  )
})

test('pruneEntriesForArchive leaves all-file selections untouched and handles edge inputs', () => {
  const files = [archiveFile('src/a.ts'), archiveFile('docs/readme.md'), archiveFile('package.json')]
  assert.deepEqual(
    pruneEntriesForArchive(files).map((entry) => entry.relativePath),
    ['src/a.ts', 'docs/readme.md', 'package.json'],
  )
  assert.deepEqual(pruneEntriesForArchive([]), [])
  assert.deepEqual(
    pruneEntriesForArchive([archiveDirectory('src')]).map((entry) => entry.relativePath),
    ['src'],
  )
})

test('areAllFileEntries gates the batch copy-files menu item', () => {
  assert.equal(areAllFileEntries([archiveFile('a.ts'), archiveFile('b/c.ts')]), true)
  assert.equal(areAllFileEntries([archiveFile('a.ts'), archiveDirectory('src')]), false)
  assert.equal(areAllFileEntries([archiveDirectory('src')]), false)
})
