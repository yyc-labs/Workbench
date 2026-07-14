import type { ResolvedLocale } from '../../../i18n/messages'
import { learningMessages } from '../../../i18n/messages/learning'

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

function translateLearningMarkdown(locale: ResolvedLocale, key: string, values?: Record<string, number | string>): string {
  const normalizedKey = key.replace(/^learning\./, '')
  const tree = learningMessages[locale].learning as Record<string, unknown>
  const segments = normalizedKey.split('.')
  let current: unknown = tree

  for (const segment of segments) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      return key
    }
    current = (current as Record<string, unknown>)[segment]
  }

  if (typeof current !== 'string') return key
  if (!values) return current
  return current.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = values[name]
    return value === undefined ? `{${name}}` : String(value)
  })
}

function getTemplateText(locale: ResolvedLocale) {
  return {
    placeholders: {
      listItem: translateLearningMarkdown(locale, 'learning.markdown.templates.placeholders.listItem'),
      taskItem: translateLearningMarkdown(locale, 'learning.markdown.templates.placeholders.taskItem'),
      boldText: translateLearningMarkdown(locale, 'learning.markdown.templates.placeholders.boldText'),
      italicText: translateLearningMarkdown(locale, 'learning.markdown.templates.placeholders.italicText'),
      strikethroughText: translateLearningMarkdown(locale, 'learning.markdown.templates.placeholders.strikethroughText'),
      quoteText: translateLearningMarkdown(locale, 'learning.markdown.templates.placeholders.quoteText'),
      imageAltText: translateLearningMarkdown(locale, 'learning.markdown.templates.placeholders.imageAltText'),
      linkText: translateLearningMarkdown(locale, 'learning.markdown.templates.placeholders.linkText'),
      heading1: translateLearningMarkdown(locale, 'learning.markdown.templates.placeholders.heading1'),
      heading2: translateLearningMarkdown(locale, 'learning.markdown.templates.placeholders.heading2'),
      heading3: translateLearningMarkdown(locale, 'learning.markdown.templates.placeholders.heading3'),
    },
    sections: {
      knowledgePoints: {
        title: translateLearningMarkdown(locale, 'learning.markdown.templates.sections.knowledgePoints.title'),
        coreConcept: translateLearningMarkdown(locale, 'learning.markdown.templates.sections.knowledgePoints.coreConcept'),
        principle: translateLearningMarkdown(locale, 'learning.markdown.templates.sections.knowledgePoints.principle'),
        example: translateLearningMarkdown(locale, 'learning.markdown.templates.sections.knowledgePoints.example'),
      },
      summary: {
        title: translateLearningMarkdown(locale, 'learning.markdown.templates.sections.summary.title'),
        conclusionOne: translateLearningMarkdown(locale, 'learning.markdown.templates.sections.summary.conclusionOne'),
        conclusionTwo: translateLearningMarkdown(locale, 'learning.markdown.templates.sections.summary.conclusionTwo'),
        nextAction: translateLearningMarkdown(locale, 'learning.markdown.templates.sections.summary.nextAction'),
      },
      reviewChecklist: {
        title: translateLearningMarkdown(locale, 'learning.markdown.templates.sections.reviewChecklist.title'),
        conceptDefinition: translateLearningMarkdown(locale, 'learning.markdown.templates.sections.reviewChecklist.conceptDefinition'),
        keyCommand: translateLearningMarkdown(locale, 'learning.markdown.templates.sections.reviewChecklist.keyCommand'),
        commonIssue: translateLearningMarkdown(locale, 'learning.markdown.templates.sections.reviewChecklist.commonIssue'),
      },
      pitfalls: {
        title: translateLearningMarkdown(locale, 'learning.markdown.templates.sections.pitfalls.title'),
        commonConfusion: translateLearningMarkdown(locale, 'learning.markdown.templates.sections.pitfalls.commonConfusion'),
        correctUsage: translateLearningMarkdown(locale, 'learning.markdown.templates.sections.pitfalls.correctUsage'),
      },
      references: {
        title: translateLearningMarkdown(locale, 'learning.markdown.templates.sections.references.title'),
        documentTitle: translateLearningMarkdown(locale, 'learning.markdown.templates.sections.references.documentTitle'),
      },
    },
  }
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

function replaceRange(value: string, start: number, end: number, replacement: string, selectionStartOffset: number, selectionEndOffset: number): LearningMarkdownEditResult {
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

function replaceRangeWithBlock(value: string, start: number, end: number, block: string, selectionStartOffset: number, selectionEndOffset: number): LearningMarkdownEditResult {
  const prefix = computeBlockPrefix(value, start)
  const suffix = computeBlockSuffix(value, end)
  const replacement = `${prefix}${block}${suffix}`
  return replaceRange(value, start, end, replacement, prefix.length + selectionStartOffset, prefix.length + selectionEndOffset)
}

function wrapInline(value: string, start: number, end: number, prefix: string, suffix: string, placeholder: string): LearningMarkdownEditResult {
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

function getListTemplateLines(template: 'bulletList' | 'orderedList' | 'taskList', count: number, orderedStartNumber: number, locale: ResolvedLocale, indent = ''): string[] {
  const text = getTemplateText(locale)
  if (template === 'bulletList') {
    return Array.from({ length: count }, (_, index) => `${indent}- ${index === 0 ? text.placeholders.listItem : ''}`)
  }
  if (template === 'orderedList') {
    return Array.from({ length: count }, (_, index) => `${indent}${orderedStartNumber + index}. ${index === 0 ? text.placeholders.listItem : ''}`)
  }
  return Array.from({ length: count }, (_, index) => `${indent}- [ ] ${index === 0 ? text.placeholders.taskItem : ''}`)
}

function getListTemplateSelectionOffsets(template: 'bulletList' | 'orderedList' | 'taskList', locale: ResolvedLocale, orderedStartNumber: number, indent = ''): { selectionStartOffset: number; selectionEndOffset: number } {
  const text = getTemplateText(locale)
  if (template === 'bulletList') {
    const markerLength = `${indent}- `.length
    return {
      selectionStartOffset: markerLength,
      selectionEndOffset: markerLength + text.placeholders.listItem.length,
    }
  }
  if (template === 'orderedList') {
    const markerLength = `${indent}${orderedStartNumber}. `.length
    return {
      selectionStartOffset: markerLength,
      selectionEndOffset: markerLength + text.placeholders.listItem.length,
    }
  }
  const markerLength = `${indent}- [ ] `.length
  return {
    selectionStartOffset: markerLength,
    selectionEndOffset: markerLength + text.placeholders.taskItem.length,
  }
}

function insertHeading(value: string, start: number, end: number, level: 1 | 2 | 3, locale: ResolvedLocale): LearningMarkdownEditResult {
  const collapsed = collapseSelectionForInsertion(value, start, end)
  value = collapsed.value
  start = collapsed.start
  end = collapsed.end

  const prefix = `${'#'.repeat(level)} `
  const text = getTemplateText(locale)
  const headingText = level === 1 ? text.placeholders.heading1 : level === 2 ? text.placeholders.heading2 : text.placeholders.heading3
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

function insertListTemplate(value: string, start: number, end: number, template: 'bulletList' | 'orderedList' | 'taskList', locale: ResolvedLocale, count = 1): LearningMarkdownEditResult {
  const safeCount = clamp(Math.floor(count), 1, 12)
  const collapsed = collapseSelectionForInsertion(value, start, end)
  value = collapsed.value
  start = collapsed.start
  end = collapsed.end

  const nestedIndent = getNestedListChildIndent(value, start)
  if (nestedIndent) {
    const orderedStartNumber = 1
    const replacement = `\n${getListTemplateLines(template, safeCount, orderedStartNumber, locale, nestedIndent).join('\n')}`
    const selectionOffsets = getListTemplateSelectionOffsets(template, locale, orderedStartNumber, nestedIndent)
    return replaceRange(value, start, start, replacement, 1 + selectionOffsets.selectionStartOffset, 1 + selectionOffsets.selectionEndOffset)
  }

  const orderedStartNumber = template === 'orderedList' ? getOrderedListStartNumber(value, getLineStart(value, start)) : 0
  const replacement = getListTemplateLines(template, safeCount, orderedStartNumber || 1, locale).join('\n')
  const selectionOffsets = getListTemplateSelectionOffsets(template, locale, orderedStartNumber || 1)
  return replaceRange(value, start, start, replacement, selectionOffsets.selectionStartOffset, selectionOffsets.selectionEndOffset)
}

function insertBlockquote(value: string, start: number, end: number, locale: ResolvedLocale): LearningMarkdownEditResult {
  const collapsed = collapseSelectionForInsertion(value, start, end)
  value = collapsed.value
  start = collapsed.start
  end = collapsed.end
  const quoteText = getTemplateText(locale).placeholders.quoteText
  return replaceRange(value, start, end, `> ${quoteText}`, 2, 2 + quoteText.length)
}

function insertLink(value: string, start: number, end: number, asImage: boolean, locale: ResolvedLocale): LearningMarkdownEditResult {
  const { selectedText } = normalizeRange(value, start, end)
  const text = getTemplateText(locale)
  const label = selectedText || (asImage ? text.placeholders.imageAltText : text.placeholders.linkText)
  const url = asImage ? 'https://example.com/image.png' : 'https://example.com'
  const prefix = asImage ? '![' : '['
  const replacement = `${prefix}${label}](${url})`
  const urlStart = replacement.indexOf(url)
  const urlEnd = urlStart + url.length
  return replaceRange(value, start, end, replacement, urlStart, urlEnd)
}

export function buildMarkdownTable(rows: number, columns: number, locale: ResolvedLocale = 'zh-CN'): string {
  const safeRows = clamp(Math.floor(rows), 1, 12)
  const safeColumns = clamp(Math.floor(columns), 1, 12)
  const header = Array.from({ length: safeColumns }, (_, index) => translateLearningMarkdown(locale, 'learning.markdown.templates.placeholders.tableHeader', { count: index + 1 }))
  const delimiter = Array.from({ length: safeColumns }, () => '---')
  const bodyRow = Array.from({ length: safeColumns }, () => translateLearningMarkdown(locale, 'learning.markdown.templates.placeholders.tableCell'))
  const bodyRows = Array.from({ length: Math.max(0, safeRows - 1) }, () => bodyRow)
  const allRows = [header, delimiter, ...bodyRows]
  return allRows.map((row) => `| ${row.join(' | ')} |`).join('\n')
}

function insertTable(value: string, start: number, end: number, rows: number, columns: number, locale: ResolvedLocale): LearningMarkdownEditResult {
  const collapsed = collapseSelectionForInsertion(value, start, end)
  value = collapsed.value
  start = collapsed.start
  end = collapsed.end

  const table = buildMarkdownTable(rows, columns, locale)
  const firstHeader = translateLearningMarkdown(locale, 'learning.markdown.templates.placeholders.tableHeader', { count: 1 })
  const headerOffset = table.indexOf(firstHeader)
  return replaceRangeWithBlock(value, start, end, table, headerOffset, headerOffset + firstHeader.length)
}

function insertPresetBlock(value: string, start: number, end: number, lines: string[], focusText: string): LearningMarkdownEditResult {
  const collapsed = collapseSelectionForInsertion(value, start, end)
  value = collapsed.value
  start = collapsed.start
  end = collapsed.end

  const block = lines.join('\n')
  const selectionOffset = block.indexOf(focusText)
  if (selectionOffset < 0) {
    return replaceRangeWithBlock(value, start, end, block, block.length, block.length)
  }
  return replaceRangeWithBlock(value, start, end, block, selectionOffset, selectionOffset + focusText.length)
}

function insertHorizontalRule(value: string, start: number, end: number): LearningMarkdownEditResult {
  const collapsed = collapseSelectionForInsertion(value, start, end)
  return replaceRangeWithBlock(collapsed.value, collapsed.start, collapsed.end, '---', 3, 3)
}

export function applyLearningMarkdownInsert(value: string, start: number, end: number, request: LearningMarkdownInsertRequest, locale: ResolvedLocale = 'zh-CN'): LearningMarkdownEditResult {
  const normalized = normalizeRange(value, start, end)
  const text = getTemplateText(locale)
  if (request.kind === 'table') {
    return insertTable(value, normalized.start, normalized.end, request.rows, request.columns, locale)
  }

  switch (request.template) {
    case 'heading1':
      return insertHeading(value, normalized.start, normalized.end, 1, locale)
    case 'heading2':
      return insertHeading(value, normalized.start, normalized.end, 2, locale)
    case 'heading3':
      return insertHeading(value, normalized.start, normalized.end, 3, locale)
    case 'bold':
      return wrapInline(value, normalized.start, normalized.end, '**', '**', text.placeholders.boldText)
    case 'italic':
      return wrapInline(value, normalized.start, normalized.end, '*', '*', text.placeholders.italicText)
    case 'strikethrough':
      return wrapInline(value, normalized.start, normalized.end, '~~', '~~', text.placeholders.strikethroughText)
    case 'inlineCode':
      return wrapInline(value, normalized.start, normalized.end, '`', '`', 'code')
    case 'codeBlock':
      return insertCodeBlock(value, normalized.start, normalized.end)
    case 'blockquote':
      return insertBlockquote(value, normalized.start, normalized.end, locale)
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return insertListTemplate(value, normalized.start, normalized.end, request.template, locale, request.count)
    case 'link':
      return insertLink(value, normalized.start, normalized.end, false, locale)
    case 'image':
      return insertLink(value, normalized.start, normalized.end, true, locale)
    case 'horizontalRule':
      return insertHorizontalRule(value, normalized.start, normalized.end)
    case 'knowledgePoints':
      return insertPresetBlock(value, normalized.start, normalized.end, [`## ${text.sections.knowledgePoints.title}`, '', `- ${text.sections.knowledgePoints.coreConcept}`, `- ${text.sections.knowledgePoints.principle}`, `- ${text.sections.knowledgePoints.example}`], text.sections.knowledgePoints.coreConcept)
    case 'summarySection':
      return insertPresetBlock(value, normalized.start, normalized.end, [`## ${text.sections.summary.title}`, '', `1. ${text.sections.summary.conclusionOne}`, `2. ${text.sections.summary.conclusionTwo}`, `3. ${text.sections.summary.nextAction}`], text.sections.summary.conclusionOne)
    case 'reviewChecklist':
      return insertPresetBlock(
        value,
        normalized.start,
        normalized.end,
        [`## ${text.sections.reviewChecklist.title}`, '', `- [ ] ${text.sections.reviewChecklist.conceptDefinition}`, `- [ ] ${text.sections.reviewChecklist.keyCommand}`, `- [ ] ${text.sections.reviewChecklist.commonIssue}`],
        text.sections.reviewChecklist.conceptDefinition,
      )
    case 'pitfallsSection':
      return insertPresetBlock(value, normalized.start, normalized.end, [`## ${text.sections.pitfalls.title}`, '', `> ${text.sections.pitfalls.commonConfusion}`, '>', `> ${text.sections.pitfalls.correctUsage}`], text.sections.pitfalls.commonConfusion)
    case 'referencesSection':
      return insertPresetBlock(value, normalized.start, normalized.end, [`## ${text.sections.references.title}`, '', `- [${text.sections.references.documentTitle}](https://example.com)`], 'https://example.com')
    default: {
      const exhaustiveCheck: never = request.template
      return exhaustiveCheck
    }
  }
}
