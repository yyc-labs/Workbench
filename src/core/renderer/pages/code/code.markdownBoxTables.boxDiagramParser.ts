import type { ParsedBoxDiagram } from './code.markdownBoxTables.types'
import {
  BOX_DIAGRAM_BORDER_CHAR_PATTERN,
  BOX_DIAGRAM_CONNECTOR_CHAR_PATTERN,
  BOX_DIAGRAM_MIN_BORDER_LINES,
  BOX_DIAGRAM_TEXTUAL_CONNECTOR_PATTERN,
} from './code.markdownBoxTables.constants'
import { splitLinesWithNumbers } from './code.markdownBoxTables.display'

function isBoxDiagramLineCandidate(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  return (
    BOX_DIAGRAM_BORDER_CHAR_PATTERN.test(trimmed) ||
    BOX_DIAGRAM_CONNECTOR_CHAR_PATTERN.test(trimmed) ||
    BOX_DIAGRAM_TEXTUAL_CONNECTOR_PATTERN.test(trimmed)
  )
}

export function parseBoxDiagram(source: string, startLine: number): ParsedBoxDiagram | null {
  const lines = splitLinesWithNumbers(source, startLine)
  if (lines.length < BOX_DIAGRAM_MIN_BORDER_LINES) return null

  let borderLikeLineCount = 0
  let hasConnector = false
  let maxWidth = 0

  for (const line of lines) {
    const text = line.text.replace(/\s+$/, '')
    if (!text.trim()) return null
    if (!isBoxDiagramLineCandidate(text) && !/[A-Za-z0-9\u4e00-\u9fff]/.test(text)) {
      return null
    }

    if (BOX_DIAGRAM_BORDER_CHAR_PATTERN.test(text)) {
      borderLikeLineCount += 1
    }
    if (BOX_DIAGRAM_CONNECTOR_CHAR_PATTERN.test(text) || BOX_DIAGRAM_TEXTUAL_CONNECTOR_PATTERN.test(text)) {
      hasConnector = true
    }
    if (line.displayWidth > maxWidth) {
      maxWidth = line.displayWidth
    }
  }

  if (borderLikeLineCount < BOX_DIAGRAM_MIN_BORDER_LINES) return null
  if (!hasConnector) return null
  if (maxWidth < 24) return null

  return {
    lines: lines.map((line) => ({
      text: line.text.replace(/\s+$/, ''),
      lineNumber: line.lineNumber,
    })),
  }
}
