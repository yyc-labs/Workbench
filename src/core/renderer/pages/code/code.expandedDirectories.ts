/**
 * 展开目录持久化纯函数（remembered 集合 + 父级约束派生 active）。
 * 设计见 docs/todo/15-工作区持久化协调器-plan.md §7（D20-D31）。
 *
 * 语义：
 * - remembered（持久化）：路径在集合中 = 用户曾主动展开该目录；折叠父目录只删父条目、保留后代记忆。
 * - active（运行时）：effectivelyExpanded(remembered) ∪ temporaryReveal（文件 reveal 的临时展开）。
 * - 恢复沿可达父子路径逐级推进，不强行展开未记忆的祖先。
 */

/** remembered 集合上限（与 MAX_CODE_SESSION_TABS / MAX_CODE_SESSION_CURSOR_ENTRIES 同风格） */
export const MAX_REMEMBERED_DIRECTORIES = 200

function directoryDepth(path: string): number {
  return path.split('/').length
}

function compareByDepthThenLocale(left: string, right: string): number {
  return directoryDepth(left) - directoryDepth(right) || left.localeCompare(right)
}

/**
 * 归一化 remembered 集合。严格按序（D28，顺序颠倒会把非法输入洗成合法输入）：
 *  1. trim；\ → /（统一分隔符）；去尾部斜杠（前导斜杠永不剥离——那会把 /src 洗成 src）
 *  2. 拒绝绝对路径：前导 /（含 UNC //）、盘符（^[A-Za-z]:）
 *  3. 段校验：拒绝空段、.、..
 *  4. 相对路径规范化：去重、按「深度 + localeCompare」排序（父→子，恢复顺序即排序顺序）
 *  5. 上限 MAX_REMEMBERED_DIRECTORIES；空数组 → undefined
 */
export function normalizeRememberedDirectories(value: unknown, limit: number = MAX_REMEMBERED_DIRECTORIES): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') continue
    // 1. trim + 统一分隔符 + 去尾斜杠
    const unified = item.trim().replace(/\\/g, '/').replace(/\/+$/, '')
    if (!unified) continue
    // 2. 拒绝绝对路径：前导 /（含 UNC //）、盘符
    if (unified.startsWith('/')) continue
    if (/^[A-Za-z]:/.test(unified)) continue
    // 3. 段校验：空段（含中间 //）、.、..
    const segments = unified.split('/')
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) continue
    seen.add(segments.join('/'))
  }
  if (seen.size === 0) return undefined
  return Array.from(seen).sort(compareByDepthThenLocale).slice(0, limit)
}

/** 路径在 remembered 且每一级祖先都在 remembered 中 */
export function isEffectivelyExpanded(path: string, remembered: ReadonlySet<string>): boolean {
  if (!remembered.has(path)) return false
  const segments = path.split('/')
  for (let index = 1; index < segments.length; index += 1) {
    const ancestor = segments.slice(0, index).join('/')
    if (!remembered.has(ancestor)) return false
  }
  return true
}

/** 派生 effectivelyExpanded 集合（父→子有序） */
export function collectEffectivelyExpanded(remembered: ReadonlySet<string>): string[] {
  return Array.from(remembered)
    .filter((path) => isEffectivelyExpanded(path, remembered))
    .sort(compareByDepthThenLocale)
}

/**
 * 恢复期展开集合：effectivelyExpanded + 顶层断裂兜底。
 *
 * 兜底场景：remembered 非空但全部不可达——典型如「reveal 临时展开父目录后只持久化了
 * 子目录」的旧数据（顶层祖先从未进入 remembered）。此时若按纯 effectivelyExpanded
 * 恢复，用户的全部展开记忆都不可见。补齐缺失祖先让记忆可见。
 * 有效展开非空时保持 D20 纯净语义：中间层断裂（如 {src, src/components/editor}）
 * 不强行展开未记忆的中间层，只恢复 src。
 */
