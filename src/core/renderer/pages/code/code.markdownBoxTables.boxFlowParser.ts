import type {
  LineInfo,
  ParsedBoxFlow,
  ParsedBoxFlowBox,
  ParsedBoxFlowConnector,
  ParsedBoxFlowConnectorDirection,
  ParsedBoxFlowRow,
} from './code.markdownBoxTables.types'
import {
  BOTTOM_LEFT_BORDER_CHARS,
  BOTTOM_RIGHT_BORDER_CHARS,
  CONNECTOR_EDGE_PATTERN,
  LEFT_ARROW_PATTERN,
  RIGHT_ARROW_PATTERN,
  TOP_LEFT_BORDER_CHARS,
  TOP_RIGHT_BORDER_CHARS,
  TRAILING_NOTE_PREFIX_PATTERN,
} from './code.markdownBoxTables.constants'
import {
  findBorderSegments,
  findDisplayCellAtColumn,
  findMatchingBorderSegment,
  findNearestVerticalBorderCell,
  sliceLineByDisplayColumns,
  splitLinesWithNumbers,
} from './code.markdownBoxTables.display'

export function normalizeConnectorLabel(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed.replace(CONNECTOR_EDGE_PATTERN, '').trim()
}

function inferConnectorDirection(value: string): ParsedBoxFlowConnectorDirection {
  if (!value.trim()) return 'none'
  if (RIGHT_ARROW_PATTERN.test(value)) return 'right'
  if (LEFT_ARROW_PATTERN.test(value)) return 'left'
  return 'right'
}

function normalizeTrailingNote(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const stripped = trimmed.replace(TRAILING_NOTE_PREFIX_PATTERN, '').trim()
  return stripped || trimmed
}

function parseBoxFlowBox(
  lines: LineInfo[],
  topLineIndex: number,
  startColumn: number,
  endColumn: number
): ParsedBoxFlowBox | null {
  for (let bottomLineIndex = topLineIndex + 2; bottomLineIndex < lines.length; bottomLineIndex += 1) {
    const bottomLine = lines[bottomLineIndex]
    if (!bottomLine) continue
    const bottomSegment = findMatchingBorderSegment(
      bottomLine,
      startColumn,
      endColumn,
      BOTTOM_LEFT_BORDER_CHARS,
      BOTTOM_RIGHT_BORDER_CHARS
    )
    if (!bottomSegment) {
      continue
    }

    const rows: ParsedBoxFlowRow[] = []
    let valid = true

    for (let contentLineIndex = topLineIndex + 1; contentLineIndex < bottomLineIndex; contentLineIndex += 1) {
      const contentLine = lines[contentLineIndex]
      if (!contentLine) {
        valid = false
        break
      }
      const leftBorderCell = findNearestVerticalBorderCell(contentLine, startColumn)
      const rightBorderCell = findNearestVerticalBorderCell(contentLine, endColumn)
      if (
        !leftBorderCell ||
        !rightBorderCell ||
        rightBorderCell.startColumn <= leftBorderCell.startColumn
      ) {
        valid = false
        break
      }

      rows.push({
        text: sliceLineByDisplayColumns(
          contentLine,
          leftBorderCell.endColumn,
          rightBorderCell.startColumn
        ).trim(),
        lineNumber: contentLine.lineNumber,
        sourceLineIndex: contentLineIndex,
        leftColumn: leftBorderCell.startColumn,
        rightColumn: rightBorderCell.startColumn,
      })
    }

    if (!valid || rows.length <= 0) continue

    return {
      startColumn: bottomSegment.startColumn,
      endColumn: bottomSegment.endColumn,
      topLineIndex,
      bottomLineIndex,
      title: '',
      rows,
    }
  }

  return null
}

function parseBoxFlowConnector(
  lines: LineInfo[],
  leftBox: ParsedBoxFlowBox,
  rightBox: ParsedBoxFlowBox
): ParsedBoxFlowConnector {
  const fallbackLineNumber = leftBox.rows[0]?.lineNumber ?? lines[leftBox.topLineIndex]?.lineNumber ?? 1

  const firstRelevantLine = Math.min(leftBox.topLineIndex, rightBox.topLineIndex)
  const lastRelevantLine = Math.max(leftBox.bottomLineIndex, rightBox.bottomLineIndex)

  for (let lineIndex = firstRelevantLine; lineIndex <= lastRelevantLine; lineIndex += 1) {
    const line = lines[lineIndex]
    if (!line) continue
    const leftRow = leftBox.rows.find((row) => row.sourceLineIndex === lineIndex)
    const rightRow = rightBox.rows.find((row) => row.sourceLineIndex === lineIndex)
    const gapStart = (leftRow?.rightColumn ?? leftBox.endColumn) + 1
    const gapEnd = (rightRow?.leftColumn ?? rightBox.startColumn) - 1
    if (gapEnd < gapStart) continue
    const rawText = sliceLineByDisplayColumns(line, gapStart, gapEnd + 1).trim()
    if (!rawText) continue
    return {
      rawText,
      label: normalizeConnectorLabel(rawText),
      direction: inferConnectorDirection(rawText),
      lineNumber: line.lineNumber,
    }
  }

  return {
    rawText: '',
    label: '',
    direction: 'right',
    lineNumber: fallbackLineNumber,
  }
}

