export type MarkdownPositionPoint = {
  line: number
  column: number
  offset?: number
}

export type MarkdownPosition = {
  start: MarkdownPositionPoint
  end: MarkdownPositionPoint
}

export type MarkdownNode = {
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

export type MarkdownParentNode = MarkdownNode & {
  children: MarkdownNode[]
}

export type MarkdownParagraphNode = MarkdownParentNode & {
  type: 'paragraph'
}

export type LineInfo = {
  text: string
  lineNumber: number
  displayCells: DisplayCell[]
  displayWidth: number
}

export type DisplayCell = {
  value: string
  startIndex: number
  endIndex: number
  startColumn: number
  endColumn: number
}

export type ParsedBoxTable = {
  rows: ParsedBoxTableRow[]
  columnCount: number
}

export type ParsedBoxTableRow = {
  cells: string[]
  startLine: number
  endLine: number
}

export type ParsedBoxFlowRow = {
  text: string
  note?: string
  lineNumber: number
  sourceLineIndex: number
  leftColumn: number
  rightColumn: number
}

export type ParsedBoxFlowBox = {
  startColumn: number
  endColumn: number
  topLineIndex: number
  bottomLineIndex: number
  title: string
  titleLineNumber?: number
  rows: ParsedBoxFlowRow[]
}

export type ParsedBoxFlowConnectorDirection = 'left' | 'right' | 'none'

export type ParsedBoxFlowConnector = {
  rawText: string
  label: string
  direction: ParsedBoxFlowConnectorDirection
  lineNumber: number
}

export type ParsedBoxFlow = {
  boxes: ParsedBoxFlowBox[]
  connectors: ParsedBoxFlowConnector[]
}

export type ParsedVerticalFlowConnectorDirection = 'down' | 'up' | 'none'

export type ParsedVerticalFlowStepDetail = {
  rawText: string
  text: string
  lineNumber: number
}

export type ParsedVerticalFlowStep = {
  rawText: string
  title: string
  note?: string
  lineNumber: number
  endLineNumber?: number
  details?: ParsedVerticalFlowStepDetail[]
}

export type ParsedVerticalFlowConnector = {
  rawText: string
  label: string
  direction: ParsedVerticalFlowConnectorDirection
  lineNumber: number
}

export type ParsedVerticalFlow = {
  steps: ParsedVerticalFlowStep[]
  connectors: ParsedVerticalFlowConnector[]
}

export type ParsedInlineArrowSegment = {
  rawText: string
  title: string
  note?: string
  lineNumber: number
  startColumn: number
  endColumn: number
}

export type ParsedBoxDiagram = {
  lines: Array<{
    text: string
    lineNumber: number
  }>
}

export type ParsedArchitectureNode = {
  title: string
  details?: string[]
  children?: ParsedArchitectureNode[]
  connectors?: string[]
  startLine: number
  endLine: number
}

export type ParsedArchitectureRow = {
  nodes: ParsedArchitectureNode[]
}

export type ParsedArchitectureSection = {
  title: string
  details?: string[]
  nodes: ParsedArchitectureNode[]
  rows: ParsedArchitectureRow[]
  startLine: number
  endLine: number
}

export type ParsedArchitectureDiagram = {
  sections: ParsedArchitectureSection[]
}
