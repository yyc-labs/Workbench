import type { IncomingHttpHeaders } from 'http'
import type {
  StructuredHttpRequestSnapshot,
  StructuredHttpResponseSnapshot,
  StructuredJsonSnapshot,
} from '../../../shared/types'

type HeaderRecordInput =
  | IncomingHttpHeaders
  | Headers
  | Record<string, string | string[] | undefined>

type BuildJsonSnapshotOptions = {
  contentType?: string
  rawText?: string
  parsedValue?: unknown
  maxBytes?: number
  truncated?: boolean
  parseError?: string
}

type BuildRequestSnapshotOptions = {
  method: string
  path: string
  url?: string
  query?: URLSearchParams | Record<string, string | string[]>
  headers: HeaderRecordInput
  bodyText?: string
  bodyValue?: unknown
  contentType?: string
  maxBodyBytes?: number
  bodyTruncated?: boolean
  bodyParseError?: string
}

type BuildResponseSnapshotOptions = {
  statusCode: number
  headers?: HeaderRecordInput
  bodyText?: string
  bodyValue?: unknown
  contentType?: string
  maxBodyBytes?: number
  bodyTruncated?: boolean
  bodyParseError?: string
}

const DEFAULT_MAX_SNAPSHOT_BYTES = 256 * 1024
const MASKED_VALUE = '[masked]'
const SENSITIVE_NAME_RE = /(^|[-_])(authorization|token|secret|api[-_]?key)$/i
const SENSITIVE_TEXT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/(Bearer\s+)([^\s",]+)/gi, `$1${MASKED_VALUE}`],
  [/("?(?:authorization|token|secret|api[_-]?key|x-api-key|x-agent-hook-token|x-ide-electron-token|x-ide-electron-transcript-token)"?\s*:\s*")([^"]+)(")/gi, `$1${MASKED_VALUE}$3`],
]

function isSensitiveName(name: string): boolean {
  return SENSITIVE_NAME_RE.test(name)
}

function maskSensitiveString(value: string): string {
  return value ? MASKED_VALUE : value
}

function maskTextValue(value: string): string {
  return SENSITIVE_TEXT_REPLACEMENTS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    value,
  )
}

function maskValueByName(name: string, value: string | string[]): string | string[] {
  if (!isSensitiveName(name)) return value
  if (Array.isArray(value)) return value.map((item) => maskSensitiveString(item))
  return maskSensitiveString(value)
}

function toHeaderRecord(headers: HeaderRecordInput): Record<string, string | string[]> {
  if (headers instanceof Headers) {
    const result: Record<string, string | string[]> = {}
    headers.forEach((value, key) => {
      result[key] = value
    })
    return result
  }

  const result: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'undefined') continue
    result[key] = value
  }
  return result
}

export function maskHeaders(headers: HeaderRecordInput): Record<string, string | string[]> {
  return Object.fromEntries(
    Object.entries(toHeaderRecord(headers)).map(([key, value]) => [key, maskValueByName(key, value)]),
  )
}

function truncateTextByBytes(value: string, maxBytes: number): { text: string; truncated: boolean } {
  const max = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : DEFAULT_MAX_SNAPSHOT_BYTES
  const bytes = Buffer.byteLength(value)
  if (bytes <= max) {
    return { text: value, truncated: false }
  }

  const suffix = '\n...<truncated>'
  const truncatedText = Buffer.from(value).subarray(0, Math.max(0, max - Buffer.byteLength(suffix))).toString('utf8')
  return {
    text: `${truncatedText}${suffix}`,
    truncated: true,
  }
}

export function maskUnknown(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => maskUnknown(item, seen))
  }
  if (value && typeof value === 'object') {
    if (seen.has(value as object)) return '[circular]'
    seen.add(value as object)
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        isSensitiveName(key)
          ? typeof child === 'string'
            ? maskSensitiveString(child)
            : MASKED_VALUE
          : maskUnknown(child, seen),
      ]),
    )
  }
  return value
}

