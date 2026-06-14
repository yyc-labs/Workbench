import type { ParsedBoxTable, ParsedBoxTableRow } from './code.markdownBoxTables.types'
import {
  extractCellsFromContentLine,
  isBottomBorderLine,
  isContentLine,
  isSeparatorLine,
  isTopBorderLine,
  splitLinesWithNumbers,
} from './code.markdownBoxTables.display'

export function parseBoxTable(source: string, startLine: number): ParsedBoxTable | null {
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
      cells: Array.from({ length: expectedColumnCount }, (_, columnIndex) => (
        pendingRowLines
          .map((item) => item.cells[columnIndex]?.trim() ?? '')
          .filter(Boolean)
          .join('\n')
      )),
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
