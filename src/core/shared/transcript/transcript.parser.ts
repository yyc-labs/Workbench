import type {
  TranscriptImportPayload,
  TranscriptReference,
  TranscriptSession,
} from '../types'

type BuildTranscriptSessionOptions = {
  sessionId: string
  projectPath: string
  createdAt: number
  updatedAt?: number
  isProjectFilePath: (relativePath: string) => boolean
  title: string
}

const ANSI_ESCAPE_PATTERN = /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g
const ABSOLUTE_POSIX_REFERENCE_PATTERN =
  /(?<![\w./-])(\/[^\s`"'()[\]{}:]+(?:\/[^\s`"'()[\]{}:]+)*)\:(\d+)(?:\:(\d+))?/g
const RELATIVE_REFERENCE_PATTERN =
  /(?<![\w/.-])((?:\.\/)?(?:[\w-]+\/)*[\w.-]+\.[A-Za-z0-9_-]+)\:(\d+)(?:\:(\d+))?/g
const ABSOLUTE_POSIX_PATH_REFERENCE_PATTERN =
  /(?<![\w./:-])(\/[^\s`"'()[\]{}:]+(?:\/[^\s`"'()[\]{}:]+)*)(?!:\d)(?![\w./-])/g
const RELATIVE_PATH_REFERENCE_PATTERN =
  /(?<![\w/.-])((?:\.\/)?(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9_-]+)(?!:\d)(?![\w/.-])/g
const ABSOLUTE_POSIX_REFERENCE_EXACT_PATTERN = new RegExp(`^${ABSOLUTE_POSIX_REFERENCE_PATTERN.source}$`)
const RELATIVE_REFERENCE_EXACT_PATTERN = new RegExp(`^${RELATIVE_REFERENCE_PATTERN.source}$`)
const ABSOLUTE_POSIX_PATH_LINE_EXACT_PATTERN = /^\/[^\s`"'()[\]{}:]+(?:\/[^\s`"'()[\]{}:]+)*$/
const RELATIVE_PATH_LINE_EXACT_PATTERN = /^(?:\.\/)?(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9_-]+$/
const WRAPPED_REFERENCE_LINE_SUFFIX_PATTERN =
  /:(?:[ \t]*\n[ \t]*)?(\d+)(?:(?:[ \t]*\n[ \t]*)?\:(?:[ \t]*\n[ \t]*)?(\d+))?/g
const RELATIVE_PATH_PREFIX_TOKEN_PATTERN = /(?:\.\/)?(?:[\w.-]+\/)+/g
const MARKDOWN_FENCE_LINE_PATTERN = /^[ \t]{0,3}([`~]{3,})/
const STRUCTURED_DATA_BRACKET_LINE_PATTERN = /^[\[\]{}]+,?$/
const STRUCTURED_DATA_QUOTED_KEY_VALUE_PATTERN = /^["'][^"'\n]+["']\s*:\s*.+$/
const STRUCTURED_DATA_ASSIGNMENT_PATTERN = /^(?:const|let|var\s+)?[A-Za-z_][\w-]*\s*=\s*[{\[]\s*,?$/
const IMPLICIT_PYTHON_CODE_KEYWORD_PATTERN =
  /^(?:async\s+def\b.+|def\b.+|class\b.+|if\s+.+:|elif\s+.+:|else:|for\s+.+:|while\s+.+:|try:|except\b.*:|finally:|with\s+.+:|match\s+.+:|case\s+.+:)$/
const IMPLICIT_JAVASCRIPT_CODE_KEYWORD_PATTERN =
  /^(?:const\s+.+|let\s+.+|var\s+.+|function\s+.+|async\s+function\s+.+|export\s+.+|import\s+.+\s+from\s+.+|if\s*\(.+|else\b.*|for\s*\(.+|while\s*\(.+|switch\s*\(.+|case\s+.+:)$/
const IMPLICIT_CODE_ASSIGNMENT_PATTERN =
  /^(?:[A-Za-z_][\w.\[\]"']*|self\.[A-Za-z_][\w]*)\s*=\s*.+$/
const IMPLICIT_CODE_CALL_PATTERN = /^(?:(?:await|return)\s+)?(?:[A-Za-z_][\w]*|self\.[A-Za-z_][\w.]*|[A-Za-z_][\w.]*)\s*\(/
const IMPLICIT_CODE_CLOSING_LINE_PATTERN = /^[)\]}],?$/
const IMPLICIT_CODE_ELLIPSIS_LINE_PATTERN = /^(?:\.{3}|pass|break|continue)$/
const IMPLICIT_CODE_TRAILING_DELIMITER_PATTERN = /[([{,]$/

function isReferenceTokenChar(value: string): boolean {
  return /[\w./-]/.test(value)
}

function normalizeLineEndings(input: string): string {
  return input.replace(/\r\n?/g, '\n')
}

function stripAnsi(input: string): string {
  return input.replace(ANSI_ESCAPE_PATTERN, '')
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/{2,}/g, '/').trim()
}

function normalizeAbsolutePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/{2,}/g, '/').trim()
  if (!normalized.startsWith('/')) return normalized
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]')
}

function isMarkdownFenceBoundary(
  line: string,
  activeFence: { marker: string; length: number } | null
): { marker: string; length: number } | null {
  const match = MARKDOWN_FENCE_LINE_PATTERN.exec(line)
  if (!match) return null
  const marker = match[1]?.[0]
  const length = match[1]?.length ?? 0
  if (!marker || length < 3) return null
  if (!activeFence) {
    return { marker, length }
  }
  if (marker === activeFence.marker && length >= activeFence.length) {
    return { marker, length }
  }
  return null
}

function isStructuredDataLine(trimmedLine: string): boolean {
  if (!trimmedLine) return false
  return STRUCTURED_DATA_BRACKET_LINE_PATTERN.test(trimmedLine)
    || STRUCTURED_DATA_QUOTED_KEY_VALUE_PATTERN.test(trimmedLine)
    || STRUCTURED_DATA_ASSIGNMENT_PATTERN.test(trimmedLine)
}

function countLeadingIndent(line: string): number {
  let count = 0
  while (count < line.length) {
    const char = line[count]
    if (char !== ' ' && char !== '\t') break
    count += 1
  }
  return count
}

function updateQuoteState(
  line: string,
  state: { inDoubleQuote: boolean; inSingleQuote: boolean }
): { inDoubleQuote: boolean; inSingleQuote: boolean } {
  let escaped = false
  let inDoubleQuote = state.inDoubleQuote
  let inSingleQuote = state.inSingleQuote

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (escaped) {
      escaped = false
      continue
    }

    if (char === '\\') {
      escaped = true
      continue
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }

    if (char === '\'' && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
    }
  }

  return { inDoubleQuote, inSingleQuote }
}

function isStrongImplicitCodeLine(trimmedLine: string): boolean {
  if (!trimmedLine) return false
  return IMPLICIT_PYTHON_CODE_KEYWORD_PATTERN.test(trimmedLine)
    || IMPLICIT_JAVASCRIPT_CODE_KEYWORD_PATTERN.test(trimmedLine)
    || IMPLICIT_CODE_ASSIGNMENT_PATTERN.test(trimmedLine)
    || IMPLICIT_CODE_CALL_PATTERN.test(trimmedLine)
}

function isImplicitIndentedContinuation(previousLine: string | null, line: string): boolean {
  const trimmedLine = line.trim()
  if (!trimmedLine || countLeadingIndent(line) <= 0) return false
  if (/^(?:[-*+]\s+|\d+\.\s+)/.test(trimmedLine)) return false

  const previousTrimmed = previousLine?.trim() ?? ''
  if (!previousTrimmed) return false
  return previousTrimmed.endsWith(':')
    || /[([{,\\]$/.test(previousTrimmed)
}

function isImplicitCodeBodyLine(line: string, previousLine: string | null = null): boolean {
  const trimmedLine = line.trim()
  if (!trimmedLine) return false
  if (isStrongImplicitCodeLine(trimmedLine)) return true
  if (IMPLICIT_CODE_CLOSING_LINE_PATTERN.test(trimmedLine)) return true
  if (IMPLICIT_CODE_ELLIPSIS_LINE_PATTERN.test(trimmedLine)) return true
  if (IMPLICIT_CODE_TRAILING_DELIMITER_PATTERN.test(trimmedLine)) return true
  return isImplicitIndentedContinuation(previousLine, line)
}

function inferStructuredDataLanguage(lines: string[]): string {
  const blockText = lines.join('\n')
  if (/\b(?:True|False|None)\b/.test(blockText) || /'[^'\n]*'/.test(blockText)) {
    return 'python'
  }
  return 'json'
}

function mergeBrokenStructuredStringLines(lines: string[]): string[] {
  if (lines.length <= 1) return lines

  const merged: string[] = []
  let index = 0
  let quoteState = { inDoubleQuote: false, inSingleQuote: false }

  while (index < lines.length) {
    let currentLine = lines[index] ?? ''
    let currentState = updateQuoteState(currentLine, quoteState)

    while (
      index + 1 < lines.length
      && (currentState.inDoubleQuote || currentState.inSingleQuote)
    ) {
      const nextLine = lines[index + 1] ?? ''
      const nextTrimmed = nextLine.trim()
      if (!nextTrimmed) break

      const joiner = currentLine.endsWith('-') ? '' : ' '
      const nextContent = nextLine.slice(countLeadingIndent(nextLine))
      currentLine = currentLine + joiner + nextContent
      currentState = updateQuoteState(nextContent, currentState)
      index += 1
    }

    merged.push(currentLine)
    quoteState = currentState
    index += 1
  }

  return merged
}

function collectStructuredDataBlock(
  lines: string[],
  startIndex: number
): { endIndex: number; language: string } | null {
  if (!isStructuredDataLine(lines[startIndex]?.trim() ?? '')) return null

  let endIndex = startIndex
  let keyValueLineCount = 0
  let bracketTokenCount = 0
  let quoteState = { inDoubleQuote: false, inSingleQuote: false }

  while (endIndex < lines.length) {
    const line = lines[endIndex] ?? ''
    const trimmedLine = line.trim()
    const isContinuationLine = (
      (quoteState.inDoubleQuote || quoteState.inSingleQuote)
      && countLeadingIndent(line) > 0
      && trimmedLine.length > 0
    )

    if (!trimmedLine || (!isStructuredDataLine(trimmedLine) && !isContinuationLine)) break
    if (STRUCTURED_DATA_QUOTED_KEY_VALUE_PATTERN.test(trimmedLine)) {
      keyValueLineCount += 1
    }
    if (/[{}\[\]]/.test(trimmedLine)) {
      bracketTokenCount += 1
    }
    quoteState = updateQuoteState(line, quoteState)
    endIndex += 1
  }

  const blockLines = lines.slice(startIndex, endIndex)
  if (blockLines.length < 2 || keyValueLineCount < 1 || bracketTokenCount < 2) {
    return null
  }

  return {
    endIndex: endIndex - 1,
    language: inferStructuredDataLanguage(blockLines),
  }
}

function inferImplicitCodeLanguage(lines: string[]): string {
  const blockText = lines.join('\n')
  if (
    /\b(?:elif|await|async\s+def|self\.|None|True|False)\b/.test(blockText)
    || lines.some((line, index) => {
      const trimmed = line.trim()
      if (!trimmed.endsWith(':')) return false
      const nextLine = lines[index + 1]
      return typeof nextLine === 'string' && countLeadingIndent(nextLine) > countLeadingIndent(line)
    })
  ) {
    return 'python'
  }

  if (
    /\b(?:const|let|var|function|=>|===|!==|import\s.+from|export)\b/.test(blockText)
    || /;\s*$/.test(blockText)
  ) {
    return 'typescript'
  }

  return ''
}

function collectImplicitCodeBlock(
  lines: string[],
  startIndex: number
): { endIndex: number; language: string } | null {
  if (!isStrongImplicitCodeLine(lines[startIndex]?.trim() ?? '')) return null

  let endIndex = startIndex
  let codeLineCount = 0
  let strongLineCount = 0
  let indentedLineCount = 0
  let previousCodeLine: string | null = null

  while (endIndex < lines.length) {
    const line = lines[endIndex] ?? ''
    const trimmedLine = line.trim()

    if (!trimmedLine) {
      const nextLine = lines[endIndex + 1]
      if (!nextLine || !isImplicitCodeBodyLine(nextLine, previousCodeLine)) break
      endIndex += 1
      continue
    }

    if (!isImplicitCodeBodyLine(line, previousCodeLine)) break

    codeLineCount += 1
    if (isStrongImplicitCodeLine(trimmedLine)) {
      strongLineCount += 1
    }
    if (countLeadingIndent(line) > 0) {
      indentedLineCount += 1
    }
    previousCodeLine = line
    endIndex += 1
  }

  while (endIndex > startIndex && !(lines[endIndex - 1] ?? '').trim()) {
    endIndex -= 1
  }

  const blockLines = lines.slice(startIndex, endIndex)
  if (codeLineCount < 2) return null
  if (strongLineCount < 2 && (strongLineCount < 1 || indentedLineCount < 1)) {
    return null
  }

  return {
    endIndex: endIndex - 1,
    language: inferImplicitCodeLanguage(blockLines),
  }
}

function normalizeImplicitMarkdownBlocks(markdownText: string): string {
  if (!markdownText) return ''

  const lines = markdownText.split('\n')
  const result: string[] = []
  let index = 0
  let activeFence: { marker: string; length: number } | null = null

  while (index < lines.length) {
    const line = lines[index] ?? ''
    const fenceBoundary = isMarkdownFenceBoundary(line, activeFence)

    if (activeFence) {
      result.push(line)
      if (fenceBoundary) {
        activeFence = null
      }
      index += 1
      continue
    }

    if (fenceBoundary) {
      activeFence = fenceBoundary
      result.push(line)
      index += 1
      continue
    }

    const structuredBlock = collectStructuredDataBlock(lines, index)
    if (structuredBlock) {
      const structuredLines = mergeBrokenStructuredStringLines(
        lines.slice(index, structuredBlock.endIndex + 1)
      )
      if (result.length > 0 && result[result.length - 1]?.trim()) {
        result.push('')
      }
      result.push(`\`\`\`${structuredBlock.language}`)
      result.push(...structuredLines)
      result.push('```')
      index = structuredBlock.endIndex + 1
      if (index < lines.length && lines[index]?.trim()) {
        result.push('')
      }
      continue
    }

    const implicitCodeBlock = collectImplicitCodeBlock(lines, index)
    if (implicitCodeBlock) {
      if (result.length > 0 && result[result.length - 1]?.trim()) {
        result.push('')
      }
      result.push(implicitCodeBlock.language ? `\`\`\`${implicitCodeBlock.language}` : '```')
      result.push(...lines.slice(index, implicitCodeBlock.endIndex + 1))
      result.push('```')
      index = implicitCodeBlock.endIndex + 1
      if (index < lines.length && lines[index]?.trim()) {
        result.push('')
      }
      continue
    }

    result.push(line)
    index += 1
  }

  return result.join('\n')
}

function resolveProjectRelativePath(projectPath: string, rawPath: string): string | null {
  const normalizedProjectPath = normalizeAbsolutePath(projectPath)
  if (!rawPath) return null

  if (rawPath.startsWith('/')) {
    const resolved = normalizeAbsolutePath(rawPath)
    if (resolved === normalizedProjectPath) return null
    const prefix = `${normalizedProjectPath}/`
    if (!resolved.startsWith(prefix)) return null
    return normalizeRelativePath(resolved.slice(prefix.length))
  }

  const normalizedRelative = normalizeRelativePath(rawPath)
  if (!normalizedRelative || normalizedRelative.startsWith('..') || normalizedRelative.includes('/../')) return null
  return normalizedRelative
}

function buildLineStarts(text: string): number[] {
  const lineStarts = [0]
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      lineStarts.push(i + 1)
    }
  }
  return lineStarts
}

function findLineNumber(lineStarts: number[], offset: number): number {
  let low = 0
  let high = lineStarts.length - 1
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const current = lineStarts[mid]
    const next = mid + 1 < lineStarts.length ? lineStarts[mid + 1] : Number.POSITIVE_INFINITY
    if (offset >= current && offset < next) {
      return mid + 1
    }
    if (offset < current) {
      high = mid - 1
    } else {
      low = mid + 1
    }
  }
  return lineStarts.length
}

