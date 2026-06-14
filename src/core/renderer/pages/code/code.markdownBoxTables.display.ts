import type { DisplayCell, LineInfo } from './code.markdownBoxTables.types'
import {
  BOTTOM_LEFT_BORDER_CHARS,
  BOTTOM_RIGHT_BORDER_CHARS,
  BOX_FLOW_BORDER_COLUMN_TOLERANCE,
  HORIZONTAL_BORDER_PATTERN,
  MIDDLE_LEFT_BORDER_CHARS,
  MIDDLE_RIGHT_BORDER_CHARS,
  TOP_LEFT_BORDER_CHARS,
  TOP_RIGHT_BORDER_CHARS,
  VERTICAL_BORDER_CHARS,
} from './code.markdownBoxTables.constants'

export function splitLinesWithNumbers(
  source: string,
  startLine: number
): LineInfo[] {
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

export function normalizeArchitectureText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function firstNonWhitespace(value: string): string | null {
  const trimmed = value.trimStart()
  return trimmed ? trimmed[0] : null
}

export function lastNonWhitespace(value: string): string | null {
  const trimmed = value.trimEnd()
  return trimmed ? trimmed[trimmed.length - 1] : null
}

export function isTopBorderLine(value: string): boolean {
  const first = firstNonWhitespace(value)
  const last = lastNonWhitespace(value)
  return Boolean(first && last && TOP_LEFT_BORDER_CHARS.has(first) && TOP_RIGHT_BORDER_CHARS.has(last) && HORIZONTAL_BORDER_PATTERN.test(value))
}

export function isBottomBorderLine(value: string): boolean {
  const first = firstNonWhitespace(value)
  const last = lastNonWhitespace(value)
  return Boolean(first && last && BOTTOM_LEFT_BORDER_CHARS.has(first) && BOTTOM_RIGHT_BORDER_CHARS.has(last) && HORIZONTAL_BORDER_PATTERN.test(value))
}

export function isSeparatorLine(value: string): boolean {
  const first = firstNonWhitespace(value)
  const last = lastNonWhitespace(value)
  return Boolean(first && last && MIDDLE_LEFT_BORDER_CHARS.has(first) && MIDDLE_RIGHT_BORDER_CHARS.has(last) && HORIZONTAL_BORDER_PATTERN.test(value))
}

export function isHorizontalBorderChar(value: string): boolean {
  return HORIZONTAL_BORDER_PATTERN.test(value)
}

export function isFullwidthCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 && (
      codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd)
    )
  )
}

export function getCharacterDisplayWidth(value: string): number {
  const codePoint = value.codePointAt(0)
  if (typeof codePoint !== 'number') return 0
  return isFullwidthCodePoint(codePoint) ? 2 : 1
}

export function buildDisplayCells(value: string): DisplayCell[] {
  const cells: DisplayCell[] = []
  let startIndex = 0
  let startColumn = 0

  while (startIndex < value.length) {
    const codePoint = value.codePointAt(startIndex)
    if (typeof codePoint !== 'number') break
    const character = String.fromCodePoint(codePoint)
    const width = getCharacterDisplayWidth(character)
    const endIndex = startIndex + character.length
    cells.push({
      value: character,
      startIndex,
      endIndex,
      startColumn,
      endColumn: startColumn + width,
    })
    startIndex = endIndex
    startColumn += width
  }

  return cells
}

export function findDisplayCellAtColumn(
  line: LineInfo,
  targetColumn: number
): DisplayCell | null {
  for (const cell of line.displayCells) {
    if (cell.startColumn === targetColumn) return cell
  }
  return null
}

export function findFirstNonWhitespaceCell(line: LineInfo): DisplayCell | null {
  for (const cell of line.displayCells) {
    if (cell.value.trim()) return cell
  }
  return null
}

export function findLastNonWhitespaceCell(line: LineInfo): DisplayCell | null {
  for (let index = line.displayCells.length - 1; index >= 0; index -= 1) {
    const cell = line.displayCells[index]
    if (cell?.value.trim()) return cell
  }
  return null
}

export function findRightmostVerticalBorderCell(line: LineInfo): DisplayCell | null {
  for (let index = line.displayCells.length - 1; index >= 0; index -= 1) {
    const cell = line.displayCells[index]
    if (isVerticalBorderCell(cell)) return cell
  }
  return null
}

export function isVerticalBorderCell(cell: DisplayCell | null | undefined): boolean {
  return Boolean(cell && VERTICAL_BORDER_CHARS.has(cell.value))
}

export function findNearestVerticalBorderCell(
  line: LineInfo,
  targetColumn: number,
  tolerance: number = BOX_FLOW_BORDER_COLUMN_TOLERANCE
): DisplayCell | null {
  let best: DisplayCell | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const cell of line.displayCells) {
    if (!isVerticalBorderCell(cell)) continue
    const distance = Math.abs(cell.startColumn - targetColumn)
    if (distance > tolerance) continue
    if (distance < bestDistance) {
      best = cell
      bestDistance = distance
      continue
    }
    if (distance === bestDistance && best && cell.startColumn < best.startColumn) {
      best = cell
    }
  }

  return best
}

