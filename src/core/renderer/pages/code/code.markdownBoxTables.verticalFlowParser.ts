import type { LineInfo, ParsedInlineArrowSegment, ParsedVerticalFlow, ParsedVerticalFlowConnector, ParsedVerticalFlowConnectorDirection, ParsedVerticalFlowStep, ParsedVerticalFlowStepDetail } from './code.markdownBoxTables.types'
import {
  BOTTOM_LEFT_BORDER_CHARS,
  BOTTOM_RIGHT_BORDER_CHARS,
  BOX_FLOW_BORDER_COLUMN_TOLERANCE,
  BOX_TITLE_EDGE_PATTERN,
  CONNECTOR_SCAFFOLD_LINE_PATTERN,
  TOP_LEFT_BORDER_CHARS,
  TOP_RIGHT_BORDER_CHARS,
  TRANSCRIPT_BRANCH_PREFIX_PATTERN,
  TRANSCRIPT_INLINE_ARROW_MATCH_PATTERN,
  TRANSCRIPT_INLINE_ARROW_PATTERN,
  TRANSCRIPT_INLINE_ARROW_SPLIT_PATTERN,
  TRANSCRIPT_INLINE_BRANCH_DETAIL_PATTERN,
  TRANSCRIPT_INLINE_BRANCH_SCAFFOLD_LINE_PATTERN,
  TRANSCRIPT_LEADING_CONTINUATION_ARROW_PATTERN,
  TRANSCRIPT_TRAILING_CONTINUATION_ARROW_PATTERN,
  VERTICAL_BORDER_CHARS,
  VERTICAL_FLOW_COMMENT_PATTERNS,
  VERTICAL_FLOW_CONNECTOR_PATTERN,
  VERTICAL_FLOW_DOWN_ARROW_PATTERN,
  VERTICAL_FLOW_UP_ARROW_PATTERN,
} from './code.markdownBoxTables.constants'
import { buildDisplayCells, findDisplayColumnForStringIndex, findFirstNonWhitespaceCell, findLastNonWhitespaceCell, findNearestVerticalBorderCell, findRightmostVerticalBorderCell, isTopBorderLine, sliceLineByDisplayColumns, splitLinesWithNumbers } from './code.markdownBoxTables.display'

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

function isTranscriptBranchDetailText(value: string): boolean {
  return TRANSCRIPT_BRANCH_PREFIX_PATTERN.test(value.trim())
}

function normalizeTranscriptBranchDetailText(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const normalized = trimmed.replace(TRANSCRIPT_BRANCH_PREFIX_PATTERN, '').trim()
  return normalized || trimmed
}

function normalizeTranscriptStepTitle(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const normalized = trimmed.replace(TRANSCRIPT_TRAILING_CONTINUATION_ARROW_PATTERN, '').trim()
  return normalized || trimmed
}