export function collectRestorableExpanded(remembered: ReadonlySet<string>): string[] {
  const effective = collectEffectivelyExpanded(remembered)
  if (remembered.size > 0 && effective.length === 0) {
    const patched = new Set(remembered)
    for (const path of remembered) {
      const segments = path.split('/')
      for (let index = 1; index < segments.length; index += 1) {
        patched.add(segments.slice(0, index).join('/'))
      }
    }
    return collectEffectivelyExpanded(patched)
  }
  return effective
}

/** 收集集合中 path 的所有后代（path/ 前缀边界，避免 src/components 误匹配 src/components2） */
export function collectDescendantPaths(path: string, paths: Iterable<string>): string[] {
  const prefix = path + '/'
  return Array.from(paths).filter((item) => item.startsWith(prefix))
}

/**
 * 恢复期第二道闸（D28）：词法 resolve 后必须仍严格位于 projectRoot 之内，否则拒绝该条。
 * 词法校验之外不信任持久化数据（可能过期/损坏/手改）。
 * 符号链接逃逸不在此层防：恢复走既有 listProjectDirectoryFiles IPC，
 * tree-service 已有 realpath + ensureWithinRoot 链（shared.ts:284/297），自动继承。
 */
export function resolveRestorablePath(projectRoot: string, relativePath: string): string | null {
  const normalizedRoot = projectRoot.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalizedRoot) return null
  const rootSegments = normalizedRoot.split('/').filter((segment) => segment !== '')
  if (rootSegments.length === 0) return null
  const relativeSegments = relativePath
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment !== '')
  const stack = [...rootSegments]
  for (const segment of relativeSegments) {
    if (segment === '.') continue
    if (segment === '..') {
      // 弹出到根或以上 = 逃逸出项目根
      if (stack.length <= rootSegments.length) return null
      stack.pop()
      continue
    }
    stack.push(segment)
  }
  // 解析结果等于根本身，不是可恢复目录
  if (stack.length <= rootSegments.length) return null
  return stack.join('/')
}

/** 恢复时的父级判定（D31）：根节点（''）无父约束恒真；其余要求父在 active 中。 */
export function isRestoreParentActive(parentPath: string, active: ReadonlySet<string>): boolean {
  if (parentPath === '') return true
  return active.has(parentPath)
}

/** 恢复决策纯函数（D26）：代次匹配 + 父目录仍 active + 子在 remembered，三者皆真才恢复 */
export function canRestoreChild(input: { generationMatch: boolean; parentActive: boolean; childInRemembered: boolean }): boolean {
  return input.generationMatch && input.parentActive && input.childInRemembered
}

/**
 * 初始化合并纯函数（D25 + D30）：三态区分，不得用归一化返回值推断来源是否存在——
 *  1. 快照字段缺失（undefined）→ 回退 store 归一化结果；
 *  2. 快照存在且为 [] → 空即权威：返回 undefined（空集），不回退 store（否则复活用户已清空的展开）；
 *  3. 快照含非法条目 → 显式降级：逐条剔除后返回剩余合法条目；一条不剩按「明确空」处理（同样不回退）。
 *  实现约束：先判断快照字段是否存在（=== undefined 判定），再执行归一化。
 */
export function mergeRememberedInit(snapshot: unknown, fromStore: unknown): string[] | undefined {
  const snapshotItems = snapshot instanceof Set ? Array.from(snapshot) : snapshot
  if (snapshotItems === undefined) return normalizeRememberedDirectories(fromStore)
  return normalizeRememberedDirectories(snapshotItems)
}

/** remembered 集合中父目录恰为 parentPath 的直接子路径（根节点的直接子是顶层目录） */
export function collectRememberedChildrenOf(parentPath: string, remembered: ReadonlySet<string>): string[] {
  return Array.from(remembered)
    .filter((path) => {
      const index = path.lastIndexOf('/')
      return index <= 0 ? parentPath === '' : path.slice(0, index) === parentPath
    })
    .sort((left, right) => left.localeCompare(right))
}
