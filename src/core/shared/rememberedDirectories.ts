/**
 * remembered 展开目录集合的归一化单一事实源。
 * 消费方：renderer（code.expandedDirectories / appStore.workspaceSlice / useCodeWorkspaceExplorerState）
 * 与 main（config/config-code-session 读写 project-launcher-config.json）。
 * 设计见 docs/todo/15-工作区持久化协调器-plan.md §7（D20-D31）。
 */

/** remembered 集合上限（与 MAX_CODE_SESSION_TABS / MAX_CODE_SESSION_CURSOR_ENTRIES 同风格） */
export const MAX_REMEMBERED_DIRECTORIES = 200

function directoryDepth(path: string): number {
  return path.split('/').length
}

export function compareByDepthThenLocale(left: string, right: string): number {
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
