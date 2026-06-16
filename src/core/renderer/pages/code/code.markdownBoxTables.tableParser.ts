import type { LineInfo, ParsedBoxTable, ParsedBoxTableRow } from './code.markdownBoxTables.types'
import {
  buildDisplayCells,
  extractCellsFromContentLine,
  hasSemanticText,
  isBottomBorderLine,
  isContentLine,
  isHorizontalBorderChar,
  isSeparatorLine,
  isTopBorderLine,
  splitLinesWithNumbers,
} from './code.markdownBoxTables.display'

type SegmentedRuleColumn = {
  startColumn: number
  endColumn: number
}

type ParsedSegmentedRowLine = {
  cells: string[]
  lineNumber: number
}

const SEGMENTED_RULE_MIN_WIDTH = 3
const SEGMENTED_RULE_COLUMN_TOLERANCE = 2

type DisplayToken = {
  rawText: string
  visibleText: string
}

function measureDisplayWidth(value: string): number {
  if (!value) return 0
  const displayCells = buildDisplayCells(value)
  return displayCells[displayCells.length - 1]?.endColumn ?? 0
}

function getLeadingWhitespaceColumns(value: string): number {
  const match = /^[ \t]*/.exec(value)
  return measureDisplayWidth(match?.[0] ?? '')
}

function mergePrefixIntoReferenceLine(prefix: string, referenceLine: string): string | null {
  const markdownLinkMatch = /^\[([^\]]+)\]\(([^)\n]+)\)(.*)$/.exec(referenceLine)
  if (markdownLinkMatch) {
    const [, label = '', href = '', trailing = ''] = markdownLinkMatch
    if (!label || !href || label.startsWith(prefix)) return referenceLine
    return `[${prefix}${label}](${href})${trailing}`
  }

  const plainReferenceMatch =
    /^((?:\.\/)?(?:[\w-]+\/)*[\w.-]+\.[A-Za-z0-9_-]+(?::\d+)?(?::\d+)?)(.*)$/.exec(referenceLine)
  if (plainReferenceMatch) {
    const [, label = '', trailing = ''] = plainReferenceMatch
    if (!label || label.startsWith(prefix)) return referenceLine
    return `${prefix}${label}${trailing}`
  }

  return null
}

function normalizeReferenceWrappedCell(value: string): string {
  if (!value.includes('\n')) return value

  const lines = value.split('\n')
  const normalizedLines: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const currentLine = lines[index] ?? ''
    const nextLine = lines[index + 1] ?? ''
    const trimmedCurrent = currentLine.trim()
    const trimmedNext = nextLine.trim()

    if (/^(?:\.\/)?(?:[\w.-]+\/)+$/.test(trimmedCurrent) && trimmedNext) {
      const mergedLine = mergePrefixIntoReferenceLine(trimmedCurrent, trimmedNext)
      if (mergedLine) {
        normalizedLines.push(mergedLine)
        index += 1
        continue
      }
    }

    normalizedLines.push(currentLine)
  }

  return normalizedLines.join('\n')
}

function normalizeRowCells(cells: string[]): string[] {
  return cells.map((cell) => normalizeReferenceWrappedCell(cell))
}

function extractSegmentedRuleColumns(line: LineInfo): SegmentedRuleColumn[] {
  const columns: SegmentedRuleColumn[] = []
  let startColumn: number | null = null
  let endColumn = 0

  const pushColumn = (): void => {
    if (startColumn == null) return
    if (endColumn - startColumn >= SEGMENTED_RULE_MIN_WIDTH) {
      columns.push({ startColumn, endColumn })
    }
    startColumn = null
    endColumn = 0
  }

  for (const cell of line.displayCells) {
    if (!cell.value.trim()) {
      pushColumn()
      continue
    }

    if (!isHorizontalBorderChar(cell.value)) {
      return []
    }

    if (startColumn == null) {
      startColumn = cell.startColumn
    }
    endColumn = cell.endColumn
  }

  pushColumn()
  return columns.length >= 2 ? columns : []
}

