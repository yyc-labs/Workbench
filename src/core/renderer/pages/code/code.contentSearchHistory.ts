export const CODE_CONTENT_SEARCH_HISTORY_STORAGE_KEY = 'workbench.code.contentSearchHistory'
export const CODE_CONTENT_SEARCH_HISTORY_LIMIT = 20

function sanitizeHistory(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()))).slice(0, CODE_CONTENT_SEARCH_HISTORY_LIMIT)
}

export function readContentSearchHistory(): string[] {
  try {
    const raw = window.localStorage.getItem(CODE_CONTENT_SEARCH_HISTORY_STORAGE_KEY)
    return sanitizeHistory(raw ? JSON.parse(raw) : null)
  } catch {
    return []
  }
}

export function recordContentSearchHistory(query: string): string[] {
  const normalized = query.trim()
  const history = readContentSearchHistory()
  if (!normalized) return history
  const next = [normalized, ...history.filter((item) => item !== normalized)].slice(0, CODE_CONTENT_SEARCH_HISTORY_LIMIT)
  try {
    window.localStorage.setItem(CODE_CONTENT_SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 隐私模式等场景 localStorage 不可写，忽略（与侧栏折叠态写入同策略）
  }
  return next
}
