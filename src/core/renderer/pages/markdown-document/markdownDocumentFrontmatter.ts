const CLOSING_MARKER_RE = /^---[ \t]*\r?$/

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 在 frontmatter 原始文本中查找顶层 key 行的索引（跳过开头的 ---，遇到结尾 --- 停止）。
 */
function findEntryLineIndex(lines: string[], key: string): number {
  const pattern = new RegExp(`^${escapeRegExp(key)}[ \\t]*:`, 'i')
  for (let i = 1; i < lines.length; i += 1) {
    if (CLOSING_MARKER_RE.test(lines[i])) break
    if (pattern.test(lines[i])) return i
  }
  return -1
}

function withTrailingNewline(joined: string, hadTrailingNewline: boolean): string {
  return hadTrailingNewline ? `${joined}\n` : joined
}

function toLines(frontmatter: string): { lines: string[]; hadTrailingNewline: boolean } {
  const hadTrailingNewline = frontmatter.endsWith('\n')
  const core = hadTrailingNewline ? frontmatter.slice(0, -1) : frontmatter
  return { lines: core.split('\n'), hadTrailingNewline }
}

function countContinuationLines(lines: string[], keyIndex: number): number {
  let end = keyIndex + 1
  while (end < lines.length && !CLOSING_MARKER_RE.test(lines[end]) && /^\s+-\s/.test(lines[end])) end += 1
  return end - keyIndex - 1
}

/**
 * 新增或更新一个条目：只替换对应 key 的顶层行（及其列表续行），其余原始文本保持不变。
 * nextKey 与 originalKey 不同时实现重命名。key 为空时返回原文。
 */
export function upsertMarkdownFrontmatterEntry(frontmatter: string, originalKey: string, nextKey: string, nextValue: string): string {
  const normalizedKey = nextKey.trim()
  if (!normalizedKey || /[:\r\n]/.test(normalizedKey)) return frontmatter
  const { lines, hadTrailingNewline } = toLines(frontmatter)
  const index = findEntryLineIndex(lines, originalKey)
  const nextLine = nextValue ? `${normalizedKey}: ${nextValue}` : `${normalizedKey}:`
  if (index >= 0) {
    const lineEnding = lines[index].endsWith('\r') ? '\r' : ''
    const continuationCount = countContinuationLines(lines, index)
    lines.splice(index, continuationCount + 1, nextLine + lineEnding)
  } else {
    let closeIndex = -1
    for (let i = lines.length - 1; i >= 1; i -= 1) {
      if (CLOSING_MARKER_RE.test(lines[i])) {
        closeIndex = i
        break
      }
    }
    if (closeIndex >= 0) lines.splice(closeIndex, 0, nextLine)
    else lines.push(nextLine)
  }
  return withTrailingNewline(lines.join('\n'), hadTrailingNewline)
}

/**
 * 删除一个条目：移除对应 key 的顶层行及其列表续行，其余原始文本保持不变。
 */
export function removeMarkdownFrontmatterEntry(frontmatter: string, key: string): string {
  const { lines, hadTrailingNewline } = toLines(frontmatter)
  const index = findEntryLineIndex(lines, key)
  if (index < 0) return frontmatter
  const continuationCount = countContinuationLines(lines, index)
  lines.splice(index, continuationCount + 1)
  return withTrailingNewline(lines.join('\n'), hadTrailingNewline)
}

/**
 * 为没有 frontmatter 的文档创建一个只含初始条目的块。
 */
export function createMarkdownFrontmatterBlock(key: string, value = ''): string {
  return value ? `---\n${key}: ${value}\n---\n` : `---\n${key}:\n---\n`
}
