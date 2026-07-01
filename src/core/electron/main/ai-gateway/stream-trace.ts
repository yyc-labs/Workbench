import type {
  AiGatewayLogDetail,
  StructuredJsonSnapshot,
} from '../../../shared/types'
import { buildJsonSnapshot } from '../agent-logs/log-snapshots'

export type StreamMergedSnapshot = NonNullable<NonNullable<AiGatewayLogDetail['stream']>['merged']>

type LimitedTextAccumulator = {
  append(value: string): void
  getText(): string
  snapshot(): StructuredJsonSnapshot | undefined
}

type BuildStreamMergedSnapshotParams = {
  upstreamText?: string
  upstreamPayload?: unknown
  clientText?: string
  clientPayload?: unknown
  finishReason?: string | null
  usage?: unknown
  maxBodyBytes: number
}

const DEFAULT_MAX_STREAM_SNAPSHOT_BYTES = 256 * 1024

function normalizeMaxBytes(maxBytes: number): number {
  return Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : DEFAULT_MAX_STREAM_SNAPSHOT_BYTES
}

function sliceUtf8TextByBytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value) <= maxBytes) return value

  let result = ''
  let bytes = 0
  for (const char of value) {
    const charBytes = Buffer.byteLength(char)
    if (bytes + charBytes > maxBytes) break
    result += char
    bytes += charBytes
  }
  return result
}

export function createLimitedTextAccumulator(
  maxBytes: number,
  contentType = 'text/plain; charset=utf-8'
): LimitedTextAccumulator {
  const limit = normalizeMaxBytes(maxBytes)
  let text = ''
  let sizeBytes = 0
  let storedBytes = 0
  let truncated = false

  return {
    append(value: string): void {
      if (!value) return
      const valueBytes = Buffer.byteLength(value)
      sizeBytes += valueBytes

      if (truncated || storedBytes >= limit) {
        truncated = true
        return
      }

      const remainingBytes = limit - storedBytes
      if (valueBytes <= remainingBytes) {
        text += value
        storedBytes += valueBytes
        return
      }

      const sliced = sliceUtf8TextByBytes(value, remainingBytes)
      if (sliced) {
        text += sliced
        storedBytes += Buffer.byteLength(sliced)
      }
      truncated = true
    },
    getText(): string {
      return text
    },
    snapshot(): StructuredJsonSnapshot | undefined {
      if (!text && !truncated) return undefined
      return {
        contentType,
        sizeBytes,
        truncated,
        rawText: text || undefined,
      }
    },
  }
}

function textSnapshot(value: string | undefined, maxBodyBytes: number): StructuredJsonSnapshot | undefined {
  if (!value) return undefined
  const accumulator = createLimitedTextAccumulator(maxBodyBytes)
  accumulator.append(value)
  return accumulator.snapshot()
}

function payloadSnapshot(value: unknown, maxBodyBytes: number): StructuredJsonSnapshot | undefined {
  if (typeof value === 'undefined') return undefined
  let rawText: string
  try {
    const serialized = JSON.stringify(value, null, 2)
    rawText = typeof serialized === 'string' ? serialized : String(value)
  } catch (error) {
    rawText = String(error instanceof Error ? error.message : error)
  }
  const accumulator = createLimitedTextAccumulator(maxBodyBytes, 'application/json; charset=utf-8')
  accumulator.append(rawText)
  const limited = accumulator.snapshot()
  if (!limited?.rawText) return undefined
  const snapshot = buildJsonSnapshot({
    contentType: 'application/json; charset=utf-8',
    rawText: limited.rawText,
    maxBytes: maxBodyBytes,
    truncated: limited.truncated,
  })
  if (snapshot && typeof limited.sizeBytes === 'number') {
    snapshot.sizeBytes = limited.sizeBytes
  }
  return snapshot
}

export function buildStreamMergedSnapshot({
  upstreamText,
  upstreamPayload,
  clientText,
  clientPayload,
  finishReason,
  usage,
  maxBodyBytes,
}: BuildStreamMergedSnapshotParams): StreamMergedSnapshot | undefined {
  const merged: StreamMergedSnapshot = {
    upstreamText: textSnapshot(upstreamText, maxBodyBytes),
    upstreamPayload: payloadSnapshot(upstreamPayload, maxBodyBytes),
    clientText: textSnapshot(clientText, maxBodyBytes),
    clientPayload: payloadSnapshot(clientPayload, maxBodyBytes),
    finishReason,
    usage,
  }

  const hasSnapshot = Boolean(
    merged.upstreamText
      || merged.upstreamPayload
      || merged.clientText
      || merged.clientPayload
      || typeof merged.finishReason !== 'undefined'
      || typeof merged.usage !== 'undefined'
  )
  return hasSnapshot ? merged : undefined
}