function hasOuterContainerAroundBoxes(
  lines: LineInfo[],
  boxes: ParsedBoxFlowBox[]
): boolean {
  if (boxes.length < 2) return false

  const topLineIndex = boxes.reduce((min, box) => Math.min(min, box.topLineIndex), boxes[0]?.topLineIndex ?? 0)
  const bottomLineIndex = boxes.reduce((max, box) => Math.max(max, box.bottomLineIndex), boxes[0]?.bottomLineIndex ?? 0)
  const leftColumn = boxes.reduce((min, box) => Math.min(min, box.startColumn), boxes[0]?.startColumn ?? 0)
  const rightColumn = boxes.reduce((max, box) => Math.max(max, box.endColumn), boxes[0]?.endColumn ?? 0)

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    if (!line) continue

    const segments = findBorderSegments(line, TOP_LEFT_BORDER_CHARS, TOP_RIGHT_BORDER_CHARS)
    for (const segment of segments) {
      if (segment.startColumn >= leftColumn || segment.endColumn <= rightColumn) {
        continue
      }

      const topCell = findDisplayCellAtColumn(line, segment.startColumn)
      const rightTopCell = findDisplayCellAtColumn(line, segment.endColumn)
      if (!topCell || !rightTopCell) continue
      if (!TOP_LEFT_BORDER_CHARS.has(topCell.value) || !TOP_RIGHT_BORDER_CHARS.has(rightTopCell.value)) {
        continue
      }

      for (let bottomIndex = lineIndex + 2; bottomIndex < lines.length; bottomIndex += 1) {
        const bottomLine = lines[bottomIndex]
        if (!bottomLine) continue

        const bottomSegment = findMatchingBorderSegment(
          bottomLine,
          segment.startColumn,
          segment.endColumn,
          BOTTOM_LEFT_BORDER_CHARS,
          BOTTOM_RIGHT_BORDER_CHARS,
          3
        )
        if (!bottomSegment) {
          continue
        }

        const containsBoxesVertically = lineIndex < topLineIndex && bottomIndex > bottomLineIndex
        if (!containsBoxesVertically) {
          continue
        }

        let validContainer = true
        for (let innerLineIndex = lineIndex + 1; innerLineIndex < bottomIndex; innerLineIndex += 1) {
          const innerLine = lines[innerLineIndex]
          if (!innerLine) {
            validContainer = false
            break
          }

          const leftBorderCell = findNearestVerticalBorderCell(innerLine, segment.startColumn, 3)
          const rightBorderCell = findNearestVerticalBorderCell(innerLine, segment.endColumn, 3)
          if (!leftBorderCell || !rightBorderCell || rightBorderCell.startColumn <= leftBorderCell.startColumn) {
            validContainer = false
            break
          }
        }

        if (validContainer) {
          return true
        }
      }
    }
  }

  return false
}

export function parseBoxFlow(source: string, startLine: number): ParsedBoxFlow | null {
  const lines = splitLinesWithNumbers(source, startLine)
  if (lines.length < 4) return null

  const groupedBoxes = new Map<number, ParsedBoxFlowBox[]>()

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    if (!line) continue
    const topSegments = findBorderSegments(line, TOP_LEFT_BORDER_CHARS, TOP_RIGHT_BORDER_CHARS)
    if (topSegments.length <= 0) continue

    const boxesOnLine: ParsedBoxFlowBox[] = []
    for (const segment of topSegments) {
      const parsedBox = parseBoxFlowBox(lines, lineIndex, segment.startColumn, segment.endColumn)
      if (parsedBox) {
        boxesOnLine.push(parsedBox)
      }
    }

    if (boxesOnLine.length > 0) {
      groupedBoxes.set(lineIndex, boxesOnLine)
    }
  }

  let candidateTopLineIndex: number | null = null
  let candidateBoxes: ParsedBoxFlowBox[] = []

  for (const [lineIndex, boxes] of groupedBoxes.entries()) {
    const sortedBoxes = [...boxes].sort((a, b) => a.startColumn - b.startColumn)
    if (sortedBoxes.length <= candidateBoxes.length) continue
    candidateTopLineIndex = lineIndex
    candidateBoxes = sortedBoxes
  }

  if (candidateTopLineIndex == null || candidateBoxes.length < 2) return null
  if (hasOuterContainerAroundBoxes(lines, candidateBoxes)) return null

  const titleLine = candidateTopLineIndex > 0 ? lines[candidateTopLineIndex - 1] : null
  const decoratedBoxes = candidateBoxes.map((box, index) => {
    const title = titleLine
      ? sliceLineByDisplayColumns(titleLine, box.startColumn, box.endColumn + 1).trim()
      : ''
    const isLastBox = index === candidateBoxes.length - 1

    return {
      ...box,
      title,
      titleLineNumber: title ? titleLine?.lineNumber : undefined,
      rows: box.rows.map((row) => {
        if (!isLastBox) return row
        const sourceLine = lines[row.sourceLineIndex]
        const note = sourceLine
          ? normalizeTrailingNote(sliceLineByDisplayColumns(sourceLine, row.rightColumn + 1))
          : ''
        if (!note) return row
        return {
          ...row,
          note,
        }
      }),
    }
  })

  const connectors = decoratedBoxes.slice(0, -1).map((box, index) => (
    parseBoxFlowConnector(lines, box, decoratedBoxes[index + 1] as ParsedBoxFlowBox)
  ))

  const hasTitles = decoratedBoxes.some((box) => box.title)
  const hasConnectorText = connectors.some((connector) => connector.rawText)
  const hasTrailingNotes = decoratedBoxes.some((box) => box.rows.some((row) => row.note))
  if (!hasTitles && !hasConnectorText && !hasTrailingNotes) return null

  return {
    boxes: decoratedBoxes,
    connectors,
  }
}
