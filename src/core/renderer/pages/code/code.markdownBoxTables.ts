import type { MarkdownNode, MarkdownParentNode, MarkdownParagraphNode } from './code.markdownBoxTables.types'
import { isParentNode, isParagraphNode, parseInlineMarkdownChildren } from './code.markdownBoxTables.ast'
import { parseBoxTable } from './code.markdownBoxTables.parsers'

const MARKDOWN_FENCE_START_LINE_PATTERN = /^[ \t]{0,3}(?:`{3,}|~{3,})/

function createTableNode(
  parsed: NonNullable<ReturnType<typeof parseBoxTable>>,
  position: MarkdownNode['position'],
): MarkdownNode {
  return {
    type: 'table',
    align: Array.from({ length: parsed.columnCount }, () => null),
    position,
    children: parsed.rows.map((row) => {
      const rowLineStart = row.startLine
      const rowLineEnd = Math.max(row.startLine, row.endLine)
      return {
        type: 'tableRow',
        position: {
          start: { line: rowLineStart, column: 1 },
          end: { line: rowLineEnd, column: Math.max(1, row.cells.join(' | ').length + 1) },
        },
        children: row.cells.map((cell) => ({
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

function transformParagraphToTable(
  node: MarkdownParagraphNode,
  source: string,
): MarkdownNode | null {
  const startOffset = node.position?.start.offset
  const endOffset = node.position?.end.offset
  const startLine = node.position?.start.line

  if (
    typeof startOffset !== 'number' ||
    typeof endOffset !== 'number' ||
    typeof startLine !== 'number' ||
    endOffset <= startOffset
  ) {
    return null
  }

  const parsed = parseBoxTable(source.slice(startOffset, endOffset), startLine)
  return parsed ? createTableNode(parsed, node.position) : null
}

function transformCodeBlockToTable(
  node: MarkdownNode,
  source: string,
): MarkdownNode | null {
  if (node.type !== 'code' || typeof node.value !== 'string' || !node.value) return null

  const sourceStartLine = node.position?.start.line
  if (typeof sourceStartLine !== 'number') return null

  let startLine = sourceStartLine
  const startOffset = node.position?.start.offset
  const endOffset = node.position?.end.offset
  if (typeof startOffset === 'number' && typeof endOffset === 'number' && endOffset > startOffset) {
    const firstLine = source.slice(startOffset, endOffset).split('\n', 1)[0] ?? ''
    if (MARKDOWN_FENCE_START_LINE_PATTERN.test(firstLine.trimEnd())) startLine += 1
  }

  const parsed = parseBoxTable(node.value, startLine)
  return parsed ? createTableNode(parsed, node.position) : null
}

function transformTree(node: MarkdownParentNode, source: string): void {
  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index]
    if (!child) continue

    if (isParagraphNode(child)) {
      const table = transformParagraphToTable(child, source)
      if (table) {
        node.children[index] = table
        continue
      }
    }

    const codeTable = transformCodeBlockToTable(child, source)
    if (codeTable) {
      node.children[index] = codeTable
      continue
    }

    if (isParentNode(child)) transformTree(child, source)
  }
}

export function remarkBoxDrawingTables() {
  return (tree: MarkdownNode, file: { value?: unknown }) => {
    if (!isParentNode(tree)) return
    const source = typeof file.value === 'string' ? file.value : ''
    if (source) transformTree(tree, source)
  }
}