function splitTranscriptInlineArrowSegments(value: string): string[] {
  const trimmed = value.trim()
  if (!trimmed) return []
  return trimmed
    .split(TRANSCRIPT_INLINE_ARROW_SPLIT_PATTERN)
    .map((segment) => normalizeTranscriptStepTitle(segment))
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function normalizeTranscriptLeadingArrowStep(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const normalized = trimmed.replace(TRANSCRIPT_LEADING_CONTINUATION_ARROW_PATTERN, '').trim()
  return normalized || trimmed
}

function parseTranscriptInlineArrowLineSegments(line: LineInfo): ParsedInlineArrowSegment[] | null {
  const matches = [...line.text.matchAll(TRANSCRIPT_INLINE_ARROW_MATCH_PATTERN)]
  if (matches.length <= 0) return null

  const segments: ParsedInlineArrowSegment[] = []
  let cursor = 0

  for (let index = 0; index <= matches.length; index += 1) {
    const boundary = index < matches.length ? (matches[index]?.index ?? -1) : line.text.length
    if (boundary < cursor) return null

    const rawSegment = line.text.slice(cursor, boundary)
    const trimmed = rawSegment.trim()
    if (!trimmed) return null

    const leadingWhitespaceLength = rawSegment.length - rawSegment.trimStart().length
    const trailingWhitespaceLength = rawSegment.length - rawSegment.trimEnd().length
    const startIndex = cursor + leadingWhitespaceLength
    const endIndex = boundary - trailingWhitespaceLength
    const { title, note } = splitVerticalFlowStepText(normalizeTranscriptStepTitle(trimmed))
    if (!title) return null

    segments.push({
      rawText: trimmed,
      title,
      note,
      lineNumber: line.lineNumber,
      startColumn: findDisplayColumnForStringIndex(line, startIndex),
      endColumn: findDisplayColumnForStringIndex(line, endIndex),
    })

    if (index < matches.length) {
      const match = matches[index]
      const matchIndex = match?.index
      const matchLength = match?.[0]?.length ?? 0
      if (typeof matchIndex !== 'number' || matchLength <= 0) return null
      cursor = matchIndex + matchLength
    }
  }

  return segments.length >= 2 ? segments : null
}

function isTranscriptInlineBranchScaffoldLine(line: LineInfo): boolean {
  return TRANSCRIPT_INLINE_BRANCH_SCAFFOLD_LINE_PATTERN.test(line.text)
}

function parseTranscriptInlineBranchDetailLine(line: LineInfo): { rawText: string; text: string; lineNumber: number; anchorColumn: number } | null {
  const match = line.text.match(TRANSCRIPT_INLINE_BRANCH_DETAIL_PATTERN)
  const content = match?.groups?.content?.trim() ?? ''
  if (!content) return null

  const branchIndex = line.text.search(/[├└╰╭╮╯]/)
  const anchorColumn = branchIndex >= 0 ? findDisplayColumnForStringIndex(line, branchIndex) : (findFirstNonWhitespaceCell(line)?.startColumn ?? 0)

  return {
    rawText: line.text.trim(),
    text: content,
    lineNumber: line.lineNumber,
    anchorColumn,
  }
}

function findTranscriptInlineBranchAnchorStepIndex(steps: ParsedInlineArrowSegment[], anchorColumn: number): number {
  for (let index = 0; index < steps.length - 1; index += 1) {
    const current = steps[index]
    const next = steps[index + 1]
    if (!current || !next) continue
    if (anchorColumn >= current.endColumn - 1 && anchorColumn <= next.startColumn + 1) {
      return index
    }
  }

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]
    if (!step) continue
    if (anchorColumn >= step.startColumn - 1 && anchorColumn <= step.endColumn + 1) {
      return index
    }
  }

  let bestIndex = 0
  let bestDistance = Number.POSITIVE_INFINITY

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]
    if (!step) continue
    const center = (step.startColumn + step.endColumn) / 2
    const distance = Math.abs(center - anchorColumn)
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  }

  return bestIndex
}

