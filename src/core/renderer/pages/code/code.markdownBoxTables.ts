import type { MarkdownNode, MarkdownParentNode, MarkdownParagraphNode } from './code.markdownBoxTables.types'
import { createApproximateLinePosition, createApproximateRangePosition, createCustomMarkdownNode, createInlineMarkdownSpan, isParentNode, isParagraphNode, parseInlineMarkdownChildren } from './code.markdownBoxTables.ast'
import { parseArchitectureDiagram, parseBoxDiagram, parseBoxFlow, parseBoxTable, parseTranscriptInlineArrowBranchFlow, parseTranscriptInlineArrowFlow, parseTranscriptLeadingArrowFlow, parseTranscriptStructuredFlow, parseTranscriptTreeFlow, parseVerticalFlow } from './code.markdownBoxTables.parsers'

const MARKDOWN_FENCE_START_LINE_PATTERN = /^[ \t]{0,3}(?:`{3,}|~{3,})/

function isPlainTextTreeStructure(source: string): boolean {
  const lines = source.split(/\r?\n/)
  const branchLineCount = lines.filter((line) => /[├└]──/.test(line)).length
  return branchLineCount >= 2 && lines.some((line) => line.includes('│'))
}

function transformParagraphToTable(node: MarkdownParagraphNode, source: string): MarkdownNode | null {
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

function transformCodeBlockToTable(node: MarkdownNode, source: string): MarkdownNode | null {
  if (node.type !== 'code') return null
  if (typeof node.value !== 'string' || !node.value) return null

  const startOffset = node.position?.start.offset
  const endOffset = node.position?.end.offset
  const sourceStartLine = node.position?.start.line

  if (typeof sourceStartLine !== 'number') return null

  let startLine = sourceStartLine
  if (typeof startOffset === 'number' && typeof endOffset === 'number' && endOffset > startOffset) {
    const rawBlock = source.slice(startOffset, endOffset)
    const firstLine = rawBlock.split('\n', 1)[0] ?? ''
    if (MARKDOWN_FENCE_START_LINE_PATTERN.test(firstLine.trimEnd())) {
      startLine += 1
    }
  }

  const parsed = parseBoxTable(node.value, startLine)
  if (!parsed) return null

  return {
    type: 'table',
    align: Array.from({ length: parsed.columnCount }, () => null),
    position: node.position,
    children: parsed.rows.map((cells) => {
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

function transformParagraphToBoxFlow(node: MarkdownParagraphNode, source: string): MarkdownNode | null {
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
    const titleNode = box.title ? createCustomMarkdownNode('boxFlowTitle', 'div', 'code-markdown-box-flow-node-title', parseInlineMarkdownChildren(box.title), createApproximateLinePosition(box.titleLineNumber ?? box.rows[0]?.lineNumber ?? startLine, box.title)) : null

    const lineNodes = box.rows.map((row) => {
      const lineChildren = [createInlineMarkdownSpan('boxFlowLineText', 'code-markdown-box-flow-line-text', row.text, row.lineNumber)]

      if (row.note) {
        lineChildren.push(createInlineMarkdownSpan('boxFlowLineNote', 'code-markdown-box-flow-line-note', row.note, row.lineNumber))
      }

      return createCustomMarkdownNode('boxFlowLine', 'div', 'code-markdown-box-flow-line', lineChildren, createApproximateLinePosition(row.lineNumber, row.text + (row.note ? ` ${row.note}` : '')))
    })

    const cardNode = createCustomMarkdownNode('boxFlowCard', 'div', 'code-markdown-box-flow-node-card', lineNodes, createApproximateRangePosition(box.rows[0]?.lineNumber ?? startLine, box.rows[box.rows.length - 1]?.lineNumber ?? startLine, Math.max(1, box.endColumn - box.startColumn + 1)))

    trackChildren.push(
      createCustomMarkdownNode(
        'boxFlowNode',
        'div',
        'code-markdown-box-flow-node',
        titleNode ? [titleNode, cardNode] : [cardNode],
        createApproximateRangePosition(box.titleLineNumber ?? box.rows[0]?.lineNumber ?? startLine, box.rows[box.rows.length - 1]?.lineNumber ?? startLine, Math.max(1, box.endColumn - box.startColumn + 1)),
      ),
    )

    const connector = parsedFlow.connectors[index]
    if (!connector) return

    const arrowGlyph = connector.direction === 'left' ? '←' : connector.direction === 'none' ? '•' : '→'
    const connectorLabel = connector.label || ''
    const connectorChildren: MarkdownNode[] = [createInlineMarkdownSpan('boxFlowConnectorArrow', 'code-markdown-box-flow-connector-arrow', arrowGlyph, connector.lineNumber, { 'aria-hidden': 'true' })]

    if (connectorLabel) {
      connectorChildren.push(createInlineMarkdownSpan('boxFlowConnectorLabel', 'code-markdown-box-flow-connector-label', connectorLabel, connector.lineNumber))
    }

    trackChildren.push(
      createCustomMarkdownNode(
        'boxFlowConnector',
        'div',
        `code-markdown-box-flow-connector ${connector.direction === 'left' ? 'is-left' : connector.direction === 'none' ? 'is-none' : 'is-right'}`,
        connectorChildren,
        createApproximateLinePosition(connector.lineNumber, connector.rawText || connectorLabel || arrowGlyph),
        connector.rawText ? { title: connector.rawText } : undefined,
      ),
    )
  })

  const trackNode = createCustomMarkdownNode('boxFlowTrack', 'div', 'code-markdown-box-flow-track', trackChildren, node.position)

  return createCustomMarkdownNode('boxFlow', 'div', 'code-markdown-box-flow', [trackNode], node.position, {
    'data-box-flow': JSON.stringify({
      boxes: parsedFlow.boxes.map((box) => ({
        title: box.title,
        rows: box.rows.map((row) => ({
          text: row.text,
          note: row.note ?? '',
        })),
      })),
      connectors: parsedFlow.connectors.map((connector) => ({
        label: connector.label,
        direction: connector.direction,
      })),
    }),
  })
}

function transformParagraphToVerticalFlow(node: MarkdownParagraphNode, source: string): MarkdownNode | null {
  const startOffset = node.position?.start.offset
  const endOffset = node.position?.end.offset
  const startLine = node.position?.start.line

  if (typeof startOffset !== 'number' || typeof endOffset !== 'number' || typeof startLine !== 'number') {
    return null
  }
  if (endOffset <= startOffset) return null

  const rawParagraph = source.slice(startOffset, endOffset)
  if (isPlainTextTreeStructure(rawParagraph)) return null

  const parsedFlow =
    parseVerticalFlow(rawParagraph, startLine) ??
    parseTranscriptTreeFlow(rawParagraph, startLine) ??
    parseTranscriptStructuredFlow(rawParagraph, startLine) ??
    parseTranscriptInlineArrowBranchFlow(rawParagraph, startLine) ??
    parseTranscriptInlineArrowFlow(rawParagraph, startLine) ??
    parseTranscriptLeadingArrowFlow(rawParagraph, startLine)
  if (!parsedFlow) return null

  const stackChildren: MarkdownNode[] = []

  parsedFlow.steps.forEach((step, index) => {
    const stepChildren: MarkdownNode[] = [createCustomMarkdownNode('verticalFlowStepTitle', 'div', 'code-markdown-vertical-flow-step-title', parseInlineMarkdownChildren(step.title), createApproximateLinePosition(step.lineNumber, step.title))]

    if (step.note) {
      stepChildren.push(createInlineMarkdownSpan('verticalFlowStepNote', 'code-markdown-vertical-flow-step-note', step.note, step.lineNumber))
    }

    if (step.details?.length) {
      stepChildren.push(
        createCustomMarkdownNode(
          'verticalFlowStepDetails',
          'div',
          'code-markdown-vertical-flow-step-details',
          step.details.map((detail) => createCustomMarkdownNode('verticalFlowStepDetail', 'div', 'code-markdown-vertical-flow-step-detail', parseInlineMarkdownChildren(detail.text), createApproximateLinePosition(detail.lineNumber, detail.rawText))),
          createApproximateRangePosition(step.details[0]?.lineNumber ?? step.lineNumber, step.details[step.details.length - 1]?.lineNumber ?? step.lineNumber, Math.max(...step.details.map((detail) => Math.max(1, detail.rawText.length)))),
        ),
      )
    }

    stackChildren.push(
      createCustomMarkdownNode('verticalFlowStep', 'div', 'code-markdown-vertical-flow-step', stepChildren, createApproximateRangePosition(step.lineNumber, step.endLineNumber ?? step.lineNumber, Math.max(1, step.title.length, step.note?.length ?? 0, ...(step.details?.map((detail) => detail.rawText.length) ?? [])))),
    )

    const connector = parsedFlow.connectors[index]
    if (!connector) return

    const arrowGlyph = connector.direction === 'up' ? '↑' : connector.direction === 'none' ? '•' : '↓'
    const connectorChildren: MarkdownNode[] = [createInlineMarkdownSpan('verticalFlowConnectorArrow', 'code-markdown-vertical-flow-connector-arrow', arrowGlyph, connector.lineNumber, { 'aria-hidden': 'true' })]

    if (connector.label) {
      connectorChildren.push(createInlineMarkdownSpan('verticalFlowConnectorLabel', 'code-markdown-vertical-flow-connector-label', connector.label, connector.lineNumber))
    }

    stackChildren.push(
      createCustomMarkdownNode(
        'verticalFlowConnector',
        'div',
        `code-markdown-vertical-flow-connector ${connector.direction === 'up' ? 'is-up' : connector.direction === 'none' ? 'is-none' : 'is-down'}`,
        connectorChildren,
        createApproximateLinePosition(connector.lineNumber, connector.rawText || connector.label || arrowGlyph),
        connector.rawText ? { title: connector.rawText } : undefined,
      ),
    )
  })

  const stackNode = createCustomMarkdownNode('verticalFlowStack', 'div', 'code-markdown-vertical-flow-stack', stackChildren, node.position)

  return createCustomMarkdownNode('verticalFlow', 'div', 'code-markdown-vertical-flow', [stackNode], node.position, {
    'data-vertical-flow': JSON.stringify({
      steps: parsedFlow.steps.map((step) => ({
        title: step.title,
        note: step.note ?? '',
        details: (step.details ?? []).map((detail) => ({
          text: detail.text,
        })),
      })),
      connectors: parsedFlow.connectors.map((connector) => ({
        label: connector.label,
        direction: connector.direction,
      })),
    }),
  })
}

function transformParagraphToBoxDiagram(node: MarkdownParagraphNode, source: string): MarkdownNode | null {
  const startOffset = node.position?.start.offset
  const endOffset = node.position?.end.offset
  const startLine = node.position?.start.line

  if (typeof startOffset !== 'number' || typeof endOffset !== 'number' || typeof startLine !== 'number') {
    return null
  }
  if (endOffset <= startOffset) return null

  const rawParagraph = source.slice(startOffset, endOffset)
  const parsedDiagram = parseBoxDiagram(rawParagraph, startLine)
  if (!parsedDiagram) return null

  return createCustomMarkdownNode('boxDiagram', 'div', 'code-markdown-box-diagram', [], node.position, {
    'data-diagram-lines': JSON.stringify(parsedDiagram.lines.map((line) => line.text)),
  })
}

function transformParagraphToArchitectureDiagram(node: MarkdownParagraphNode, source: string): MarkdownNode | null {
  const startOffset = node.position?.start.offset
  const endOffset = node.position?.end.offset
  const startLine = node.position?.start.line

  if (typeof startOffset !== 'number' || typeof endOffset !== 'number' || typeof startLine !== 'number') {
    return null
  }
  if (endOffset <= startOffset) return null

  const rawParagraph = source.slice(startOffset, endOffset)
  const parsedDiagram = parseArchitectureDiagram(rawParagraph, startLine)
  if (!parsedDiagram) return null

  return createCustomMarkdownNode('architectureDiagram', 'div', 'code-markdown-architecture-diagram', [], node.position, {
    'data-architecture-diagram': JSON.stringify(parsedDiagram),
  })
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

      const architectureDiagramReplacement = transformParagraphToArchitectureDiagram(child, source)
      if (architectureDiagramReplacement) {
        node.children[index] = architectureDiagramReplacement
        continue
      }

      const diagramReplacement = transformParagraphToBoxDiagram(child, source)
      if (diagramReplacement) {
        node.children[index] = diagramReplacement
        continue
      }
    }

    const codeTableReplacement = transformCodeBlockToTable(child, source)
    if (codeTableReplacement) {
      node.children[index] = codeTableReplacement
      continue
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
