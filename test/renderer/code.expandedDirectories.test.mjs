import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { normalizeRememberedDirectories, isEffectivelyExpanded, collectEffectivelyExpanded, collectRestorableExpanded, collectDescendantPaths, resolveRestorablePath, isRestoreParentActive, canRestoreChild, mergeRememberedInit, collectRememberedChildrenOf, MAX_REMEMBERED_DIRECTORIES } =
  loadTsModule('src/core/renderer/pages/code/code.expandedDirectories.ts')

test('用例 14：normalizeRememberedDirectories 基础规则', () => {
  // 反斜杠统一、去尾斜杠、去重、排序（深度优先）
  assert.deepEqual(normalizeRememberedDirectories(['src\\components', 'src/', 'src', 'docs']), ['docs', 'src', 'src/components'])
  // 拒绝 .. 与 .
  assert.deepEqual(normalizeRememberedDirectories(['src/../src']), undefined)
  assert.deepEqual(normalizeRememberedDirectories(['.']), undefined)
  assert.deepEqual(normalizeRememberedDirectories(['src/.']), undefined)
  // 空段拒绝
  assert.deepEqual(normalizeRememberedDirectories(['a//b']), undefined)
  // 非数组 / 空数组 → undefined
  assert.deepEqual(normalizeRememberedDirectories(undefined), undefined)
  assert.deepEqual(normalizeRememberedDirectories('src'), undefined)
  assert.deepEqual(normalizeRememberedDirectories([]), undefined)
  // 非字符串条目跳过
  assert.deepEqual(normalizeRememberedDirectories(['src', 42, null, {}]), ['src'])
  // 上限 200
  const many = Array.from({ length: 250 }, (_unused, index) => `d${index}`)
  assert.equal(normalizeRememberedDirectories(many)?.length, MAX_REMEMBERED_DIRECTORIES)
  assert.equal(MAX_REMEMBERED_DIRECTORIES, 200)
})

test('用例 20：绝对路径三形态拒绝（D28 校验顺序）', () => {
  // 前导 /（POSIX 风格）
  assert.deepEqual(normalizeRememberedDirectories(['/src']), undefined)
  // 盘符
  assert.deepEqual(normalizeRememberedDirectories(['C:\\src']), undefined)
  assert.deepEqual(normalizeRememberedDirectories(['c:/src']), undefined)
  // UNC
  assert.deepEqual(normalizeRememberedDirectories(['\\\\server\\share']), undefined)
  assert.deepEqual(normalizeRememberedDirectories(['//server/share']), undefined)
  // .. 逃逸
  assert.deepEqual(normalizeRememberedDirectories(['src/../src']), undefined)
  assert.deepEqual(normalizeRememberedDirectories(['../src']), undefined)
  // 中间空段
  assert.deepEqual(normalizeRememberedDirectories(['a//b']), undefined)
  // 合法相对路径不受影响
  assert.deepEqual(normalizeRememberedDirectories(['src', 'src/components']), ['src', 'src/components'])
})

test('用例 15：isEffectivelyExpanded / collectEffectivelyExpanded 父级约束', () => {
  const remembered = new Set(['src', 'src/components/editor'])
  // 祖先（src/components）不在集合中 → editor 不展开
  assert.equal(isEffectivelyExpanded('src/components/editor', remembered), false)
  assert.equal(isEffectivelyExpanded('src', remembered), true)
  assert.deepEqual(collectEffectivelyExpanded(remembered), ['src'])

  // 父链完整 → 全部展开，且父→子有序
  const full = new Set(['src', 'src/components', 'src/components/editor', 'docs'])
  assert.equal(isEffectivelyExpanded('src/components/editor', full), true)
  assert.deepEqual(collectEffectivelyExpanded(full), ['docs', 'src', 'src/components', 'src/components/editor'])

  // 不在集合中
  assert.equal(isEffectivelyExpanded('lib', full), false)
  // 空集合
  assert.deepEqual(collectEffectivelyExpanded(new Set()), [])
})

test('用例 16：collectDescendantPaths 前缀边界', () => {
  const paths = ['src/components', 'src/components2', 'src/components/editor', 'src']
  assert.deepEqual(collectDescendantPaths('src/components', paths), ['src/components/editor'])
  // 不误匹配 src/components2
  assert.ok(!collectDescendantPaths('src/components', paths).includes('src/components2'))
  assert.deepEqual(collectDescendantPaths('src', paths), ['src/components', 'src/components2', 'src/components/editor'])
})

test('用例 17：resolveRestorablePath 逃逸项目根返回 null', () => {
  assert.equal(resolveRestorablePath('D:/repos/app', 'src'), 'D:/repos/app/src')
  assert.equal(resolveRestorablePath('D:/repos/app', 'src/components'), 'D:/repos/app/src/components')
  // .. 逃逸
  assert.equal(resolveRestorablePath('D:/repos/app', '../outside'), null)
  assert.equal(resolveRestorablePath('D:/repos/app', 'src/../../outside'), null)
  // 解析结果等于根
  assert.equal(resolveRestorablePath('D:/repos/app', '.'), null)
  assert.equal(resolveRestorablePath('D:/repos/app', 'src/..'), null)
  // 中间 .. 折叠后仍在根内
  assert.equal(resolveRestorablePath('D:/repos/app', 'src/../lib'), 'D:/repos/app/lib')
  // 空根
  assert.equal(resolveRestorablePath('', 'src'), null)
})

