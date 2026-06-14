import { unified } from 'unified'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import type { MarkdownNode, MarkdownParentNode, MarkdownParagraphNode, MarkdownPosition } from './code.markdownBoxTables.types'

export function isParentNode(node: MarkdownNode): node is MarkdownParentNode {
  return Array.isArray(node.children)
}

export function isParagraphNode(node: MarkdownNode): node is MarkdownParagraphNode {
  return node.type === 'paragraph' && Array.isArray(node.children)
}

export function parseInlineMarkdownChildren(value: string): MarkdownNode[] {
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

export function createApproximateLinePosition(
  lineNumber: number,
  text: string
): MarkdownPosition {
  const safeLineNumber = Math.max(1, Math.floor(lineNumber))
  return {
    start: { line: safeLineNumber, column: 1 },
    end: { line: safeLineNumber, column: Math.max(1, text.length + 1) },
  }
}

export function createApproximateRangePosition(
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

export function createCustomMarkdownNode(
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

export function createInlineMarkdownSpan(
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
