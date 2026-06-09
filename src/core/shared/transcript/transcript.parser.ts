import type {
  TranscriptImportPayload,
  TranscriptReference,
  TranscriptSession,
} from '../types'

type BuildTranscriptSessionOptions = {
  sessionId: string
  projectPath: string
  createdAt: number
  isProjectFilePath: (relativePath: string) => boolean
  title: string
}

const ANSI_ESCAPE_PATTERN = /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g
const ABSOLUTE_POSIX_REFERENCE_PATTERN =
  /(?<![\w./-])(\/[^\s`"'()[\]{}:]+(?:\/[^\s`"'()[\]{}:]+)*)\:(\d+)(?:\:(\d+))?/g
const RELATIVE_REFERENCE_PATTERN =
  /(?<![\w/.-])((?:\.\/)?(?:[\w-]+\/)*[\w.-]+\.[A-Za-z0-9_-]+)\:(\d+)(?:\:(\d+))?/g
const ABSOLUTE_POSIX_REFERENCE_EXACT_PATTERN = new RegExp(`^${ABSOLUTE_POSIX_REFERENCE_PATTERN.source}$`)
const RELATIVE_REFERENCE_EXACT_PATTERN = new RegExp(`^${RELATIVE_REFERENCE_PATTERN.source}$`)
const WRAPPED_REFERENCE_LINE_SUFFIX_PATTERN =
  /:(?:[ \t]*\n[ \t]*)?(\d+)(?:(?:[ \t]*\n[ \t]*)?\:(?:[ \t]*\n[ \t]*)?(\d+))?/g

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

function createReferenceId(sessionId: string, index: number): string {
  return `${sessionId}-ref-${index + 1}`
}

function normalizeWrappedReferenceCandidate(rawText: string): string {
  return rawText.replace(/\n[ \t]*/g, '')
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

function createMarkdownText(
  cleanedText: string,
  references: TranscriptReference[]
): string {
  if (references.length === 0) return cleanedText

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
  return result
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

  WRAPPED_REFERENCE_LINE_SUFFIX_PATTERN.lastIndex = 0
  let wrappedSuffixMatch: RegExpExecArray | null
  while ((wrappedSuffixMatch = WRAPPED_REFERENCE_LINE_SUFFIX_PATTERN.exec(cleanedText)) !== null) {
    const suffixStartOffset = wrappedSuffixMatch.index
    const suffixEndOffset = suffixStartOffset + wrappedSuffixMatch[0].length
    const candidateStartOffset = findWrappedReferenceStart(cleanedText, suffixStartOffset)
    if (candidateStartOffset == null) continue

    const rawText = cleanedText.slice(candidateStartOffset, suffixEndOffset)
    if (!rawText.includes('\n')) continue

    const normalizedCandidate = normalizeWrappedReferenceCandidate(rawText)
    const parsedCandidate = parseNormalizedReferenceCandidate(normalizedCandidate)
    if (!parsedCandidate) continue

    candidates.push({
      rawText,
      rawPath: parsedCandidate.rawPath,
      label: normalizedCandidate,
      lineNumber: parsedCandidate.lineNumber,
      column: parsedCandidate.column,
      startOffset: candidateStartOffset,
      endOffset: suffixEndOffset,
    })
  }

  const deduped: TranscriptReference[] = []
  const occupiedRanges: Array<{ start: number; end: number }> = []

  for (const candidate of candidates.sort((a, b) => a.startOffset - b.startOffset)) {
    if (occupiedRanges.some((range) => candidate.startOffset < range.end && candidate.endOffset > range.start)) {
      continue
    }
    const relativePath = resolveProjectRelativePath(projectPath, candidate.rawPath)
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
    updatedAt: options.createdAt,
  }
}