function normalizeQuery(query: URLSearchParams | Record<string, string | string[]> | undefined):
  Record<string, string | string[]> | undefined {
  if (!query) return undefined
  if (query instanceof URLSearchParams) {
    const entries = Array.from(query.keys()).sort()
    const result: Record<string, string | string[]> = {}
    for (const key of entries) {
      if (key in result) continue
      const values = query.getAll(key)
      result[key] = values.length <= 1 ? (values[0] ?? '') : values
    }
    return Object.keys(result).length > 0 ? result : undefined
  }
  return Object.keys(query).length > 0 ? query : undefined
}

export function buildJsonSnapshot({
  contentType,
  rawText,
  parsedValue,
  maxBytes = DEFAULT_MAX_SNAPSHOT_BYTES,
  truncated = false,
  parseError,
}: BuildJsonSnapshotOptions): StructuredJsonSnapshot | undefined {
  if (typeof rawText === 'undefined' && typeof parsedValue === 'undefined' && !parseError) {
    return undefined
  }

  let maskedParsed = typeof parsedValue === 'undefined' ? undefined : maskUnknown(parsedValue)
  let resolvedParseError = parseError
  let normalizedText = typeof rawText === 'string' ? rawText : undefined

  if (typeof maskedParsed === 'undefined' && typeof rawText === 'string' && rawText.trim()) {
    try {
      maskedParsed = maskUnknown(JSON.parse(rawText))
    } catch (error) {
      resolvedParseError = resolvedParseError || (error instanceof Error ? error.message : String(error))
    }
  }

  if (typeof maskedParsed !== 'undefined') {
    normalizedText = JSON.stringify(maskedParsed, null, 2)
  } else if (typeof normalizedText === 'string') {
    normalizedText = maskTextValue(normalizedText)
  }

  const sizeSource = typeof rawText === 'string'
    ? rawText
    : typeof normalizedText === 'string'
      ? normalizedText
      : ''
  const sizeBytes = sizeSource ? Buffer.byteLength(sizeSource) : undefined
  const limitedText = typeof normalizedText === 'string'
    ? truncateTextByBytes(normalizedText, maxBytes)
    : null

  return {
    contentType,
    sizeBytes,
    truncated: Boolean(truncated || limitedText?.truncated),
    parseError: resolvedParseError,
    rawText: limitedText?.text,
    parsed: maskedParsed,
  }
}

export function buildRequestSnapshot({
  method,
  path,
  url,
  query,
  headers,
  bodyText,
  bodyValue,
  contentType,
  maxBodyBytes,
  bodyTruncated,
  bodyParseError,
}: BuildRequestSnapshotOptions): StructuredHttpRequestSnapshot {
  return {
    method,
    path,
    url,
    query: normalizeQuery(query),
    headers: maskHeaders(headers),
    body: buildJsonSnapshot({
      contentType,
      rawText: bodyText,
      parsedValue: bodyValue,
      maxBytes: maxBodyBytes,
      truncated: bodyTruncated,
      parseError: bodyParseError,
    }),
  }
}

export function buildResponseSnapshot({
  statusCode,
  headers,
  bodyText,
  bodyValue,
  contentType,
  maxBodyBytes,
  bodyTruncated,
  bodyParseError,
}: BuildResponseSnapshotOptions): StructuredHttpResponseSnapshot {
  return {
    statusCode,
    headers: headers ? maskHeaders(headers) : undefined,
    body: buildJsonSnapshot({
      contentType,
      rawText: bodyText,
      parsedValue: bodyValue,
      maxBytes: maxBodyBytes,
      truncated: bodyTruncated,
      parseError: bodyParseError,
    }),
  }
}

export function hasStructuredTruncation(value: unknown): boolean {
  if (!value) return false
  if (Array.isArray(value)) return value.some((item) => hasStructuredTruncation(item))
  if (typeof value === 'object') {
    if ('truncated' in (value as Record<string, unknown>) && (value as { truncated?: unknown }).truncated === true) {
      return true
    }
    return Object.values(value as Record<string, unknown>).some((item) => hasStructuredTruncation(item))
  }
  return false
}