function getLineTextByIndex(text: string, lineStarts: number[], lineIndex: number): string {
  const lineStartOffset = lineStarts[lineIndex] ?? 0
  const lineEndOffset = lineIndex + 1 < lineStarts.length ? lineStarts[lineIndex + 1] - 1 : text.length
  return text.slice(lineStartOffset, lineEndOffset)
}

function countTrailingSpaces(value: string): number {
  let count = 0
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (value[index] !== ' ') break
    count += 1
  }
  return count
}

function inferContextualRelativePathPrefix(
  text: string,
  lineStarts: number[],
  candidate: {
    rawPath: string
    startOffset: number
  }
): string | null {
  if (!candidate.rawPath || candidate.rawPath.startsWith('/')) return null
  if (candidate.rawPath.startsWith('./')) return null

  const startLineIndex = Math.max(0, findLineNumber(lineStarts, candidate.startOffset) - 1)

  for (let lineIndex = startLineIndex - 1; lineIndex >= 0 && lineIndex >= startLineIndex - 4; lineIndex -= 1) {
    const previousLine = getLineTextByIndex(text, lineStarts, lineIndex)
    const trimmed = previousLine.trim()
    if (!trimmed) continue

    const candidateLine = getLineTextByIndex(text, lineStarts, Math.max(lineIndex + 1, startLineIndex))
    const candidateLineOffset = lineStarts[Math.max(lineIndex + 1, startLineIndex)] ?? 0
    const candidateColumn = Math.max(0, candidate.startOffset - candidateLineOffset)
    const leadingIndent = countLeadingIndent(candidateLine)
    const spacesBeforeCandidate = countTrailingSpaces(candidateLine.slice(0, candidateColumn))
    const isContinuationLike = leadingIndent >= 8 || spacesBeforeCandidate >= 8
    if (!isContinuationLike) continue

    const matches = [...trimmed.matchAll(RELATIVE_PATH_PREFIX_TOKEN_PATTERN)]
    const lastMatch = matches[matches.length - 1]
    const prefix = lastMatch?.[0]
    if (prefix) return prefix
  }

  return null
}