function parseVerticalFlowConnector(line: LineInfo): ParsedVerticalFlowConnector | null {
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

function isTranscriptTreeRootLine(line: LineInfo): boolean {
  const trimmed = line.text.trim()
  if (!trimmed) return false
  if (TRANSCRIPT_BRANCH_PREFIX_PATTERN.test(trimmed)) return false
  if (isTranscriptConnectorLikeLine(line)) return false
  if (isTopBorderLine(line.text)) return false
  return true
}

function parseTranscriptTreeBranchLine(line: LineInfo): { text: string; lineNumber: number; branchColumn: number } | null {
  const raw = line.text.replace(/\s+$/, '')
  if (!raw.trim()) return null

  let index = 0

  while (index < raw.length) {
    const current = raw[index]
    if (current === ' ' || current === '\t') {
      index += 1
      continue
    }

    if (current === '│' || current === '║' || current === '┃' || current === '|') {
      index += 1
      while (index < raw.length && (raw[index] === ' ' || raw[index] === '\t')) {
        index += 1
      }
      continue
    }

    break
  }

  const branchMarker = raw[index]
  if (!branchMarker || !/[├└╰╭╮╯]/.test(branchMarker)) return null
  const branchColumn = findDisplayColumnForStringIndex(line, index)
  index += 1

  while (index < raw.length && /[\s─═━-]/.test(raw[index] ?? '')) {
    index += 1
  }

  const text = raw.slice(index).trim()
  if (!text) return null

  return {
    text,
    lineNumber: line.lineNumber,
    branchColumn,
  }
}

function countLeadingWhitespace(value: string): number {
  let count = 0
  while (count < value.length) {
    const current = value[count]
    if (current !== ' ' && current !== '\t') break
    count += 1
  }
  return count
}

function normalizeTranscriptTreeLines(lines: LineInfo[]): LineInfo[] {
  if (lines.length <= 1) return lines

  const positiveLeadingWhitespace = lines
    .slice(1)
    .map((line) => countLeadingWhitespace(line.text))
    .filter((count) => count > 0)

  if (positiveLeadingWhitespace.length <= 0) return lines

  const commonIndent = Math.min(...positiveLeadingWhitespace)
  if (commonIndent <= 0) return lines

  return lines.map((line, index) => {
    if (index === 0) return line
    const trimmedText = line.text.slice(Math.min(commonIndent, countLeadingWhitespace(line.text)))
    const displayCells = buildDisplayCells(trimmedText)
    return {
      ...line,
      text: trimmedText,
      displayCells,
      displayWidth: displayCells[displayCells.length - 1]?.endColumn ?? 0,
    }
  })
}

export function parseTranscriptTreeFlow(source: string, startLine: number): ParsedVerticalFlow | null {
  const lines = normalizeTranscriptTreeLines(splitLinesWithNumbers(source, startLine))
  if (lines.length < 2) return null

  const leadEntries: Array<{ line: LineInfo; trimmed: string }> = []
  let bodyStartIndex = -1

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line) return null
    const trimmed = line.text.trim()
    if (!trimmed) {
      if (bodyStartIndex >= 0) return null
      continue
    }

    const branch = parseTranscriptTreeBranchLine(line)
    if (branch) {
      bodyStartIndex = index
      break
    }

    if (!isTranscriptTreeRootLine(line)) return null
    if (bodyStartIndex >= 0) return null
    leadEntries.push({ line, trimmed })
  }

  if (bodyStartIndex < 0) return null

  const bodyEntries = lines.slice(bodyStartIndex).map((line) => ({
    line,
    trimmed: line.text.trim(),
    branch: parseTranscriptTreeBranchLine(line),
  }))
  if (bodyEntries.some((entry) => !entry.trimmed)) return null

  const firstBranch = bodyEntries[0]?.branch
  if (!firstBranch) return null

  const baseColumn = firstBranch.branchColumn
  const positiveBranchOffsets = bodyEntries
    .map((entry) => entry.branch?.branchColumn ?? baseColumn)
    .map((column) => column - baseColumn)
    .filter((offset) => offset > 0)
  const indentUnit = positiveBranchOffsets.length > 0 ? Math.min(...positiveBranchOffsets) : 2
  const branches: Array<{ title: string; lineNumber: number; details: ParsedVerticalFlowStepDetail[] }> = []
  const connectors: ParsedVerticalFlowConnector[] = []

  for (const entry of bodyEntries) {
    const { line, trimmed, branch } = entry
    if (isTopBorderLine(line.text)) return null

    if (!branch) {
      if (isTranscriptConnectorLikeLine(line)) return null
      const activeBranch = branches[branches.length - 1]
      if (!activeBranch) return null
      activeBranch.details.push({
        rawText: trimmed,
        text: trimmed,
        lineNumber: line.lineNumber,
      })
      continue
    }

    const offset = Math.max(0, branch.branchColumn - baseColumn)
    const level = offset <= 0 ? 0 : Math.max(1, Math.round(offset / Math.max(1, indentUnit)))

    if (level === 0) {
      branches.push({
        title: branch.text,
        lineNumber: branch.lineNumber,
        details: [],
      })
      continue
    }

    const activeBranch = branches[branches.length - 1]
    if (!activeBranch) return null
    activeBranch.details.push({
      rawText: trimmed,
      text: branch.text,
      lineNumber: branch.lineNumber,
    })
  }

  if (branches.length < 2) return null

  const steps: ParsedVerticalFlowStep[] = []

  if (leadEntries.length > 0) {
    const root = leadEntries[0]
    const rootDetails = leadEntries.slice(1).map((entry) => ({
      rawText: entry.trimmed,
      text: entry.trimmed,
      lineNumber: entry.line.lineNumber,
    }))

    steps.push({
      rawText: [root?.trimmed ?? '', ...rootDetails.map((detail) => detail.rawText)].filter(Boolean).join('\n'),
      title: root?.trimmed ?? '',
      lineNumber: root?.line.lineNumber ?? startLine,
      endLineNumber: rootDetails[rootDetails.length - 1]?.lineNumber ?? root?.line.lineNumber ?? startLine,
      details: rootDetails.length > 0 ? rootDetails : undefined,
    })
  }

  steps.push(
    ...branches.map((branch) => ({
      rawText: [branch.title, ...branch.details.map((detail) => detail.rawText)].join('\n'),
      title: branch.title,
      lineNumber: branch.lineNumber,
      endLineNumber: branch.details[branch.details.length - 1]?.lineNumber ?? branch.lineNumber,
      details: branch.details.length > 0 ? branch.details : undefined,
    })),
  )

  for (let index = 0; index < steps.length - 1; index += 1) {
    const sourceStep = steps[index]
    connectors.push({
      rawText: '↓',
      label: '',
      direction: 'down',
      lineNumber: sourceStep?.endLineNumber ?? sourceStep?.lineNumber ?? firstBranch.lineNumber,
    })
  }

  return {
    steps,
    connectors,
  }
}

