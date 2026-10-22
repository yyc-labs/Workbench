import type { ProjectFileNode } from '../../../shared/types'
import { fileNameFromRelativePath } from './code.markdownShared'
import { joinProjectPath, normalizeRelativePathForCopy } from './code.pathActions'

/**
 * 文件树多选纯逻辑（16 号计划 §7）。
 *
 * 约束：全部函数确定性、无副作用，不碰 Tree API / 剪贴板 / React 状态；
 * 选中集合的唯一事实来源是 react-arborist 内部 selection，本文件只做输入输出计算。
 */

/** 右键菜单快照中的单个选中项；id 即行 id（规范化前的 relativePath）。 */
export interface SelectedTreeItem {
  id: string
  relativePath: string
  name: string
  kind: 'file' | 'directory'
}

/** 右键菜单打开时生成的不可变快照；菜单存续期间不受树选择变化影响。 */
export interface CodeTreeContextMenuSnapshot {
  projectPath: string
  scopeKey: string
  selectedItems: SelectedTreeItem[]
}

/** active 同步决策（§2.3 纯函数化；2026-10-22 修订后无 'converge'）。 */
export type ActiveSyncPlan = 'reset' | 'keep' | 'noop'

// ── 遍历与查找 ─────────────────────────────────────────────

/** DFS preorder 收集全部节点 id（含目录与排除节点）；已加载但折叠的后代也在 nodes 数据中。 */
export function collectNodeIdsInTreeOrder(nodes: readonly ProjectFileNode[]): string[] {
  const result: string[] = []
  const walk = (items: readonly ProjectFileNode[]) => {
    for (const item of items) {
      result.push(item.relativePath)
      if (item.children && item.children.length > 0) {
        walk(item.children)
      }
    }
  }
  walk(nodes)
  return result
}

/** 扁平搜索模式 = 顶层数组的展示顺序。 */
export function collectFlatResultIds(nodes: readonly ProjectFileNode[]): string[] {
  return nodes.map((item) => item.relativePath)
}

/** 当前 nodes 的 id → 节点查找表（首次出现优先）。 */
export function buildNodeLookup(nodes: readonly ProjectFileNode[]): Map<string, ProjectFileNode> {
  const lookup = new Map<string, ProjectFileNode>()
  const walk = (items: readonly ProjectFileNode[]) => {
    for (const item of items) {
      if (!lookup.has(item.relativePath)) lookup.set(item.relativePath, item)
      if (item.children && item.children.length > 0) {
        walk(item.children)
      }
    }
  }
  walk(nodes)
  return lookup
}

/** 当前上下文的有效 id 集合（C2：只有存在于当前 nodes 的 active 才允许成为选中项）。 */
export function buildValidIdSet(nodes: readonly ProjectFileNode[]): Set<string> {
  return new Set(collectNodeIdsInTreeOrder(nodes))
}

// ── 选择运算 ─────────────────────────────────────────────

/** Ctrl/Cmd 点选：切换目标 id，不影响其他选择。 */
export function toggleSelectionId(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  return next
}

/**
 * Shift 区间：在 visibleIds（当前可见行顺序）上取锚点与目标的闭区间，正反向一致；
 * 锚点无效（不可见 / 不存在）时回退为单选目标。
 */
export function getVisibleRangeIds(visibleIds: readonly string[], anchorId: string | null, targetId: string): string[] {
  const anchorIndex = anchorId == null ? -1 : visibleIds.indexOf(anchorId)
  const targetIndex = visibleIds.indexOf(targetId)
  if (anchorIndex < 0 || targetIndex < 0) return [targetId]
  const start = Math.min(anchorIndex, targetIndex)
  const end = Math.max(anchorIndex, targetIndex)
  return visibleIds.slice(start, end + 1)
}

/** 按 orderedIds 过滤 selected：只过滤不重排（orderedIds 由 collect* 之一提供）。 */
export function orderSelectedIds(orderedIds: readonly string[], selected: ReadonlySet<string>): string[] {
  return orderedIds.filter((id) => selected.has(id))
}

/** 过滤掉不在当前有效集合中的 id（失效清理，保序遍历顺序）。 */
export function filterValidSelectedIds(selected: ReadonlySet<string>, valid: ReadonlySet<string>): string[] {
  return [...selected].filter((id) => valid.has(id))
}

// ── 输出装配（§3.1 四步的前三步） ───────────────────────────

