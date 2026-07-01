import type {
  AgentLogDetail,
  StructuredHttpRequestSnapshot,
  StructuredHttpResponseSnapshot,
  StructuredJsonSnapshot,
} from '../../../../shared/types'
import { formatBytes, isRecord, snapshotValue } from './agentLogs.display'

export type AgentLogFlowStepStatus = 'ok' | 'warn' | 'error' | 'missing'

export type AgentLogFlowStep = {
  id: string
  title: string
  description?: string
  request?: StructuredHttpRequestSnapshot
  response?: StructuredHttpResponseSnapshot
  body?: StructuredJsonSnapshot
  value?: unknown
  status: AgentLogFlowStepStatus
  summary: string[]
}

export type AgentLogFlowLabels = {
  ingressRequest: string
  ingressGatewayDescription: string
  ingressHookDescription: string
  normalizedRequest: string
  normalizedRequestDescription: string
  upstreamRequest: string
  upstreamRequestDescription: string
  upstreamResponse: string
  clientResponse: string
  normalizedEnvelope: string
  normalizedEnvelopeDescription: string
  payload: string
  sideEffects: string
  sideEffectsDescription: string
  notCapturedYet: string
  truncated: string
  parseError: string
  stream: string
}

function compact(values: Array<string | undefined | null | false>): string[] {
  return values.filter((value): value is string => Boolean(value))
}

function requestBodyWarning(request: StructuredHttpRequestSnapshot | undefined): boolean {
  return Boolean(request?.body?.truncated || request?.body?.parseError)
}

function responseBodyWarning(response: StructuredHttpResponseSnapshot | undefined): boolean {
  return Boolean(response?.body?.truncated || response?.body?.parseError)
}

function snapshotWarning(snapshot: StructuredJsonSnapshot | undefined): boolean {
  return Boolean(snapshot?.truncated || snapshot?.parseError)
}

function hasStepData(step: Pick<AgentLogFlowStep, 'request' | 'response' | 'body' | 'value'>): boolean {
  return Boolean(step.request || step.response || step.body || typeof step.value !== 'undefined')
}

function resolveStatus(
  step: Pick<AgentLogFlowStep, 'id' | 'request' | 'response' | 'body' | 'value'>,
  errorStepId: string | null,
): AgentLogFlowStepStatus {
  const hasData = hasStepData(step)

  if (step.response && step.response.statusCode >= 400) return 'error'
  if (errorStepId === step.id) return 'error'
  if (!hasData) return 'missing'
  if (requestBodyWarning(step.request) || responseBodyWarning(step.response) || snapshotWarning(step.body)) return 'warn'
  return 'ok'
}

function statusCodeSummary(response: StructuredHttpResponseSnapshot | undefined): string | undefined {
  return typeof response?.statusCode === 'number' ? `${response.statusCode}` : undefined
}

function bodySizeSummary(snapshot: StructuredJsonSnapshot | undefined): string | undefined {
  return formatBytes(snapshot?.sizeBytes)
}

function requestHost(request: StructuredHttpRequestSnapshot | undefined): string | undefined {
  if (!request?.url) return undefined
  try {
    return new URL(request.url).host
  } catch {
    return undefined
  }
}

function snapshotFlags(snapshot: StructuredJsonSnapshot | undefined, labels: AgentLogFlowLabels): string[] {
  return compact([
    snapshot?.truncated ? labels.truncated : undefined,
    snapshot?.parseError ? labels.parseError : undefined,
  ])
}

function valueSize(value: unknown): string | undefined {
  if (typeof value === 'undefined') return undefined
  try {
    return formatBytes(JSON.stringify(value).length)
  } catch {
    return undefined
  }
}

function gatewayErrorStepId(detail: Extract<AgentLogDetail, { source: 'ai-gateway' }>): string | null {
  if (!detail.error) return null
  if (!detail.upstreamResponse || detail.upstreamResponse.statusCode >= 400) return 'provider-response'
  if (!detail.clientResponse || detail.clientResponse.statusCode >= 400) return 'client-response'
  return 'provider-response'
}

function hookErrorStepId(detail: Extract<AgentLogDetail, { source: 'agent-hooks' }>): string | null {
  if (!detail.error) return null
  if (detail.payload) return 'payload'
  if (detail.normalizedEnvelope) return 'normalize'
  return 'ingress'
}

function withStatuses(steps: AgentLogFlowStep[], errorStepId: string | null): AgentLogFlowStep[] {
  return steps.map((step) => ({
    ...step,
    status: resolveStatus(step, errorStepId),
    summary: step.summary.length > 0 ? step.summary : [],
  }))
}

export function getStepBodyValue(step: AgentLogFlowStep): unknown {
  return step.value
    ?? snapshotValue(step.body)
    ?? snapshotValue(step.request?.body)
    ?? snapshotValue(step.response?.body)
}