function applyContextualRelativePathPrefix(
  text: string,
  lineStarts: number[],
  candidate: {
    rawPath: string
    startOffset: number
  }
): string {
  const inferredPrefix = inferContextualRelativePathPrefix(text, lineStarts, candidate)
  if (!inferredPrefix || candidate.rawPath.startsWith(inferredPrefix)) {
    return candidate.rawPath
  }
  return `${inferredPrefix}${candidate.rawPath}`.replace(/\/{2,}/g, '/')
}

function createReferenceId(sessionId: string, index: number): string {
  return `${sessionId}-ref-${index + 1}`
}

function normalizeWrappedReferenceCandidate(rawText: string): string {
  return rawText.replace(/\n[ \t]*/g, '')
}

function trimLeadingWhitespace(value: string): { trimmed: string; offsetDelta: number } {
  const match = /^\s+/.exec(value)
  const offsetDelta = match?.[0]?.length ?? 0
  return {
    trimmed: value.slice(offsetDelta),
    offsetDelta,
  }
}

function countNonEmptyWrappedReferenceLines(rawText: string): number {
  return rawText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .length
}

function findWrappedReferenceStart(text: string, suffixStartOffset: number): number | null {
  let index = suffixStartOffset - 1
  let sawNewline = false
  let sawPathChar = false

  while (index >= 0) {
    const current = text[index]
    if (isReferenceTokenChar(current)) {
      sawPathChar = true
      index -= 1
      continue
    }

    if (current === '\n') {
      sawNewline = true
      index -= 1
      continue
    }

    if (current === ' ' || current === '\t') {
      let whitespaceStart = index
      while (whitespaceStart >= 0 && (text[whitespaceStart] === ' ' || text[whitespaceStart] === '\t')) {
        whitespaceStart -= 1
      }
      if (whitespaceStart >= 0 && text[whitespaceStart] === '\n') {
        sawNewline = true
        index = whitespaceStart - 1
        continue
      }
    }

    break
  }

  if (!sawNewline || !sawPathChar) return null
  return index + 1
}

