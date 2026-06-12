import type { CSSProperties, ComponentPropsWithoutRef, SVGProps } from 'react'

const BOX_DIAGRAM_FONT_STACK = "'Sarasa Mono SC', 'Noto Sans Mono CJK SC', 'JetBrains Mono', 'Cascadia Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
const BOX_DIAGRAM_BASE_CELL_WIDTH = 18
const BOX_DIAGRAM_BASE_ROW_HEIGHT = 28
const BOX_DIAGRAM_TEXT_BASELINE_RATIO = 0.7
const BOX_DIAGRAM_ARROW_HALF_WIDTH = 6
const BOX_DIAGRAM_ARROW_HALF_HEIGHT = 5
const BOX_DIAGRAM_LINE_INSET = 0.8

type DisplayCell = {
  value: string
  startColumn: number
  endColumn: number
}

type BoxDiagramTextRun = {
  text: string
  startColumn: number
}

type BoxDiagramLineSegment = {
  x1: number
  y1: number
  x2: number
  y2: number
}

type BoxDiagramArrowDirection = 'up' | 'down' | 'left' | 'right'

type BoxDiagramArrow = {
  cx: number
  cy: number
  direction: BoxDiagramArrowDirection
}

type BoxDiagramBlockProps = ComponentPropsWithoutRef<'div'> & {
  lines: string[]
}

const BOX_DRAWING_DIRECTION_MAP: Record<string, Array<'left' | 'right' | 'up' | 'down'>> = {
  '─': ['left', 'right'],
  '═': ['left', 'right'],
  '━': ['left', 'right'],
  '-': ['left', 'right'],
  '│': ['up', 'down'],
  '║': ['up', 'down'],
  '┃': ['up', 'down'],
  '|': ['up', 'down'],
  '┌': ['right', 'down'],
  '╔': ['right', 'down'],
  '╒': ['right', 'down'],
  '╓': ['right', 'down'],
  '╭': ['right', 'down'],
  '┐': ['left', 'down'],
  '╗': ['left', 'down'],
  '╕': ['left', 'down'],
  '╖': ['left', 'down'],
  '╮': ['left', 'down'],
  '└': ['right', 'up'],
  '╚': ['right', 'up'],
  '╘': ['right', 'up'],
  '╙': ['right', 'up'],
  '╰': ['right', 'up'],
  '┘': ['left', 'up'],
  '╝': ['left', 'up'],
  '╛': ['left', 'up'],
  '╜': ['left', 'up'],
  '╯': ['left', 'up'],
  '├': ['right', 'up', 'down'],
  '╠': ['right', 'up', 'down'],
  '╞': ['right', 'up', 'down'],
  '╟': ['right', 'up', 'down'],
  '┤': ['left', 'up', 'down'],
  '╣': ['left', 'up', 'down'],
  '╡': ['left', 'up', 'down'],
  '╢': ['left', 'up', 'down'],
  '┬': ['left', 'right', 'down'],
  '┳': ['left', 'right', 'down'],
  '┴': ['left', 'right', 'up'],
  '┻': ['left', 'right', 'up'],
  '┼': ['left', 'right', 'up', 'down'],
  '╋': ['left', 'right', 'up', 'down'],
}

const BOX_DRAWING_CHARS = new Set(Object.keys(BOX_DRAWING_DIRECTION_MAP))
const ARROW_DIRECTION_MAP: Record<string, BoxDiagramArrowDirection> = {
  '▼': 'down',
  '▽': 'down',
  '▾': 'down',
  '▿': 'down',
  '▲': 'up',
  '△': 'up',
  '▴': 'up',
  '▵': 'up',
  '▶': 'right',
  '►': 'right',
  '→': 'right',
  '⇒': 'right',
  '↦': 'right',
  '⟶': 'right',
  '⟹': 'right',
  '>': 'right',
  '◀': 'left',
  '◁': 'left',
  '←': 'left',
  '⇐': 'left',
  '↤': 'left',
  '⟵': 'left',
  '⟸': 'left',
  '<': 'left',
  'v': 'down',
  'V': 'down',
  '^': 'up',
}
const ARROW_CHARS = new Set(Object.keys(ARROW_DIRECTION_MAP))

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
  let index = 0
  let startColumn = 0

  while (index < value.length) {
    const codePoint = value.codePointAt(index)
    if (typeof codePoint !== 'number') break
    const character = String.fromCodePoint(codePoint)
    const width = getCharacterDisplayWidth(character)
    const endIndex = index + character.length
    cells.push({
      value: character,
      startColumn,
      endColumn: startColumn + width,
    })
    startColumn += width
    index = endIndex
  }

  return cells
}