export function findStringIndexForDisplayColumn(
  line: LineInfo,
  targetColumn: number
): number {
  if (targetColumn <= 0) return 0

  for (const cell of line.displayCells) {
    if (targetColumn <= cell.startColumn) return cell.startIndex
    if (targetColumn > cell.startColumn && targetColumn < cell.endColumn) {
      return cell.endIndex
    }
  }

  return line.text.length
}

export function findDisplayColumnForStringIndex(
  line: LineInfo,
  targetIndex: number
): number {
  if (targetIndex <= 0) return 0

  for (const cell of line.displayCells) {
    if (targetIndex <= cell.startIndex) return cell.startColumn
    if (targetIndex > cell.startIndex && targetIndex <= cell.endIndex) {
      return cell.endColumn
    }
  }

  return line.displayWidth
}

export function sliceLineByDisplayColumns(
  line: LineInfo,
  startColumn: number,
  endColumn?: number
): string {
  const safeStartColumn = Math.max(0, startColumn)
  const safeEndColumn = typeof endColumn === 'number'
    ? Math.max(safeStartColumn, endColumn)
    : line.displayWidth
  const startIndex = findStringIndexForDisplayColumn(line, safeStartColumn)
  const endIndex = findStringIndexForDisplayColumn(line, safeEndColumn)
  return line.text.slice(startIndex, endIndex)
}

export function findMatchingBorderSegment(
  line: LineInfo,
  expectedStartColumn: number,
  expectedEndColumn: number,
  leftChars: Set<string>,
  rightChars: Set<string>,
  tolerance: number = BOX_FLOW_BORDER_COLUMN_TOLERANCE
): { startColumn: number; endColumn: number } | null {
  let best: { startColumn: number; endColumn: number } | null = null
  let bestScore = Number.POSITIVE_INFINITY

  for (const segment of findBorderSegments(line, leftChars, rightChars)) {
    const score =
      Math.abs(segment.startColumn - expectedStartColumn) +
      Math.abs(segment.endColumn - expectedEndColumn)
    if (
      Math.abs(segment.startColumn - expectedStartColumn) > tolerance ||
      Math.abs(segment.endColumn - expectedEndColumn) > tolerance
    ) {
      continue
    }
    if (score < bestScore) {
      best = segment
      bestScore = score
    }
  }

  return best
}

export function findBorderSegments(
  line: LineInfo,
  leftChars: Set<string>,
  rightChars: Set<string>
): Array<{ startColumn: number; endColumn: number }> {
  const segments: Array<{ startColumn: number; endColumn: number }> = []

  for (let index = 0; index < line.displayCells.length; index += 1) {
    const current = line.displayCells[index]
    if (!current || !leftChars.has(current.value)) continue

    let endIndex = index + 1
    while (endIndex < line.displayCells.length) {
      const cell = line.displayCells[endIndex]
      if (!cell || !isHorizontalBorderChar(cell.value)) break
      endIndex += 1
    }

    const rightCell = line.displayCells[endIndex]
    if (endIndex > index + 1 && rightCell && rightChars.has(rightCell.value)) {
      segments.push({ startColumn: current.startColumn, endColumn: rightCell.startColumn })
      index = endIndex
    }
  }

  return segments
}

export function isBorderSegment(
  line: LineInfo,
  startColumn: number,
  endColumn: number,
  leftChars: Set<string>,
  rightChars: Set<string>
): boolean {
  if (startColumn < 0 || endColumn <= startColumn) return false
  const startCell = findDisplayCellAtColumn(line, startColumn)
  const endCell = findDisplayCellAtColumn(line, endColumn)
  if (!startCell || !endCell) return false
  if (!leftChars.has(startCell.value)) return false
  if (!rightChars.has(endCell.value)) return false

  for (const cell of line.displayCells) {
    if (cell.startColumn <= startColumn || cell.startColumn >= endColumn) continue
    if (!isHorizontalBorderChar(cell.value)) return false
  }

  return true
}

export function isVerticalContentSegment(
  line: LineInfo,
  startColumn: number,
  endColumn: number
): boolean {
  if (startColumn < 0 || endColumn <= startColumn) return false
  const startCell = findDisplayCellAtColumn(line, startColumn)
  const endCell = findDisplayCellAtColumn(line, endColumn)
  return (
    Boolean(startCell && endCell) &&
    VERTICAL_BORDER_CHARS.has(startCell?.value ?? '') &&
    VERTICAL_BORDER_CHARS.has(endCell?.value ?? '')
  )
}

export function findVerticalDelimiterIndexes(value: string): number[] {
  const indexes: number[] = []
  for (let index = 0; index < value.length; index += 1) {
    if (VERTICAL_BORDER_CHARS.has(value[index])) {
      indexes.push(index)
    }
  }
  return indexes
}

export function extractCellsFromContentLine(value: string): string[] | null {
  const indexes = findVerticalDelimiterIndexes(value)
  if (indexes.length < 2) return null

  const cells: string[] = []
  for (let index = 0; index < indexes.length - 1; index += 1) {
    const start = indexes[index] + 1
    const end = indexes[index + 1]
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