function parseNormalizedReferenceCandidate(
  candidate: string
): {
  rawPath: string
  lineNumber: number
  column?: number
} | null {
  const exactMatch = ABSOLUTE_POSIX_REFERENCE_EXACT_PATTERN.exec(candidate)
    ?? RELATIVE_REFERENCE_EXACT_PATTERN.exec(candidate)
  if (!exactMatch) return null

  const rawPath = exactMatch[1] || ''
  const lineValue = Number(exactMatch[2])
  const columnValue = exactMatch[3] ? Number(exactMatch[3]) : undefined
  if (!rawPath || !Number.isFinite(lineValue)) return null

  return {
    rawPath,
    lineNumber: Math.max(1, Math.floor(lineValue)),
    column: Number.isFinite(columnValue) ? Math.max(1, Math.floor(columnValue as number)) : undefined,
  }
}

function parseStandalonePathLineCandidate(
  candidate: string
): {
  rawPath: string
  lineNumber: number
} | null {
  if (!candidate) return null
  if (
    !ABSOLUTE_POSIX_PATH_LINE_EXACT_PATTERN.test(candidate)
    && !RELATIVE_PATH_LINE_EXACT_PATTERN.test(candidate)
  ) {
    return null
  }

  return {
    rawPath: candidate,
    lineNumber: 1,
  }
}