export function parseVerticalFlow(source: string, startLine: number): ParsedVerticalFlow | null {
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

function parseTranscriptPlainStep(lines: LineInfo[], startIndex: number): { step: ParsedVerticalFlowStep; nextLineIndex: number; sawBranchDetail: boolean } | null {
  const titleLine = lines[startIndex]
  if (!titleLine) return null

  const rawTitle = titleLine.text.trim()
  const { title, note } = splitVerticalFlowStepText(normalizeTranscriptStepTitle(rawTitle))
  if (!title || isTranscriptConnectorLikeLine(titleLine)) {
    return null
  }

  const details: ParsedVerticalFlowStepDetail[] = []
  let endLineNumber = titleLine.lineNumber
  let nextLineIndex = startIndex + 1
  let sawBranchDetail = false

  while (nextLineIndex < lines.length) {
    const current = lines[nextLineIndex]
    if (!current) break
    const trimmed = current.text.trim()
    if (!trimmed || isTranscriptConnectorLikeLine(current) || isTopBorderLine(current.text)) {
      break
    }

    details.push({
      rawText: trimmed,
      text: normalizeTranscriptBranchDetailText(trimmed),
      lineNumber: current.lineNumber,
    })
    if (isTranscriptBranchDetailText(trimmed)) {
      sawBranchDetail = true
    }
    endLineNumber = current.lineNumber
    nextLineIndex += 1
  }

  return {
    step: {
      rawText: [rawTitle, ...details.map((detail) => detail.rawText)].join('\n'),
      title,
      note,
      lineNumber: titleLine.lineNumber,
      endLineNumber,
      details: details.length > 0 ? details : undefined,
    },
    nextLineIndex,
    sawBranchDetail,
  }
}

function parseTranscriptTitledBoxStep(lines: LineInfo[], startIndex: number): { step: ParsedVerticalFlowStep; nextLineIndex: number; sawBranchDetail: boolean } | null {
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
    if (first && last && BOTTOM_LEFT_BORDER_CHARS.has(first.value) && BOTTOM_RIGHT_BORDER_CHARS.has(last.value) && Math.abs(first.startColumn - topLeft.startColumn) <= BOX_FLOW_BORDER_COLUMN_TOLERANCE && Math.abs(last.startColumn - topRight.startColumn) <= BOX_FLOW_BORDER_COLUMN_TOLERANCE) {
      bottomLineIndex = lineIndex
      break
    }

    const leftBorderCell = findNearestVerticalBorderCell(current, topLeft.startColumn)
    const rightBorderCell = findNearestVerticalBorderCell(current, expectedRightColumn, 4) ?? findRightmostVerticalBorderCell(current)
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
    const rightBorderCell = findNearestVerticalBorderCell(current, expectedRightColumn, 4) ?? findRightmostVerticalBorderCell(current)
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
    sawBranchDetail: false,
  }
}

