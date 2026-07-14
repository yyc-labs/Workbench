import { randomUUID } from 'crypto'
import type { IncomingMessage } from 'http'
import type {
  AgentLogLevel,
  AiGatewayLogDetail,
  AiGatewayLogRoute,
  AiGatewayProtocolConversionKind,
  AiGatewayProviderConfig,
  StructuredHttpRequestSnapshot,
  StructuredJsonSnapshot,
} from '../../../shared/types'
import {
  buildJsonSnapshot,
  buildRequestSnapshot,
  hasStructuredTruncation,
} from '../agent-logs/log-snapshots'
import { getContentType } from './gateway-http'
import { routeTitle } from './gateway-routes'
import type { ToolValidationReport } from './tool-validation'

export type RequestLogContext = {
  route: AiGatewayLogRoute
  requestMethod: string
  requestPath: string
  profileId?: string
}

export type GatewayRequestTrace = {
  id: string
  startedAt: number
  title: string
  level: AgentLogLevel
  requestContext: RequestLogContext
  ingressRequest: StructuredHttpRequestSnapshot
  meta: AiGatewayLogDetail['meta']
  normalizedRequest?: StructuredJsonSnapshot
  upstreamRequest?: AiGatewayLogDetail['upstreamRequest']
  upstreamResponse?: AiGatewayLogDetail['upstreamResponse']
  clientResponse?: AiGatewayLogDetail['clientResponse']
  stream?: AiGatewayLogDetail['stream']
  protocolDiagnostics?: AiGatewayLogDetail['protocolDiagnostics']
  error?: AiGatewayLogDetail['error']
  statusCode?: number
  finalized: boolean
}

export function beginGatewayTrace(
  req: IncomingMessage,
  requestContext: RequestLogContext
): GatewayRequestTrace {
  const requestUrl = new URL(req.url || '/', 'http://localhost')
  return {
    id: randomUUID(),
    startedAt: Date.now(),
    title: routeTitle(requestContext.route),
    level: 'info',
    requestContext,
    ingressRequest: buildRequestSnapshot({
      method: req.method || requestContext.requestMethod,
      path: requestUrl.pathname,
      url: req.url || requestUrl.pathname,
      query: requestUrl.searchParams,
      headers: req.headers,
      contentType: getContentType(req.headers),
    }),
    meta: {
      requestId: '',
      route: requestContext.route,
      profileId: requestContext.profileId,
    },
    finalized: false,
  }
}

export function updateGatewayTraceIngressBody(
  trace: GatewayRequestTrace,
  rawBody: string,
  parsedBody: unknown | undefined,
  maxBodyBytes: number
): void {
  trace.ingressRequest = buildRequestSnapshot({
    method: trace.ingressRequest.method,
    path: trace.ingressRequest.path,
    url: trace.ingressRequest.url,
    query: trace.ingressRequest.query,
    headers: trace.ingressRequest.headers,
    bodyText: rawBody,
    bodyValue: parsedBody,
    contentType: trace.ingressRequest.body?.contentType ?? getContentType({
      'content-type': trace.ingressRequest.headers['content-type'],
    }),
    maxBodyBytes,
  })
}

export function setGatewayTraceRouteData(
  trace: GatewayRequestTrace,
  provider: AiGatewayProviderConfig,
  model: string,
  requestedStream: boolean,
  normalizedRequest: unknown,
  maxBodyBytes: number,
  diagnostics?: {
    conversion?: AiGatewayProtocolConversionKind
    lossyWarnings?: string[]
  }
): void {
  trace.meta.providerId = provider.id
  trace.meta.providerName = provider.name
  trace.meta.model = model
  trace.normalizedRequest = buildJsonSnapshot({
    contentType: 'application/json; charset=utf-8',
    parsedValue: normalizedRequest,
    maxBytes: maxBodyBytes,
  })
  trace.stream = {
    requested: requestedStream,
    enabled: false,
  }
  trace.protocolDiagnostics = {
    ...(trace.protocolDiagnostics ?? {}),
    providerCapabilities: provider.capabilities,
    conversion: diagnostics?.conversion ?? trace.protocolDiagnostics?.conversion,
    lossyWarnings: diagnostics?.lossyWarnings ?? trace.protocolDiagnostics?.lossyWarnings,
  }
  trace.statusCode = requestedStream ? 200 : trace.statusCode
}

export function updateGatewayTraceProtocolDiagnostics(
  trace: GatewayRequestTrace,
  diagnostics: NonNullable<AiGatewayLogDetail['protocolDiagnostics']>
): void {
  trace.protocolDiagnostics = {
    ...(trace.protocolDiagnostics ?? {}),
    ...diagnostics,
    lossyWarnings: diagnostics.lossyWarnings ?? trace.protocolDiagnostics?.lossyWarnings,
    toolValidation: diagnostics.toolValidation ?? trace.protocolDiagnostics?.toolValidation,
  }
}

export function applyToolValidationReport(
  trace: GatewayRequestTrace,
  report: ToolValidationReport
): void {
  if (report.entries.length === 0) return
  updateGatewayTraceProtocolDiagnostics(trace, {
    toolValidation: report.entries,
  })
}

export function buildGatewayTraceDetail(trace: GatewayRequestTrace): AiGatewayLogDetail {
  const durationMs = Math.max(0, Date.now() - trace.startedAt)
  trace.meta.requestId = trace.id
  trace.meta.durationMs = durationMs

  return {
    source: 'ai-gateway',
    summary: {
      id: trace.id,
      source: 'ai-gateway',
      title: trace.title,
      timestamp: trace.startedAt,
      level: trace.level,
      route: trace.requestContext.route,
      requestMethod: trace.requestContext.requestMethod,
      requestPath: trace.requestContext.requestPath,
      providerId: trace.meta.providerId,
      providerName: trace.meta.providerName,
      model: trace.meta.model,
      profileId: trace.meta.profileId,
      statusCode: trace.statusCode,
      durationMs,
      stream: trace.stream?.requested,
      eventCount: trace.stream?.upstreamEventCount,
      streamRetryAttempt: trace.meta.streamRetryAttempt,
      maxStreamRetryAttempts: trace.meta.maxStreamRetryAttempts,
      timeoutRetryAttempt: trace.meta.timeoutRetryAttempt,
      maxTimeoutRetryAttempts: trace.meta.maxTimeoutRetryAttempts,
      truncated: hasStructuredTruncation({
        ingressRequest: trace.ingressRequest,
        normalizedRequest: trace.normalizedRequest,
        upstreamRequest: trace.upstreamRequest,
        upstreamResponse: trace.upstreamResponse,
        clientResponse: trace.clientResponse,
        stream: trace.stream,
      }),
    },
    meta: trace.meta,
    ingressRequest: trace.ingressRequest,
    normalizedRequest: trace.normalizedRequest,
    protocolDiagnostics: trace.protocolDiagnostics,
    upstreamRequest: trace.upstreamRequest,
    upstreamResponse: trace.upstreamResponse,
    clientResponse: trace.clientResponse,
    stream: trace.stream,
    error: trace.error,
  }
}
