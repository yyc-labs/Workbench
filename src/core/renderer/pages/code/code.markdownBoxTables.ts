import { unified } from 'unified'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'

type MarkdownPositionPoint = {
  line: number
  column: number
  offset?: number
}

type MarkdownPosition = {
  start: MarkdownPositionPoint
  end: MarkdownPositionPoint
}

type MarkdownNode = {
  type: string
  position?: MarkdownPosition
  children?: MarkdownNode[]
  value?: string
  align?: Array<'left' | 'right' | 'center' | null>
  data?: {
    hName?: string
    hProperties?: Record<string, unknown>
  }
}

type MarkdownParentNode = MarkdownNode & {
  children: MarkdownNode[]
}

type MarkdownParagraphNode = MarkdownParentNode & {
  type: 'paragraph'
}

type LineInfo = {
  text: string
  lineNumber: number
  displayCells: DisplayCell[]
  displayWidth: number
}

type DisplayCell = {
  value: string
  startIndex: number
  endIndex: number
  startColumn: number
  endColumn: number
}

type ParsedBoxTable = {
  rows: ParsedBoxTableRow[]
  columnCount: number
}

type ParsedBoxTableRow = {
  cells: string[]
  startLine: number
  endLine: number
}

type ParsedBoxFlowRow = {
  text: string
  note?: string
  lineNumber: number
  sourceLineIndex: number
  leftColumn: number
  rightColumn: number
}

type ParsedBoxFlowBox = {
  startColumn: number
  endColumn: number
  topLineIndex: number
  bottomLineIndex: number
  title: string
  titleLineNumber?: number
  rows: ParsedBoxFlowRow[]
}

type ParsedBoxFlowConnectorDirection = 'left' | 'right' | 'none'

type ParsedBoxFlowConnector = {
  rawText: string
  label: string
  direction: ParsedBoxFlowConnectorDirection
  lineNumber: number
}

type ParsedBoxFlow = {
  boxes: ParsedBoxFlowBox[]
  connectors: ParsedBoxFlowConnector[]
}

type ParsedVerticalFlowConnectorDirection = 'down' | 'up' | 'none'

type ParsedVerticalFlowStepDetail = {
  rawText: string
  text: string
  lineNumber: number
}

type ParsedVerticalFlowStep = {
  rawText: string
  title: string
  note?: string
  lineNumber: number
  endLineNumber?: number
  details?: ParsedVerticalFlowStepDetail[]
}

type ParsedVerticalFlowConnector = {
  rawText: string
  label: string
  direction: ParsedVerticalFlowConnectorDirection
  lineNumber: number
}

type ParsedVerticalFlow = {
  steps: ParsedVerticalFlowStep[]
  connectors: ParsedVerticalFlowConnector[]
}

const TOP_LEFT_BORDER_CHARS = new Set(['┌', '╔', '╒', '╓', '╭', '+'])
const TOP_RIGHT_BORDER_CHARS = new Set(['┐', '╗', '╕', '╖', '╮', '+'])
const BOTTOM_LEFT_BORDER_CHARS = new Set(['└', '╚', '╘', '╙', '╰', '+'])
const BOTTOM_RIGHT_BORDER_CHARS = new Set(['┘', '╝', '╛', '╜', '╯', '+'])
const MIDDLE_LEFT_BORDER_CHARS = new Set(['├', '╠', '╞', '╟', '+'])
const MIDDLE_RIGHT_BORDER_CHARS = new Set(['┤', '╣', '╡', '╢', '+'])
const VERTICAL_BORDER_CHARS = new Set(['│', '║', '┃', '|'])
const HORIZONTAL_BORDER_PATTERN = /[─═━-]/
const RIGHT_ARROW_PATTERN = /[▶►>→⇒↦⟶⟹]/
const LEFT_ARROW_PATTERN = /[◀◁<←⇐↤⟵⟸]/
const CONNECTOR_EDGE_PATTERN = /^[\s│║┃|─═━\-<>▶►◀◁→⇒←⇐↦↤⟵⟸⟶⟹]+|[\s│║┃|─═━\-<>▶►◀◁→⇒←⇐↦↤⟵⟸⟶⟹]+$/g
const TRAILING_NOTE_PREFIX_PATTERN = /^[\s←⇐↤⟵⟸<]+/
const BOX_FLOW_BORDER_COLUMN_TOLERANCE = 2
const VERTICAL_FLOW_DOWN_ARROW_PATTERN = /[↓⇣⇩⭣⬇↧▼▽▾▿]|[vV](?=$|\s)/
const VERTICAL_FLOW_UP_ARROW_PATTERN = /[↑⇡⇧⭡⬆↥▲△▴▵]|\^(?=$|\s)/
const VERTICAL_FLOW_CONNECTOR_PATTERN =
  /^[\s│║┃|:.\-]*(?<arrow>(?:[↓⇣⇩⭣⬇↧▼▽▾▿↑⇡⇧⭡⬆↥▲△▴▵]+|[vV^]+(?=$|\s)))[\s│║┃|:.\-]*(?:(?<label>\S(?:.*\S)?)\s*)?$/