function parseTranscriptConnectorGroup(lines: LineInfo[], startIndex: number): { connector: ParsedVerticalFlowConnector; nextLineIndex: number } | null {
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

export function parseTranscriptStructuredFlow(source: string, startLine: number): ParsedVerticalFlow | null {
  const lines = splitLinesWithNumbers(source, startLine)
  if (lines.length < 5) return null

  const steps: ParsedVerticalFlowStep[] = []
  const connectors: ParsedVerticalFlowConnector[] = []
  let lineIndex = 0
  let sawBoxStep = false
  let sawDetailStep = false
  let sawBranchDetail = false
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
    } else {
      if (parsedStep.step.details?.length) {
        sawDetailStep = true
      }
      if (parsedStep.sawBranchDetail) {
        sawBranchDetail = true
      }
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
  if (!sawBoxStep && !sawConnectorLabel && !sawBranchDetail && !sawDetailStep) return null

  return {
    steps,
    connectors,
  }
}

export function parseTranscriptInlineArrowFlow(source: string, startLine: number): ParsedVerticalFlow | null {
  // Inline Markdown commonly annotates prose (for example, `string → ""` or **Upload mode**).
  // Preserve those descriptions as Markdown instead of turning them into a flow diagram.
  if (/(?:`|\*\*|__)/.test(source)) return null

  const lines = splitLinesWithNumbers(source, startLine)
  if (lines.length <= 0) return null

  const steps: ParsedVerticalFlowStep[] = []
  let sawArrow = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line) return null

    const trimmed = line.text.trim()
    if (!trimmed) return null
    if (isTranscriptConnectorLikeLine(line) || isTopBorderLine(line.text)) return null

    const hasArrow = TRANSCRIPT_INLINE_ARROW_PATTERN.test(trimmed)
    const endsWithArrow = TRANSCRIPT_TRAILING_CONTINUATION_ARROW_PATTERN.test(trimmed)
    const isLastLine = index === lines.length - 1

    if (lines.length === 1) {
      if (!hasArrow || endsWithArrow) return null
    } else if (!isLastLine) {
      if (!hasArrow || !endsWithArrow) return null
    } else if (!hasArrow) {
      if (!TRANSCRIPT_TRAILING_CONTINUATION_ARROW_PATTERN.test(lines[index - 1]?.text.trim() ?? '')) {
        return null
      }
    } else if (endsWithArrow) {
      return null
    }

    const segments = hasArrow ? splitTranscriptInlineArrowSegments(trimmed) : [trimmed]
    if (segments.length <= 0) return null
    if (hasArrow) {
      sawArrow = true
    }

    for (const segment of segments) {
      const { title, note } = splitVerticalFlowStepText(segment)
      if (!title) return null
      steps.push({
        rawText: segment,
        title,
        note,
        lineNumber: line.lineNumber,
        endLineNumber: line.lineNumber,
      })
    }
  }

  if (!sawArrow || steps.length < 3) return null

  return {
    steps,
    connectors: steps.slice(0, -1).map((step) => ({
      rawText: '→',
      label: '',
      direction: 'down',
      lineNumber: step.lineNumber,
    })),
  }
}

export function parseTranscriptInlineArrowBranchFlow(source: string, startLine: number): ParsedVerticalFlow | null {
  const lines = splitLinesWithNumbers(source, startLine)
  if (lines.length < 2) return null

  const mainLine = lines[0]
  if (!mainLine) return null

  const mainTrimmed = mainLine.text.trim()
  if (!mainTrimmed) return null
  if (isTranscriptConnectorLikeLine(mainLine) || isTopBorderLine(mainLine.text)) return null

  const mainSteps = parseTranscriptInlineArrowLineSegments(mainLine)
  if (!mainSteps) return null

  const detailsByStep = new Map<number, ParsedVerticalFlowStepDetail[]>()
  const endLineNumberByStep = new Map<number, number>()
  let sawBranch = false
  let pendingAnchorColumn: number | null = null

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line) return null

    const trimmed = line.text.trim()
    if (!trimmed) return null

    if (isTranscriptInlineBranchScaffoldLine(line)) {
      pendingAnchorColumn = findFirstNonWhitespaceCell(line)?.startColumn ?? pendingAnchorColumn
      continue
    }

    const parsedBranch = parseTranscriptInlineBranchDetailLine(line)
    if (!parsedBranch) return null

    const anchorStepIndex = findTranscriptInlineBranchAnchorStepIndex(mainSteps, pendingAnchorColumn ?? parsedBranch.anchorColumn)
    const details = detailsByStep.get(anchorStepIndex) ?? []
    details.push({
      rawText: parsedBranch.rawText,
      text: parsedBranch.text,
      lineNumber: parsedBranch.lineNumber,
    })
    detailsByStep.set(anchorStepIndex, details)
    endLineNumberByStep.set(anchorStepIndex, parsedBranch.lineNumber)
    pendingAnchorColumn = null
    sawBranch = true
  }

  if (!sawBranch || pendingAnchorColumn !== null) return null

  const steps: ParsedVerticalFlowStep[] = mainSteps.map((step, index) => ({
    rawText: step.rawText,
    title: step.title,
    note: step.note,
    lineNumber: step.lineNumber,
    endLineNumber: endLineNumberByStep.get(index) ?? step.lineNumber,
    details: detailsByStep.get(index),
  }))

  return {
    steps,
    connectors: steps.slice(0, -1).map((step) => ({
      rawText: '→',
      label: '',
      direction: 'down',
      lineNumber: step.lineNumber,
    })),
  }
}

export function parseTranscriptLeadingArrowFlow(source: string, startLine: number): ParsedVerticalFlow | null {
  const lines = splitLinesWithNumbers(source, startLine)
  if (lines.length < 2) return null

  const firstLine = lines[0]
  if (!firstLine) return null
  const firstTrimmed = firstLine.text.trim()
  if (!firstTrimmed) return null
  if (isTranscriptConnectorLikeLine(firstLine) || isTopBorderLine(firstLine.text)) return null
  if (TRANSCRIPT_LEADING_CONTINUATION_ARROW_PATTERN.test(firstTrimmed)) return null

  const steps: ParsedVerticalFlowStep[] = []
  const { title: firstTitle, note: firstNote } = splitVerticalFlowStepText(normalizeTranscriptStepTitle(firstTrimmed))
  if (!firstTitle) return null
  steps.push({
    rawText: firstTrimmed,
    title: firstTitle,
    note: firstNote,
    lineNumber: firstLine.lineNumber,
    endLineNumber: firstLine.lineNumber,
  })

  let sawLeadingArrow = false

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line) return null

    const trimmed = line.text.trim()
    if (!trimmed) return null
    if (!TRANSCRIPT_LEADING_CONTINUATION_ARROW_PATTERN.test(trimmed)) {
      return null
    }

    const normalizedStep = normalizeTranscriptLeadingArrowStep(trimmed)
    const { title, note } = splitVerticalFlowStepText(normalizedStep)
    if (!title) return null

    steps.push({
      rawText: normalizedStep,
      title,
      note,
      lineNumber: line.lineNumber,
      endLineNumber: line.lineNumber,
    })
    sawLeadingArrow = true
  }

  if (!sawLeadingArrow || steps.length < 2) return null

  return {
    steps,
    connectors: steps.slice(0, -1).map((step) => ({
      rawText: '→',
      label: '',
      direction: 'down',
      lineNumber: step.lineNumber,
    })),
  }
}
