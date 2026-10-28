/**
 * 会话消息中的项目文件路径识别。
 *
 * 只做纯文本处理：从 AI 消息里提取「看起来像项目文件路径」的候选 token，
 * 并支持把消息文本按已验证的路径切成 文本/文件 两类片段。
 * 代码块（``` 围栏与行内 `code`）中的内容一律保护，不做路径识别，
 * 避免污染 Markdown 渲染。
 */

const PROTECTED_REGION_PATTERN = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g

// 路径 token 只接受 ASCII 路径字符，避免把紧跟路径的中英文正文吞进 token。
const PATH_TOKEN_PATTERN = /(?:[A-Za-z]:[\\/][\w.\-\\/]+)|(?:[\w.\-]+(?:[\\/][\w.\-]+)+)/g

// Markdown 链接 [文字](路径)：目标是已验证文件时整段替换为自定义协议链接。
const MARKDOWN_LINK_PATTERN = /\[([^\]\n]*)\]\(([^()\s]+)\)/g

const TRAILING_NOISE_PATTERN = /[.,;:!?*'"]+$/

function cleanPathToken(raw: string): string {
  return raw.trim().replace(TRAILING_NOISE_PATTERN, '')
}

function isPlausibleFilePath(token: string): boolean {
  if (!token || token.includes('://')) return false
  const segments = token.split(/[\\/]/).filter(Boolean)
  if (segments.length === 0) return false
  const lastSegment = segments[segments.length - 1]
  return /\.[A-Za-z0-9]{1,8}$/.test(lastSegment)
}

/** 提取消息文本中的文件路径候选（去重、跳过代码区域）。 */
export function extractFilePathCandidates(text: string): string[] {
  if (!text) return []
  const stripped = text.replace(PROTECTED_REGION_PATTERN, ' ')
  const candidates = new Set<string>()
  for (const match of stripped.matchAll(PATH_TOKEN_PATTERN)) {
    const token = cleanPathToken(match[0])
    if (!isPlausibleFilePath(token)) continue
    candidates.add(token)
  }
  return [...candidates]
}

/** 绝对路径尝试转为项目内相对路径；项目外返回 null，相对路径原样返回。 */
export function resolveCandidateRelativePath(projectPath: string, candidate: string): string | null {
  if (/^[A-Za-z]:[\\/]/.test(candidate) || candidate.startsWith('/')) {
    const root = projectPath.trim().replace(/\\/g, '/').replace(/\/+$/, '')
    const normalized = candidate.trim().replace(/\\/g, '/')
    const rootPrefix = `${root}/`
    if (normalized.toLowerCase().startsWith(rootPrefix.toLowerCase())) {
      return normalized.slice(rootPrefix.length)
    }
    return null
  }
  return candidate
}

/** 已验证文件路径在 Markdown 内使用的自定义协议，由渲染层 `a` 组件接管。 */
export const SESSION_FILE_LINK_SCHEME = 'session-file://'

/**
 * 把消息文本中「已验证的项目文件路径」内联转换为 Markdown 链接，
 * 让文件 chip 作为链接组件跟随段落/列表项在同一行渲染。
 * resolved 的 key 是 extractFilePathCandidates 输出的原始 token。
 * 围栏代码块与行内代码保持原样，不做转换。
 */
export function inlineMessageFileLinks(text: string, resolved: ReadonlyMap<string, string>): string {
  if (!text || resolved.size === 0) return text
  let result = ''
  let cursor = 0

  const processPlainRegion = (start: number, end: number): string => {
    const region = text.slice(start, end)
    const replacements: Array<{ start: number; end: number; replacement: string }> = []

    // 先收 Markdown 链接 [文字](路径)：整段替换，避免残留中括号小括号。
    for (const match of region.matchAll(MARKDOWN_LINK_PATTERN)) {
      const token = cleanPathToken(match[2] ?? '')
      const relativePath = token ? resolved.get(token) : undefined
      if (!token || !relativePath) continue
      const matchIndex = match.index ?? 0
      const linkText = match[1] || token
      replacements.push({ start: matchIndex, end: matchIndex + match[0].length, replacement: `[${linkText}](${SESSION_FILE_LINK_SCHEME}${encodeURIComponent(relativePath)})` })
    }

    // 再收裸路径 token，落在链接片段内的跳过。
    for (const match of region.matchAll(PATH_TOKEN_PATTERN)) {
      const matchIndex = match.index ?? 0
      const tokenStart = matchIndex
      const tokenEnd = matchIndex + match[0].length
      if (replacements.some((span) => tokenStart >= span.start && tokenEnd <= span.end)) continue
      const token = cleanPathToken(match[0])
      const relativePath = token ? resolved.get(token) : undefined
      if (!token || !relativePath) continue
      replacements.push({ start: tokenStart, end: tokenStart + token.length, replacement: `[${token}](${SESSION_FILE_LINK_SCHEME}${encodeURIComponent(relativePath)})` })
    }

    replacements.sort((a, b) => a.start - b.start)
    let out = ''
    let spanCursor = 0
    for (const span of replacements) {
      if (span.start < spanCursor) continue
      out += region.slice(spanCursor, span.start) + span.replacement
      spanCursor = span.end
    }
    return out + region.slice(spanCursor)
  }

  for (const match of text.matchAll(PROTECTED_REGION_PATTERN)) {
    const regionStart = match.index ?? 0
    const regionEnd = regionStart + match[0].length
    result += processPlainRegion(cursor, regionStart) + text.slice(regionStart, regionEnd)
    cursor = regionEnd
  }
  result += processPlainRegion(cursor, text.length)
  return result
}
