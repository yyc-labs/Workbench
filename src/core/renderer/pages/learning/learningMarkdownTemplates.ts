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

const LIST_CHILD_INDENT = '  '
const ORDERED_LIST_MARKER_RE = /^(\s*)(\d+)\.\s+/
const BULLET_LIST_MARKER_RE = /^(\s*)[-+*]\s+/
const TASK_LIST_MARKER_RE = /^(\s*)[-+*]\s+\[(?: |x|X)\]\s+/

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

function deleteSelection(value: string, start: number, end: number): string {
  if (start === end) return value
  return `${value.slice(0, start)}${value.slice(end)}`
}

function collapseSelectionForInsertion(value: string, start: number, end: number) {
  if (start === end) {
    return { value, start, end }
  }
  return {
    value: deleteSelection(value, start, end),
    start,
    end: start,
  }
}

function getLineStart(value: string, index: number): number {
  return value.lastIndexOf('\n', Math.max(0, index - 1)) + 1
}

function getLineEnd(value: string, index: number): number {
  const lineEndIndex = value.indexOf('\n', index)
  return lineEndIndex === -1 ? value.length : lineEndIndex
}

function getPreviousLine(value: string, lineStart: number): string | null {
  if (lineStart <= 0) return null
  const previousLineEnd = lineStart - 1
  const previousLineStart = value.lastIndexOf('\n', previousLineEnd - 1) + 1
  return value.slice(previousLineStart, previousLineEnd)
}

function getCurrentLineIndent(value: string, lineStart: number): string {
  const lineEnd = getLineEnd(value, lineStart)
  const line = value.slice(lineStart, lineEnd)
  const match = /^(\s*)/.exec(line)
  return match?.[1] ?? ''
}

function getOrderedListStartNumber(value: string, lineStart: number): number {
  const previousLine = getPreviousLine(value, lineStart)
  if (!previousLine) return 1
  const match = ORDERED_LIST_MARKER_RE.exec(previousLine)
  if (!match) return 1
  const currentIndent = getCurrentLineIndent(value, lineStart)
  const previousIndent = match[1] ?? ''
  if (currentIndent !== previousIndent) return 1
  const previousNumber = Number.parseInt(match[2] ?? '', 10)
  return Number.isFinite(previousNumber) ? previousNumber + 1 : 1
}

function getNestedListChildIndent(value: string, position: number): string | null {
  const lineStart = getLineStart(value, position)
  const lineEnd = getLineEnd(value, position)
  if (position !== lineEnd) return null

  const line = value.slice(lineStart, lineEnd)
  const orderedMatch = ORDERED_LIST_MARKER_RE.exec(line)
  if (orderedMatch) {
    const indent = orderedMatch[1] ?? ''
    const markerWidth = (orderedMatch[0] ?? '').length - indent.length
    return `${indent}${' '.repeat(markerWidth)}`
  }

  const taskMatch = TASK_LIST_MARKER_RE.exec(line)
  if (taskMatch) {
    return `${taskMatch[1] ?? ''}${LIST_CHILD_INDENT}`
  }

  const bulletMatch = BULLET_LIST_MARKER_RE.exec(line)
  if (bulletMatch) {
    return `${bulletMatch[1] ?? ''}${LIST_CHILD_INDENT}`
  }

  return null
}

function getListTemplateLines(
  template: 'bulletList' | 'orderedList' | 'taskList',
  count: number,
  orderedStartNumber: number,
  indent = ''
): string[] {
  if (template === 'bulletList') {
    return Array.from({ length: count }, (_, index) => `${indent}- ${index === 0 ? '列表项' : ''}`)
  }
  if (template === 'orderedList') {
    return Array.from({ length: count }, (_, index) => `${indent}${orderedStartNumber + index}. ${index === 0 ? '列表项' : ''}`)
  }
  return Array.from({ length: count }, (_, index) => `${indent}- [ ] ${index === 0 ? '待办事项' : ''}`)
}

