/**
 * 终端内链接识别（纯函数）：从单行文本提取 http(s) 链接及 0-based 列区间。
 *
 * xterm 的 registerLinkProvider 以「行」为单位回调，range 坐标为 1-based（x/y 均是），
 * 由 Terminal 组件侧换算；这里保持零依赖以便 node 单测。
 * 只匹配单行：跨行折行的长链接会匹配到前半段（与 @xterm/addon-web-links 同限制）。
 */

export interface TerminalLinkMatch {
  /** 链接文本（已剥离句尾标点） */
  text: string
  /** 0-based 起始列（含） */
  start: number
  /** 0-based 结束列（不含） */
  end: number
}

const URL_PATTERN = /\bhttps?:\/\/[^\s'"<>\\]+/gi

/** 句尾标点不进链接：`https://a.com.` 的句号、`(https://a.com)` 的右括号等。 */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}>'"\u2019\u201d]+$/

export function extractTerminalLinks(lineText: string): TerminalLinkMatch[] {
  const matches: TerminalLinkMatch[] = []
  // 每次新建正则：复用带 g 标志的正则会跨调用残留 lastIndex。
  const pattern = new RegExp(URL_PATTERN.source, 'gi')
  let match: RegExpExecArray | null
  while ((match = pattern.exec(lineText)) !== null) {
    const trimmed = match[0].replace(TRAILING_PUNCTUATION, '')
    if (!trimmed) continue
    matches.push({ text: trimmed, start: match.index, end: match.index + trimmed.length })
  }
  return matches
}