function isDecorationCell(value: string): boolean {
  return BOX_DRAWING_CHARS.has(value) || ARROW_CHARS.has(value)
}

function buildTextRuns(cells: DisplayCell[]): BoxDiagramTextRun[] {
  const runs: BoxDiagramTextRun[] = []
  let buffer = ''
  let bufferStart = 0
  let active = false

  const flush = () => {
    const normalized = buffer.replace(/\s+$/, '')
    if (active && normalized.trim()) {
      runs.push({
        text: normalized,
        startColumn: bufferStart,
      })
    }
    buffer = ''
    active = false
  }

  for (const cell of cells) {
    if (isDecorationCell(cell.value)) {
      flush()
      continue
    }

    if (!active) {
      if (!cell.value.trim()) {
        continue
      }
      active = true
      bufferStart = cell.startColumn
      buffer = cell.value
      continue
    }

    buffer += cell.value
  }

  flush()
  return runs
}

function buildSegments(cells: DisplayCell[], rowIndex: number): BoxDiagramLineSegment[] {
  const yCenter = rowIndex * BOX_DIAGRAM_BASE_ROW_HEIGHT + BOX_DIAGRAM_BASE_ROW_HEIGHT / 2
  const yTop = rowIndex * BOX_DIAGRAM_BASE_ROW_HEIGHT + BOX_DIAGRAM_LINE_INSET
  const yBottom = (rowIndex + 1) * BOX_DIAGRAM_BASE_ROW_HEIGHT - BOX_DIAGRAM_LINE_INSET
  const segments: BoxDiagramLineSegment[] = []

  for (const cell of cells) {
    const directions = BOX_DRAWING_DIRECTION_MAP[cell.value]
    if (!directions) continue
    const xLeft = cell.startColumn * BOX_DIAGRAM_BASE_CELL_WIDTH + BOX_DIAGRAM_LINE_INSET
    const xRight = cell.endColumn * BOX_DIAGRAM_BASE_CELL_WIDTH - BOX_DIAGRAM_LINE_INSET
    const xCenter = (xLeft + xRight) / 2

    for (const direction of directions) {
      if (direction === 'left') {
        segments.push({ x1: xLeft, y1: yCenter, x2: xCenter, y2: yCenter })
      } else if (direction === 'right') {
        segments.push({ x1: xCenter, y1: yCenter, x2: xRight, y2: yCenter })
      } else if (direction === 'up') {
        segments.push({ x1: xCenter, y1: yTop, x2: xCenter, y2: yCenter })
      } else if (direction === 'down') {
        segments.push({ x1: xCenter, y1: yCenter, x2: xCenter, y2: yBottom })
      }
    }
  }

  return segments
}

function buildArrows(cells: DisplayCell[], rowIndex: number): BoxDiagramArrow[] {
  const arrows: BoxDiagramArrow[] = []

  for (const cell of cells) {
    const direction = ARROW_DIRECTION_MAP[cell.value]
    if (!direction) continue

    const xLeft = cell.startColumn * BOX_DIAGRAM_BASE_CELL_WIDTH
    const xRight = cell.endColumn * BOX_DIAGRAM_BASE_CELL_WIDTH
    const yTop = rowIndex * BOX_DIAGRAM_BASE_ROW_HEIGHT
    const yBottom = yTop + BOX_DIAGRAM_BASE_ROW_HEIGHT
    arrows.push({
      cx: (xLeft + xRight) / 2,
      cy: (yTop + yBottom) / 2,
      direction,
    })
  }

  return arrows
}

