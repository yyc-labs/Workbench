import type {
  LineInfo,
  ParsedArchitectureDiagram,
  ParsedArchitectureNode,
  ParsedArchitectureSection,
  ParsedBoxFlowBox,
  ParsedBoxFlowRow,
} from './code.markdownBoxTables.types'
import {
  ARCHITECTURE_DIVIDER_CENTER_CHARS,
  BOTTOM_LEFT_BORDER_CHARS,
  BOTTOM_RIGHT_BORDER_CHARS,
  MIDDLE_LEFT_BORDER_CHARS,
  MIDDLE_RIGHT_BORDER_CHARS,
  TOP_LEFT_BORDER_CHARS,
  TOP_RIGHT_BORDER_CHARS,
  VERTICAL_BORDER_CHARS,
} from './code.markdownBoxTables.constants'
import {
  findBorderSegments,
  findFirstNonWhitespaceCell,
  findLastNonWhitespaceCell,
  findNearestVerticalBorderCell,
  hasSemanticText,
  isBottomBorderLine,
  isHorizontalBorderChar,
  isTopBorderLine,
  normalizeArchitectureText,
  sliceLineByDisplayColumns,
  splitLinesWithNumbers,
} from './code.markdownBoxTables.display'
import { normalizeConnectorLabel, parseBoxFlow } from './code.markdownBoxTables.boxFlowParser'

function isArchitectureDividerLine(
  line: LineInfo,
  leftColumn: number,
  rightColumn: number
): boolean {
  const leftCell = findFirstNonWhitespaceCell(line)
  const rightCell = findLastNonWhitespaceCell(line)
  if (!leftCell || !rightCell) return false
  if (!MIDDLE_LEFT_BORDER_CHARS.has(leftCell.value) || !MIDDLE_RIGHT_BORDER_CHARS.has(rightCell.value)) {
    return false
  }
  if (Math.abs(leftCell.startColumn - leftColumn) > 1) return false
  if (Math.abs(rightCell.startColumn - rightColumn) > 3) return false

  let supportedCount = 0
  let unsupportedCount = 0
  let centerJunctionCount = 0
  for (const cell of line.displayCells) {
    if (cell.startColumn <= leftCell.startColumn || cell.startColumn >= rightCell.startColumn) continue
    if (!cell.value.trim()) continue
    if (
      isHorizontalBorderChar(cell.value)
      || ARCHITECTURE_DIVIDER_CENTER_CHARS.has(cell.value)
      || VERTICAL_BORDER_CHARS.has(cell.value)
    ) {
      supportedCount += 1
      if (ARCHITECTURE_DIVIDER_CENTER_CHARS.has(cell.value)) {
        centerJunctionCount += 1
      }
      continue
    }
    unsupportedCount += 1
  }

  return supportedCount > 0 && unsupportedCount === 0 && (centerJunctionCount >= 1 || supportedCount >= 12)
}

function collectArchitectureTextLines(
  lines: LineInfo[],
  startLineIndex: number,
  endLineIndex: number,
  leftColumn: number,
  rightColumn: number
): string[] {
  if (endLineIndex < startLineIndex) return []

  const result: string[] = []
  for (let lineIndex = startLineIndex; lineIndex <= endLineIndex; lineIndex += 1) {
    const line = lines[lineIndex]
    if (!line) continue
    const rawText = sliceLineByDisplayColumns(line, leftColumn + 1, rightColumn)
    const text = extractArchitectureSemanticText(rawText)
    if (!text || !hasSemanticText(text)) continue
    result.push(text)
  }
  return result
}