test('用例 21：isRestoreParentActive + canRestoreChild', () => {
  // 根节点父级恒真（D31）
  assert.equal(isRestoreParentActive('', new Set()), true)
  assert.equal(isRestoreParentActive('', new Set(['src'])), true)
  // 其余要求父在 active 中
  assert.equal(isRestoreParentActive('src', new Set(['src'])), true)
  assert.equal(isRestoreParentActive('src/components', new Set(['src'])), false)

  // 三者皆真才恢复
  assert.equal(canRestoreChild({ generationMatch: true, parentActive: true, childInRemembered: true }), true)
  assert.equal(canRestoreChild({ generationMatch: false, parentActive: true, childInRemembered: true }), false)
  assert.equal(canRestoreChild({ generationMatch: true, parentActive: false, childInRemembered: true }), false)
  assert.equal(canRestoreChild({ generationMatch: true, parentActive: true, childInRemembered: false }), false)
})

test('用例 22：mergeRememberedInit 快照优先、缺省回退、非法剔除', () => {
  // 快照优先于 store
  assert.deepEqual(mergeRememberedInit(['src'], ['docs']), ['src'])
  // 快照缺省 → 回退 store
  assert.deepEqual(mergeRememberedInit(undefined, ['docs', 'docs/api']), ['docs', 'docs/api'])
  // 两来源均含非法条目时被剔除
  assert.deepEqual(mergeRememberedInit(['/abs', 'src'], ['../x']), ['src'])
  // 快照为陈旧 active 语义数据（缺中间层）时不得覆盖 store 完整 remembered——
  // 合并发生在 remembered 层：快照即权威，store 完整集合不被陈旧 active 覆盖
  assert.deepEqual(mergeRememberedInit(['src'], ['src', 'src/components', 'src/components/editor']), ['src'])
  // Set 形态快照同样支持
  assert.deepEqual(mergeRememberedInit(new Set(['src', 'docs']), []), ['docs', 'src'])
})

test('用例 27：mergeRememberedInit 三态——空快照 ≠ 缺失快照（D30）', () => {
  // 快照字段缺失 → 回退 store
  assert.deepEqual(mergeRememberedInit(undefined, ['src', 'docs']), ['docs', 'src'])
  // 快照明确为空 → 空即权威，不得复活 store 旧路径
  assert.deepEqual(mergeRememberedInit([], ['src', 'docs']), undefined)
  assert.deepEqual(mergeRememberedInit(new Set(), ['src', 'docs']), undefined)
  assert.deepEqual(mergeRememberedInit(null, ['src', 'docs']), undefined)
  // 快照含非法条目 → 逐条剔除后按剩余内容处理
  assert.deepEqual(mergeRememberedInit(['src', '/abs', 'docs'], ['lib']), ['docs', 'src'])
  // 剔光按明确空：不回退 store
  assert.deepEqual(mergeRememberedInit(['/abs', '..'], ['lib']), undefined)
})

test('用例 28：根节点恢复链——父→子顺序，根节点无标记不中断（D31）', () => {
  const remembered = new Set(['src', 'src/components'])
  // 根节点直接子收集
  assert.deepEqual(collectRememberedChildrenOf('', remembered), ['src'])
  // 第二级
  assert.deepEqual(collectRememberedChildrenOf('src', remembered), ['src/components'])
  // 无直接子的目录返回空
  assert.deepEqual(collectRememberedChildrenOf('src/components', remembered), [])
  // 恢复顺序：collectEffectivelyExpanded 父→子
  assert.deepEqual(collectEffectivelyExpanded(remembered), ['src', 'src/components'])
})

test('collectRestorableExpanded：顶层祖先缺失时兜底补齐（reveal 未转正回归）', () => {
  // 复现 bug 场景：remembered 只有简历/ 下的三个子目录，顶层「简历」靠 reveal 临时展开未转正
  const remembered = new Set(['简历/04-历史备份', '简历/05-照片素材', '简历/项目内容总结'])
  // 纯 effectivelyExpanded 全部不可达
  assert.deepEqual(collectEffectivelyExpanded(remembered), [])
  // 兜底补齐顶层祖先后全部可见，且父→子有序
  assert.deepEqual(collectRestorableExpanded(remembered), ['简历', '简历/04-历史备份', '简历/05-照片素材', '简历/项目内容总结'])

  // 有效展开非空时保持 D20 纯净语义：中间层断裂不强行展开
  const midGap = new Set(['src', 'src/components/editor'])
  assert.deepEqual(collectRestorableExpanded(midGap), ['src'])

  // 空集合
  assert.deepEqual(collectRestorableExpanded(new Set()), [])
  // 完整链不受影响
  const full = new Set(['src', 'src/components'])
  assert.deepEqual(collectRestorableExpanded(full), ['src', 'src/components'])
})

test('用例 29：手动刷新语义数据准备——collectEffectivelyExpanded 不含临时展开', () => {
  // remembered 与 temporaryReveal 分离：刷新后 active = effectivelyExpanded(remembered)，
  // temporaryReveal（如 reveal 文件的祖先）不进入 remembered，刷新即清除（D29 方案 A）。
  const remembered = new Set(['src'])
  const active = new Set([...collectEffectivelyExpanded(remembered), 'src/components']) // components 为 reveal 临时展开
  assert.ok(active.has('src/components'))
  // 刷新重置后临时展开消失、remembered 保留
  assert.deepEqual(collectEffectivelyExpanded(remembered), ['src'])
  // 折叠父目录只删父条目（collectDescendantPaths 仅作用于 active，不动 remembered）
  const rememberedAfterCollapse = new Set(['src', 'src/components', 'src/components/editor'])
  rememberedAfterCollapse.delete('src/components')
  assert.deepEqual(collectEffectivelyExpanded(rememberedAfterCollapse), ['src'])
  assert.ok(rememberedAfterCollapse.has('src/components/editor')) // 深层记忆保留
})