function getListTemplateSelectionOffsets(
  template: 'bulletList' | 'orderedList' | 'taskList',
  orderedStartNumber: number,
  indent = ''
): { selectionStartOffset: number; selectionEndOffset: number } {
  if (template === 'bulletList') {
    const markerLength = `${indent}- `.length
    return {
      selectionStartOffset: markerLength,
      selectionEndOffset: markerLength + '列表项'.length,
    }
  }
  if (template === 'orderedList') {
    const markerLength = `${indent}${orderedStartNumber}. `.length
    return {
      selectionStartOffset: markerLength,
      selectionEndOffset: markerLength + '列表项'.length,
    }
  }
  const markerLength = `${indent}- [ ] `.length
  return {
    selectionStartOffset: markerLength,
    selectionEndOffset: markerLength + '待办事项'.length,
  }
}

function insertHeading(
  value: string,
  start: number,
  end: number,
  level: 1 | 2 | 3
): LearningMarkdownEditResult {
  const collapsed = collapseSelectionForInsertion(value, start, end)
  value = collapsed.value
  start = collapsed.start
  end = collapsed.end

  const prefix = `${'#'.repeat(level)} `
  const headingText = level === 1 ? '一级标题' : level === 2 ? '二级标题' : '三级标题'
  const replacement = `${prefix}${headingText}`
  return replaceRange(value, start, end, replacement, prefix.length, replacement.length)
}

function insertCodeBlock(value: string, start: number, end: number): LearningMarkdownEditResult {
  const collapsed = collapseSelectionForInsertion(value, start, end)
  value = collapsed.value
  start = collapsed.start
  end = collapsed.end

  const codeText = 'code'
  const block = ['```text', codeText, '```'].join('\n')
  const codeStartOffset = '```text\n'.length
  const codeEndOffset = codeStartOffset + codeText.length
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
  const collapsed = collapseSelectionForInsertion(value, start, end)
  value = collapsed.value
  start = collapsed.start
  end = collapsed.end

  const nestedIndent = getNestedListChildIndent(value, start)
  if (nestedIndent) {
    const orderedStartNumber = 1
    const replacement = `\n${getListTemplateLines(template, safeCount, orderedStartNumber, nestedIndent).join('\n')}`
    const selectionOffsets = getListTemplateSelectionOffsets(template, orderedStartNumber, nestedIndent)
    return replaceRange(
      value,
      start,
      start,
      replacement,
      1 + selectionOffsets.selectionStartOffset,
      1 + selectionOffsets.selectionEndOffset
    )
  }

  const orderedStartNumber = template === 'orderedList'
    ? getOrderedListStartNumber(value, getLineStart(value, start))
    : 0
  const replacement = getListTemplateLines(template, safeCount, orderedStartNumber || 1).join('\n')
  const selectionOffsets = getListTemplateSelectionOffsets(template, orderedStartNumber || 1)
  return replaceRange(
    value,
    start,
    start,
    replacement,
    selectionOffsets.selectionStartOffset,
    selectionOffsets.selectionEndOffset
  )
}

function insertBlockquote(value: string, start: number, end: number): LearningMarkdownEditResult {
  const collapsed = collapseSelectionForInsertion(value, start, end)
  value = collapsed.value
  start = collapsed.start
  end = collapsed.end
  return replaceRange(value, start, end, '> 引用', 2, 4)
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
  const collapsed = collapseSelectionForInsertion(value, start, end)
  value = collapsed.value
  start = collapsed.start
  end = collapsed.end

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
  const collapsed = collapseSelectionForInsertion(value, start, end)
  value = collapsed.value
  start = collapsed.start
  end = collapsed.end

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

function insertHorizontalRule(value: string, start: number, end: number): LearningMarkdownEditResult {
  const collapsed = collapseSelectionForInsertion(value, start, end)
  return replaceRangeWithBlock(collapsed.value, collapsed.start, collapsed.end, '---', 3, 3)
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
      return insertHorizontalRule(value, normalized.start, normalized.end)
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