/** 按规范化相对路径去重，保留首次出现，保序。 */
export function dedupeByNormalizedPath<T extends { relativePath: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const item of items) {
    const key = normalizeRelativePathForCopy(item.relativePath)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

/**
 * 批量打包/复制前的条目裁剪（17 号计划 §2.3，防重复打包）：
 * 1. 按规范化相对路径去重（保留首次，保序）；
 * 2. 丢弃是其他目录条目后代的条目（目录整棵子树打包，后代文件/子孙目录不重复进包）；
 * 3. 目录互为父子时保留祖先。
 */
export function pruneEntriesForArchive<T extends { relativePath: string; kind: 'file' | 'directory' }>(entries: readonly T[]): T[] {
  const deduped = dedupeByNormalizedPath(entries)
  const selectedDirectories = deduped.filter((entry) => entry.kind === 'directory').map((entry) => normalizeRelativePathForCopy(entry.relativePath))
  return deduped.filter((entry) => {
    const normalized = normalizeRelativePathForCopy(entry.relativePath)
    // 目录条目只在祖先目录已选中时丢弃；文件条目在任何祖先目录已选中时丢弃。
    return !selectedDirectories.some((directory) => directory !== normalized && normalized.startsWith(directory + '/'))
  })
}

/** 批量「复制文件」显示条件：所选条目全部为 file（含任一文件夹即隐藏，与单选菜单「目录不显示复制文件」同语义）。 */
export function areAllFileEntries(entries: readonly { kind: 'file' | 'directory' }[]): boolean {
  return entries.every((entry) => entry.kind === 'file')
}

/** 相对路径 → 绝对路径（复用 joinProjectPath）。 */
export function toAbsolutePathItems<T extends { relativePath: string }>(items: readonly T[], projectPath: string): { relativePath: string }[] {
  return items.map((item) => ({ relativePath: joinProjectPath(projectPath, item.relativePath) }))
}

/** 相对路径 → 名称（复用 fileNameFromRelativePath）。 */
export function toNameItems<T extends { relativePath: string }>(items: readonly T[]): { relativePath: string }[] {
  return items.map((item) => ({ relativePath: fileNameFromRelativePath(item.relativePath) }))
}

/** 单换行拼接，首尾无多余空行。 */
export function joinLines(items: readonly { relativePath: string }[]): string {
  return items.map((item) => item.relativePath).join('\n')
}

// ── 右键快照构建（§5.2） ─────────────────────────────────

/**
 * 右键事件当时构建不可变快照：
 * 1. 目标已在选中集合且集合非空 → 用集合（按 orderedNodeIds 输出序排列、过滤失效项）；
 * 2. 目标不在选中集合 → 用目标节点数据构建单项快照（不依赖状态更新时序）；
 * 3. 集合整体失效时回退目标单项，保证右键总有菜单。
 */
export function buildContextMenuSnapshot(input: { target: { relativePath: string; name: string; kind: 'file' | 'directory' }; selectedIds: ReadonlySet<string>; orderedNodeIds: readonly string[]; nodeLookup: ReadonlyMap<string, ProjectFileNode>; projectPath: string; scopeKey: string }): CodeTreeContextMenuSnapshot {
  const { target, selectedIds, orderedNodeIds, nodeLookup, projectPath, scopeKey } = input
  const targetItem: SelectedTreeItem = { id: target.relativePath, relativePath: target.relativePath, name: target.name, kind: target.kind }
  let items: SelectedTreeItem[]
  if (selectedIds.size > 0 && selectedIds.has(target.relativePath)) {
    items = orderSelectedIds(orderedNodeIds, selectedIds)
      .map((id) => nodeLookup.get(id))
      .filter((node): node is ProjectFileNode => Boolean(node))
      .map((node) => ({ id: node.relativePath, relativePath: node.relativePath, name: node.name, kind: node.kind }))
    // 集合整体失效（nodes 与 selection 短暂不同步）时回退目标单项，保证右键总有菜单。
    if (items.length === 0) items = [targetItem]
  } else {
    items = [targetItem]
  }
  return { projectPath, scopeKey, selectedItems: items }
}

// ── active 同步决策（§2.3，2026-10-22 用户决策修订） ─────────────────

/**
 * active 同步 effect 的决策纯函数。
 * 修订后语义（用户 2026-10-22：点击文件不触发选中，Ctrl/Shift 才是显式选择）：
 * 选中集合只由 Ctrl toggle / Shift 区间 / scope 清理改变，active 永不自动进入 selection。
 * - 'reset'：scope 变化，调用方清理（deselectAll + 关菜单 + 丢快照 + 清锚点 + 更新 ref）；
 * - 'keep'：active 在当前节点集合且已在选中集合中，保留整个集合（用户显式选过）；
 * - 'noop'：其余一切情况（含 active 有效但未被显式选中）都不写树。
 */
export function planActiveSync(input: { activeId: string | null; validIds: ReadonlySet<string>; selectedIds: ReadonlySet<string>; scopeChanged: boolean }): ActiveSyncPlan {
  if (input.scopeChanged) return 'reset'
  if (input.activeId == null) return 'noop'
  if (!input.validIds.has(input.activeId)) return 'noop'
  if (input.selectedIds.has(input.activeId)) return 'keep'
  return 'noop'
}
