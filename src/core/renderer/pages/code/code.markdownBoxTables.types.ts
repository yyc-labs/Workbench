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