function areSegmentedRuleColumnsCompatible(
  reference: SegmentedRuleColumn[],
  candidate: SegmentedRuleColumn[]
): boolean {
  if (reference.length !== candidate.length) return false

  return reference.every((column, index) => {
    const other = candidate[index]
    return Boolean(
      other &&
      Math.abs(column.startColumn - other.startColumn) <= SEGMENTED_RULE_COLUMN_TOLERANCE &&
      Math.abs(column.endColumn - other.endColumn) <= SEGMENTED_RULE_COLUMN_TOLERANCE
    )
  })
}

function parseMarkdownLinkToken(value: string, startIndex: number): {
  rawText: string
  visibleText: string
  endIndex: number
} | null {
  if (value[startIndex] !== '[') return null

  const labelEndIndex = value.indexOf(']', startIndex + 1)
  if (labelEndIndex <= startIndex + 1) return null
  if (value[labelEndIndex + 1] !== '(') return null

  let hrefIndex = labelEndIndex + 2
  let parenthesisDepth = 1
  while (hrefIndex < value.length) {
    const current = value[hrefIndex]
    if (current === '\n') return null
    if (current === '(') {
      parenthesisDepth += 1
    } else if (current === ')') {
      parenthesisDepth -= 1
      if (parenthesisDepth === 0) {
        const visibleText = value.slice(startIndex + 1, labelEndIndex)
        if (!visibleText) return null
        return {
          rawText: value.slice(startIndex, hrefIndex + 1),
          visibleText,
          endIndex: hrefIndex + 1,
        }
      }
    }
    hrefIndex += 1
  }

  return null
}

function buildSegmentedDisplayTokens(value: string): DisplayToken[] {
  const tokens: DisplayToken[] = []
  let index = 0

  while (index < value.length) {
    const markdownLink = parseMarkdownLinkToken(value, index)
    if (markdownLink) {
      tokens.push({
        rawText: markdownLink.rawText,
        visibleText: markdownLink.visibleText,
      })
      index = markdownLink.endIndex
      continue
    }

    const codePoint = value.codePointAt(index)
    if (typeof codePoint !== 'number') break
    const character = String.fromCodePoint(codePoint)
    tokens.push({
      rawText: character,
      visibleText: character,
    })
    index += character.length
  }

  return tokens
}

function findSegmentedCellIndex(boundaries: number[], startColumn: number): number {
  let cellIndex = 0
  while (cellIndex < boundaries.length && startColumn >= boundaries[cellIndex]!) {
    cellIndex += 1
  }
  return cellIndex
}

function extractCellsFromSegmentedContentLine(
  line: LineInfo,
  columns: SegmentedRuleColumn[]
): string[] | null {
  const boundaries = columns.slice(0, -1).map((column, index) => (
    Math.floor((column.endColumn + columns[index + 1].startColumn) / 2)
  ))

  const cells = Array.from({ length: columns.length }, () => '')
  let visualColumn = Math.max(0, (columns[0]?.startColumn ?? 0) - getLeadingWhitespaceColumns(line.text))

  for (const token of buildSegmentedDisplayTokens(line.text)) {
    const tokenWidth = measureDisplayWidth(token.visibleText)
    const cellIndex = findSegmentedCellIndex(boundaries, visualColumn)
    if (cellIndex >= 0 && cellIndex < cells.length) {
      cells[cellIndex] += token.rawText
    }
    visualColumn += tokenWidth
  }

  const normalizedCells = cells.map((cell) => cell.trim())

  if (normalizedCells.every((cell) => !cell)) {
    return hasSemanticText(line.text) ? null : normalizedCells
  }

  return normalizedCells
}