function buildArrowPath({ cx, cy, direction }: BoxDiagramArrow): string {
  if (direction === 'down') {
    return `M ${cx - BOX_DIAGRAM_ARROW_HALF_WIDTH} ${cy - BOX_DIAGRAM_ARROW_HALF_HEIGHT} L ${cx + BOX_DIAGRAM_ARROW_HALF_WIDTH} ${cy - BOX_DIAGRAM_ARROW_HALF_HEIGHT} L ${cx} ${cy + BOX_DIAGRAM_ARROW_HALF_HEIGHT} Z`
  }
  if (direction === 'up') {
    return `M ${cx - BOX_DIAGRAM_ARROW_HALF_WIDTH} ${cy + BOX_DIAGRAM_ARROW_HALF_HEIGHT} L ${cx + BOX_DIAGRAM_ARROW_HALF_WIDTH} ${cy + BOX_DIAGRAM_ARROW_HALF_HEIGHT} L ${cx} ${cy - BOX_DIAGRAM_ARROW_HALF_HEIGHT} Z`
  }
  if (direction === 'left') {
    return `M ${cx + BOX_DIAGRAM_ARROW_HALF_HEIGHT} ${cy - BOX_DIAGRAM_ARROW_HALF_WIDTH} L ${cx + BOX_DIAGRAM_ARROW_HALF_HEIGHT} ${cy + BOX_DIAGRAM_ARROW_HALF_WIDTH} L ${cx - BOX_DIAGRAM_ARROW_HALF_HEIGHT} ${cy} Z`
  }
  return `M ${cx - BOX_DIAGRAM_ARROW_HALF_HEIGHT} ${cy - BOX_DIAGRAM_ARROW_HALF_WIDTH} L ${cx - BOX_DIAGRAM_ARROW_HALF_HEIGHT} ${cy + BOX_DIAGRAM_ARROW_HALF_WIDTH} L ${cx + BOX_DIAGRAM_ARROW_HALF_HEIGHT} ${cy} Z`
}

function diagramStyleVariables(columns: number, rows: number): CSSProperties {
  return {
    '--diagram-columns': String(columns),
    '--diagram-rows': String(rows),
  } as CSSProperties
}

function svgTextProps(x: number, y: number): SVGProps<SVGTextElement> {
  return {
    x,
    y,
    xmlSpace: 'preserve',
  }
}

export function parseBoxDiagramLinesProp(value: unknown): string[] {
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

export function BoxDiagramBlock({
  className,
  lines,
  children: _children,
  ...props
}: BoxDiagramBlockProps) {
  const normalizedLines = lines.filter((line) => line.length > 0)
  const rows = normalizedLines.length
  const columns = normalizedLines.reduce((max, line) => {
    const cells = buildDisplayCells(line)
    return Math.max(max, cells[cells.length - 1]?.endColumn ?? 0)
  }, 0)

  if (rows <= 0 || columns <= 0) {
    return <div className={className} {...props} />
  }

  const width = columns * BOX_DIAGRAM_BASE_CELL_WIDTH
  const height = rows * BOX_DIAGRAM_BASE_ROW_HEIGHT

  return (
    <div className={className} {...props}>
      <div className="code-markdown-box-diagram-body" style={diagramStyleVariables(columns, rows)}>
        <svg
          className="code-markdown-box-diagram-svg"
          viewBox={`0 0 ${width} ${height}`}
          aria-hidden="true"
        >
          <g className="code-markdown-box-diagram-strokes">
            {normalizedLines.map((line, rowIndex) => {
              const cells = buildDisplayCells(line)
              const segments = buildSegments(cells, rowIndex)
              return segments.map((segment, segmentIndex) => (
                <line
                  key={`segment-${rowIndex}-${segmentIndex}`}
                  className="code-markdown-box-diagram-stroke"
                  x1={segment.x1}
                  y1={segment.y1}
                  x2={segment.x2}
                  y2={segment.y2}
                />
              ))
            })}
          </g>

          <g className="code-markdown-box-diagram-arrows">
            {normalizedLines.map((line, rowIndex) => {
              const cells = buildDisplayCells(line)
              const arrows = buildArrows(cells, rowIndex)
              return arrows.map((arrow, arrowIndex) => (
                <path
                  key={`arrow-${rowIndex}-${arrowIndex}`}
                  className="code-markdown-box-diagram-arrow"
                  d={buildArrowPath(arrow)}
                />
              ))
            })}
          </g>

          <g className="code-markdown-box-diagram-text-layer">
            {normalizedLines.map((line, rowIndex) => {
              const cells = buildDisplayCells(line)
              const runs = buildTextRuns(cells)
              const y = rowIndex * BOX_DIAGRAM_BASE_ROW_HEIGHT + BOX_DIAGRAM_BASE_ROW_HEIGHT * BOX_DIAGRAM_TEXT_BASELINE_RATIO
              return runs.map((run, runIndex) => (
                <text
                  key={`text-${rowIndex}-${runIndex}`}
                  className="code-markdown-box-diagram-text"
                  {...svgTextProps(run.startColumn * BOX_DIAGRAM_BASE_CELL_WIDTH, y)}
                >
                  {run.text}
                </text>
              ))
            })}
          </g>
        </svg>
      </div>
    </div>
  )
}

export const BOX_DIAGRAM_FONT_FAMILY = BOX_DIAGRAM_FONT_STACK