const VERTICAL_FLOW_COMMENT_PATTERNS = [/\s+#\s+/, /\s+\/\/\s+/]
const CONNECTOR_SCAFFOLD_LINE_PATTERN =
  /^[\s│║┃|:.\-↓⇣⇩⭣⬇↧▼▽▾▿↑⇡⇧⭡⬆↥▲△▴▵vV^<>▶►◀◁→⇒←⇐↦↤⟵⟸⟶⟹]+$/
const BOX_TITLE_EDGE_PATTERN = /^[\s─═━-]+|[\s─═━-]+$/g

function isParentNode(node: MarkdownNode): node is MarkdownParentNode {
  return Array.isArray(node.children)
}

function isParagraphNode(node: MarkdownNode): node is MarkdownParagraphNode {
  return node.type === 'paragraph' && Array.isArray(node.children)
}

function splitLinesWithNumbers(
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

function firstNonWhitespace(value: string): string | null {
  const trimmed = value.trimStart()
  return trimmed ? trimmed[0] : null
}

function lastNonWhitespace(value: string): string | null {
  const trimmed = value.trimEnd()
  return trimmed ? trimmed[trimmed.length - 1] : null
}

function isTopBorderLine(value: string): boolean {
  const first = firstNonWhitespace(value)
  const last = lastNonWhitespace(value)
  return Boolean(first && last && TOP_LEFT_BORDER_CHARS.has(first) && TOP_RIGHT_BORDER_CHARS.has(last) && HORIZONTAL_BORDER_PATTERN.test(value))
}

function isBottomBorderLine(value: string): boolean {
  const first = firstNonWhitespace(value)
  const last = lastNonWhitespace(value)
  return Boolean(first && last && BOTTOM_LEFT_BORDER_CHARS.has(first) && BOTTOM_RIGHT_BORDER_CHARS.has(last) && HORIZONTAL_BORDER_PATTERN.test(value))
}

function isSeparatorLine(value: string): boolean {
  const first = firstNonWhitespace(value)
  const last = lastNonWhitespace(value)
  return Boolean(first && last && MIDDLE_LEFT_BORDER_CHARS.has(first) && MIDDLE_RIGHT_BORDER_CHARS.has(last) && HORIZONTAL_BORDER_PATTERN.test(value))
}

function isHorizontalBorderChar(value: string): boolean {
  return HORIZONTAL_BORDER_PATTERN.test(value)
}

function isFullwidthCodePoint(codePoint: number): boolean {
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

function getCharacterDisplayWidth(value: string): number {
  const codePoint = value.codePointAt(0)
  if (typeof codePoint !== 'number') return 0
  return isFullwidthCodePoint(codePoint) ? 2 : 1
}

function buildDisplayCells(value: string): DisplayCell[] {
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

function findDisplayCellAtColumn(
  line: LineInfo,
  targetColumn: number
): DisplayCell | null {
  for (const cell of line.displayCells) {
    if (cell.startColumn === targetColumn) return cell
  }
  return null
}

function findFirstNonWhitespaceCell(line: LineInfo): DisplayCell | null {
  for (const cell of line.displayCells) {
    if (cell.value.trim()) return cell
  }
  return null
}

function findLastNonWhitespaceCell(line: LineInfo): DisplayCell | null {
  for (let index = line.displayCells.length - 1; index >= 0; index -= 1) {
    const cell = line.displayCells[index]
    if (cell?.value.trim()) return cell
  }
  return null
}

function findRightmostVerticalBorderCell(line: LineInfo): DisplayCell | null {
  for (let index = line.displayCells.length - 1; index >= 0; index -= 1) {
    const cell = line.displayCells[index]
    if (isVerticalBorderCell(cell)) return cell
  }
  return null
}

function isVerticalBorderCell(cell: DisplayCell | null | undefined): boolean {
  return Boolean(cell && VERTICAL_BORDER_CHARS.has(cell.value))
}

function findNearestVerticalBorderCell(
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

function findStringIndexForDisplayColumn(
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

function sliceLineByDisplayColumns(
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

function findMatchingBorderSegment(
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

function findBorderSegments(
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

function isBorderSegment(
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

function isVerticalContentSegment(
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

function findVerticalDelimiterIndexes(value: string): number[] {
  const indexes: number[] = []
  for (let index = 0; index < value.length; index += 1) {
    if (VERTICAL_BORDER_CHARS.has(value[index])) {
      indexes.push(index)
    }
  }
  return indexes
}

function extractCellsFromContentLine(value: string): string[] | null {
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

function isContentLine(value: string): boolean {
  const first = firstNonWhitespace(value)
  const last = lastNonWhitespace(value)
  if (!first || !last || !VERTICAL_BORDER_CHARS.has(first) || !VERTICAL_BORDER_CHARS.has(last)) {
    return false
  }
  const cells = extractCellsFromContentLine(value)
  return Boolean(cells && cells.length > 0)
}

function parseInlineMarkdownChildren(value: string): MarkdownNode[] {
  const trimmed = value.trim()
  if (!trimmed) {
    return []
  }

  const tree = unified().use(remarkParse).use(remarkGfm).parse(trimmed) as MarkdownParentNode
  const onlyChild = tree.children[0]
  if (tree.children.length === 1 && isParagraphNode(onlyChild)) {
    return onlyChild.children
  }

  return [{ type: 'text', value: trimmed }]
}

function createApproximateLinePosition(
  lineNumber: number,
  text: string
): MarkdownPosition {
  const safeLineNumber = Math.max(1, Math.floor(lineNumber))
  return {
    start: { line: safeLineNumber, column: 1 },
    end: { line: safeLineNumber, column: Math.max(1, text.length + 1) },
  }
}

function createApproximateRangePosition(
  startLine: number,
  endLine: number,
  width: number
): MarkdownPosition {
  const safeStartLine = Math.max(1, Math.floor(startLine))
  const safeEndLine = Math.max(safeStartLine, Math.floor(endLine))
  return {
    start: { line: safeStartLine, column: 1 },
    end: { line: safeEndLine, column: Math.max(1, width + 1) },
  }
}

function createCustomMarkdownNode(
  type: string,
  tagName: string,
  className: string,
  children: MarkdownNode[],
  position?: MarkdownPosition,
  properties?: Record<string, unknown>
): MarkdownNode {
  return {
    type,
    children,
    position,
    data: {
      hName: tagName,
      hProperties: {
        className,
        ...properties,
      },
    },
  }
}

function createInlineMarkdownSpan(
  type: string,
  className: string,
  value: string,
  lineNumber: number,
  extraProperties?: Record<string, unknown>
): MarkdownNode {
  return createCustomMarkdownNode(
    type,
    'span',
    className,
    parseInlineMarkdownChildren(value),
    createApproximateLinePosition(lineNumber, value),
    extraProperties
  )
}

function normalizeConnectorLabel(value: string): string {
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

function splitVerticalFlowStepText(value: string): { title: string; note?: string } {
  const trimmed = value.trim()
  if (!trimmed) {
    return { title: '' }
  }

  for (const pattern of VERTICAL_FLOW_COMMENT_PATTERNS) {
    const match = pattern.exec(trimmed)
    if (!match || typeof match.index !== 'number') continue
    const title = trimmed.slice(0, match.index).trim()
    const note = trimmed.slice(match.index + match[0].length).trim()
    if (title && note) {
      return { title, note }
    }
  }

  return { title: trimmed }
}

function inferVerticalFlowConnectorDirection(value: string): ParsedVerticalFlowConnectorDirection {
  if (!value.trim()) return 'none'
  if (VERTICAL_FLOW_DOWN_ARROW_PATTERN.test(value)) return 'down'
  if (VERTICAL_FLOW_UP_ARROW_PATTERN.test(value)) return 'up'
  return 'down'
}

function parseVerticalFlowConnector(
  line: LineInfo
): ParsedVerticalFlowConnector | null {
  const trimmed = line.text.trim()
  if (!trimmed) return null

  const match = trimmed.match(VERTICAL_FLOW_CONNECTOR_PATTERN)
  const arrow = match?.groups?.arrow?.trim() ?? ''
  if (!arrow) return null

  const label = match?.groups?.label?.trim() ?? ''
  return {
    rawText: trimmed,
    label,
    direction: inferVerticalFlowConnectorDirection(arrow),
    lineNumber: line.lineNumber,
  }
}

function parseVerticalFlow(source: string, startLine: number): ParsedVerticalFlow | null {
  const lines = splitLinesWithNumbers(source, startLine)
  if (lines.length < 3) return null

  const firstLine = lines[0]?.text.trim() ?? ''
  if (!firstLine) return null

  const steps: ParsedVerticalFlowStep[] = []
  const connectors: ParsedVerticalFlowConnector[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index]
    if (!current) return null
    const trimmed = current.text.trim()
    if (!trimmed) return null

    if (index % 2 === 0) {
      const { title, note } = splitVerticalFlowStepText(trimmed)
      if (!title) return null
      steps.push({
        rawText: trimmed,
        title,
        note,
        lineNumber: current.lineNumber,
      })
      continue
    }

    const connector = parseVerticalFlowConnector(current)
    if (!connector) return null
    connectors.push(connector)
  }

  if (steps.length < 2 || connectors.length !== steps.length - 1) return null
  if (!connectors.some((item) => item.rawText.length > 0)) return null

  return {
    steps,
    connectors,
  }
}

function isConnectorScaffoldOnlyLine(value: string): boolean {
  return CONNECTOR_SCAFFOLD_LINE_PATTERN.test(value.trim())
}

function isTranscriptConnectorLikeLine(line: LineInfo): boolean {
  const trimmed = line.text.trim()
  if (!trimmed) return false
  if (parseVerticalFlowConnector(line)) return true
  const first = trimmed[0]
  return Boolean(first && (VERTICAL_BORDER_CHARS.has(first) || first === ':' || first === '.' || first === '-'))
}

function parseTranscriptConnectorLabelLine(line: LineInfo): string {
  const directConnector = parseVerticalFlowConnector(line)
  if (directConnector?.label) {
    return directConnector.label
  }

  const trimmed = line.text.trim()
  if (!trimmed || isConnectorScaffoldOnlyLine(trimmed)) {
    return ''
  }

  const withoutPrefix = trimmed
    .replace(/^[\s│║┃|:.\-]+/, '')
    .replace(/^[↓⇣⇩⭣⬇↧▼▽▾▿↑⇡⇧⭡⬆↥▲△▴▵vV^<>▶►◀◁→⇒←⇐↦↤⟵⟸⟶⟹]+/, '')
    .trim()

  if (!withoutPrefix || isConnectorScaffoldOnlyLine(withoutPrefix)) {
    return ''
  }

  return withoutPrefix
}

function parseTranscriptPlainStep(
  lines: LineInfo[],
  startIndex: number
): { step: ParsedVerticalFlowStep; nextLineIndex: number } | null {
  const titleLine = lines[startIndex]
  if (!titleLine) return null

  const title = titleLine.text.trim()
  if (!title || isTranscriptConnectorLikeLine(titleLine)) {
    return null
  }

  const details: ParsedVerticalFlowStepDetail[] = []
  let endLineNumber = titleLine.lineNumber
  let nextLineIndex = startIndex + 1

  while (nextLineIndex < lines.length) {
    const current = lines[nextLineIndex]
    if (!current) break
    const trimmed = current.text.trim()
    if (!trimmed || isTranscriptConnectorLikeLine(current) || isTopBorderLine(current.text)) {
      break
    }

    details.push({
      rawText: trimmed,
      text: trimmed,
      lineNumber: current.lineNumber,
    })
    endLineNumber = current.lineNumber
    nextLineIndex += 1
  }

  return {
    step: {
      rawText: [title, ...details.map((detail) => detail.rawText)].join('\n'),
      title,
      lineNumber: titleLine.lineNumber,
      endLineNumber,
      details: details.length > 0 ? details : undefined,
    },
    nextLineIndex,
  }
}

function parseTranscriptTitledBoxStep(
  lines: LineInfo[],
  startIndex: number
): { step: ParsedVerticalFlowStep; nextLineIndex: number } | null {
  const topLine = lines[startIndex]
  if (!topLine) return null

  const topLeft = findFirstNonWhitespaceCell(topLine)
  const topRight = findLastNonWhitespaceCell(topLine)
  if (!topLeft || !topRight) return null
  if (!TOP_LEFT_BORDER_CHARS.has(topLeft.value) || !TOP_RIGHT_BORDER_CHARS.has(topRight.value)) {
    return null
  }

  const rawTitle = sliceLineByDisplayColumns(topLine, topLeft.endColumn, topRight.startColumn)
  const title = rawTitle.replace(BOX_TITLE_EDGE_PATTERN, '').trim()
  if (!title) return null

  let bottomLineIndex = -1
  let expectedRightColumn = topRight.startColumn
  for (let lineIndex = startIndex + 1; lineIndex < lines.length; lineIndex += 1) {
    const current = lines[lineIndex]
    if (!current) continue

    const first = findFirstNonWhitespaceCell(current)
    const last = findLastNonWhitespaceCell(current)
    if (
      first &&
      last &&
      BOTTOM_LEFT_BORDER_CHARS.has(first.value) &&
      BOTTOM_RIGHT_BORDER_CHARS.has(last.value) &&
      Math.abs(first.startColumn - topLeft.startColumn) <= BOX_FLOW_BORDER_COLUMN_TOLERANCE &&
      Math.abs(last.startColumn - topRight.startColumn) <= BOX_FLOW_BORDER_COLUMN_TOLERANCE
    ) {
      bottomLineIndex = lineIndex
      break
    }

    const leftBorderCell = findNearestVerticalBorderCell(current, topLeft.startColumn)
    const rightBorderCell = findNearestVerticalBorderCell(current, expectedRightColumn, 4)
      ?? findRightmostVerticalBorderCell(current)
    if (!leftBorderCell || !rightBorderCell || rightBorderCell.startColumn <= leftBorderCell.startColumn) {
      return null
    }
    expectedRightColumn = Math.max(expectedRightColumn, rightBorderCell.startColumn)
  }

  if (bottomLineIndex <= startIndex) return null

  const details: ParsedVerticalFlowStepDetail[] = []
  for (let lineIndex = startIndex + 1; lineIndex < bottomLineIndex; lineIndex += 1) {
    const current = lines[lineIndex]
    if (!current) continue
    const leftBorderCell = findNearestVerticalBorderCell(current, topLeft.startColumn)
    const rightBorderCell = findNearestVerticalBorderCell(current, expectedRightColumn, 4)
      ?? findRightmostVerticalBorderCell(current)
    if (!leftBorderCell || !rightBorderCell || rightBorderCell.startColumn <= leftBorderCell.startColumn) {
      return null
    }

    const text = sliceLineByDisplayColumns(current, leftBorderCell.endColumn, rightBorderCell.startColumn).trim()
    if (!text) continue
    details.push({
      rawText: text,
      text,
      lineNumber: current.lineNumber,
    })
  }

  return {
    step: {
      rawText: [title, ...details.map((detail) => detail.rawText)].join('\n'),
      title,
      lineNumber: topLine.lineNumber,
      endLineNumber: lines[bottomLineIndex]?.lineNumber ?? topLine.lineNumber,
      details: details.length > 0 ? details : undefined,
    },
    nextLineIndex: bottomLineIndex + 1,
  }
}

function parseTranscriptConnectorGroup(
  lines: LineInfo[],
  startIndex: number
): { connector: ParsedVerticalFlowConnector; nextLineIndex: number } | null {
  const group: LineInfo[] = []
  let nextLineIndex = startIndex
  let directionalConnectorLine: LineInfo | null = null

  while (nextLineIndex < lines.length) {
    const current = lines[nextLineIndex]
    if (!current) break
    const trimmed = current.text.trim()
    if (!trimmed) break

    if (!isTranscriptConnectorLikeLine(current)) {
      break
    }

    group.push(current)
    if (parseVerticalFlowConnector(current)) {
      directionalConnectorLine = current
    }
    nextLineIndex += 1
  }

  if (group.length <= 0 || !directionalConnectorLine) {
    return null
  }

  const label = group
    .map((line) => parseTranscriptConnectorLabelLine(line))
    .filter(Boolean)
    .join(' ')

  return {
    connector: {
      rawText: group.map((line) => line.text.replace(/\s+$/, '')).join('\n'),
      label,
      direction: inferVerticalFlowConnectorDirection(directionalConnectorLine.text.trim()),
      lineNumber: group[0]?.lineNumber ?? directionalConnectorLine.lineNumber,
    },
    nextLineIndex,
  }
}

function parseTranscriptStructuredFlow(source: string, startLine: number): ParsedVerticalFlow | null {
  const lines = splitLinesWithNumbers(source, startLine)
  if (lines.length < 5) return null

  const steps: ParsedVerticalFlowStep[] = []
  const connectors: ParsedVerticalFlowConnector[] = []
  let lineIndex = 0
  let sawBoxStep = false
  let sawConnectorLabel = false

  while (lineIndex < lines.length) {
    const current = lines[lineIndex]
    if (!current) break
    if (!current.text.trim()) return null

    const boxStep = parseTranscriptTitledBoxStep(lines, lineIndex)
    const parsedStep = boxStep ?? parseTranscriptPlainStep(lines, lineIndex)
    if (!parsedStep) {
      return null
    }

    steps.push(parsedStep.step)
    if (boxStep) {
      sawBoxStep = true
    }
    lineIndex = parsedStep.nextLineIndex

    if (lineIndex >= lines.length) {
      break
    }

    const connectorGroup = parseTranscriptConnectorGroup(lines, lineIndex)
    if (!connectorGroup) {
      return null
    }

    connectors.push(connectorGroup.connector)
    if (connectorGroup.connector.label) {
      sawConnectorLabel = true
    }
    lineIndex = connectorGroup.nextLineIndex
  }

  if (steps.length < 2 || connectors.length !== steps.length - 1) return null
  if (!connectors.some((connector) => connector.rawText.trim())) return null
  if (!sawBoxStep && !sawConnectorLabel) return null

  return {
    steps,
    connectors,
  }
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

function parseBoxFlow(source: string, startLine: number): ParsedBoxFlow | null {
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

function parseBoxTable(source: string, startLine: number): ParsedBoxTable | null {
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

function transformParagraphToTable(
  node: MarkdownParagraphNode,
  source: string
): MarkdownNode | null {
  const startOffset = node.position?.start.offset
  const endOffset = node.position?.end.offset
  const startLine = node.position?.start.line

  if (typeof startOffset !== 'number' || typeof endOffset !== 'number' || typeof startLine !== 'number') {
    return null
  }
  if (endOffset <= startOffset) return null

  const rawParagraph = source.slice(startOffset, endOffset)
  const parsed = parseBoxTable(rawParagraph, startLine)
  if (!parsed) return null

  return {
    type: 'table',
    align: Array.from({ length: parsed.columnCount }, () => null),
    position: node.position,
    children: parsed.rows.map((cells, rowIndex) => {
      const rowLineStart = cells.startLine
      const rowLineEnd = Math.max(cells.startLine, cells.endLine)
      return {
        type: 'tableRow',
        position: {
          start: { line: rowLineStart, column: 1 },
          end: { line: rowLineEnd, column: Math.max(1, cells.cells.join(' | ').length + 1) },
        },
        children: cells.cells.map((cell) => ({
          type: 'tableCell',
          children: parseInlineMarkdownChildren(cell),
          position: {
            start: { line: rowLineStart, column: 1 },
            end: { line: rowLineEnd, column: Math.max(1, cell.length + 1) },
          },
        })),
      }
    }),
  }
}

function transformParagraphToBoxFlow(
  node: MarkdownParagraphNode,
  source: string
): MarkdownNode | null {
  const startOffset = node.position?.start.offset
  const endOffset = node.position?.end.offset
  const startLine = node.position?.start.line

  if (typeof startOffset !== 'number' || typeof endOffset !== 'number' || typeof startLine !== 'number') {
    return null
  }
  if (endOffset <= startOffset) return null

  const rawParagraph = source.slice(startOffset, endOffset)
  const parsedFlow = parseBoxFlow(rawParagraph, startLine)
  if (!parsedFlow) return null

  const trackChildren: MarkdownNode[] = []

  parsedFlow.boxes.forEach((box, index) => {
    const titleNode = box.title
      ? createCustomMarkdownNode(
        'boxFlowTitle',
        'div',
        'code-markdown-box-flow-node-title',
        parseInlineMarkdownChildren(box.title),
        createApproximateLinePosition(box.titleLineNumber ?? box.rows[0]?.lineNumber ?? startLine, box.title)
      )
      : null

    const lineNodes = box.rows.map((row) => {
      const lineChildren = [
        createInlineMarkdownSpan(
          'boxFlowLineText',
          'code-markdown-box-flow-line-text',
          row.text,
          row.lineNumber
        ),
      ]

      if (row.note) {
        lineChildren.push(
          createInlineMarkdownSpan(
            'boxFlowLineNote',
            'code-markdown-box-flow-line-note',
            row.note,
            row.lineNumber
          )
        )
      }

      return createCustomMarkdownNode(
        'boxFlowLine',
        'div',
        'code-markdown-box-flow-line',
        lineChildren,
        createApproximateLinePosition(row.lineNumber, row.text + (row.note ? ` ${row.note}` : ''))
      )
    })

    const cardNode = createCustomMarkdownNode(
      'boxFlowCard',
      'div',
      'code-markdown-box-flow-node-card',
      lineNodes,
      createApproximateRangePosition(
        box.rows[0]?.lineNumber ?? startLine,
        box.rows[box.rows.length - 1]?.lineNumber ?? startLine,
        Math.max(1, box.endColumn - box.startColumn + 1)
      )
    )

    trackChildren.push(
      createCustomMarkdownNode(
        'boxFlowNode',
        'div',
        'code-markdown-box-flow-node',
        titleNode ? [titleNode, cardNode] : [cardNode],
        createApproximateRangePosition(
          box.titleLineNumber ?? box.rows[0]?.lineNumber ?? startLine,
          box.rows[box.rows.length - 1]?.lineNumber ?? startLine,
          Math.max(1, box.endColumn - box.startColumn + 1)
        )
      )
    )

    const connector = parsedFlow.connectors[index]
    if (!connector) return

    const arrowGlyph = connector.direction === 'left'
      ? '←'
      : connector.direction === 'none'
        ? '•'
        : '→'
    const connectorLabel = connector.label || ''
    const connectorChildren: MarkdownNode[] = [
      createInlineMarkdownSpan(
        'boxFlowConnectorArrow',
        'code-markdown-box-flow-connector-arrow',
        arrowGlyph,
        connector.lineNumber,
        { 'aria-hidden': 'true' }
      ),
    ]

    if (connectorLabel) {
      connectorChildren.push(
        createInlineMarkdownSpan(
          'boxFlowConnectorLabel',
          'code-markdown-box-flow-connector-label',
          connectorLabel,
          connector.lineNumber
        )
      )
    }

    trackChildren.push(
      createCustomMarkdownNode(
        'boxFlowConnector',
        'div',
        `code-markdown-box-flow-connector ${
          connector.direction === 'left'
            ? 'is-left'
            : connector.direction === 'none'
              ? 'is-none'
              : 'is-right'
        }`,
        connectorChildren,
        createApproximateLinePosition(
          connector.lineNumber,
          connector.rawText || connectorLabel || arrowGlyph
        ),
        connector.rawText ? { title: connector.rawText } : undefined
      )
    )
  })

  const trackNode = createCustomMarkdownNode(
    'boxFlowTrack',
    'div',
    'code-markdown-box-flow-track',
    trackChildren,
    node.position
  )

  return createCustomMarkdownNode(
    'boxFlow',
    'div',
    'code-markdown-box-flow',
    [trackNode],
    node.position
  )
}

function transformParagraphToVerticalFlow(
  node: MarkdownParagraphNode,
  source: string
): MarkdownNode | null {
  const startOffset = node.position?.start.offset
  const endOffset = node.position?.end.offset
  const startLine = node.position?.start.line

  if (typeof startOffset !== 'number' || typeof endOffset !== 'number' || typeof startLine !== 'number') {
    return null
  }
  if (endOffset <= startOffset) return null

  const rawParagraph = source.slice(startOffset, endOffset)
  const parsedFlow = parseVerticalFlow(rawParagraph, startLine) ?? parseTranscriptStructuredFlow(rawParagraph, startLine)
  if (!parsedFlow) return null

  const stackChildren: MarkdownNode[] = []

  parsedFlow.steps.forEach((step, index) => {
    const stepChildren: MarkdownNode[] = [
      createCustomMarkdownNode(
        'verticalFlowStepTitle',
        'div',
        'code-markdown-vertical-flow-step-title',
        parseInlineMarkdownChildren(step.title),
        createApproximateLinePosition(step.lineNumber, step.title)
      ),
    ]

    if (step.note) {
      stepChildren.push(
        createInlineMarkdownSpan(
          'verticalFlowStepNote',
          'code-markdown-vertical-flow-step-note',
          step.note,
          step.lineNumber
        )
      )
    }

    if (step.details?.length) {
      stepChildren.push(
        createCustomMarkdownNode(
          'verticalFlowStepDetails',
          'div',
          'code-markdown-vertical-flow-step-details',
          step.details.map((detail) => (
            createCustomMarkdownNode(
              'verticalFlowStepDetail',
              'div',
              'code-markdown-vertical-flow-step-detail',
              parseInlineMarkdownChildren(detail.text),
              createApproximateLinePosition(detail.lineNumber, detail.rawText)
            )
          )),
          createApproximateRangePosition(
            step.details[0]?.lineNumber ?? step.lineNumber,
            step.details[step.details.length - 1]?.lineNumber ?? step.lineNumber,
            Math.max(...step.details.map((detail) => Math.max(1, detail.rawText.length)))
          )
        )
      )
    }

    stackChildren.push(
      createCustomMarkdownNode(
        'verticalFlowStep',
        'div',
        'code-markdown-vertical-flow-step',
        stepChildren,
        createApproximateRangePosition(
          step.lineNumber,
          step.endLineNumber ?? step.lineNumber,
          Math.max(
            1,
            step.title.length,
            step.note?.length ?? 0,
            ...(step.details?.map((detail) => detail.rawText.length) ?? [])
          )
        )
      )
    )

    const connector = parsedFlow.connectors[index]
    if (!connector) return

    const arrowGlyph = connector.direction === 'up'
      ? '↑'
      : connector.direction === 'none'
        ? '•'
        : '↓'
    const connectorChildren: MarkdownNode[] = [
      createInlineMarkdownSpan(
        'verticalFlowConnectorArrow',
        'code-markdown-vertical-flow-connector-arrow',
        arrowGlyph,
        connector.lineNumber,
        { 'aria-hidden': 'true' }
      ),
    ]

    if (connector.label) {
      connectorChildren.push(
        createInlineMarkdownSpan(
          'verticalFlowConnectorLabel',
          'code-markdown-vertical-flow-connector-label',
          connector.label,
          connector.lineNumber
        )
      )
    }

    stackChildren.push(
      createCustomMarkdownNode(
        'verticalFlowConnector',
        'div',
        `code-markdown-vertical-flow-connector ${
          connector.direction === 'up'
            ? 'is-up'
            : connector.direction === 'none'
              ? 'is-none'
              : 'is-down'
        }`,
        connectorChildren,
        createApproximateLinePosition(
          connector.lineNumber,
          connector.rawText || connector.label || arrowGlyph
        ),
        connector.rawText ? { title: connector.rawText } : undefined
      )
    )
  })

  const stackNode = createCustomMarkdownNode(
    'verticalFlowStack',
    'div',
    'code-markdown-vertical-flow-stack',
    stackChildren,
    node.position
  )

  return createCustomMarkdownNode(
    'verticalFlow',
    'div',
    'code-markdown-vertical-flow',
    [stackNode],
    node.position
  )
}

function transformTree(node: MarkdownParentNode, source: string): void {
  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index]
    if (!child) continue

    if (isParagraphNode(child)) {
      const verticalFlowReplacement = transformParagraphToVerticalFlow(child, source)
      if (verticalFlowReplacement) {
        node.children[index] = verticalFlowReplacement
        continue
      }

      const flowReplacement = transformParagraphToBoxFlow(child, source)
      if (flowReplacement) {
        node.children[index] = flowReplacement
        continue
      }

      const replacement = transformParagraphToTable(child, source)
      if (replacement) {
        node.children[index] = replacement
        continue
      }
    }

    if (isParentNode(child)) {
      transformTree(child, source)
    }
  }
}

export function remarkBoxDrawingTables() {
  return (tree: MarkdownNode, file: { value?: unknown }) => {
    if (!isParentNode(tree)) return
    const source = typeof file.value === 'string' ? file.value : ''
    if (!source) return
    transformTree(tree, source)
  }
}