function parseSegmentedRuleTable(source: string, startLine: number): ParsedBoxTable | null {
  const lines = splitLinesWithNumbers(source, startLine)
  if (lines.length < 3) return null

  const ruleColumnsByLine = lines.map((line) => extractSegmentedRuleColumns(line))
  const firstRuleIndex = ruleColumnsByLine.findIndex((columns) => columns.length >= 2)
  if (firstRuleIndex <= 0) return null

  const canonicalColumns = ruleColumnsByLine[firstRuleIndex]
  if (!canonicalColumns || canonicalColumns.length < 2) return null

  const ruleLineIndexes = new Set<number>()
  for (let index = 0; index < ruleColumnsByLine.length; index += 1) {
    const columns = ruleColumnsByLine[index]
    if (!columns || columns.length <= 0) continue
    if (!areSegmentedRuleColumnsCompatible(canonicalColumns, columns)) {
      return null
    }
    ruleLineIndexes.add(index)
  }

  const rows: ParsedBoxTableRow[] = []
  let pendingRowLines: ParsedSegmentedRowLine[] = []

  const flushPendingRow = (): boolean => {
    if (pendingRowLines.length <= 0) return true

    const cells = canonicalColumns.map((_, columnIndex) => (
      pendingRowLines
        .map((item) => item.cells[columnIndex] ?? '')
        .filter(Boolean)
        .join('\n')
    ))

    if (cells.every((cell) => !cell)) {
      return false
    }

    rows.push({
      cells: normalizeRowCells(cells),
      startLine: pendingRowLines[0]?.lineNumber ?? startLine,
      endLine: pendingRowLines[pendingRowLines.length - 1]?.lineNumber ?? startLine,
    })
    pendingRowLines = []
    return true
  }

  for (let index = 0; index < lines.length; index += 1) {
    if (ruleLineIndexes.has(index)) {
      if (!flushPendingRow()) return null
      continue
    }

    const line = lines[index]
    if (!line) return null

    const cells = extractCellsFromSegmentedContentLine(line, canonicalColumns)
    if (!cells) return null

    pendingRowLines.push({
      cells,
      lineNumber: line.lineNumber,
    })
  }

  if (!flushPendingRow()) return null
  if (rows.length < 2) return null

  const headerNonEmptyCount = rows[0]?.cells.filter(Boolean).length ?? 0
  const hasBodyRow = rows.slice(1).some((row) => row.cells.filter(Boolean).length >= 2)
  if (headerNonEmptyCount < 2 || !hasBodyRow) return null

  return {
    rows,
    columnCount: canonicalColumns.length,
  }
}

function parseBorderedBoxTable(source: string, startLine: number): ParsedBoxTable | null {
  const lines = splitLinesWithNumbers(source, startLine)
  if (lines.length < 3) return null
  if (!isTopBorderLine(lines[0]?.text ?? '')) return null
  if (!isBottomBorderLine(lines[lines.length - 1]?.text ?? '')) return null

  const rows: ParsedBoxTableRow[] = []
  let columnCount: number | null = null
  let pendingRowLines: Array<{ cells: string[]; lineNumber: number }> = []

  const flushPendingRow = (): boolean => {
    if (pendingRowLines.length <= 0) return true

    const expectedColumnCount = pendingRowLines[0]?.cells.length ?? 0
    if (expectedColumnCount <= 0) return false
    if (pendingRowLines.some((item) => item.cells.length !== expectedColumnCount)) {
      return false
    }

    if (columnCount == null) {
      columnCount = expectedColumnCount
    } else if (expectedColumnCount !== columnCount) {
      return false
    }

    rows.push({
      cells: normalizeRowCells(Array.from({ length: expectedColumnCount }, (_, columnIndex) => (
        pendingRowLines
          .map((item) => item.cells[columnIndex]?.trim() ?? '')
          .filter(Boolean)
          .join('\n')
      ))),
      startLine: pendingRowLines[0]?.lineNumber ?? startLine,
      endLine: pendingRowLines[pendingRowLines.length - 1]?.lineNumber ?? startLine,
    })
    pendingRowLines = []
    return true
  }

  for (let index = 1; index < lines.length - 1; index += 1) {
    const line = lines[index]
    if (!line) return null
    if (isSeparatorLine(line.text)) {
      if (!flushPendingRow()) return null
      continue
    }
    if (!isContentLine(line.text)) return null

    const cells = extractCellsFromContentLine(line.text)
    if (!cells || cells.length <= 0) return null

    pendingRowLines.push({
      cells,
      lineNumber: line.lineNumber,
    })
  }

  if (!flushPendingRow()) return null

  if (!columnCount || rows.length <= 0) return null

  return {
    rows,
    columnCount,
  }
}

export function parseBoxTable(source: string, startLine: number): ParsedBoxTable | null {
  return parseBorderedBoxTable(source, startLine) ?? parseSegmentedRuleTable(source, startLine)
}