function createMarkdownText(
  cleanedText: string,
  references: TranscriptReference[]
): string {
  if (references.length === 0) return normalizeImplicitMarkdownBlocks(cleanedText)

  const sorted = [...references].sort((a, b) => {
    if (a.messageRange.startOffset !== b.messageRange.startOffset) {
      return a.messageRange.startOffset - b.messageRange.startOffset
    }
    return a.messageRange.endOffset - b.messageRange.endOffset
  })

  let cursor = 0
  let result = ''

  for (const reference of sorted) {
    const { startOffset, endOffset } = reference.messageRange
    if (startOffset < cursor) continue
    result += cleanedText.slice(cursor, startOffset)
    result += `[${escapeMarkdownLabel(reference.label)}](${reference.href})`
    cursor = endOffset
  }

  result += cleanedText.slice(cursor)
  return normalizeImplicitMarkdownBlocks(result)
}

function collectReferences(
  sessionId: string,
  cleanedText: string,
  projectPath: string,
  isProjectFilePath: (relativePath: string) => boolean
): TranscriptReference[] {
  const lineStarts = buildLineStarts(cleanedText)
  const candidates: Array<{
    rawText: string
    rawPath: string
    label: string
    lineNumber?: number
    column?: number
    startOffset: number
    endOffset: number
  }> = []

  const collectFromPattern = (pattern: RegExp, pathGroup: number) => {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(cleanedText)) !== null) {
      const rawText = match[0]
      const rawPath = match[pathGroup] || ''
      const lineValue = Number(match[pathGroup + 1])
      const columnValue = match[pathGroup + 2] ? Number(match[pathGroup + 2]) : undefined
      if (!rawPath || !Number.isFinite(lineValue)) continue
      candidates.push({
        rawText,
        rawPath,
        label: rawText,
        lineNumber: Math.max(1, Math.floor(lineValue)),
        column: Number.isFinite(columnValue) ? Math.max(1, Math.floor(columnValue as number)) : undefined,
        startOffset: match.index,
        endOffset: match.index + rawText.length,
      })
    }
  }

  collectFromPattern(ABSOLUTE_POSIX_REFERENCE_PATTERN, 1)
  collectFromPattern(RELATIVE_REFERENCE_PATTERN, 1)

  const collectPathOnlyFromPattern = (pattern: RegExp, pathGroup: number) => {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(cleanedText)) !== null) {
      const rawText = match[0]
      const rawPath = match[pathGroup] || ''
      if (!rawPath) continue
      candidates.push({
        rawText,
        rawPath,
        label: rawText,
        lineNumber: 1,
        startOffset: match.index,
        endOffset: match.index + rawText.length,
      })
    }
  }

  collectPathOnlyFromPattern(ABSOLUTE_POSIX_PATH_REFERENCE_PATTERN, 1)
  collectPathOnlyFromPattern(RELATIVE_PATH_REFERENCE_PATTERN, 1)

  WRAPPED_REFERENCE_LINE_SUFFIX_PATTERN.lastIndex = 0
  let wrappedSuffixMatch: RegExpExecArray | null
  while ((wrappedSuffixMatch = WRAPPED_REFERENCE_LINE_SUFFIX_PATTERN.exec(cleanedText)) !== null) {
    const suffixStartOffset = wrappedSuffixMatch.index
    const suffixEndOffset = suffixStartOffset + wrappedSuffixMatch[0].length
    const candidateStartOffset = findWrappedReferenceStart(cleanedText, suffixStartOffset)
    if (candidateStartOffset == null) continue

    const rawText = cleanedText.slice(candidateStartOffset, suffixEndOffset)
    const trimmedWrapped = trimLeadingWhitespace(rawText)
    if (!trimmedWrapped.trimmed.includes('\n')) continue
    if (countNonEmptyWrappedReferenceLines(trimmedWrapped.trimmed) < 2) continue

    const normalizedCandidate = normalizeWrappedReferenceCandidate(trimmedWrapped.trimmed)
    const parsedCandidate = parseNormalizedReferenceCandidate(normalizedCandidate)
    if (!parsedCandidate) continue
    const contextualRawPath = applyContextualRelativePathPrefix(cleanedText, lineStarts, {
      rawPath: parsedCandidate.rawPath,
      startOffset: candidateStartOffset + trimmedWrapped.offsetDelta,
    })

    candidates.push({
      rawText: trimmedWrapped.trimmed,
      rawPath: contextualRawPath,
      label: normalizedCandidate,
      lineNumber: parsedCandidate.lineNumber,
      column: parsedCandidate.column,
      startOffset: candidateStartOffset + trimmedWrapped.offsetDelta,
      endOffset: suffixEndOffset,
    })
  }

  for (let index = 0; index < lineStarts.length; index += 1) {
    const lineStartOffset = lineStarts[index]
    const lineEndOffset = index + 1 < lineStarts.length ? lineStarts[index + 1] - 1 : cleanedText.length
    const rawLine = cleanedText.slice(lineStartOffset, lineEndOffset)
    const trimmedLine = rawLine.trim()
    const parsedCandidate = parseStandalonePathLineCandidate(trimmedLine)
    if (!parsedCandidate) continue

    const leadingWhitespaceLength = rawLine.length - rawLine.trimStart().length
    const trailingWhitespaceLength = rawLine.length - rawLine.trimEnd().length
    const startOffset = lineStartOffset + leadingWhitespaceLength
    const endOffset = lineEndOffset - trailingWhitespaceLength

    candidates.push({
      rawText: trimmedLine,
      rawPath: parsedCandidate.rawPath,
      label: trimmedLine,
      lineNumber: parsedCandidate.lineNumber,
      startOffset,
      endOffset,
    })
  }

  const deduped: TranscriptReference[] = []
  const occupiedRanges: Array<{ start: number; end: number }> = []

  for (const candidate of candidates.sort((a, b) => {
    if (a.startOffset !== b.startOffset) {
      return a.startOffset - b.startOffset
    }
    return b.endOffset - a.endOffset
  })) {
    if (occupiedRanges.some((range) => candidate.startOffset < range.end && candidate.endOffset > range.start)) {
      continue
    }
    const resolvedRawPath = applyContextualRelativePathPrefix(cleanedText, lineStarts, candidate)

    let relativePath = resolveProjectRelativePath(projectPath, resolvedRawPath)
    if (!relativePath || !isProjectFilePath(relativePath)) {
      relativePath = resolveProjectRelativePath(projectPath, candidate.rawPath)
    }
    if (!relativePath) continue
    if (!isProjectFilePath(relativePath)) continue

    const startLine = findLineNumber(lineStarts, candidate.startOffset)
    const endLine = findLineNumber(lineStarts, Math.max(candidate.startOffset, candidate.endOffset - 1))
    const id = createReferenceId(sessionId, deduped.length)
    deduped.push({
      id,
      sessionId,
      relativePath,
      lineNumber: candidate.lineNumber,
      column: candidate.column,
      label: candidate.label,
      rawText: candidate.rawText,
      href: `transcript-ref://${id}`,
      messageRange: {
        startOffset: candidate.startOffset,
        endOffset: candidate.endOffset,
        startLine,
        endLine,
      },
    })
    occupiedRanges.push({ start: candidate.startOffset, end: candidate.endOffset })
  }

  return deduped
}

export function buildTranscriptSession(
  payload: TranscriptImportPayload,
  options: BuildTranscriptSessionOptions
): TranscriptSession {
  const rawText = payload.rawText ?? ''
  const normalizedRawText = normalizeLineEndings(rawText)
  const cleanedText = stripAnsi(normalizedRawText)
  const references = collectReferences(
    options.sessionId,
    cleanedText,
    options.projectPath,
    options.isProjectFilePath
  )
  const markdownText = createMarkdownText(cleanedText, references)

  return {
    id: options.sessionId,
    projectId: payload.projectId,
    sourceType: payload.sourceType,
    title: options.title,
    rawText: normalizedRawText,
    markdownText,
    references,
    createdAt: options.createdAt,
    updatedAt: options.updatedAt ?? options.createdAt,
  }
}
