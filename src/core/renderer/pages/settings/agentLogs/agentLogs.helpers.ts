import type { AgentLogDetail, AgentLogSummary } from '../../../../shared/types'
import type { AgentLogFilters } from './agentLogs.types'

export function agentLogKey(value: Pick<AgentLogSummary, 'source' | 'id'>): string {
  return `${value.source}:${value.id}`
}

export function toPrettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
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
