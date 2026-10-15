export const MAX_CONTENT_SEARCH_SCOPE_GLOBS = 24
const CONTENT_SEARCH_SCOPE_SEPARATOR_RE = /[\s,;\n，；]+/

// 路径语义优先：含 `/` 的一律按路径处理（无论是否点前缀），单段 token 保留扩展名语义。
export function normalizeContentSearchScopeToken(value: string): string {
  const token = value.trim().replace(/\\/g, '/')
  if (!token) return ''
  if (token.includes('/')) {
    const normalized = token
      .replace(/\/+$/, '') // 去尾斜杠
      .replace(/^\.\//, '') // 去前导 ./，避免 rg 锚定 glob 匹配不到
    if (!normalized) return ''
    if (normalized.includes('*')) return normalized // 用户已写 glob，如 src/*.ts、docs/**，原样保留
    return `${normalized}/**`
  }
  if (token.startsWith('.')) return `*${token}` // .tsx → *.tsx（rg 非锚定，匹配任意层级）
  if (!token.includes('*') && /^[A-Za-z0-9_-]+$/.test(token)) return `*.${token}` // tsx → *.tsx
  return token
}

export function parseContentSearchScopeGlobs(scopeInput: string): string[] {
  const tokens = scopeInput
    .split(CONTENT_SEARCH_SCOPE_SEPARATOR_RE)
    .map(normalizeContentSearchScopeToken)
    .filter((item) => item.length > 0)
  return Array.from(new Set(tokens)).slice(0, MAX_CONTENT_SEARCH_SCOPE_GLOBS)
}

export function contentSearchScopeKey(scopeInput: string): string {
  return parseContentSearchScopeGlobs(scopeInput).join('\n')
}
