export type LearningMarkdownTemplateKey =
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'inlineCode'
  | 'codeBlock'
  | 'blockquote'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'link'
  | 'image'
  | 'horizontalRule'
  | 'knowledgePoints'
  | 'summarySection'
  | 'reviewChecklist'
  | 'pitfallsSection'
  | 'referencesSection'

export type LearningMarkdownInsertRequest =
  | {
      kind: 'template'
      template: LearningMarkdownTemplateKey
      count?: number
    }
  | {
      kind: 'table'
      rows: number
      columns: number
    }

export interface LearningMarkdownEditResult {
  value: string
  selectionStart: number
  selectionEnd: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function normalizeRange(value: string, start: number, end: number) {
  const length = value.length
  const safeStart = clamp(start, 0, length)
  const safeEnd = clamp(end, safeStart, length)
  return {
    start: safeStart,
    end: safeEnd,
    selectedText: value.slice(safeStart, safeEnd),
  }
}

function replaceRange(
  value: string,
  start: number,
  end: number,
  replacement: string,
  selectionStartOffset: number,
  selectionEndOffset: number
): LearningMarkdownEditResult {
  const nextValue = `${value.slice(0, start)}${replacement}${value.slice(end)}`
  return {
    value: nextValue,
    selectionStart: start + selectionStartOffset,
    selectionEnd: start + selectionEndOffset,
  }
}

function computeBlockPrefix(value: string, start: number): string {
  if (start <= 0) return ''
  if (value[start - 1] !== '\n') return '\n\n'
  if (start >= 2 && value[start - 2] === '\n') return ''
  return '\n'
}

function computeBlockSuffix(value: string, end: number): string {
  if (end >= value.length) return ''
  if (value[end] !== '\n') return '\n\n'
  if (end + 1 < value.length && value[end + 1] === '\n') return ''
  return '\n'
}

function replaceRangeWithBlock(
  value: string,
  start: number,
  end: number,
  block: string,
  selectionStartOffset: number,
  selectionEndOffset: number
): LearningMarkdownEditResult {
  const prefix = computeBlockPrefix(value, start)
  const suffix = computeBlockSuffix(value, end)
  const replacement = `${prefix}${block}${suffix}`
  return replaceRange(
    value,
    start,
    end,
    replacement,
    prefix.length + selectionStartOffset,
    prefix.length + selectionEndOffset
  )
}

function normalizeInlineSelection(selectedText: string, fallback: string): string {
  const normalized = selectedText.trim().replace(/\s*\n+\s*/g, ' ')
  return normalized || fallback
}

function wrapInline(
  value: string,
  start: number,
  end: number,
  prefix: string,
  suffix: string,
  placeholder: string
): LearningMarkdownEditResult {
  const { selectedText } = normalizeRange(value, start, end)
  const hasSelection = start !== end
  const innerText = hasSelection ? selectedText : placeholder
  const replacement = `${prefix}${innerText}${suffix}`
  if (hasSelection) {
    return replaceRange(value, start, end, replacement, replacement.length, replacement.length)
  }
  return replaceRange(value, start, end, replacement, prefix.length, prefix.length + innerText.length)
}

function transformSelectedLines(
  value: string,
  start: number,
  end: number,
  transformLine: (line: string, index: number) => string
): LearningMarkdownEditResult {
  const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  const lineEndIndex = value.indexOf('\n', end)
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex
  const block = value.slice(lineStart, lineEnd)
  const transformed = block
    .split('\n')
    .map((line, index) => transformLine(line, index))
    .join('\n')
  return replaceRange(value, lineStart, lineEnd, transformed, 0, transformed.length)
}

function withInsertedMarker(line: string, marker: string): string {
  if (!line.trim()) return line
  const match = /^(\s*)(.*)$/.exec(line)
  if (!match) return `${marker}${line}`
  return `${match[1]}${marker}${match[2]}`
}

function insertHeading(
  value: string,
  start: number,
  end: number,
  level: 1 | 2 | 3
): LearningMarkdownEditResult {
  const prefix = `${'#'.repeat(level)} `
  const { selectedText } = normalizeRange(value, start, end)
  const hasSelection = start !== end
  const headingText = normalizeInlineSelection(
    selectedText,
    level === 1 ? '一级标题' : level === 2 ? '二级标题' : '三级标题'
  )
  const replacement = `${prefix}${headingText}`
  if (hasSelection) {
    return replaceRange(value, start, end, replacement, replacement.length, replacement.length)
  }
  return replaceRange(value, start, end, replacement, prefix.length, replacement.length)
}

function insertCodeBlock(value: string, start: number, end: number): LearningMarkdownEditResult {
  const { selectedText } = normalizeRange(value, start, end)
  const codeText = selectedText || 'code'
  const block = ['```text', codeText, '```'].join('\n')
  const codeStartOffset = '```text\n'.length
  const codeEndOffset = codeStartOffset + codeText.length
  if (start !== end) {
    return replaceRangeWithBlock(value, start, end, block, block.length, block.length)
  }
  return replaceRangeWithBlock(value, start, end, block, codeStartOffset, codeEndOffset)
}

function insertListTemplate(
  value: string,
  start: number,
  end: number,
  template: 'bulletList' | 'orderedList' | 'taskList',
  count = 1
): LearningMarkdownEditResult {
  const safeCount = clamp(Math.floor(count), 1, 12)
  if (start === end) {
    if (template === 'bulletList') {
      const lines = Array.from({ length: safeCount }, () => '- 列表项')
      const replacement = lines.join('\n')
      return replaceRange(value, start, end, replacement, 2, 5)
    }
    if (template === 'orderedList') {
      const lines = Array.from({ length: safeCount }, (_, index) => `${index + 1}. 列表项`)
      const replacement = lines.join('\n')
      return replaceRange(value, start, end, replacement, 3, 6)
    }
    const lines = Array.from({ length: safeCount }, () => '- [ ] 待办事项')
    const replacement = lines.join('\n')
    return replaceRange(value, start, end, replacement, 6, 10)
  }

  let visibleIndex = 0
  return transformSelectedLines(value, start, end, (line) => {
    if (!line.trim()) return line
    if (template === 'bulletList') return withInsertedMarker(line, '- ')
    if (template === 'taskList') return withInsertedMarker(line, '- [ ] ')
    visibleIndex += 1
    return withInsertedMarker(line, `${visibleIndex}. `)
  })
}

function insertBlockquote(value: string, start: number, end: number): LearningMarkdownEditResult {
  if (start === end) {
    return replaceRange(value, start, end, '> 引用', 2, 4)
  }
  return transformSelectedLines(value, start, end, (line) => {
    const match = /^(\s*)(.*)$/.exec(line)
    if (!match) return `> ${line}`
    if (!match[2]) return `${match[1]}>`
    return `${match[1]}> ${match[2]}`
  })
}

function insertLink(value: string, start: number, end: number, asImage: boolean): LearningMarkdownEditResult {
  const { selectedText } = normalizeRange(value, start, end)
  const label = selectedText || (asImage ? '图片描述' : '链接文字')
  const url = asImage ? 'https://example.com/image.png' : 'https://example.com'
  const prefix = asImage ? '![' : '['
  const replacement = `${prefix}${label}](${url})`
  const urlStart = replacement.indexOf(url)
  const urlEnd = urlStart + url.length
  return replaceRange(value, start, end, replacement, urlStart, urlEnd)
}

export function buildMarkdownTable(rows: number, columns: number): string {
  const safeRows = clamp(Math.floor(rows), 1, 12)
  const safeColumns = clamp(Math.floor(columns), 1, 12)
  const header = Array.from({ length: safeColumns }, (_, index) => `列${index + 1}`)
  const delimiter = Array.from({ length: safeColumns }, () => '---')
  const bodyRow = Array.from({ length: safeColumns }, () => '内容')
  const bodyRows = Array.from({ length: Math.max(0, safeRows - 1) }, () => bodyRow)
  const allRows = [header, delimiter, ...bodyRows]
  return allRows.map((row) => `| ${row.join(' | ')} |`).join('\n')
}

function insertTable(
  value: string,
  start: number,
  end: number,
  rows: number,
  columns: number
): LearningMarkdownEditResult {
  const table = buildMarkdownTable(rows, columns)
  const firstHeader = '列1'
  const headerOffset = table.indexOf(firstHeader)
  return replaceRangeWithBlock(value, start, end, table, headerOffset, headerOffset + firstHeader.length)
}

function insertPresetBlock(
  value: string,
  start: number,
  end: number,
  lines: string[],
  focusText: string
): LearningMarkdownEditResult {
  const block = lines.join('\n')
  const selectionOffset = block.indexOf(focusText)
  if (selectionOffset < 0) {
    return replaceRangeWithBlock(value, start, end, block, block.length, block.length)
  }
  return replaceRangeWithBlock(
    value,
    start,
    end,
    block,
    selectionOffset,
    selectionOffset + focusText.length
  )
}

export function applyLearningMarkdownInsert(
  value: string,
  start: number,
  end: number,
  request: LearningMarkdownInsertRequest
): LearningMarkdownEditResult {
  const normalized = normalizeRange(value, start, end)
  if (request.kind === 'table') {
    return insertTable(value, normalized.start, normalized.end, request.rows, request.columns)
  }

  switch (request.template) {
    case 'heading1':
      return insertHeading(value, normalized.start, normalized.end, 1)
    case 'heading2':
      return insertHeading(value, normalized.start, normalized.end, 2)
    case 'heading3':
      return insertHeading(value, normalized.start, normalized.end, 3)
    case 'bold':
      return wrapInline(value, normalized.start, normalized.end, '**', '**', '加粗文本')
    case 'italic':
      return wrapInline(value, normalized.start, normalized.end, '*', '*', '斜体文本')
    case 'strikethrough':
      return wrapInline(value, normalized.start, normalized.end, '~~', '~~', '删除线文本')
    case 'inlineCode':
      return wrapInline(value, normalized.start, normalized.end, '`', '`', 'code')
    case 'codeBlock':
      return insertCodeBlock(value, normalized.start, normalized.end)
    case 'blockquote':
      return insertBlockquote(value, normalized.start, normalized.end)
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return insertListTemplate(value, normalized.start, normalized.end, request.template, request.count)
    case 'link':
      return insertLink(value, normalized.start, normalized.end, false)
    case 'image':
      return insertLink(value, normalized.start, normalized.end, true)
    case 'horizontalRule':
      return replaceRangeWithBlock(value, normalized.start, normalized.end, '---', 3, 3)
    case 'knowledgePoints':
      return insertPresetBlock(
        value,
        normalized.start,
        normalized.end,
        [
          '## 知识点',
          '',
          '- 核心概念：',
          '- 原理说明：',
          '- 示例：',
        ],
        '核心概念：'
      )
    case 'summarySection':
      return insertPresetBlock(
        value,
        normalized.start,
        normalized.end,
        [
          '## 总结',
          '',
          '1. 结论一',
          '2. 结论二',
          '3. 后续行动',
        ],
        '结论一'
      )
    case 'reviewChecklist':
      return insertPresetBlock(
        value,
        normalized.start,
        normalized.end,
        [
          '## 待复习',
          '',
          '- [ ] 概念定义',
          '- [ ] 关键命令',
          '- [ ] 常见问题',
        ],
        '概念定义'
      )
    case 'pitfallsSection':
      return insertPresetBlock(
        value,
        normalized.start,
        normalized.end,
        [
          '## 易错点',
          '',
          '> 容易混淆：',
          '>',
          '> 正确写法：',
        ],
        '容易混淆：'
      )
    case 'referencesSection':
      return insertPresetBlock(
        value,
        normalized.start,
        normalized.end,
        [
          '## 参考资料',
          '',
          '- [文档标题](https://example.com)',
        ],
        'https://example.com'
      )
    default: {
      const exhaustiveCheck: never = request.template
      return exhaustiveCheck
    }
  }
}
