import { unified } from 'unified'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import type { MarkdownNode, MarkdownParentNode, MarkdownParagraphNode } from './code.markdownBoxTables.types'

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