export function buildAgentLogFlowSteps(
  detail: AgentLogDetail,
  labels: AgentLogFlowLabels,
): AgentLogFlowStep[] {
  if (detail.source === 'ai-gateway') {
    const steps: AgentLogFlowStep[] = [
      {
        id: 'ingress',
        title: labels.ingressRequest,
        description: labels.ingressGatewayDescription,
        request: detail.ingressRequest,
        status: 'missing',
        summary: compact([
          detail.ingressRequest ? `${detail.ingressRequest.method} ${detail.ingressRequest.path}` : undefined,
          bodySizeSummary(detail.ingressRequest?.body),
          detail.meta.authSource,
          ...snapshotFlags(detail.ingressRequest?.body, labels),
        ]),
      },
      {
        id: 'normalize',
        title: labels.normalizedRequest,
        description: labels.normalizedRequestDescription,
        body: detail.normalizedRequest,
        status: 'missing',
        summary: compact([
          detail.meta.route,
          detail.meta.model,
          detail.stream?.requested ? labels.stream : undefined,
          bodySizeSummary(detail.normalizedRequest),
          ...snapshotFlags(detail.normalizedRequest, labels),
        ]),
      },
      {
        id: 'upstream',
        title: labels.upstreamRequest,
        description: labels.upstreamRequestDescription,
        request: detail.upstreamRequest,
        status: 'missing',
        summary: compact([
          detail.meta.providerName || detail.meta.providerId,
          detail.meta.model,
          requestHost(detail.upstreamRequest),
          bodySizeSummary(detail.upstreamRequest?.body),
          ...snapshotFlags(detail.upstreamRequest?.body, labels),
        ]),
      },
      {
        id: 'provider-response',
        title: labels.upstreamResponse,
        response: detail.upstreamResponse,
        status: 'missing',
        summary: compact([
          statusCodeSummary(detail.upstreamResponse),
          detail.stream?.enabled ? labels.stream : undefined,
          typeof detail.stream?.upstreamEventCount === 'number' ? `${detail.stream.upstreamEventCount}` : undefined,
          bodySizeSummary(detail.upstreamResponse?.body),
          ...snapshotFlags(detail.upstreamResponse?.body, labels),
        ]),
      },
      {
        id: 'client-response',
        title: labels.clientResponse,
        response: detail.clientResponse,
        status: 'missing',
        summary: compact([
          statusCodeSummary(detail.clientResponse),
          detail.stream?.enabled ? labels.stream : undefined,
          bodySizeSummary(detail.clientResponse?.body),
          ...snapshotFlags(detail.clientResponse?.body, labels),
        ]),
      },
    ]

    return withStatuses(steps, gatewayErrorStepId(detail))
  }

  const normalizedEnvelope = detail.normalizedEnvelope
  const normalizedRecord = isRecord(normalizedEnvelope) ? normalizedEnvelope : null
  const steps: AgentLogFlowStep[] = [
    {
      id: 'ingress',
      title: labels.ingressRequest,
      description: labels.ingressHookDescription,
      request: detail.ingressRequest,
      status: 'missing',
      summary: compact([
        detail.ingressRequest ? `${detail.ingressRequest.method} ${detail.ingressRequest.path}` : undefined,
        bodySizeSummary(detail.ingressRequest?.body),
        ...snapshotFlags(detail.ingressRequest?.body, labels),
      ]),
    },
    {
      id: 'normalize',
      title: labels.normalizedEnvelope,
      description: labels.normalizedEnvelopeDescription,
      value: normalizedEnvelope,
      status: 'missing',
      summary: compact([
        detail.meta.providerEvent,
        detail.meta.canonicalEvent,
        valueSize(normalizedEnvelope),
      ]),
    },
    {
      id: 'payload',
      title: labels.payload,
      body: detail.payload,
      status: 'missing',
      summary: compact([
        typeof normalizedRecord?.cwd === 'string' ? normalizedRecord.cwd : detail.summary.cwd,
        typeof normalizedRecord?.toolName === 'string' ? normalizedRecord.toolName : detail.summary.toolName,
        bodySizeSummary(detail.payload),
        ...snapshotFlags(detail.payload, labels),
      ]),
    },
    {
      id: 'side-effects',
      title: labels.sideEffects,
      description: labels.sideEffectsDescription,
      value: undefined,
      status: 'missing',
      summary: [labels.notCapturedYet],
    },
  ]

  return withStatuses(steps, hookErrorStepId(detail))
}

export function getDefaultAgentLogFlowStepId(detail: AgentLogDetail, steps: AgentLogFlowStep[]): string {
  const abnormal = steps.find((step) => step.status === 'error' || step.status === 'warn')
  if (abnormal) return abnormal.id

  const preferredId = detail.source === 'ai-gateway' ? 'provider-response' : 'normalize'
  const preferred = steps.find((step) => step.id === preferredId)
  if (preferred && preferred.status !== 'missing') return preferred.id

  return steps.find((step) => step.status !== 'missing')?.id ?? steps[0]?.id ?? ''
}
