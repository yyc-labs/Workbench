import type { AgentLogDetail, AgentLogSummary } from '../../../../shared/types'
import type { AgentLogFilters } from './agentLogs.types'

export function agentLogKey(value: Pick<AgentLogSummary, 'source' | 'id'>): string {
  return `${value.source}:${value.id}`
}

export function toPrettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

const DEFAULT_SIZE_ESTIMATE_MAX_DEPTH = 6
const DEFAULT_SIZE_ESTIMATE_MAX_NODES = 240
const DEFAULT_SIZE_ESTIMATE_MAX_STRING_CHARS = 16 * 1024

export function estimateJsonSizeBytes(
  value: unknown,
  options?: {
    maxDepth?: number
    maxNodes?: number
    maxStringChars?: number
  },
): number | undefined {
  const maxDepth = options?.maxDepth ?? DEFAULT_SIZE_ESTIMATE_MAX_DEPTH
  const maxNodes = options?.maxNodes ?? DEFAULT_SIZE_ESTIMATE_MAX_NODES
  const maxStringChars = options?.maxStringChars ?? DEFAULT_SIZE_ESTIMATE_MAX_STRING_CHARS
  let visitedNodes = 0
  let aborted = false

  const visit = (current: unknown, depth: number): number => {
    if (visitedNodes >= maxNodes) {
      aborted = true
      return 0
    }

    visitedNodes += 1

    if (current === null) return 4
    if (typeof current === 'string') return Math.min(current.length, maxStringChars) + 2
    if (typeof current === 'number' || typeof current === 'boolean' || typeof current === 'bigint') {
      return String(current).length
    }
    if (typeof current === 'undefined') return 9
    if (typeof current !== 'object') return String(current).length
    if (depth >= maxDepth) {
      aborted = true
      return Array.isArray(current) ? 2 : 2
    }

    if (Array.isArray(current)) {
      let total = 2
      for (let index = 0; index < current.length; index += 1) {
        total += visit(current[index], depth + 1)
        if (index < current.length - 1) total += 1
        if (aborted) return total
      }
      return total
    }

    const entries = Object.entries(current)
    let total = 2
    for (let index = 0; index < entries.length; index += 1) {
      const [key, child] = entries[index]
      total += key.length + 3
      total += visit(child, depth + 1)
      if (index < entries.length - 1) total += 1
      if (aborted) return total
    }
    return total
  }

  const estimated = visit(value, 0)
  return aborted ? undefined : estimated
}

export function readValueAtPath(value: unknown, path: string[]): unknown {
  let current = value

  for (const segment of path) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)]
      continue
    }

    if (!current || typeof current !== 'object' || !(segment in current)) {
      return undefined
    }

    current = (current as Record<string, unknown>)[segment]
  }

  return current
}

function normalizeText(value: string | undefined): string {
  return (value || '').trim().toLowerCase()
}

export function matchesAgentLogFilters(summary: AgentLogSummary, filters: AgentLogFilters): boolean {
  if (filters.source !== 'all' && summary.source !== filters.source) return false
  if (filters.level !== 'all' && summary.level !== filters.level) return false
  if (filters.route !== 'all' && summary.route !== filters.route) return false

  const query = normalizeText(filters.query)
  if (!query) return true

  const haystack = normalizeText([
    summary.title,
    summary.source,
    summary.route,
    summary.requestPath,
    summary.providerEvent,
    summary.canonicalEvent,
    summary.provider,
    summary.providerId,
    summary.providerName,
    summary.model,
    summary.profileId,
    summary.cwd,
    summary.toolName,
  ].filter(Boolean).join(' '))

  return haystack.includes(query)
}

export function detailToJson(detail: AgentLogDetail | null): unknown {
  if (!detail) return null

  if (detail.source === 'ai-gateway') {
    return {
      summary: detail.summary,
      meta: detail.meta,
      ingressRequest: detail.ingressRequest,
      normalizedRequest: detail.normalizedRequest,
      protocolDiagnostics: detail.protocolDiagnostics,
      upstreamRequest: detail.upstreamRequest,
      upstreamResponse: detail.upstreamResponse,
      clientResponse: detail.clientResponse,
      stream: detail.stream,
      error: detail.error,
    }
  }

  return {
    summary: detail.summary,
    meta: detail.meta,
    ingressRequest: detail.ingressRequest,
    normalizedEnvelope: detail.normalizedEnvelope,
    payload: detail.payload,
    error: detail.error,
  }
}
