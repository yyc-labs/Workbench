/**
 * Incremental JSONL resumption core (plan 20 stage 3, D8).
 *
 * Core principle, quoted in every consumer: incremental reading is a VERIFIED
 * optimization path — full parsing is the correctness fallback. The committed
 * prefix is re-hashed on every resumption (no sampling blind spots; a
 * mid-file rewrite can never survive the check). Performance split: the
 * <50ms target covers tail parsing only; prefix hashing is billed separately
 * (13.5MB ≈ 100ms, stage 0). Any future sampling optimization MUST carry the
 * notice that sparse sampling is not an absolute rewrite-detection guarantee.
 */
import { createHash } from 'node:crypto'
import type { AgentHistoryPreviewMessage, AgentHistorySession } from '../../../../../shared/types/agentHistory'
import type { JsonlParseLimits } from './jsonl-parser'

export interface ResumableBaseline {
  /** Previously persisted layer A+B view. */
  session: AgentHistorySession
  /** End of the last committed record (plan v2.1: byteOffset semantics). */
  byteOffset: number
  /** sha256 of the committed prefix bytes. */
  prefixHash: string
}

/** sha256 over the whole buffer — hex, 16 chars (same width as sessionKey hashes). */
export function hashBuffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex').slice(0, 16)
}

export interface SplitLinesResult {
  lines: string[]
  /** Bytes consumed = index after the last NEWLINE. A trailing half-line is never consumed. */
  consumedBytes: number
}

/**
 * Split a buffer into complete lines at NEWLINE boundaries only. A trailing
 * half-line (interrupted write) is excluded from both lines and consumedBytes.
 */
export function splitCompleteLines(buf: Buffer): SplitLinesResult {
  const lines: string[] = []
  let start = 0
  let idx = buf.indexOf(0x0a)
  while (idx !== -1) {
    lines.push(buf.toString('utf8', start, idx))
    start = idx + 1
    idx = buf.indexOf(0x0a, start)
  }
  return { lines, consumedBytes: start }
}

/**
 * Accumulator that folds new rows on top of a persisted summary. Derived
 * fields follow each provider's own rules via explicit closures — counters and
 * time ranges merge, preview keeps the tail, and "last value wins" fields
 * (cwd/branch/model/sessionId) re-apply on every new row exactly as a full
 * parse would. Title semantics differ per provider, so it is handled outside.
 */
export interface ResumableAccumulator {
  touch(timestamp: string | number | null | undefined): void
  addMessage(message: { role: 'user' | 'assistant' | 'system'; text: string; timestamp: string | number | null | undefined }): void
  summary(): {
    createdAt: string | null
    updatedAt: string | null
    messageCount: number
    previewMessages: AgentHistoryPreviewMessage[]
  }
}

export function createResumableAccumulator(baseline: AgentHistorySession, limits: JsonlParseLimits): ResumableAccumulator {
  const toMs = (value: string | number | null | undefined): number | null => {
    if (value === null || value === undefined || value === '') return null
    const date = typeof value === 'number' ? new Date(value) : new Date(value)
    return Number.isFinite(date.getTime()) ? date.getTime() : null
  }
  let minMs = toMs(baseline.createdAt)
  let maxMs = toMs(baseline.updatedAt)
  let messageCount = baseline.messageCount
  const preview: AgentHistoryPreviewMessage[] = baseline.previewMessages.slice(-limits.previewMessageCount)

  return {
    touch(timestamp) {
      const ms = toMs(timestamp)
      if (ms === null) return
      if (minMs === null || ms < minMs) minMs = ms
      if (maxMs === null || ms > maxMs) maxMs = ms
    },
    addMessage(message) {
      const text = message.text.trim()
      if (!text) return
      messageCount += 1
      preview.push({
        role: message.role,
        text: text.length > limits.previewTextMaxLength ? `${text.slice(0, limits.previewTextMaxLength)}…` : text,
        timestamp: toIsoTimestampSafe(message.timestamp),
      })
      if (preview.length > limits.previewMessageCount) preview.shift()
    },
    summary() {
      return {
        createdAt: minMs !== null ? new Date(minMs).toISOString() : null,
        updatedAt: maxMs !== null ? new Date(maxMs).toISOString() : null,
        messageCount,
        previewMessages: preview,
      }
    },
  }
}

function toIsoTimestampSafe(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

const HASH_CHUNK_BYTES = 4 * 1024 * 1024

interface ChunkedReadSource {
  readRange(file: string, offset: number, length: number, signal?: AbortSignal): Promise<Buffer>
}

/**
 * sha256 of the whole file, chunked (4MB) so a 64MB session never allocates a
 * 64MB scratch buffer at parse concurrency 4. Cost ≈ one extra sequential read
 * (stage 0: 13.5MB ≈ 94ms over UNC). Returns null on any IO failure — callers
 * persist a null hash and the next scan simply re-parses in full.
 */
export async function hashFileByChunks(dataSource: ChunkedReadSource, filePath: string, sizeBytes: number, signal?: AbortSignal): Promise<string | null> {
  const hash = createHash('sha256')
  let offset = 0
  try {
    while (offset < sizeBytes) {
      signal?.throwIfAborted()
      const chunk = await dataSource.readRange(filePath, offset, HASH_CHUNK_BYTES, signal)
      if (chunk.length === 0) break
      hash.update(chunk)
      offset += chunk.length
    }
    return hash.digest('hex').slice(0, 16)
  } catch {
    return null
  }
}
