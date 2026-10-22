import { normalizeRememberedDirectories } from '../../../shared/rememberedDirectories'
import type { ProjectCodeSession } from '../../../shared/types'

const MAX_CODE_SESSION_TABS = 5
const MAX_CODE_SESSION_CURSOR_ENTRIES = 60
const MAX_CODE_SESSION_CONTENT_SEARCH_HISTORY = 12

// 与 renderer store（appStore.workspaceSlice.ts setProjectCodeSession）同规则；
// tabs/cursor 同样是两层各自校验的边界模式，glob 解析在搜索时进行、不进持久化。
function normalizeContentSearchHistory(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const normalized = Array.from(new Set(value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter((item) => item.length > 0))).slice(0, MAX_CODE_SESSION_CONTENT_SEARCH_HISTORY)
  return normalized.length > 0 ? normalized : undefined
}

function normalizeContentSearchScope(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

/**
 * project.codeSession 的读归一化（loadConfig 的 projects / removedProjects 快照共用）。
 * expandedDirectories（remembered 展开集合）与 renderer 共用 shared 单一事实源；
 * 字段缺失 → undefined，由 renderer 三态合并（D30）决定是否回退 store 值。
 * 注意：「无 tabs 但有持久记忆」的会话必须保留——早先只按 tabs/cursor 判空，
 * 重启后 loadConfig 会把 expandedDirectories / contentSearchHistory / contentSearchScope
 * 连同整个 codeSession 一起剥掉，文件树展开状态与内容搜索历史、范围全部丢失
 * （展开状态在手动刷新把 active 重置为空 remembered 时集中暴露）。
 */
export function normalizeCodeSession(value: unknown): ProjectCodeSession | undefined {
  if (!value || typeof value !== 'object') return undefined

  const raw = value as {
    tabs?: unknown
    activePath?: unknown
    cursorPositions?: unknown
    contentSearchHistory?: unknown
    contentSearchScope?: unknown
    expandedDirectories?: unknown
  }
  const tabs = Array.isArray(raw.tabs)
    ? Array.from(
        new Set(
          raw.tabs
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ).slice(0, MAX_CODE_SESSION_TABS)
    : []

  const activePath = typeof raw.activePath === 'string' ? raw.activePath.trim() : ''

  const cursorEntries: Array<[string, { lineNumber: number; column: number }]> = []
  if (raw.cursorPositions && typeof raw.cursorPositions === 'object') {
    for (const [rawPath, rawPosition] of Object.entries(raw.cursorPositions as Record<string, unknown>)) {
      const path = rawPath.trim()
      if (!path) continue
      if (!rawPosition || typeof rawPosition !== 'object') continue
      const lineNumber = Math.max(1, Math.floor(Number((rawPosition as { lineNumber?: unknown }).lineNumber)))
      const column = Math.max(1, Math.floor(Number((rawPosition as { column?: unknown }).column)))
      if (!Number.isFinite(lineNumber) || !Number.isFinite(column)) continue
      cursorEntries.push([path, { lineNumber, column }])
      if (cursorEntries.length >= MAX_CODE_SESSION_CURSOR_ENTRIES) break
    }
  }

  const cursorPositions = cursorEntries.length > 0 ? Object.fromEntries(cursorEntries) : undefined
  const contentSearchHistory = normalizeContentSearchHistory(raw.contentSearchHistory)
  const contentSearchScope = normalizeContentSearchScope(raw.contentSearchScope)
  const expandedDirectories = normalizeRememberedDirectories(raw.expandedDirectories)

  const normalizedActivePath = activePath && tabs.includes(activePath) ? activePath : tabs[0]

  if (tabs.length <= 0 && !cursorPositions && !contentSearchHistory && !contentSearchScope && !expandedDirectories) return undefined

  return {
    tabs,
    activePath: normalizedActivePath,
    cursorPositions,
    contentSearchHistory,
    contentSearchScope,
    expandedDirectories,
  }
}
