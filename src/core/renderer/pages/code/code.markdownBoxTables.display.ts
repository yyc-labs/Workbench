import type { DisplayCell, LineInfo } from './code.markdownBoxTables.types'
import {
  BOTTOM_LEFT_BORDER_CHARS,
  BOTTOM_RIGHT_BORDER_CHARS,
  HORIZONTAL_BORDER_PATTERN,
  MIDDLE_LEFT_BORDER_CHARS,
  MIDDLE_RIGHT_BORDER_CHARS,
  TOP_LEFT_BORDER_CHARS,
  TOP_RIGHT_BORDER_CHARS,
  VERTICAL_BORDER_CHARS,
} from './code.markdownBoxTables.constants'

export function splitLinesWithNumbers(source: string, startLine: number): LineInfo[] {
  return source.split('\n').map((text, index) => {
    const displayCells = buildDisplayCells(text)
    return {
      text,
      lineNumber: startLine + index,
      displayCells,
      displayWidth: displayCells[displayCells.length - 1]?.endColumn ?? 0,
    }
  })
}

export function hasSemanticText(value: string): boolean {
  return /[A-Za-z0-9\u4e00-\u9fff]/.test(value)
}

function firstNonWhitespace(value: string): string | null {
  const trimmed = value.trimStart()
  return trimmed ? (trimmed[0] ?? null) : null
}

function lastNonWhitespace(value: string): string | null {
  const trimmed = value.trimEnd()
  return trimmed ? (trimmed[trimmed.length - 1] ?? null) : null
}

export function isTopBorderLine(value: string): boolean {
  const first = firstNonWhitespace(value)
  const last = lastNonWhitespace(value)
  return Boolean(
    first &&
      last &&
      TOP_LEFT_BORDER_CHARS.has(first) &&
      TOP_RIGHT_BORDER_CHARS.has(last) &&
      HORIZONTAL_BORDER_PATTERN.test(value),
  )
}

export function isBottomBorderLine(value: string): boolean {
  const first = firstNonWhitespace(value)
  const last = lastNonWhitespace(value)
  return Boolean(
    first &&
      last &&
      BOTTOM_LEFT_BORDER_CHARS.has(first) &&
      BOTTOM_RIGHT_BORDER_CHARS.has(last) &&
      HORIZONTAL_BORDER_PATTERN.test(value),
  )
}

export function isSeparatorLine(value: string): boolean {
  const first = firstNonWhitespace(value)
  const last = lastNonWhitespace(value)
  return Boolean(
    first &&
      last &&
      MIDDLE_LEFT_BORDER_CHARS.has(first) &&
      MIDDLE_RIGHT_BORDER_CHARS.has(last) &&
      HORIZONTAL_BORDER_PATTERN.test(value),
  )
}

export function isHorizontalBorderChar(value: string): boolean {
  return HORIZONTAL_BORDER_PATTERN.test(value)
}

function isFullwidthCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd))
  )
}

function getCharacterDisplayWidth(value: string): number {
  const codePoint = value.codePointAt(0)
  if (typeof codePoint !== 'number') return 0
  return isFullwidthCodePoint(codePoint) ? 2 : 1
}

export function buildDisplayCells(value: string): DisplayCell[] {
  const cells: DisplayCell[] = []
  let stringIndex = 0
  let displayColumn = 0

  for (const character of value) {
    const width = getCharacterDisplayWidth(character)
    cells.push({
      value: character,
      startIndex: stringIndex,
      endIndex: stringIndex + character.length,
      startColumn: displayColumn,
      endColumn: displayColumn + width,
    })
    stringIndex += character.length
    displayColumn += width
  }

  return cells
}

function findVerticalDelimiterIndexes(value: string): number[] {
  const indexes: number[] = []
  for (let index = 0; index < value.length; index += 1) {
    if (VERTICAL_BORDER_CHARS.has(value[index] ?? '')) indexes.push(index)
  }
  return indexes
}

export function extractCellsFromContentLine(value: string): string[] | null {
  const delimiterIndexes = findVerticalDelimiterIndexes(value)
  if (delimiterIndexes.length < 2) return null

  const cells: string[] = []
  for (let index = 0; index < delimiterIndexes.length - 1; index += 1) {
    const start = (delimiterIndexes[index] ?? 0) + 1
    const end = delimiterIndexes[index + 1] ?? start
    cells.push(value.slice(start, end).trim())
  }
  return cells
}

export function isContentLine(value: string): boolean {
  const first = firstNonWhitespace(value)
  const last = lastNonWhitespace(value)
  if (!first || !last || !VERTICAL_BORDER_CHARS.has(first) || !VERTICAL_BORDER_CHARS.has(last)) {
    return false
  }
  const cells = extractCellsFromContentLine(value)
  return Boolean(cells && cells.length > 0)
}
