export interface LearningMarkdownEditorEditResult {
  value: string
  selectionStart: number
  selectionEnd: number
}

const INDENT_UNIT = '  '
const ORDERED_LIST_LINE_RE = /^(\s*)(\d+)\.\s+(.*)$/
const BULLET_LIST_LINE_RE = /^(\s*)([-+*])\s+(.*)$/
const TASK_LIST_LINE_RE = /^(\s*)([-+*])\s+\[( |x|X)\]\s?(.*)$/

type LineTransform = {
  text: string
  mapPosition: (position: number) => number
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
  }
}

function replaceRange(value: string, start: number, end: number, replacement: string, selectionStart: number, selectionEnd: number): LearningMarkdownEditorEditResult {
  return {
    value: `${value.slice(0, start)}${replacement}${value.slice(end)}`,
    selectionStart,
    selectionEnd,
  }
}

function getLineStart(value: string, index: number): number {
  return value.lastIndexOf('\n', Math.max(0, index - 1)) + 1
}

function getLineEnd(value: string, index: number): number {
  const lineEndIndex = value.indexOf('\n', index)
  return lineEndIndex === -1 ? value.length : lineEndIndex
}

function getSelectedLineRange(value: string, start: number, end: number) {
  return {
    lineStart: getLineStart(value, start),
    lineEnd: getLineEnd(value, end),
  }
}

function mapBlockPosition(lines: string[], transforms: LineTransform[], position: number): number {
  let originalCursor = 0
  let transformedCursor = 0

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const transform = transforms[index]
    if (!transform) break
    const hasNewline = index < lines.length - 1
    const lineEnd = originalCursor + line.length

    if (position <= lineEnd) {
      return transformedCursor + transform.mapPosition(position - originalCursor)
    }

    transformedCursor += transform.text.length
    originalCursor = lineEnd

    if (!hasNewline) break
    if (position === originalCursor + 1) {
      return transformedCursor + 1
    }
    transformedCursor += 1
    originalCursor += 1
  }

  return transformedCursor
}

function applyLineTransform(value: string, start: number, end: number, transformLine: (line: string) => LineTransform): LearningMarkdownEditorEditResult {
  const normalized = normalizeRange(value, start, end)
  const { lineStart, lineEnd } = getSelectedLineRange(value, normalized.start, normalized.end)
  const block = value.slice(lineStart, lineEnd)
  const lines = block.split('\n')
  const transforms = lines.map((line) => transformLine(line))
  const replacement = transforms.map((transform) => transform.text).join('\n')
  const relativeStart = normalized.start - lineStart
  const relativeEnd = normalized.end - lineStart
  const nextSelectionStart = lineStart + mapBlockPosition(lines, transforms, relativeStart)
  const nextSelectionEnd = lineStart + mapBlockPosition(lines, transforms, relativeEnd)

  return replaceRange(value, lineStart, lineEnd, replacement, nextSelectionStart, nextSelectionEnd)
}

function getRemovedIndentLength(line: string): number {
  if (!line) return 0
  if (line.startsWith('\t')) return 1
  const leadingSpaces = /^ +/.exec(line)?.[0].length ?? 0
  return Math.min(INDENT_UNIT.length, leadingSpaces)
}

export function indentMarkdownLines(value: string, start: number, end: number): LearningMarkdownEditorEditResult {
  return applyLineTransform(value, start, end, (line) => ({
    text: `${INDENT_UNIT}${line}`,
    mapPosition: (position) => INDENT_UNIT.length + position,
  }))
}

export function outdentMarkdownLines(value: string, start: number, end: number): LearningMarkdownEditorEditResult {
  return applyLineTransform(value, start, end, (line) => {
    const removedLength = getRemovedIndentLength(line)
    return {
      text: line.slice(removedLength),
      mapPosition: (position) => Math.max(0, position - removedLength),
    }
  })
}

export function continueMarkdownList(value: string, start: number, end: number): LearningMarkdownEditorEditResult | null {
  const normalized = normalizeRange(value, start, end)
  if (normalized.start !== normalized.end) return null

  const lineStart = getLineStart(value, normalized.start)
  const lineEnd = getLineEnd(value, normalized.end)
  if (normalized.start !== lineEnd) return null

  const line = value.slice(lineStart, lineEnd)
  const taskMatch = TASK_LIST_LINE_RE.exec(line)
  if (taskMatch) {
    const indent = taskMatch[1] ?? ''
    const marker = taskMatch[2] ?? '-'
    const content = taskMatch[4] ?? ''
    if (!content.trim()) {
      return replaceRange(value, lineStart, lineEnd, '', lineStart, lineStart)
    }
    const insertion = `\n${indent}${marker} [ ] `
    const nextPosition = normalized.start + insertion.length
    return replaceRange(value, normalized.start, normalized.end, insertion, nextPosition, nextPosition)
  }

  const orderedMatch = ORDERED_LIST_LINE_RE.exec(line)
  if (orderedMatch) {
    const indent = orderedMatch[1] ?? ''
    const number = Number.parseInt(orderedMatch[2] ?? '', 10)
    const content = orderedMatch[3] ?? ''
    if (!content.trim()) {
      return replaceRange(value, lineStart, lineEnd, '', lineStart, lineStart)
    }
    const insertion = `\n${indent}${Number.isFinite(number) ? number + 1 : 1}. `
    const nextPosition = normalized.start + insertion.length
    return replaceRange(value, normalized.start, normalized.end, insertion, nextPosition, nextPosition)
  }

  const bulletMatch = BULLET_LIST_LINE_RE.exec(line)
  if (bulletMatch) {
    const indent = bulletMatch[1] ?? ''
    const marker = bulletMatch[2] ?? '-'
    const content = bulletMatch[3] ?? ''
    if (!content.trim()) {
      return replaceRange(value, lineStart, lineEnd, '', lineStart, lineStart)
    }
    const insertion = `\n${indent}${marker} `
    const nextPosition = normalized.start + insertion.length
    return replaceRange(value, normalized.start, normalized.end, insertion, nextPosition, nextPosition)
  }

  return null
}
