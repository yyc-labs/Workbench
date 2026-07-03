import type { AgentLogDetail } from '../../../../shared/types'
import type { AgentLogFlowStep } from './agentLogs.flow'

export type AgentLogHeaderFocusField =
  | 'requestId'
  | 'status'
  | 'duration'
  | 'provider'
  | 'model'
  | 'event'
  | 'timestamp'
  | 'source'

export function joinJsonPath(
  left: string[] | undefined,
  right: string[] | undefined,
): string[] | undefined {
  if (!left && !right) return undefined
  return [...(left ?? []), ...(right ?? [])]
}

export function formatJsonPath(path: string[] | undefined): string {
  if (!path || path.length === 0) return '$'
  return path.reduce((label, segment) => {
    if (/^\d+$/.test(segment)) return `${label}[${segment}]`
    return `${label}.${segment}`
  }, '$')
}

export function getAgentLogHeaderFocusPath(
  detail: AgentLogDetail,
  field: AgentLogHeaderFocusField,
): string[] | undefined {
  switch (field) {
    case 'requestId':
      return ['meta', 'requestId']
    case 'status':
      if (detail.source === 'ai-gateway' && detail.clientResponse) {
        return ['clientResponse', 'statusCode']
      }
      return ['summary', 'statusCode']
    case 'duration':
      return detail.source === 'ai-gateway'
        ? ['meta', 'durationMs']
        : ['meta', 'durationMs']
    case 'provider':
      if (detail.source === 'ai-gateway') {
        return detail.meta.providerName
          ? ['meta', 'providerName']
          : ['meta', 'providerId']
      }
      return ['meta', 'provider']
    case 'model':
      return detail.source === 'ai-gateway' ? ['meta', 'model'] : undefined
    case 'event':
      return detail.source === 'agent-hooks'
        ? (detail.meta.canonicalEvent
          ? ['meta', 'canonicalEvent']
          : ['meta', 'providerEvent'])
        : undefined
    case 'timestamp':
      return ['summary', 'timestamp']
    case 'source':
      return ['summary', 'source']
    default:
      return undefined
  }
}

export function getAgentLogSectionJsonRootPath(
  detail: AgentLogDetail,
  stepId: string,
): string[] {
  if (detail.source === 'ai-gateway') {
    switch (stepId) {
      case 'ingress':
        return ['ingressRequest']
      case 'normalize':
        return ['normalizedRequest']
      case 'protocol-diagnostics':
        return ['protocolDiagnostics']
      case 'upstream':
        return ['upstreamRequest']
      case 'provider-response':
        return ['upstreamResponse']
      case 'client-response':
        return ['clientResponse']
      default:
        return []
    }
  }

  switch (stepId) {
    case 'ingress':
      return ['ingressRequest']
    case 'normalize':
      return ['normalizedEnvelope']
    case 'payload':
      return ['payload']
    case 'side-effects':
      return []
    default:
      return []
  }
}

export function getStepBodyJsonPathPrefix(
  step: Pick<AgentLogFlowStep, 'body' | 'request' | 'response'>,
  jsonRootPath: string[],
): string[] | undefined {
  if (step.body) {
    return step.body.parsed !== undefined
      ? [...jsonRootPath, 'parsed']
      : step.body.rawText
        ? [...jsonRootPath, 'rawText']
        : jsonRootPath
  }

  if (step.request?.body) {
    return step.request.body.parsed !== undefined
      ? [...jsonRootPath, 'body', 'parsed']
      : step.request.body.rawText
        ? [...jsonRootPath, 'body', 'rawText']
        : [...jsonRootPath, 'body']
  }

  if (step.response?.body) {
    return step.response.body.parsed !== undefined
      ? [...jsonRootPath, 'body', 'parsed']
      : step.response.body.rawText
        ? [...jsonRootPath, 'body', 'rawText']
        : [...jsonRootPath, 'body']
  }

  return jsonRootPath.length > 0 ? jsonRootPath : undefined
}

export function getSectionPrimaryFocusPath(
  detail: AgentLogDetail,
  step: AgentLogFlowStep,
): string[] | undefined {
  if (detail.source === 'ai-gateway' && step.id === 'provider-response') {
    if (detail.stream?.merged?.upstreamText || detail.stream?.merged?.upstreamPayload) {
      return detail.stream?.merged?.upstreamText
        ? ['stream', 'merged', 'upstreamText']
        : ['stream', 'merged', 'upstreamPayload']
    }
  }

  if (detail.source === 'ai-gateway' && step.id === 'client-response') {
    if (detail.stream?.merged?.clientText || detail.stream?.merged?.clientPayload) {
      return detail.stream?.merged?.clientText
        ? ['stream', 'merged', 'clientText']
        : ['stream', 'merged', 'clientPayload']
    }
  }

  const jsonRootPath = getAgentLogSectionJsonRootPath(detail, step.id)
  return getStepBodyJsonPathPrefix(step, jsonRootPath) ?? (jsonRootPath.length > 0 ? jsonRootPath : undefined)
}