function extractArchitectureSemanticText(value: string): string {
  const normalized = normalizeArchitectureText(value)
  if (!normalized) return ''

  const segments = normalized
    .split(/[│║┃|]/)
    .map((segment) => normalizeArchitectureText(segment))
    .filter((segment) => hasSemanticText(segment))

  if (segments.length <= 0) return normalized

  const cleaned = segments
    .map((segment) => segment.replace(/^[^A-Za-z0-9\u4e00-\u9fff(（]+/, '').trim())
    .filter((segment) => hasSemanticText(segment))

  const candidates = cleaned.length > 0 ? cleaned : segments
  candidates.sort((a, b) => b.length - a.length)
  return candidates[0] ?? normalized
}

function cleanArchitectureLabel(value: string): string {
  return value.replace(/^[^A-Za-z0-9\u4e00-\u9fff(（]+/, '').trim()
}

function isSameBox(candidate: ParsedBoxFlowBox, current: ParsedBoxFlowBox): boolean {
  return candidate.startColumn === current.startColumn
    && candidate.endColumn === current.endColumn
    && candidate.topLineIndex === current.topLineIndex
    && candidate.bottomLineIndex === current.bottomLineIndex
}

function isBoxContainedWithin(candidate: ParsedBoxFlowBox, current: ParsedBoxFlowBox): boolean {
  if (isSameBox(candidate, current)) return false
  return candidate.startColumn >= current.startColumn
    && candidate.endColumn <= current.endColumn
    && candidate.topLineIndex >= current.topLineIndex
    && candidate.bottomLineIndex <= current.bottomLineIndex
}

function collectTopLevelBoxesInRegion(
  lines: LineInfo[],
  startLineIndex: number,
  endLineIndex: number,
  leftColumn: number,
  rightColumn: number
): ParsedBoxFlowBox[] {
  const candidates: ParsedBoxFlowBox[] = []

  for (let lineIndex = startLineIndex; lineIndex <= endLineIndex; lineIndex += 1) {
    const line = lines[lineIndex]
    if (!line) continue
    const segments = findBorderSegments(line, TOP_LEFT_BORDER_CHARS, TOP_RIGHT_BORDER_CHARS)
    for (const segment of segments) {
      if (segment.startColumn <= leftColumn || segment.endColumn >= rightColumn) continue
      const box = parseArchitectureBox(lines, lineIndex, segment.startColumn, segment.endColumn)
      if (!box || box.bottomLineIndex > endLineIndex) continue
      candidates.push(box)
    }
  }

  const selected: ParsedBoxFlowBox[] = []
  const sorted = [...candidates].sort((a, b) => {
    const areaA = (a.endColumn - a.startColumn + 1) * (a.bottomLineIndex - a.topLineIndex + 1)
    const areaB = (b.endColumn - b.startColumn + 1) * (b.bottomLineIndex - b.topLineIndex + 1)
    if (areaA !== areaB) return areaB - areaA
    if (a.topLineIndex !== b.topLineIndex) return a.topLineIndex - b.topLineIndex
    return a.startColumn - b.startColumn
  })

  for (const candidate of sorted) {
    if (selected.some((current) => isSameBox(candidate, current) || isBoxContainedWithin(candidate, current))) {
      continue
    }
    selected.push(candidate)
  }

  return selected.sort((a, b) => {
    if (a.topLineIndex !== b.topLineIndex) return a.topLineIndex - b.topLineIndex
    return a.startColumn - b.startColumn
  })
}

function sliceArchitectureRegionSource(
  lines: LineInfo[],
  startLineIndex: number,
  endLineIndex: number,
  leftColumn: number,
  rightColumn: number
): string {
  if (endLineIndex < startLineIndex) return ''
  return lines
    .slice(startLineIndex, endLineIndex + 1)
    .map((line) => sliceLineByDisplayColumns(line, leftColumn + 1, rightColumn).replace(/\s+$/, ''))
    .join('\n')
}

function isArchitectureBottomBorderInteriorChar(value: string): boolean {
  return isHorizontalBorderChar(value) || ARCHITECTURE_DIVIDER_CENTER_CHARS.has(value)
}

function findMatchingArchitectureBottomSegment(
  line: LineInfo,
  expectedStartColumn: number,
  expectedEndColumn: number,
  tolerance: number = 3
): { startColumn: number; endColumn: number } | null {
  for (const leftCell of line.displayCells) {
    if (!BOTTOM_LEFT_BORDER_CHARS.has(leftCell.value)) continue
    if (Math.abs(leftCell.startColumn - expectedStartColumn) > tolerance) continue

    for (let index = line.displayCells.length - 1; index >= 0; index -= 1) {
      const rightCell = line.displayCells[index]
      if (!rightCell || !BOTTOM_RIGHT_BORDER_CHARS.has(rightCell.value)) continue
      if (Math.abs(rightCell.startColumn - expectedEndColumn) > tolerance) continue
      if (rightCell.startColumn <= leftCell.startColumn) continue

      let valid = true
      for (const cell of line.displayCells) {
        if (cell.startColumn <= leftCell.startColumn || cell.startColumn >= rightCell.startColumn) continue
        if (!cell.value.trim()) continue
        if (!isArchitectureBottomBorderInteriorChar(cell.value)) {
          valid = false
          break
        }
      }

      if (valid) {
        return {
          startColumn: leftCell.startColumn,
          endColumn: rightCell.startColumn,
        }
      }
    }
  }

  return null
}

function parseArchitectureBox(
  lines: LineInfo[],
  topLineIndex: number,
  startColumn: number,
  endColumn: number
): ParsedBoxFlowBox | null {
  for (let bottomLineIndex = topLineIndex + 2; bottomLineIndex < lines.length; bottomLineIndex += 1) {
    const bottomLine = lines[bottomLineIndex]
    if (!bottomLine) continue
    const bottomSegment = findMatchingArchitectureBottomSegment(
      bottomLine,
      startColumn,
      endColumn
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
      const leftBorderCell = findNearestVerticalBorderCell(contentLine, startColumn, 3)
      const rightBorderCell = findNearestVerticalBorderCell(contentLine, endColumn, 4)
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

function inferArchitectureConnectors(
  lines: LineInfo[],
  box: ParsedBoxFlowBox,
  childCount: number
): string[] | undefined {
  if (childCount < 2) return undefined

  const source = sliceArchitectureRegionSource(
    lines,
    box.topLineIndex + 1,
    box.bottomLineIndex - 1,
    box.startColumn,
    box.endColumn
  )
  const parsedFlow = parseBoxFlow(source, lines[box.topLineIndex + 1]?.lineNumber ?? 1)
  if (parsedFlow && parsedFlow.connectors.length === childCount - 1) {
    return parsedFlow.connectors.map((connector) => normalizeConnectorLabel(connector.rawText))
  }

  return Array.from({ length: childCount - 1 }, () => '')
}

function parseArchitectureNode(
  lines: LineInfo[],
  box: ParsedBoxFlowBox
): ParsedArchitectureNode {
  const innerTop = box.topLineIndex + 1
  const innerBottom = box.bottomLineIndex - 1
  const childBoxes = collectTopLevelBoxesInRegion(
    lines,
    innerTop,
    innerBottom,
    box.startColumn,
    box.endColumn
  )

  if (childBoxes.length > 0) {
    const firstChildTop = Math.min(...childBoxes.map((child) => child.topLineIndex))
    const titleLines = collectArchitectureTextLines(
      lines,
      innerTop,
      firstChildTop - 1,
      box.startColumn,
      box.endColumn
    )

    return {
      title: cleanArchitectureLabel(titleLines[0] ?? ''),
      details: titleLines.length > 1 ? titleLines.slice(1).map((line) => cleanArchitectureLabel(line)).filter(Boolean) : undefined,
      children: childBoxes.map((child) => parseArchitectureNode(lines, child)),
      connectors: inferArchitectureConnectors(lines, box, childBoxes.length),
      startLine: lines[box.topLineIndex]?.lineNumber ?? 1,
      endLine: lines[box.bottomLineIndex]?.lineNumber ?? (lines[box.topLineIndex]?.lineNumber ?? 1),
    }
  }

  const contentLines = box.rows
    .map((row) => normalizeArchitectureText(row.text))
    .filter((row) => hasSemanticText(row))

  return {
    title: cleanArchitectureLabel(contentLines[0] ?? ''),
    details: contentLines.length > 1 ? contentLines.slice(1).map((line) => cleanArchitectureLabel(line)).filter(Boolean) : undefined,
    startLine: lines[box.topLineIndex]?.lineNumber ?? 1,
    endLine: lines[box.bottomLineIndex]?.lineNumber ?? (lines[box.topLineIndex]?.lineNumber ?? 1),
  }
}

function parseArchitectureSection(
  lines: LineInfo[],
  startLineIndex: number,
  endLineIndex: number,
  leftColumn: number,
  rightColumn: number
): ParsedArchitectureSection | null {
  const nestedSectionBoundary = findNestedArchitectureSectionBoundary(
    lines,
    startLineIndex,
    endLineIndex,
    leftColumn,
    rightColumn
  )
  const effectiveEndLineIndex = nestedSectionBoundary != null
    ? Math.max(startLineIndex, nestedSectionBoundary - 1)
    : endLineIndex

  const boxes = collectTopLevelBoxesInRegion(lines, startLineIndex, effectiveEndLineIndex, leftColumn, rightColumn)
  if (boxes.length <= 0) return null

  const firstBoxTop = Math.min(...boxes.map((box) => box.topLineIndex))
  const titleLines = collectArchitectureTextLines(
    lines,
    startLineIndex,
    firstBoxTop - 1,
    leftColumn,
    rightColumn
  )
  const title = cleanArchitectureLabel(titleLines[0] ?? '')
  if (!title) return null

  const rowEntries: Array<{
    topLineIndex: number
    nodes: ParsedArchitectureNode[]
  }> = []

  for (const box of boxes) {
    const node = parseArchitectureNode(lines, box)
    if (!node.title.trim() && (node.children?.length ?? 0) <= 0) continue

    const lastRow = rowEntries[rowEntries.length - 1]
    if (!lastRow || Math.abs(box.topLineIndex - lastRow.topLineIndex) > 1) {
      rowEntries.push({
        topLineIndex: box.topLineIndex,
        nodes: [node],
      })
      continue
    }

    lastRow.nodes.push(node)
  }

  const rows = rowEntries
    .map((row) => ({ nodes: row.nodes }))
    .filter((row) => row.nodes.length > 0)
  const nodes = rows.flatMap((row) => row.nodes)
  if (nodes.length <= 0) return null

  return {
    title,
    details: titleLines.length > 1 ? titleLines.slice(1).map((line) => cleanArchitectureLabel(line)).filter(Boolean) : undefined,
    nodes,
    rows,
    startLine: lines[startLineIndex]?.lineNumber ?? 1,
    endLine: lines[effectiveEndLineIndex]?.lineNumber ?? (lines[startLineIndex]?.lineNumber ?? 1),
  }
}

function findNestedArchitectureSectionBoundary(
  lines: LineInfo[],
  startLineIndex: number,
  endLineIndex: number,
  leftColumn: number,
  rightColumn: number
): number | null {
  for (let lineIndex = startLineIndex + 1; lineIndex <= endLineIndex; lineIndex += 1) {
    const line = lines[lineIndex]
    if (!line) continue
    if (!isArchitectureDividerLine(line, leftColumn, rightColumn)) continue

    const text = extractArchitectureSemanticText(
      sliceLineByDisplayColumns(line, leftColumn + 1, rightColumn)
    )
    if (!text) {
      return lineIndex
    }
  }

  return null
}

export function parseArchitectureDiagram(source: string, startLine: number): ParsedArchitectureDiagram | null {
  const lines = splitLinesWithNumbers(source, startLine)
  if (lines.length < 8) return null

  const topLine = lines[0]
  const bottomLine = lines[lines.length - 1]
  if (!topLine || !bottomLine) return null
  if (!isTopBorderLine(topLine.text) || !isBottomBorderLine(bottomLine.text)) return null

  const topLeft = findFirstNonWhitespaceCell(topLine)
  const topRight = findLastNonWhitespaceCell(topLine)
  const bottomLeft = findFirstNonWhitespaceCell(bottomLine)
  const bottomRight = findLastNonWhitespaceCell(bottomLine)
  if (!topLeft || !topRight || !bottomLeft || !bottomRight) return null
  if (topLeft.startColumn !== bottomLeft.startColumn || topRight.startColumn !== bottomRight.startColumn) {
    return null
  }

  const dividerIndexes = lines
    .map((line, index) => (isArchitectureDividerLine(line, topLeft.startColumn, topRight.startColumn) ? index : -1))
    .filter((index) => index > 0 && index < lines.length - 1)

  if (dividerIndexes.length <= 0) return null

  const sections: ParsedArchitectureSection[] = []
  let sectionStart = 1
  for (const dividerIndex of [...dividerIndexes, lines.length - 1]) {
    const sectionEnd = dividerIndex - 1
    if (sectionEnd >= sectionStart) {
      const parsedSection = parseArchitectureSection(
        lines,
        sectionStart,
        sectionEnd,
        topLeft.startColumn,
        topRight.startColumn
      )
      if (parsedSection) {
        sections.push(parsedSection)
      }
    }
    sectionStart = dividerIndex + 1
  }

  const totalNodeCount = sections.reduce((sum, section) => sum + section.nodes.length, 0)
  if (sections.length < 2 || totalNodeCount < 3) return null

  return { sections }
}
