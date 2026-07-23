import { randomUUID } from 'crypto'
import { net } from 'electron'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import type { AiGatewayConfig, AiGatewayLogDetail, AiGatewayLogEntry, AiGatewayProtocolConversionKind, AiGatewayProviderConfig } from '../../../shared/types'
import { buildRequestSnapshot, buildResponseSnapshot } from '../agent-logs/log-snapshots'
import { chatStreamChunkToAnthropicEvents, chatStreamChunkToResponsesEvents, createAnthropicStreamStart, createAnthropicStreamState, createAnthropicStreamStop, createResponsesStreamCreated, createResponsesStreamFinish, createResponsesStreamIds, createResponsesStreamState } from './gateway-chat-stream-conversion'
import { AI_GATEWAY_DEFAULT_MAX_BODY_BYTES, getAiGatewayAnthropicBaseUrl, getAiGatewayListenUrl, getAiGatewayOpenAiBaseUrl, normalizeAiGatewayConfig } from './gateway-config'
import { emptyResponse, getContentType, getHeaderValue, getResponseContentType, type HeaderValue, jsonResponse, writeSseHeaders } from './gateway-http'
import { handleAnthropicMessagesRoute, handleChatCompletionsRoute, handleResponsesRoute } from './gateway-request-handlers'
import { parseRoutedPath, type RouteKind, routeErrorPayload } from './gateway-routes'
import {
  buildAnthropicMessagePayload as streamBuildAnthropicMessagePayload,
  buildChatStreamPayload as streamBuildChatStreamPayload,
  buildRawSsePayload as streamBuildRawSsePayload,
  createAnthropicContentTraceAccumulator as streamCreateAnthropicContentTraceAccumulator,
  createChatToolCallTraceAccumulator as streamCreateChatToolCallTraceAccumulator,
  extractDeltaText as streamExtractDeltaText,
  extractFinishReason as streamExtractFinishReason,
  extractUsage as streamExtractUsage,
  findResponseCompletedPayload as streamFindResponseCompletedPayload,
  isJsonRecord as streamIsJsonRecord,
  parseJsonRecord as streamParseJsonRecord,
  readAnthropicPassthroughEvent as streamReadAnthropicPassthroughEvent,
  readAnthropicStopMetadata as streamReadAnthropicStopMetadata,
} from './gateway-stream-accumulators'
import { updateGatewayStreamTrace } from './gateway-stream-observability'
import { decodeSseStream, drainSseEvents, encodeSseEvent } from './gateway-stream-proxy'
import {
  applyToolValidationReport as applyToolValidationReportHelper,
  beginGatewayTrace as beginGatewayTraceHelper,
  buildGatewayTraceDetail,
  type GatewayRequestTrace,
  type RequestLogContext,
  setGatewayTraceRouteData as setGatewayTraceRouteDataHelper,
  updateGatewayTraceIngressBody as updateGatewayTraceIngressBodyHelper,
  updateGatewayTraceProtocolDiagnostics as updateGatewayTraceProtocolDiagnosticsHelper,
} from './gateway-trace'
import { buildAnthropicAuthHeaders, buildAnthropicUpstreamLogDetails, buildResponsesUpstreamLogDetails, buildUpstreamLogDetails, extractRequestApiToken, isAbortError, readResponseText, resolveUpstreamAuth, toAnthropicMessagesUrl, toChatCompletionsUrl, toResponsesUrl } from './gateway-upstream'
import type { AnthropicMessagesRequest, ChatCompletionRequest, ChatCompletionResponse, JsonObject, OpenAiResponsesRequest } from './protocol-types'
import { GatewayRouteError, UnsupportedGatewayFeatureError } from './protocol-types'
import type { AiGatewayProviderRegistry } from './provider-registry'
import { createLimitedTextAccumulator } from './stream-trace'
import { anthropicToolsToValidationTools, assertToolValidationPassed, type ToolValidationReport, toolValidationFailureMessage, validateAnthropicToolUseBlocks, validateChatToolCalls } from './tool-validation'

export { extractRequestApiToken, toAnthropicMessagesUrl } from './gateway-upstream'

type AiGatewayServerOptions = {
  getConfig: () => AiGatewayConfig
  registry: AiGatewayProviderRegistry
  isLogCaptureEnabled?: () => boolean
}

const AI_GATEWAY_DEBUG_ENV = 'IDE_ELECTRON_AI_GATEWAY_DEBUG'
const AI_GATEWAY_LOG_PREVIEW_CHARS = 1200
const AI_GATEWAY_MAX_DEBUG_SSE_EVENTS = 6
const AI_GATEWAY_RECENT_LOG_LIMIT = 200

/**
 * Keep upstream traffic on Electron's Chromium network stack. This avoids using
 * Node/Undici's direct TLS implementation, which can be treated differently by
 * an upstream CDN or WAF. `net` is unavailable in the Node-only test loader, so
 * those tests deliberately retain the standard Fetch implementation.
 */
function fetchUpstream(input: string, init: RequestInit): Promise<Response> {
  if (typeof net?.fetch === 'function') {
    return net.fetch(input, init) as Promise<Response>
  }
  return globalThis.fetch(input, init)
}

function remediationForUnsupportedFeature(kind: string | undefined): string | undefined {
  if (kind === 'responses_reasoning') {
    return 'Route this request to an openai_responses provider, or remove reasoning before using an openai_chat provider.'
  }
  if (kind === 'responses_tools') {
    return 'Enable function tools and Responses-to-Chat downgrade for this provider, or route the request to an openai_responses provider.'
  }
  if (kind === 'responses_builtin_tools') {
    return 'Built-in Responses tools require an openai_responses provider; only function tools can use the Chat downgrade route.'
  }
  if (kind === 'responses_tool_calls') {
    return 'Include each earlier function_call item before its function_call_output, with one matching call_id per tool result.'
  }
  if (kind === 'responses_tool_choice') {
    return 'Use auto, none, required, or a declared function tool choice when routing Responses through Chat.'
  }
  if (kind === 'responses_streaming') {
    return 'Enable streaming for this provider, or send the Responses request without stream=true.'
  }
  return undefined
}

function isAiGatewayDebugEnabled(): boolean {
  const value = (process.env[AI_GATEWAY_DEBUG_ENV] ?? '').trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

function truncateForLog(value: string, maxChars = AI_GATEWAY_LOG_PREVIEW_CHARS): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}...<truncated>`
}

function serializeForLog(value: unknown): string {
  if (typeof value === 'string') return truncateForLog(value)
  try {
    return truncateForLog(JSON.stringify(value))
  } catch {
    return truncateForLog(String(value))
  }
}

function logAiGateway(level: 'info' | 'warn' | 'error', message: string, details?: Record<string, unknown>): void {
  const suffix = details ? ` ${serializeForLog(details)}` : ''
  console[level](`[ai-gateway] ${message}${suffix}`)
}

function debugAiGateway(message: string, details?: Record<string, unknown>): void {
  if (!isAiGatewayDebugEnabled()) return
  logAiGateway('info', message, details)
}

export class AiGatewayServer {
  private readonly getConfig: AiGatewayServerOptions['getConfig']
  private readonly registry: AiGatewayProviderRegistry
  private readonly isLogCaptureEnabled: () => boolean
  private server: Server | null = null
  private recentLogs: AiGatewayLogEntry[] = []
  private recentLogDetails: AiGatewayLogDetail[] = []
  private running = false
  private error: string | undefined
  private activeHost = '127.0.0.1'
  private activePort = 17374

  constructor(options: AiGatewayServerOptions) {
    this.getConfig = options.getConfig
    this.registry = options.registry
    this.isLogCaptureEnabled = options.isLogCaptureEnabled ?? (() => true)
  }

  async start(configInput?: AiGatewayConfig): Promise<void> {
    const config = normalizeAiGatewayConfig(configInput ?? this.getConfig())
    if (!config.enabled) {
      await this.stop()
      return
    }

    if (this.server && this.activeHost === config.host && this.activePort === config.port) {
      this.running = true
      return
    }

    await this.stop()
    this.activeHost = config.host
    this.activePort = config.port
    this.error = undefined

    await new Promise<void>((resolve, reject) => {
      const server = createServer((req, res) => {
        void this.handleRequest(req, res).catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          if (!res.headersSent) {
            jsonResponse(res, 500, { error: { message, type: 'ai_gateway_error' } })
          } else {
            res.end()
          }
        })
      })
      server.once('error', (error) => {
        this.running = false
        this.error = error instanceof Error ? error.message : String(error)
        reject(error)
      })
      server.listen(config.port, config.host, () => {
        this.server = server
        this.running = true
        this.error = undefined
        resolve()
      })
    })
  }

  stop(): Promise<void> {
    if (!this.server) {
      this.running = false
      return Promise.resolve()
    }

    const server = this.server
    this.server = null
    this.running = false
    return new Promise((resolve) => {
      server.close(() => resolve())
    })
  }

  isRunning(): boolean {
    return this.running
  }

  getError(): string | undefined {
    return this.error
  }

  getRecentLogs(): AiGatewayLogEntry[] {
    return this.recentLogs.slice()
  }

  getRecentLogDetails(): AiGatewayLogDetail[] {
    return this.recentLogDetails.slice()
  }

  clearRecentLogs(): void {
    this.recentLogs = []
    this.recentLogDetails = []
  }

  getActiveEndpoint(): { host: string; port: number; url: string; anthropicBaseUrl: string; openAiBaseUrl: string } {
    const config = this.server ? { host: this.activeHost, port: this.activePort } : this.getConfig()
    return {
      host: config.host,
      port: config.port,
      url: getAiGatewayListenUrl(config),
      anthropicBaseUrl: getAiGatewayAnthropicBaseUrl(config),
      openAiBaseUrl: getAiGatewayOpenAiBaseUrl(config),
    }
  }

  private appendRecentLog(entry: Omit<AiGatewayLogEntry, 'id' | 'timestamp'>): void {
    if (!this.isLogCaptureEnabled()) return
    this.recentLogs.unshift({
      ...entry,
      id: randomUUID(),
      timestamp: Date.now(),
    })
    if (this.recentLogs.length > AI_GATEWAY_RECENT_LOG_LIMIT) {
      this.recentLogs = this.recentLogs.slice(0, AI_GATEWAY_RECENT_LOG_LIMIT)
    }
  }

  private appendRecentLogDetail(detail: AiGatewayLogDetail): void {
    if (!this.isLogCaptureEnabled()) return
    this.recentLogDetails.unshift(detail)
    if (this.recentLogDetails.length > AI_GATEWAY_RECENT_LOG_LIMIT) {
      this.recentLogDetails = this.recentLogDetails.slice(0, AI_GATEWAY_RECENT_LOG_LIMIT)
    }
  }

  private recordGatewayLog(entry: Omit<AiGatewayLogEntry, 'id' | 'timestamp'>, consoleDetails?: Record<string, unknown>): void {
    if (!this.isLogCaptureEnabled()) return
    this.appendRecentLog(entry)
    if (entry.level === 'info' && !isAiGatewayDebugEnabled()) return
    logAiGateway(
      entry.level,
      entry.message,
      consoleDetails ?? {
        route: entry.route,
        requestMethod: entry.requestMethod,
        requestPath: entry.requestPath,
        providerId: entry.providerId,
        providerName: entry.providerName,
        upstreamUrl: entry.upstreamUrl,
        profileId: entry.profileId,
        model: entry.model,
        stream: entry.stream,
        statusCode: entry.statusCode,
        contentType: entry.contentType,
        errorCode: entry.errorCode,
        eventCount: entry.eventCount,
        attempt: entry.attempt,
        maxAttempts: entry.maxAttempts,
        bodyPreview: entry.bodyPreview,
      },
    )
  }

  private beginGatewayTrace(req: IncomingMessage, requestContext: RequestLogContext): GatewayRequestTrace {
    return beginGatewayTraceHelper(req, requestContext)
  }

  private updateGatewayTraceIngressBody(trace: GatewayRequestTrace, rawBody: string, parsedBody: unknown | undefined, maxBodyBytes: number): void {
    updateGatewayTraceIngressBodyHelper(trace, rawBody, parsedBody, maxBodyBytes)
  }

  private setGatewayTraceRouteData(
    trace: GatewayRequestTrace,
    provider: AiGatewayProviderConfig,
    model: string,
    requestedStream: boolean,
    normalizedRequest: unknown,
    maxBodyBytes: number,
    diagnostics?: {
      conversion?: AiGatewayProtocolConversionKind
      lossyWarnings?: string[]
    },
  ): void {
    setGatewayTraceRouteDataHelper(trace, provider, model, requestedStream, normalizedRequest, maxBodyBytes, diagnostics)
  }

  private updateGatewayTraceProtocolDiagnostics(trace: GatewayRequestTrace, diagnostics: NonNullable<AiGatewayLogDetail['protocolDiagnostics']>): void {
    updateGatewayTraceProtocolDiagnosticsHelper(trace, diagnostics)
  }

  private applyToolValidationReport(trace: GatewayRequestTrace, report: ToolValidationReport): void {
    applyToolValidationReportHelper(trace, report)
  }

  private recordToolValidation(provider: AiGatewayProviderConfig, requestContext: RequestLogContext, model: string, stream: boolean, report: ToolValidationReport): void {
    if (report.entries.length === 0) return
    const upstreamUrl = provider.protocol === 'anthropic_messages' ? toAnthropicMessagesUrl(provider.baseUrl) : provider.protocol === 'openai_responses' ? toResponsesUrl(provider.baseUrl) : toChatCompletionsUrl(provider.baseUrl)
    this.recordGatewayLog(
      {
        ...requestContext,
        level: report.valid ? 'info' : 'warn',
        message: report.valid ? 'Validated upstream tool arguments' : 'Rejected upstream tool arguments after validation',
        providerId: provider.id,
        providerName: provider.name,
        upstreamUrl,
        model,
        stream,
        errorCode: report.valid ? undefined : 'tool_validation_failed',
        bodyPreview: report.valid ? undefined : toolValidationFailureMessage(report),
      },
      {
        providerId: provider.id,
        providerName: provider.name,
        protocol: provider.protocol,
        capabilities: provider.capabilities,
        upstreamUrl,
        model,
        stream,
        toolValidation: report.entries,
      },
    )
  }

  private finalizeGatewayTrace(trace: GatewayRequestTrace): void {
    if (trace.finalized) return
    trace.finalized = true
    if (!this.isLogCaptureEnabled()) return
    this.appendRecentLogDetail(buildGatewayTraceDetail(trace))
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', 'http://localhost')
    const routedPath = parseRoutedPath(url.pathname)
    const config = normalizeAiGatewayConfig(this.getConfig())

    if (req.method === 'GET' && routedPath.path === '/health') {
      jsonResponse(res, 200, {
        ok: true,
        running: this.running,
        url: getAiGatewayListenUrl(config),
        anthropicBaseUrl: getAiGatewayAnthropicBaseUrl(config),
        openAiBaseUrl: getAiGatewayOpenAiBaseUrl(config),
      })
      return
    }

    if (req.method !== 'POST') {
      emptyResponse(res, 405)
      return
    }

    const maxBodyBytes = config.maxBodyBytes ?? AI_GATEWAY_DEFAULT_MAX_BODY_BYTES
    if (routedPath.path === '/v1/messages' || routedPath.path === '/messages') {
      await handleAnthropicMessagesRoute(
        req,
        res,
        maxBodyBytes,
        {
          registry: this.registry,
          beginGatewayTrace: this.beginGatewayTrace.bind(this),
          updateGatewayTraceIngressBody: this.updateGatewayTraceIngressBody.bind(this),
          setGatewayTraceRouteData: this.setGatewayTraceRouteData.bind(this),
          applyToolValidationReport: this.applyToolValidationReport.bind(this),
          recordToolValidation: this.recordToolValidation.bind(this),
          finalizeGatewayTrace: this.finalizeGatewayTrace.bind(this),
          recordGatewayLog: this.recordGatewayLog.bind(this),
          respondRouteError: this.respondRouteError.bind(this),
          fetchChatJson: this.fetchChatJson.bind(this),
          proxyChatStreamAsAnthropic: this.proxyChatStreamAsAnthropic.bind(this),
          proxyAnthropicMessagesStream: this.proxyAnthropicMessagesStream.bind(this),
          proxyAnthropicMessagesJson: this.proxyAnthropicMessagesJson.bind(this),
          proxyResponsesStream: this.proxyResponsesStream.bind(this),
          proxyResponsesJson: this.proxyResponsesJson.bind(this),
          proxyChatStreamAsResponses: this.proxyChatStreamAsResponses.bind(this),
          proxyChatStreamRaw: this.proxyChatStreamRaw.bind(this),
        },
        routedPath.profileId,
      )
      return
    }
    if (routedPath.path === '/v1/responses' || routedPath.path === '/responses') {
      await handleResponsesRoute(req, res, maxBodyBytes, {
        registry: this.registry,
        beginGatewayTrace: this.beginGatewayTrace.bind(this),
        updateGatewayTraceIngressBody: this.updateGatewayTraceIngressBody.bind(this),
        setGatewayTraceRouteData: this.setGatewayTraceRouteData.bind(this),
        applyToolValidationReport: this.applyToolValidationReport.bind(this),
        recordToolValidation: this.recordToolValidation.bind(this),
        finalizeGatewayTrace: this.finalizeGatewayTrace.bind(this),
        recordGatewayLog: this.recordGatewayLog.bind(this),
        respondRouteError: this.respondRouteError.bind(this),
        fetchChatJson: this.fetchChatJson.bind(this),
        proxyChatStreamAsAnthropic: this.proxyChatStreamAsAnthropic.bind(this),
        proxyAnthropicMessagesStream: this.proxyAnthropicMessagesStream.bind(this),
        proxyAnthropicMessagesJson: this.proxyAnthropicMessagesJson.bind(this),
        proxyResponsesStream: this.proxyResponsesStream.bind(this),
        proxyResponsesJson: this.proxyResponsesJson.bind(this),
        proxyChatStreamAsResponses: this.proxyChatStreamAsResponses.bind(this),
        proxyChatStreamRaw: this.proxyChatStreamRaw.bind(this),
      })
      return
    }
    if (routedPath.path === '/v1/chat/completions' || routedPath.path === '/chat/completions') {
      await handleChatCompletionsRoute(req, res, maxBodyBytes, {
        registry: this.registry,
        beginGatewayTrace: this.beginGatewayTrace.bind(this),
        updateGatewayTraceIngressBody: this.updateGatewayTraceIngressBody.bind(this),
        setGatewayTraceRouteData: this.setGatewayTraceRouteData.bind(this),
        applyToolValidationReport: this.applyToolValidationReport.bind(this),
        recordToolValidation: this.recordToolValidation.bind(this),
        finalizeGatewayTrace: this.finalizeGatewayTrace.bind(this),
        recordGatewayLog: this.recordGatewayLog.bind(this),
        respondRouteError: this.respondRouteError.bind(this),
        fetchChatJson: this.fetchChatJson.bind(this),
        proxyChatStreamAsAnthropic: this.proxyChatStreamAsAnthropic.bind(this),
        proxyAnthropicMessagesStream: this.proxyAnthropicMessagesStream.bind(this),
        proxyAnthropicMessagesJson: this.proxyAnthropicMessagesJson.bind(this),
        proxyResponsesStream: this.proxyResponsesStream.bind(this),
        proxyResponsesJson: this.proxyResponsesJson.bind(this),
        proxyChatStreamAsResponses: this.proxyChatStreamAsResponses.bind(this),
        proxyChatStreamRaw: this.proxyChatStreamRaw.bind(this),
      })
      return
    }

    emptyResponse(res, 404)
  }

  private async fetchAnthropicMessages(provider: AiGatewayProviderConfig, payload: AnthropicMessagesRequest, incomingHeaders: Record<string, HeaderValue>, requestContext: RequestLogContext, trace: GatewayRequestTrace | undefined, apiTokenOverride = ''): Promise<Response> {
    const controller = new AbortController()
    const timeoutMs = provider.timeoutMs ?? 60000
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const authResult = buildAnthropicAuthHeaders(provider, incomingHeaders, apiTokenOverride)
    const anthropicVersion = getHeaderValue(incomingHeaders, 'anthropic-version') || '2023-06-01'
    const anthropicBeta = getHeaderValue(incomingHeaders, 'anthropic-beta')
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: payload.stream ? 'text/event-stream' : 'application/json',
      'anthropic-version': anthropicVersion,
      ...authResult.headers,
    }
    if (anthropicBeta) headers['anthropic-beta'] = anthropicBeta

    if (trace) {
      trace.meta.authSource = authResult.auth.source
      trace.meta.authToken = authResult.auth.token || '(empty)'
      trace.upstreamRequest = buildRequestSnapshot({
        method: 'POST',
        path: '/v1/messages',
        url: toAnthropicMessagesUrl(provider.baseUrl),
        headers,
        bodyValue: payload,
        contentType: 'application/json; charset=utf-8',
        maxBodyBytes: this.getConfig().maxBodyBytes ?? AI_GATEWAY_DEFAULT_MAX_BODY_BYTES,
      })
    }

    try {
      this.recordGatewayLog(
        {
          ...requestContext,
          level: 'info',
          message: 'Resolved upstream auth for Anthropic passthrough request',
          providerId: provider.id,
          providerName: provider.name,
          upstreamUrl: toAnthropicMessagesUrl(provider.baseUrl),
          model: payload.model,
          stream: payload.stream === true,
          authSource: authResult.auth.source,
          authToken: authResult.auth.token ? '[masked]' : '(empty)',
        },
        buildAnthropicUpstreamLogDetails(provider, payload, {
          authSource: authResult.auth.source,
          hasAuthToken: Boolean(authResult.auth.token),
          timeoutMs,
        }),
      )
      debugAiGateway(
        'Forwarding request to upstream Anthropic Messages',
        buildAnthropicUpstreamLogDetails(provider, payload, {
          timeoutMs,
        }),
      )
      const response = await fetchUpstream(toAnthropicMessagesUrl(provider.baseUrl), {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      if (trace) {
        trace.upstreamResponse = buildResponseSnapshot({
          statusCode: response.status,
          headers: response.headers,
          contentType: getResponseContentType(response),
        })
      }
      debugAiGateway(
        'Received upstream Anthropic response headers',
        buildAnthropicUpstreamLogDetails(provider, payload, {
          status: response.status,
          contentType: response.headers.get('content-type') || '',
        }),
      )
      return response
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error(`Upstream Anthropic request timed out after ${timeoutMs}ms.`)
      }
      this.recordGatewayLog(
        {
          ...requestContext,
          level: 'warn',
          message: 'Upstream Anthropic request failed before a response was received',
          providerId: provider.id,
          providerName: provider.name,
          upstreamUrl: toAnthropicMessagesUrl(provider.baseUrl),
          model: payload.model,
          stream: payload.stream === true,
          authSource: authResult.auth.source,
          authToken: authResult.auth.token ? '[masked]' : '(empty)',
          bodyPreview: error instanceof Error ? error.message : String(error),
        },
        buildAnthropicUpstreamLogDetails(provider, payload, {
          error: error instanceof Error ? error.message : String(error),
          timeoutMs,
        }),
      )
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  private writePassthroughResponse(res: ServerResponse, statusCode: number, contentType: string, bodyText: string): void {
    const headers: Record<string, string | number> = {}
    if (contentType) headers['content-type'] = contentType
    headers['content-length'] = Buffer.byteLength(bodyText)
    res.writeHead(statusCode, headers)
    res.end(bodyText)
  }

  private async proxyAnthropicMessagesJson(provider: AiGatewayProviderConfig, payload: AnthropicMessagesRequest, incomingHeaders: Record<string, HeaderValue>, requestContext: RequestLogContext, apiTokenOverride: string, trace: GatewayRequestTrace, res: ServerResponse): Promise<void> {
    const response = await this.fetchAnthropicMessages(provider, { ...payload, stream: false }, incomingHeaders, requestContext, trace, apiTokenOverride)
    const responseText = await readResponseText(response)
    const contentType = response.headers.get('content-type') || 'application/json; charset=utf-8'
    const maxBodyBytes = this.getConfig().maxBodyBytes ?? AI_GATEWAY_DEFAULT_MAX_BODY_BYTES
    let parsedResponse: JsonObject | undefined
    if (response.ok) {
      parsedResponse = streamParseJsonRecord(responseText)
    }
    trace.upstreamResponse = buildResponseSnapshot({
      statusCode: response.status,
      headers: response.headers,
      bodyText: responseText,
      bodyValue: parsedResponse,
      contentType,
      maxBodyBytes,
    })
    if (response.ok && parsedResponse) {
      const validationReport = validateAnthropicToolUseBlocks(parsedResponse.content, anthropicToolsToValidationTools(payload.tools))
      this.applyToolValidationReport(trace, validationReport)
      this.recordToolValidation(provider, requestContext, String(payload.model || ''), false, validationReport)
      assertToolValidationPassed(validationReport)
    }
    trace.clientResponse = buildResponseSnapshot({
      statusCode: response.status,
      headers: { 'content-type': contentType },
      bodyText: responseText,
      contentType,
      maxBodyBytes,
    })
    trace.statusCode = response.status
    this.recordGatewayLog(
      {
        ...requestContext,
        level: response.ok ? 'info' : 'warn',
        message: response.ok ? 'Returned Anthropic passthrough response' : 'Upstream Anthropic passthrough returned non-OK response',
        providerId: provider.id,
        providerName: provider.name,
        upstreamUrl: toAnthropicMessagesUrl(provider.baseUrl),
        model: payload.model,
        stream: false,
        statusCode: response.status,
        contentType,
        bodyPreview: response.ok ? undefined : responseText,
      },
      buildAnthropicUpstreamLogDetails(provider, payload, {
        status: response.status,
        contentType,
        bodyPreview: response.ok ? undefined : responseText,
      }),
    )
    this.writePassthroughResponse(res, response.status, contentType, responseText)
  }

  private async proxyAnthropicMessagesStream(provider: AiGatewayProviderConfig, payload: AnthropicMessagesRequest, incomingHeaders: Record<string, HeaderValue>, requestContext: RequestLogContext, apiTokenOverride: string, trace: GatewayRequestTrace, res: ServerResponse): Promise<void> {
    const response = await this.fetchAnthropicMessages(provider, { ...payload, stream: true }, incomingHeaders, requestContext, trace, apiTokenOverride)
    const contentType = response.headers.get('content-type') || ''
    const maxBodyBytes = this.getConfig().maxBodyBytes ?? AI_GATEWAY_DEFAULT_MAX_BODY_BYTES
    if (!response.ok || !response.body || !/text\/event-stream/i.test(contentType)) {
      const responseText = await readResponseText(response)
      const resolvedContentType = contentType || 'application/json; charset=utf-8'
      trace.upstreamResponse = buildResponseSnapshot({
        statusCode: response.status,
        headers: response.headers,
        bodyText: responseText,
        contentType: resolvedContentType,
        maxBodyBytes,
      })
      trace.clientResponse = buildResponseSnapshot({
        statusCode: response.status,
        headers: { 'content-type': resolvedContentType },
        bodyText: responseText,
        contentType: resolvedContentType,
        maxBodyBytes,
      })
      trace.statusCode = response.status
      this.recordGatewayLog(
        {
          ...requestContext,
          level: 'warn',
          message: response.ok ? 'Upstream Anthropic stream returned non-SSE response' : 'Upstream Anthropic stream returned non-OK response',
          providerId: provider.id,
          providerName: provider.name,
          upstreamUrl: toAnthropicMessagesUrl(provider.baseUrl),
          model: payload.model,
          stream: true,
          statusCode: response.status,
          contentType: resolvedContentType,
          bodyPreview: responseText,
        },
        buildAnthropicUpstreamLogDetails(provider, payload, {
          status: response.status,
          contentType: resolvedContentType,
          bodyPreview: responseText,
        }),
      )
      this.writePassthroughResponse(res, response.status, resolvedContentType, responseText)
      return
    }

    this.recordGatewayLog({
      ...requestContext,
      level: 'info',
      message: 'Streaming Anthropic passthrough response',
      providerId: provider.id,
      providerName: provider.name,
      upstreamUrl: toAnthropicMessagesUrl(provider.baseUrl),
      model: payload.model,
      stream: true,
      statusCode: 200,
      contentType,
    })
    trace.stream = {
      ...(trace.stream ?? { requested: payload.stream === true, enabled: false }),
      enabled: true,
    }
    trace.upstreamResponse = buildResponseSnapshot({
      statusCode: response.status,
      headers: response.headers,
      contentType,
    })
    trace.clientResponse = buildResponseSnapshot({
      statusCode: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      contentType: 'text/event-stream; charset=utf-8',
    })
    trace.statusCode = 200
    writeSseHeaders(res)

    let upstreamEventCount = 0
    const previewEvents: unknown[] = []
    const textAccumulator = createLimitedTextAccumulator(maxBodyBytes)
    const contentAccumulator = streamCreateAnthropicContentTraceAccumulator()
    let upstreamMessage: JsonObject | undefined
    let stopReason: string | null | undefined
    let usage: unknown
    const updateStreamTrace = (): void => {
      const text = textAccumulator.getText()
      const payloadSnapshot = streamBuildAnthropicMessagePayload({
        id: typeof upstreamMessage?.id === 'string' ? upstreamMessage.id : 'msg_stream',
        model: typeof upstreamMessage?.model === 'string' ? upstreamMessage.model : payload.model,
        text,
        contentBlocks: contentAccumulator.snapshot(text),
        stopReason,
        usage,
      })
      updateGatewayStreamTrace(trace, {
        requested: payload.stream === true,
        enabled: true,
        upstreamEventCount,
        previewEvents,
        upstreamText: text,
        upstreamPayload: payloadSnapshot,
        clientText: text,
        clientPayload: payloadSnapshot,
        finishReason: stopReason,
        usage,
        maxBodyBytes,
      })
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let sseBuffer = ''
    const handleSseEvent = (event: { event?: string; data: string }): void => {
      upstreamEventCount += 1
      if (previewEvents.length < AI_GATEWAY_MAX_DEBUG_SSE_EVENTS) {
        previewEvents.push({
          event: event.event || 'message',
          data: event.data,
        })
      }
      const parsed = streamParseJsonRecord(event.data)
      contentAccumulator.appendParsed(parsed)
      const streamEvent = streamReadAnthropicPassthroughEvent(parsed)
      if (streamEvent.message) {
        upstreamMessage = streamEvent.message
        if (typeof usage === 'undefined') {
          usage = streamEvent.message.usage
        }
      }
      if (streamEvent.textDelta) {
        textAccumulator.append(streamEvent.textDelta)
      }
      if (typeof streamEvent.stopReason !== 'undefined') {
        stopReason = streamEvent.stopReason
      }
      if (typeof streamEvent.usage !== 'undefined') {
        usage = streamEvent.usage
      }
    }
    const drainRawSseText = (value: string): void => {
      if (!value) return
      sseBuffer += value
      const drained = drainSseEvents(sseBuffer)
      sseBuffer = drained.rest
      for (const event of drained.events) {
        handleSseEvent(event)
      }
    }
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          res.write(Buffer.from(value))
          drainRawSseText(decoder.decode(value, { stream: true }))
        }
      }
      drainRawSseText(decoder.decode())
      updateStreamTrace()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      trace.level = 'warn'
      trace.error = {
        code: 'ai_gateway_error',
        message,
      }
      updateStreamTrace()
      this.recordGatewayLog(
        {
          ...requestContext,
          level: 'warn',
          message: 'Anthropic passthrough stream failed',
          providerId: provider.id,
          providerName: provider.name,
          upstreamUrl: toAnthropicMessagesUrl(provider.baseUrl),
          model: payload.model,
          stream: true,
          eventCount: upstreamEventCount,
          bodyPreview: message,
        },
        buildAnthropicUpstreamLogDetails(provider, payload, {
          error: message,
          upstreamEventCount,
        }),
      )
      res.write(
        encodeSseEvent('error', {
          type: 'error',
          error: {
            type: 'api_error',
            message,
          },
        }),
      )
    } finally {
      reader.releaseLock()
      res.end()
    }
  }

  private async fetchResponses(provider: AiGatewayProviderConfig, payload: OpenAiResponsesRequest, requestContext: RequestLogContext, trace?: GatewayRequestTrace, requestApiToken = ''): Promise<Response> {
    const controller = new AbortController()
    const timeoutMs = provider.timeoutMs ?? 60000
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: payload.stream ? 'text/event-stream' : 'application/json',
    }
    const auth = resolveUpstreamAuth(provider, requestApiToken)
    if (auth.token) {
      headers.authorization = `Bearer ${auth.token}`
    }

    if (trace) {
      trace.meta.authSource = auth.source
      trace.meta.authToken = auth.token || '(empty)'
      trace.upstreamRequest = buildRequestSnapshot({
        method: 'POST',
        path: '/v1/responses',
        url: toResponsesUrl(provider.baseUrl),
        headers,
        bodyValue: payload,
        contentType: 'application/json; charset=utf-8',
        maxBodyBytes: this.getConfig().maxBodyBytes ?? AI_GATEWAY_DEFAULT_MAX_BODY_BYTES,
      })
    }

    try {
      this.recordGatewayLog(
        {
          ...requestContext,
          level: 'info',
          message: 'Resolved upstream auth for native Responses request',
          providerId: provider.id,
          providerName: provider.name,
          upstreamUrl: toResponsesUrl(provider.baseUrl),
          model: payload.model,
          stream: payload.stream === true,
          authSource: auth.source,
          authToken: auth.token ? '[masked]' : '(empty)',
        },
        buildResponsesUpstreamLogDetails(provider, payload, {
          authSource: auth.source,
          hasAuthToken: Boolean(auth.token),
          timeoutMs,
        }),
      )
      debugAiGateway(
        'Forwarding request to upstream Responses',
        buildResponsesUpstreamLogDetails(provider, payload, {
          timeoutMs,
        }),
      )
      const response = await fetchUpstream(toResponsesUrl(provider.baseUrl), {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      if (trace) {
        trace.upstreamResponse = buildResponseSnapshot({
          statusCode: response.status,
          headers: response.headers,
          contentType: getResponseContentType(response),
        })
      }
      debugAiGateway(
        'Received upstream Responses headers',
        buildResponsesUpstreamLogDetails(provider, payload, {
          status: response.status,
          contentType: response.headers.get('content-type') || '',
        }),
      )
      return response
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error(`Upstream Responses request timed out after ${timeoutMs}ms.`)
      }
      this.recordGatewayLog(
        {
          ...requestContext,
          level: 'warn',
          message: 'Upstream Responses request failed before a response was received',
          providerId: provider.id,
          providerName: provider.name,
          upstreamUrl: toResponsesUrl(provider.baseUrl),
          model: payload.model,
          stream: payload.stream === true,
          authSource: auth.source,
          authToken: auth.token ? '[masked]' : '(empty)',
          bodyPreview: error instanceof Error ? error.message : String(error),
        },
        buildResponsesUpstreamLogDetails(provider, payload, {
          error: error instanceof Error ? error.message : String(error),
          timeoutMs,
        }),
      )
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  private async proxyResponsesJson(provider: AiGatewayProviderConfig, payload: OpenAiResponsesRequest, requestContext: RequestLogContext, requestApiToken: string, trace: GatewayRequestTrace, res: ServerResponse): Promise<void> {
    const response = await this.fetchResponses(provider, { ...payload, stream: false }, requestContext, trace, requestApiToken)
    const responseText = await readResponseText(response)
    const contentType = response.headers.get('content-type') || 'application/json; charset=utf-8'
    const maxBodyBytes = this.getConfig().maxBodyBytes ?? AI_GATEWAY_DEFAULT_MAX_BODY_BYTES
    trace.upstreamResponse = buildResponseSnapshot({
      statusCode: response.status,
      headers: response.headers,
      bodyText: responseText,
      contentType,
      maxBodyBytes,
    })
    trace.clientResponse = buildResponseSnapshot({
      statusCode: response.status,
      headers: { 'content-type': contentType },
      bodyText: responseText,
      contentType,
      maxBodyBytes,
    })
    trace.statusCode = response.status
    this.recordGatewayLog(
      {
        ...requestContext,
        level: response.ok ? 'info' : 'warn',
        message: response.ok ? 'Returned native Responses passthrough response' : 'Upstream native Responses returned non-OK response',
        providerId: provider.id,
        providerName: provider.name,
        upstreamUrl: toResponsesUrl(provider.baseUrl),
        model: payload.model,
        stream: false,
        statusCode: response.status,
        contentType,
        bodyPreview: response.ok ? undefined : responseText,
      },
      buildResponsesUpstreamLogDetails(provider, payload, {
        status: response.status,
        contentType,
        bodyPreview: response.ok ? undefined : responseText,
      }),
    )
    this.writePassthroughResponse(res, response.status, contentType, responseText)
  }

  private async proxyResponsesStream(provider: AiGatewayProviderConfig, payload: OpenAiResponsesRequest, requestContext: RequestLogContext, requestApiToken: string, trace: GatewayRequestTrace, res: ServerResponse): Promise<void> {
    const response = await this.fetchResponses(provider, { ...payload, stream: true }, requestContext, trace, requestApiToken)
    const contentType = response.headers.get('content-type') || ''
    const maxBodyBytes = this.getConfig().maxBodyBytes ?? AI_GATEWAY_DEFAULT_MAX_BODY_BYTES
    if (!response.ok || !response.body || !/text\/event-stream/i.test(contentType)) {
      const responseText = await readResponseText(response)
      const resolvedContentType = contentType || 'application/json; charset=utf-8'
      trace.upstreamResponse = buildResponseSnapshot({
        statusCode: response.status,
        headers: response.headers,
        bodyText: responseText,
        contentType: resolvedContentType,
        maxBodyBytes,
      })
      trace.clientResponse = buildResponseSnapshot({
        statusCode: response.status,
        headers: { 'content-type': resolvedContentType },
        bodyText: responseText,
        contentType: resolvedContentType,
        maxBodyBytes,
      })
      trace.statusCode = response.status
      this.recordGatewayLog(
        {
          ...requestContext,
          level: 'warn',
          message: response.ok ? 'Upstream native Responses stream returned non-SSE response' : 'Upstream native Responses stream returned non-OK response',
          providerId: provider.id,
          providerName: provider.name,
          upstreamUrl: toResponsesUrl(provider.baseUrl),
          model: payload.model,
          stream: true,
          statusCode: response.status,
          contentType: resolvedContentType,
          bodyPreview: responseText,
        },
        buildResponsesUpstreamLogDetails(provider, payload, {
          status: response.status,
          contentType: resolvedContentType,
          bodyPreview: responseText,
        }),
      )
      this.writePassthroughResponse(res, response.status, resolvedContentType, responseText)
      return
    }

    this.recordGatewayLog({
      ...requestContext,
      level: 'info',
      message: 'Streaming native Responses passthrough response',
      providerId: provider.id,
      providerName: provider.name,
      upstreamUrl: toResponsesUrl(provider.baseUrl),
      model: payload.model,
      stream: true,
      statusCode: 200,
      contentType,
    })
    trace.stream = {
      ...(trace.stream ?? { requested: payload.stream === true, enabled: false }),
      enabled: true,
    }
    trace.upstreamResponse = buildResponseSnapshot({
      statusCode: response.status,
      headers: response.headers,
      contentType,
    })
    trace.clientResponse = buildResponseSnapshot({
      statusCode: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      contentType: 'text/event-stream; charset=utf-8',
    })
    trace.statusCode = 200
    writeSseHeaders(res)

    let upstreamEventCount = 0
    const previewEvents: unknown[] = []
    const textAccumulator = createLimitedTextAccumulator(maxBodyBytes)
    const rawSseAccumulator = createLimitedTextAccumulator(maxBodyBytes, 'text/event-stream; charset=utf-8')
    let completedPayload: JsonObject | undefined
    let finishReason: string | null | undefined
    let usage: unknown
    const updateStreamTrace = (): void => {
      const text = textAccumulator.getText()
      const rawPayload = streamBuildRawSsePayload(rawSseAccumulator.snapshot())
      const payloadSnapshot = completedPayload ?? rawPayload
      updateGatewayStreamTrace(trace, {
        requested: payload.stream === true,
        enabled: true,
        upstreamEventCount,
        previewEvents,
        upstreamText: text,
        upstreamPayload: payloadSnapshot,
        clientText: text,
        clientPayload: payloadSnapshot,
        finishReason,
        usage,
        maxBodyBytes,
      })
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let sseBuffer = ''
    const handleSseEvent = (event: { event?: string; data: string }): void => {
      upstreamEventCount += 1
      if (previewEvents.length < AI_GATEWAY_MAX_DEBUG_SSE_EVENTS) {
        previewEvents.push({
          event: event.event || 'message',
          data: event.data,
        })
      }
      const parsed = streamParseJsonRecord(event.data)
      if (parsed?.type === 'response.output_text.delta' && typeof parsed.delta === 'string') {
        textAccumulator.append(parsed.delta)
      }
      if (parsed?.type === 'response.completed' && streamIsJsonRecord(parsed.response)) {
        completedPayload = parsed.response
        if (typeof parsed.response.output_text === 'string' && !textAccumulator.getText()) {
          textAccumulator.append(parsed.response.output_text)
        }
        if (streamIsJsonRecord(parsed.response.usage)) {
          usage = parsed.response.usage
        }
        finishReason = 'completed'
      }
    }
    const drainRawSseText = (value: string): void => {
      if (!value) return
      rawSseAccumulator.append(value)
      sseBuffer += value
      const drained = drainSseEvents(sseBuffer)
      sseBuffer = drained.rest
      for (const event of drained.events) {
        handleSseEvent(event)
      }
    }
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          res.write(Buffer.from(value))
          drainRawSseText(decoder.decode(value, { stream: true }))
        }
      }
      drainRawSseText(decoder.decode())
      updateStreamTrace()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      trace.level = 'warn'
      trace.error = {
        code: 'ai_gateway_error',
        message,
      }
      updateStreamTrace()
      this.recordGatewayLog(
        {
          ...requestContext,
          level: 'warn',
          message: 'Native Responses passthrough stream failed',
          providerId: provider.id,
          providerName: provider.name,
          upstreamUrl: toResponsesUrl(provider.baseUrl),
          model: payload.model,
          stream: true,
          eventCount: upstreamEventCount,
          bodyPreview: message,
        },
        buildResponsesUpstreamLogDetails(provider, payload, {
          error: message,
          upstreamEventCount,
        }),
      )
      res.write(
        encodeSseEvent('response.failed', {
          type: 'response.failed',
          response: {
            status: 'failed',
            error: {
              code: 'ai_gateway_error',
              message,
            },
          },
        }),
      )
    } finally {
      reader.releaseLock()
      res.end()
    }
  }

  private async fetchChat(provider: AiGatewayProviderConfig, chatRequest: ChatCompletionRequest, requestContext: RequestLogContext, trace?: GatewayRequestTrace, apiTokenOverride = ''): Promise<Response> {
    const controller = new AbortController()
    const timeoutMs = provider.timeoutMs ?? 60000
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: chatRequest.stream ? 'text/event-stream' : 'application/json',
    }
    const auth = resolveUpstreamAuth(provider, apiTokenOverride)
    if (auth.token) {
      headers.authorization = `Bearer ${auth.token}`
    }
    if (trace) {
      trace.meta.authSource = auth.source
      trace.meta.authToken = auth.token || '(empty)'
      trace.upstreamRequest = buildRequestSnapshot({
        method: 'POST',
        path: '/chat/completions',
        url: toChatCompletionsUrl(provider.baseUrl),
        headers,
        bodyValue: chatRequest,
        contentType: 'application/json; charset=utf-8',
        maxBodyBytes: this.getConfig().maxBodyBytes ?? AI_GATEWAY_DEFAULT_MAX_BODY_BYTES,
      })
    }

    try {
      this.recordGatewayLog(
        {
          ...requestContext,
          level: 'info',
          message: 'Resolved upstream auth for request',
          providerId: provider.id,
          providerName: provider.name,
          upstreamUrl: toChatCompletionsUrl(provider.baseUrl),
          model: chatRequest.model,
          stream: chatRequest.stream === true,
          authSource: auth.source,
          authToken: auth.token ? '[masked]' : '(empty)',
        },
        buildUpstreamLogDetails(provider, chatRequest, {
          authSource: auth.source,
          hasAuthToken: Boolean(auth.token),
          timeoutMs,
        }),
      )
      debugAiGateway(
        'Forwarding request to upstream chat/completions',
        buildUpstreamLogDetails(provider, chatRequest, {
          timeoutMs,
        }),
      )
      const response = await fetchUpstream(toChatCompletionsUrl(provider.baseUrl), {
        method: 'POST',
        headers,
        body: JSON.stringify(chatRequest),
        signal: controller.signal,
      })
      if (trace) {
        trace.upstreamResponse = buildResponseSnapshot({
          statusCode: response.status,
          headers: response.headers,
          contentType: getResponseContentType(response),
        })
      }
      debugAiGateway(
        'Received upstream response headers',
        buildUpstreamLogDetails(provider, chatRequest, {
          status: response.status,
          contentType: response.headers.get('content-type') || '',
        }),
      )
      return response
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error(`Upstream request timed out after ${timeoutMs}ms.`)
      }
      this.recordGatewayLog(
        {
          ...requestContext,
          level: 'warn',
          message: 'Upstream request failed before a response was received',
          providerId: provider.id,
          providerName: provider.name,
          upstreamUrl: toChatCompletionsUrl(provider.baseUrl),
          model: chatRequest.model,
          stream: chatRequest.stream === true,
          authSource: auth.source,
          authToken: auth.token ? '[masked]' : '(empty)',
          bodyPreview: error instanceof Error ? error.message : String(error),
        },
        buildUpstreamLogDetails(provider, chatRequest, {
          error: error instanceof Error ? error.message : String(error),
          timeoutMs,
        }),
      )
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  private async fetchChatJson(provider: AiGatewayProviderConfig, chatRequest: ChatCompletionRequest, requestContext: RequestLogContext, trace?: GatewayRequestTrace, apiTokenOverride = ''): Promise<ChatCompletionResponse> {
    const response = await this.fetchChat(provider, { ...chatRequest, stream: false }, requestContext, trace, apiTokenOverride)
    const responseText = await readResponseText(response)
    if (trace) {
      trace.upstreamResponse = buildResponseSnapshot({
        statusCode: response.status,
        headers: response.headers,
        bodyText: responseText,
        contentType: getResponseContentType(response),
        maxBodyBytes: this.getConfig().maxBodyBytes ?? AI_GATEWAY_DEFAULT_MAX_BODY_BYTES,
      })
    }
    if (!response.ok) {
      this.recordGatewayLog(
        {
          ...requestContext,
          level: 'warn',
          message: 'Upstream chat/completions returned non-OK JSON response',
          providerId: provider.id,
          providerName: provider.name,
          upstreamUrl: toChatCompletionsUrl(provider.baseUrl),
          model: chatRequest.model,
          stream: false,
          statusCode: response.status,
          contentType: response.headers.get('content-type') || '',
          bodyPreview: responseText,
        },
        buildUpstreamLogDetails(provider, chatRequest, {
          status: response.status,
          contentType: response.headers.get('content-type') || '',
          bodyPreview: responseText,
        }),
      )
      throw new Error(responseText || `Upstream chat/completions failed with status ${response.status}.`)
    }
    try {
      const parsed = JSON.parse(responseText) as ChatCompletionResponse
      if (trace) {
        trace.upstreamResponse = buildResponseSnapshot({
          statusCode: response.status,
          headers: response.headers,
          bodyText: responseText,
          bodyValue: parsed,
          contentType: getResponseContentType(response),
          maxBodyBytes: this.getConfig().maxBodyBytes ?? AI_GATEWAY_DEFAULT_MAX_BODY_BYTES,
        })
      }
      return parsed
    } catch {
      if (trace) {
        trace.upstreamResponse = buildResponseSnapshot({
          statusCode: response.status,
          headers: response.headers,
          bodyText: responseText,
          contentType: getResponseContentType(response),
          maxBodyBytes: this.getConfig().maxBodyBytes ?? AI_GATEWAY_DEFAULT_MAX_BODY_BYTES,
          bodyParseError: 'Invalid JSON response body.',
        })
      }
      this.recordGatewayLog(
        {
          ...requestContext,
          level: 'warn',
          message: 'Upstream chat/completions returned invalid JSON',
          providerId: provider.id,
          providerName: provider.name,
          upstreamUrl: toChatCompletionsUrl(provider.baseUrl),
          model: chatRequest.model,
          stream: false,
          statusCode: response.status,
          contentType: response.headers.get('content-type') || '',
          bodyPreview: responseText,
        },
        buildUpstreamLogDetails(provider, chatRequest, {
          status: response.status,
          contentType: response.headers.get('content-type') || '',
          bodyPreview: responseText,
        }),
      )
      throw new Error('Upstream chat/completions returned invalid JSON.')
    }
  }

  private async fetchChatStream(provider: AiGatewayProviderConfig, chatRequest: ChatCompletionRequest, requestContext: RequestLogContext, trace?: GatewayRequestTrace, apiTokenOverride = ''): Promise<Response> {
    const maxStreamRetries = Math.max(0, provider.streamRetryCount ?? 0)
    const streamRetryDelayMs = Math.max(0, provider.streamRetryDelayMs ?? 0)
    const maxTimeoutRetries = Math.max(0, provider.timeoutRetryCount ?? 0)
    const timeoutRetryDelayMs = Math.max(0, provider.timeoutRetryDelayMs ?? 0)
    const maxAttempts = maxStreamRetries + maxTimeoutRetries + 1
    let streamRetryAttempts = 0
    let timeoutRetryAttempts = 0
    const upstreamUrl = toChatCompletionsUrl(provider.baseUrl)
    let lastErrorMessage = ''
    const syncTraceRetryMeta = (): void => {
      if (!trace) return
      trace.meta.streamRetryAttempt = streamRetryAttempts
      trace.meta.maxStreamRetryAttempts = maxStreamRetries
      trace.meta.timeoutRetryAttempt = timeoutRetryAttempts
      trace.meta.maxTimeoutRetryAttempts = maxTimeoutRetries
    }

    syncTraceRetryMeta()

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController()
      const timeoutMs = provider.timeoutMs ?? 60000
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: chatRequest.stream ? 'text/event-stream' : 'application/json',
      }
      const auth = resolveUpstreamAuth(provider, apiTokenOverride)
      if (auth.token) {
        headers.authorization = `Bearer ${auth.token}`
      }
      if (trace && attempt === 1) {
        trace.meta.authSource = auth.source
        trace.meta.authToken = auth.token || '(empty)'
        trace.upstreamRequest = buildRequestSnapshot({
          method: 'POST',
          path: '/chat/completions',
          url: upstreamUrl,
          headers,
          bodyValue: { ...chatRequest, stream: true },
          contentType: 'application/json; charset=utf-8',
          maxBodyBytes: this.getConfig().maxBodyBytes ?? AI_GATEWAY_DEFAULT_MAX_BODY_BYTES,
        })
      }

      try {
        if (attempt === 1) {
          this.recordGatewayLog(
            {
              ...requestContext,
              level: 'info',
              message: 'Resolved upstream auth for request',
              providerId: provider.id,
              providerName: provider.name,
              upstreamUrl,
              model: chatRequest.model,
              stream: true,
              authSource: auth.source,
              authToken: auth.token ? '[masked]' : '(empty)',
            },
            buildUpstreamLogDetails(provider, chatRequest, {
              authSource: auth.source,
              hasAuthToken: Boolean(auth.token),
              timeoutMs,
              streamRetryCount: maxStreamRetries,
              streamRetryDelayMs,
              timeoutRetryCount: maxTimeoutRetries,
              timeoutRetryDelayMs,
            }),
          )
          debugAiGateway(
            'Forwarding request to upstream chat/completions',
            buildUpstreamLogDetails(provider, chatRequest, {
              timeoutMs,
              streamRetryCount: maxStreamRetries,
              streamRetryDelayMs,
              timeoutRetryCount: maxTimeoutRetries,
              timeoutRetryDelayMs,
            }),
          )
        }

        const response = await fetchUpstream(upstreamUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...chatRequest, stream: true }),
          signal: controller.signal,
        })
        const contentType = response.headers.get('content-type') || ''

        if (!response.ok && response.status >= 500 && streamRetryAttempts < maxStreamRetries) {
          streamRetryAttempts += 1
          syncTraceRetryMeta()
          const responseText = await readResponseText(response)
          lastErrorMessage = responseText || `Upstream chat/completions stream failed with status ${response.status}.`
          if (trace) {
            trace.upstreamResponse = buildResponseSnapshot({
              statusCode: response.status,
              headers: response.headers,
              bodyText: responseText,
              contentType: getResponseContentType(response),
              maxBodyBytes: this.getConfig().maxBodyBytes ?? AI_GATEWAY_DEFAULT_MAX_BODY_BYTES,
            })
          }
          this.recordGatewayLog(
            {
              ...requestContext,
              level: 'warn',
              message: 'Upstream chat/completions stream returned retryable response',
              providerId: provider.id,
              providerName: provider.name,
              upstreamUrl,
              model: chatRequest.model,
              stream: true,
              statusCode: response.status,
              contentType,
              bodyPreview: responseText,
              attempt,
              maxAttempts,
            },
            buildUpstreamLogDetails(provider, chatRequest, {
              status: response.status,
              contentType,
              bodyPreview: responseText,
              attempt,
              maxAttempts,
              streamRetryCount: maxStreamRetries,
            }),
          )
          debugAiGateway(
            'Retrying upstream chat/completions stream after retryable failure',
            buildUpstreamLogDetails(provider, chatRequest, {
              status: response.status,
              contentType,
              attempt,
              maxAttempts,
              streamRetryCount: maxStreamRetries,
              streamRetryDelayMs,
            }),
          )
          if (streamRetryDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, streamRetryDelayMs))
          }
          continue
        }

        if (!response.ok) {
          const responseText = await readResponseText(response)
          if (trace) {
            trace.upstreamResponse = buildResponseSnapshot({
              statusCode: response.status,
              headers: response.headers,
              bodyText: responseText,
              contentType: getResponseContentType(response),
              maxBodyBytes: this.getConfig().maxBodyBytes ?? AI_GATEWAY_DEFAULT_MAX_BODY_BYTES,
            })
          }
          this.recordGatewayLog(
            {
              ...requestContext,
              level: 'warn',
              message: 'Upstream chat/completions stream returned non-OK response',
              providerId: provider.id,
              providerName: provider.name,
              upstreamUrl,
              model: chatRequest.model,
              stream: true,
              statusCode: response.status,
              contentType,
              bodyPreview: responseText,
            },
            buildUpstreamLogDetails(provider, chatRequest, {
              status: response.status,
              contentType,
              bodyPreview: responseText,
            }),
          )
          throw new Error(responseText || `Upstream chat/completions stream failed with status ${response.status}.`)
        }

        if (!response.body) {
          if (trace) {
            trace.upstreamResponse = buildResponseSnapshot({
              statusCode: response.status,
              headers: response.headers,
              contentType: getResponseContentType(response),
            })
          }
          this.recordGatewayLog(
            {
              ...requestContext,
              level: 'warn',
              message: 'Upstream chat/completions stream returned empty body',
              providerId: provider.id,
              providerName: provider.name,
              upstreamUrl,
              model: chatRequest.model,
              stream: true,
              statusCode: response.status,
              contentType,
            },
            buildUpstreamLogDetails(provider, chatRequest, {
              status: response.status,
              contentType,
            }),
          )
          throw new Error('Upstream chat/completions stream returned an empty body.')
        }

        if (!/text\/event-stream/i.test(contentType)) {
          const responseText = await readResponseText(response)
          if (trace) {
            trace.upstreamResponse = buildResponseSnapshot({
              statusCode: response.status,
              headers: response.headers,
              bodyText: responseText,
              contentType,
              maxBodyBytes: this.getConfig().maxBodyBytes ?? AI_GATEWAY_DEFAULT_MAX_BODY_BYTES,
            })
          }
          this.recordGatewayLog(
            {
              ...requestContext,
              level: 'warn',
              message: 'Upstream chat/completions stream returned non-SSE content-type',
              providerId: provider.id,
              providerName: provider.name,
              upstreamUrl,
              model: chatRequest.model,
              stream: true,
              statusCode: response.status,
              contentType,
              bodyPreview: responseText,
            },
            buildUpstreamLogDetails(provider, chatRequest, {
              status: response.status,
              contentType,
              bodyPreview: responseText,
            }),
          )
          throw new Error(responseText || `Upstream chat/completions stream returned content-type "${contentType || 'unknown'}" instead of text/event-stream.`)
        }

        if (trace) {
          trace.upstreamResponse = buildResponseSnapshot({
            statusCode: response.status,
            headers: response.headers,
            contentType,
          })
        }
        if (attempt > 1) {
          this.recordGatewayLog(
            {
              ...requestContext,
              level: 'info',
              message: 'Upstream chat/completions stream recovered after retry',
              providerId: provider.id,
              providerName: provider.name,
              upstreamUrl,
              model: chatRequest.model,
              stream: true,
              statusCode: response.status,
              contentType,
            },
            buildUpstreamLogDetails(provider, chatRequest, {
              status: response.status,
              contentType,
              attempt,
              maxAttempts,
              streamRetryCount: maxStreamRetries,
              streamRetryDelayMs,
            }),
          )
        }
        return response
      } catch (error) {
        const timedOut = isAbortError(error)
        const errorMessage = timedOut ? `Upstream request timed out after ${timeoutMs}ms.` : error instanceof Error ? error.message : String(error)
        const canRetry = timedOut ? timeoutRetryAttempts < maxTimeoutRetries : streamRetryAttempts < maxStreamRetries
        if (canRetry) {
          if (timedOut) {
            timeoutRetryAttempts += 1
            syncTraceRetryMeta()
          } else {
            streamRetryAttempts += 1
            syncTraceRetryMeta()
          }
          lastErrorMessage = errorMessage
          this.recordGatewayLog(
            {
              ...requestContext,
              level: 'warn',
              message: timedOut ? 'Upstream chat/completions stream timed out and will be retried' : 'Upstream chat/completions stream failed and will be retried',
              providerId: provider.id,
              providerName: provider.name,
              upstreamUrl,
              model: chatRequest.model,
              stream: true,
              bodyPreview: lastErrorMessage,
              attempt,
              maxAttempts,
            },
            buildUpstreamLogDetails(provider, chatRequest, {
              error: errorMessage,
              attempt,
              maxAttempts,
              streamRetryCount: maxStreamRetries,
              streamRetryDelayMs,
              timeoutRetryCount: maxTimeoutRetries,
              timeoutRetryDelayMs,
              timeoutMs,
            }),
          )
          debugAiGateway(
            timedOut ? 'Retrying upstream chat/completions stream after timeout' : 'Retrying upstream chat/completions stream after failure',
            buildUpstreamLogDetails(provider, chatRequest, {
              error: errorMessage,
              attempt,
              maxAttempts,
              streamRetryCount: maxStreamRetries,
              streamRetryDelayMs,
              timeoutRetryCount: maxTimeoutRetries,
              timeoutRetryDelayMs,
              timeoutMs,
            }),
          )
          const retryDelayMs = timedOut ? timeoutRetryDelayMs : streamRetryDelayMs
          if (retryDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
          }
          continue
        }
        syncTraceRetryMeta()
        const finalError = timedOut ? new Error(errorMessage) : error
        this.recordGatewayLog(
          {
            ...requestContext,
            level: 'error',
            message: 'Upstream chat/completions stream retry exhausted',
            providerId: provider.id,
            providerName: provider.name,
            upstreamUrl,
            model: chatRequest.model,
            stream: true,
            bodyPreview: errorMessage,
            attempt,
            maxAttempts,
          },
          buildUpstreamLogDetails(provider, chatRequest, {
            error: errorMessage,
            attempt,
            maxAttempts,
            streamRetryCount: maxStreamRetries,
            streamRetryDelayMs,
            timeoutRetryCount: maxTimeoutRetries,
            timeoutRetryDelayMs,
            timeoutMs,
          }),
        )
        throw finalError
      } finally {
        clearTimeout(timer)
      }
    }

    throw new Error(lastErrorMessage || 'Upstream chat/completions stream failed.')
  }

  private async proxyChatStreamRaw(provider: AiGatewayProviderConfig, chatRequest: ChatCompletionRequest, requestContext: RequestLogContext, apiTokenOverride: string, trace: GatewayRequestTrace, res: ServerResponse): Promise<void> {
    const response = await this.fetchChatStream(provider, chatRequest, requestContext, trace, apiTokenOverride)
    this.recordGatewayLog({
      ...requestContext,
      level: 'info',
      message: 'Proxying raw Chat Completions stream',
      providerId: provider.id,
      providerName: provider.name,
      upstreamUrl: toChatCompletionsUrl(provider.baseUrl),
      model: chatRequest.model,
      stream: true,
      statusCode: 200,
      contentType: response.headers.get('content-type') || '',
    })
    trace.stream = {
      ...(trace.stream ?? { requested: chatRequest.stream === true, enabled: false }),
      enabled: true,
    }
    trace.clientResponse = buildResponseSnapshot({
      statusCode: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      contentType: 'text/event-stream; charset=utf-8',
    })
    trace.statusCode = 200
    writeSseHeaders(res)
    const reader = response.body!.getReader()
    const maxBodyBytes = this.getConfig().maxBodyBytes ?? AI_GATEWAY_DEFAULT_MAX_BODY_BYTES
    const decoder = new TextDecoder()
    const textAccumulator = createLimitedTextAccumulator(maxBodyBytes)
    const toolCallAccumulator = streamCreateChatToolCallTraceAccumulator()
    const rawSseAccumulator = createLimitedTextAccumulator(maxBodyBytes, 'text/event-stream; charset=utf-8')
    let sseBuffer = ''
    let upstreamEventCount = 0
    let finishReason: string | null | undefined
    let usage: JsonObject | undefined
    const previewEvents: unknown[] = []
    const handleSseEvent = (event: { event?: string; data: string }): void => {
      if (event.data === '[DONE]') return
      upstreamEventCount += 1
      if (previewEvents.length < AI_GATEWAY_MAX_DEBUG_SSE_EVENTS) {
        previewEvents.push({
          event: event.event || 'message',
          data: event.data,
        })
      }
      const parsed = streamParseJsonRecord(event.data) as ChatCompletionResponse | undefined
      if (!parsed) return
      finishReason = streamExtractFinishReason(parsed) ?? finishReason
      usage = streamExtractUsage(parsed) ?? usage
      toolCallAccumulator.append(parsed)
      textAccumulator.append(streamExtractDeltaText(parsed))
    }
    const drainRawSseText = (value: string): void => {
      if (!value) return
      rawSseAccumulator.append(value)
      sseBuffer += value
      const drained = drainSseEvents(sseBuffer)
      sseBuffer = drained.rest
      for (const event of drained.events) {
        handleSseEvent(event)
      }
    }
    const updateStreamTrace = (): void => {
      const text = textAccumulator.getText()
      const rawPayload = streamBuildRawSsePayload(rawSseAccumulator.snapshot())
      const finalPayload = streamBuildChatStreamPayload(chatRequest.model, text, finishReason, usage, toolCallAccumulator.snapshot()) ?? rawPayload
      updateGatewayStreamTrace(trace, {
        requested: chatRequest.stream === true,
        enabled: true,
        upstreamEventCount,
        previewEvents,
        upstreamText: text,
        upstreamPayload: finalPayload,
        clientText: text,
        clientPayload: finalPayload,
        finishReason,
        usage,
        maxBodyBytes,
      })
    }
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          res.write(Buffer.from(value))
          drainRawSseText(decoder.decode(value, { stream: true }))
        }
      }
      drainRawSseText(decoder.decode())
      updateStreamTrace()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      trace.level = 'warn'
      trace.error = {
        code: 'ai_gateway_error',
        message,
      }
      updateStreamTrace()
      this.recordGatewayLog(
        {
          ...requestContext,
          level: 'warn',
          message: 'Raw Chat Completions stream proxy failed',
          providerId: provider.id,
          providerName: provider.name,
          upstreamUrl: toChatCompletionsUrl(provider.baseUrl),
          model: chatRequest.model,
          stream: true,
          eventCount: upstreamEventCount,
          bodyPreview: message,
        },
        buildUpstreamLogDetails(provider, chatRequest, {
          error: message,
          upstreamEventCount,
        }),
      )
      throw error
    } finally {
      reader.releaseLock()
      res.end()
    }
  }

  private async proxyChatStreamAsAnthropic(provider: AiGatewayProviderConfig, chatRequest: ChatCompletionRequest, requestContext: RequestLogContext, apiTokenOverride: string, trace: GatewayRequestTrace, res: ServerResponse): Promise<void> {
    const response = await this.fetchChatStream(provider, chatRequest, requestContext, trace, apiTokenOverride)
    const messageId = `msg_${randomUUID().replace(/-/g, '')}`
    const streamState = createAnthropicStreamState()
    let finishReason: string | null | undefined
    let upstreamEventCount = 0
    let usage: JsonObject | undefined
    const previewEvents: unknown[] = []
    const maxBodyBytes = this.getConfig().maxBodyBytes ?? AI_GATEWAY_DEFAULT_MAX_BODY_BYTES
    const upstreamTextAccumulator = createLimitedTextAccumulator(maxBodyBytes)
    const clientTextAccumulator = createLimitedTextAccumulator(maxBodyBytes)
    const upstreamToolCallAccumulator = streamCreateChatToolCallTraceAccumulator()
    const clientContentAccumulator = streamCreateAnthropicContentTraceAccumulator()
    const updateStreamTrace = (clientStopReason?: string | null, clientUsage?: unknown): void => {
      const upstreamText = upstreamTextAccumulator.getText()
      const clientText = clientTextAccumulator.getText()
      const resolvedClientStopReason = typeof clientStopReason !== 'undefined' ? clientStopReason : finishReason
      const resolvedClientUsage = typeof clientUsage !== 'undefined' ? clientUsage : usage
      const upstreamPayload = streamBuildChatStreamPayload(chatRequest.model, upstreamText, finishReason, usage, upstreamToolCallAccumulator.snapshot())
      const clientPayload = streamBuildAnthropicMessagePayload({
        id: messageId,
        model: chatRequest.model,
        text: clientText,
        contentBlocks: clientContentAccumulator.snapshot(clientText),
        stopReason: resolvedClientStopReason,
        usage: resolvedClientUsage,
      })
      updateGatewayStreamTrace(trace, {
        requested: chatRequest.stream === true,
        enabled: true,
        upstreamEventCount,
        previewEvents,
        upstreamText,
        upstreamPayload,
        clientText,
        clientPayload,
        finishReason,
        usage: typeof usage !== 'undefined' ? usage : clientUsage,
        maxBodyBytes,
      })
    }

    this.recordGatewayLog({
      ...requestContext,
      level: 'info',
      message: 'Streaming Anthropic response',
      providerId: provider.id,
      providerName: provider.name,
      upstreamUrl: toChatCompletionsUrl(provider.baseUrl),
      model: chatRequest.model,
      stream: true,
      statusCode: 200,
      contentType: response.headers.get('content-type') || '',
    })
    trace.stream = {
      ...(trace.stream ?? { requested: chatRequest.stream === true, enabled: false }),
      enabled: true,
    }
    trace.clientResponse = buildResponseSnapshot({
      statusCode: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      contentType: 'text/event-stream; charset=utf-8',
    })
    trace.statusCode = 200
    writeSseHeaders(res)
    for (const event of createAnthropicStreamStart(messageId, chatRequest.model)) {
      res.write(encodeSseEvent(event.event, event.data))
    }

    try {
      for await (const event of decodeSseStream(response.body!)) {
        if (event.data === '[DONE]') break
        upstreamEventCount += 1
        if (upstreamEventCount <= AI_GATEWAY_MAX_DEBUG_SSE_EVENTS) {
          debugAiGateway(
            'Upstream SSE event preview for Anthropic route',
            buildUpstreamLogDetails(provider, chatRequest, {
              eventName: event.event || '',
              eventIndex: upstreamEventCount,
              dataPreview: event.data,
            }),
          )
        }
        if (previewEvents.length < AI_GATEWAY_MAX_DEBUG_SSE_EVENTS) {
          previewEvents.push({
            event: event.event || 'message',
            data: event.data,
          })
        }
        let chunk: ChatCompletionResponse
        try {
          chunk = JSON.parse(event.data) as ChatCompletionResponse
        } catch {
          this.recordGatewayLog(
            {
              ...requestContext,
              level: 'warn',
              message: 'Failed to parse upstream SSE chunk as JSON for Anthropic route',
              providerId: provider.id,
              providerName: provider.name,
              upstreamUrl: toChatCompletionsUrl(provider.baseUrl),
              model: chatRequest.model,
              stream: true,
              eventCount: upstreamEventCount,
              bodyPreview: event.data,
            },
            buildUpstreamLogDetails(provider, chatRequest, {
              eventName: event.event || '',
              eventIndex: upstreamEventCount,
              dataPreview: event.data,
            }),
          )
          throw new Error('Upstream chat/completions stream emitted an invalid JSON SSE chunk.')
        }
        finishReason = streamExtractFinishReason(chunk) ?? finishReason
        usage = streamExtractUsage(chunk) ?? usage
        upstreamToolCallAccumulator.append(chunk)
        const deltaText = streamExtractDeltaText(chunk)
        const deltaToolCalls = chunk.choices?.[0]?.delta?.tool_calls
        const hasDeltaToolCalls = Array.isArray(deltaToolCalls) && deltaToolCalls.length > 0
        upstreamTextAccumulator.append(deltaText)
        clientTextAccumulator.append(deltaText)
        if (!hasDeltaToolCalls || deltaText.trim()) {
          const mappedChunk = hasDeltaToolCalls
            ? ({
                ...chunk,
                choices: chunk.choices?.map((choice) => ({
                  ...choice,
                  delta: {
                    ...choice.delta,
                    tool_calls: undefined,
                  },
                })),
              } as ChatCompletionResponse)
            : chunk
          for (const mapped of chatStreamChunkToAnthropicEvents(mappedChunk, streamState)) {
            clientContentAccumulator.appendEvent(mapped)
            res.write(encodeSseEvent(mapped.event, mapped.data))
          }
        }
      }
      if (upstreamEventCount === 0) {
        this.recordGatewayLog(
          {
            ...requestContext,
            level: 'warn',
            message: 'Upstream chat/completions stream produced no SSE chunks for Anthropic route',
            providerId: provider.id,
            providerName: provider.name,
            upstreamUrl: toChatCompletionsUrl(provider.baseUrl),
            model: chatRequest.model,
            stream: true,
          },
          buildUpstreamLogDetails(provider, chatRequest),
        )
      }
      const toolCalls = upstreamToolCallAccumulator.snapshot()
      const validationReport = validateChatToolCalls(toolCalls, chatRequest.tools)
      const normalizedToolCalls = validationReport.normalizedToolCalls
      this.applyToolValidationReport(trace, validationReport)
      this.recordToolValidation(provider, requestContext, chatRequest.model, true, validationReport)
      if (!validationReport.valid) {
        const message = toolValidationFailureMessage(validationReport)
        trace.level = 'warn'
        trace.error = {
          code: 'tool_validation_failed',
          message,
        }
        updateStreamTrace()
        res.write(
          encodeSseEvent('error', {
            type: 'error',
            error: {
              type: 'tool_validation_failed',
              message,
            },
          }),
        )
        return
      }
      if (normalizedToolCalls.length > 0) {
        for (const mapped of chatStreamChunkToAnthropicEvents(
          {
            choices: [
              {
                delta: {
                  tool_calls: normalizedToolCalls,
                },
              },
            ],
          },
          streamState,
        )) {
          clientContentAccumulator.appendEvent(mapped)
          res.write(encodeSseEvent(mapped.event, mapped.data))
        }
      }
      const stopEvents = createAnthropicStreamStop(finishReason, usage, streamState)
      for (const event of stopEvents) {
        clientContentAccumulator.appendEvent(event)
        res.write(encodeSseEvent(event.event, event.data))
      }
      const stopMetadata = streamReadAnthropicStopMetadata(stopEvents, finishReason, usage)
      updateStreamTrace(stopMetadata.stopReason, stopMetadata.usage)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      trace.level = 'warn'
      trace.error = {
        code: 'ai_gateway_error',
        message,
      }
      updateStreamTrace()
      this.recordGatewayLog(
        {
          ...requestContext,
          level: 'warn',
          message: 'Anthropic stream proxy failed',
          providerId: provider.id,
          providerName: provider.name,
          upstreamUrl: toChatCompletionsUrl(provider.baseUrl),
          model: chatRequest.model,
          stream: true,
          eventCount: upstreamEventCount,
          bodyPreview: message,
        },
        buildUpstreamLogDetails(provider, chatRequest, {
          error: message,
          upstreamEventCount,
        }),
      )
      res.write(
        encodeSseEvent('error', {
          type: 'error',
          error: {
            type: 'api_error',
            message,
          },
        }),
      )
    } finally {
      res.end()
    }
  }

  private async proxyChatStreamAsResponses(provider: AiGatewayProviderConfig, chatRequest: ChatCompletionRequest, requestContext: RequestLogContext, apiTokenOverride: string, trace: GatewayRequestTrace, res: ServerResponse): Promise<void> {
    const response = await this.fetchChatStream(provider, chatRequest, requestContext, trace, apiTokenOverride)
    const ids = createResponsesStreamIds()
    const responsesStreamState = createResponsesStreamState()
    let fullText = ''
    let upstreamEventCount = 0
    let finishReason: string | null | undefined
    let usage: JsonObject | undefined
    const previewEvents: unknown[] = []
    const maxBodyBytes = this.getConfig().maxBodyBytes ?? AI_GATEWAY_DEFAULT_MAX_BODY_BYTES
    const upstreamToolCallAccumulator = streamCreateChatToolCallTraceAccumulator()
    const updateStreamTrace = (clientPayload?: JsonObject): void => {
      const upstreamPayload = streamBuildChatStreamPayload(chatRequest.model, fullText, finishReason, usage, upstreamToolCallAccumulator.snapshot())
      updateGatewayStreamTrace(trace, {
        requested: chatRequest.stream === true,
        enabled: true,
        upstreamEventCount,
        previewEvents,
        upstreamText: fullText,
        upstreamPayload,
        clientText: fullText,
        clientPayload,
        finishReason,
        usage,
        maxBodyBytes,
      })
    }

    this.recordGatewayLog({
      ...requestContext,
      level: 'info',
      message: 'Streaming Responses response',
      providerId: provider.id,
      providerName: provider.name,
      upstreamUrl: toChatCompletionsUrl(provider.baseUrl),
      model: chatRequest.model,
      stream: true,
      statusCode: 200,
      contentType: response.headers.get('content-type') || '',
    })
    trace.stream = {
      ...(trace.stream ?? { requested: chatRequest.stream === true, enabled: false }),
      enabled: true,
    }
    trace.clientResponse = buildResponseSnapshot({
      statusCode: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      contentType: 'text/event-stream; charset=utf-8',
    })
    trace.statusCode = 200
    writeSseHeaders(res)
    const createdEvent = createResponsesStreamCreated(ids.responseId, chatRequest.model)
    res.write(encodeSseEvent(createdEvent.event, createdEvent.data))

    try {
      for await (const event of decodeSseStream(response.body!)) {
        if (event.data === '[DONE]') break
        upstreamEventCount += 1
        if (upstreamEventCount <= AI_GATEWAY_MAX_DEBUG_SSE_EVENTS) {
          debugAiGateway(
            'Upstream SSE event preview for Responses route',
            buildUpstreamLogDetails(provider, chatRequest, {
              eventName: event.event || '',
              eventIndex: upstreamEventCount,
              dataPreview: event.data,
            }),
          )
        }
        if (previewEvents.length < AI_GATEWAY_MAX_DEBUG_SSE_EVENTS) {
          previewEvents.push({
            event: event.event || 'message',
            data: event.data,
          })
        }
        let chunk: ChatCompletionResponse
        try {
          chunk = JSON.parse(event.data) as ChatCompletionResponse
        } catch {
          this.recordGatewayLog(
            {
              ...requestContext,
              level: 'warn',
              message: 'Failed to parse upstream SSE chunk as JSON for Responses route',
              providerId: provider.id,
              providerName: provider.name,
              upstreamUrl: toChatCompletionsUrl(provider.baseUrl),
              model: chatRequest.model,
              stream: true,
              eventCount: upstreamEventCount,
              bodyPreview: event.data,
            },
            buildUpstreamLogDetails(provider, chatRequest, {
              eventName: event.event || '',
              eventIndex: upstreamEventCount,
              dataPreview: event.data,
            }),
          )
          throw new Error('Upstream chat/completions stream emitted an invalid JSON SSE chunk.')
        }
        finishReason = streamExtractFinishReason(chunk) ?? finishReason
        usage = streamExtractUsage(chunk) ?? usage
        upstreamToolCallAccumulator.append(chunk)
        fullText += streamExtractDeltaText(chunk)
        for (const mapped of chatStreamChunkToResponsesEvents(chunk, responsesStreamState)) {
          res.write(encodeSseEvent(mapped.event, mapped.data))
        }
      }
      if (upstreamEventCount === 0) {
        this.recordGatewayLog(
          {
            ...requestContext,
            level: 'warn',
            message: 'Upstream chat/completions stream produced no SSE chunks for Responses route',
            providerId: provider.id,
            providerName: provider.name,
            upstreamUrl: toChatCompletionsUrl(provider.baseUrl),
            model: chatRequest.model,
            stream: true,
          },
          buildUpstreamLogDetails(provider, chatRequest),
        )
      }
      const validationReport = validateChatToolCalls(upstreamToolCallAccumulator.snapshot(), chatRequest.tools)
      this.applyToolValidationReport(trace, validationReport)
      this.recordToolValidation(provider, requestContext, chatRequest.model, true, validationReport)
      if (!validationReport.valid) {
        const message = toolValidationFailureMessage(validationReport)
        trace.level = 'warn'
        trace.error = {
          code: 'tool_validation_failed',
          message,
        }
        updateStreamTrace()
        res.write(
          encodeSseEvent('response.failed', {
            type: 'response.failed',
            response: {
              id: ids.responseId,
              status: 'failed',
              error: {
                code: 'tool_validation_failed',
                message,
              },
            },
          }),
        )
        return
      }
      const stopEvents = createResponsesStreamFinish(ids.responseId, chatRequest.model, responsesStreamState, usage, finishReason)
      for (const event of stopEvents) {
        res.write(encodeSseEvent(event.event, event.data))
      }
      updateStreamTrace(streamFindResponseCompletedPayload(stopEvents))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      trace.level = 'warn'
      trace.error = {
        code: 'ai_gateway_error',
        message,
      }
      updateStreamTrace()
      this.recordGatewayLog(
        {
          ...requestContext,
          level: 'warn',
          message: 'Responses stream proxy failed',
          providerId: provider.id,
          providerName: provider.name,
          upstreamUrl: toChatCompletionsUrl(provider.baseUrl),
          model: chatRequest.model,
          stream: true,
          eventCount: upstreamEventCount,
          bodyPreview: message,
        },
        buildUpstreamLogDetails(provider, chatRequest, {
          error: message,
          upstreamEventCount,
        }),
      )
      res.write(
        encodeSseEvent('response.failed', {
          type: 'response.failed',
          response: {
            id: ids.responseId,
            status: 'failed',
            error: {
              code: 'ai_gateway_error',
              message,
            },
          },
        }),
      )
    } finally {
      res.end()
    }
  }

  private respondRouteError(res: ServerResponse, kind: RouteKind, requestContext: RequestLogContext, trace: GatewayRequestTrace, error: unknown): void {
    if (res.headersSent) {
      trace.level = 'warn'
      trace.error = {
        code: 'response_already_sent',
        message: error instanceof Error ? error.message : String(error),
      }
      this.finalizeGatewayTrace(trace)
      res.end()
      return
    }
    if (error instanceof Error && error.message === 'REQUEST_BODY_TOO_LARGE') {
      trace.level = 'warn'
      trace.statusCode = 413
      trace.error = {
        code: 'request_body_too_large',
        message: 'request body too large',
      }
      trace.ingressRequest = buildRequestSnapshot({
        method: trace.ingressRequest.method,
        path: trace.ingressRequest.path,
        url: trace.ingressRequest.url,
        query: trace.ingressRequest.query,
        headers: trace.ingressRequest.headers,
        contentType: getContentType({ 'content-type': trace.ingressRequest.headers['content-type'] }),
        maxBodyBytes: this.getConfig().maxBodyBytes ?? AI_GATEWAY_DEFAULT_MAX_BODY_BYTES,
        bodyTruncated: true,
        bodyParseError: 'Request body exceeded the configured limit.',
      })
      trace.clientResponse = buildResponseSnapshot({
        statusCode: 413,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        bodyValue: routeErrorPayload(kind, 'request body too large', 'request_body_too_large'),
        contentType: 'application/json; charset=utf-8',
        maxBodyBytes: this.getConfig().maxBodyBytes ?? AI_GATEWAY_DEFAULT_MAX_BODY_BYTES,
      })
      this.recordGatewayLog({
        ...requestContext,
        level: 'warn',
        message: 'Route request body exceeded the configured limit',
        statusCode: 413,
        errorCode: 'request_body_too_large',
      })
      this.finalizeGatewayTrace(trace)
      jsonResponse(res, 413, routeErrorPayload(kind, 'request body too large', 'request_body_too_large'))
      return
    }
    const statusCode = error instanceof GatewayRouteError ? error.statusCode : 400
    const code = error instanceof GatewayRouteError ? error.code : 'ai_gateway_error'
    const message = error instanceof Error ? error.message : String(error)
    const unsupportedFeature =
      error instanceof UnsupportedGatewayFeatureError && error.kind
        ? {
            kind: error.kind,
            remediation: remediationForUnsupportedFeature(error.kind),
          }
        : undefined
    if (unsupportedFeature) {
      this.updateGatewayTraceProtocolDiagnostics(trace, {
        unsupportedFeature,
      })
    }
    const errorDetails = unsupportedFeature
      ? {
          unsupported_feature: unsupportedFeature.kind,
          ...(unsupportedFeature.remediation ? { remediation: unsupportedFeature.remediation } : {}),
        }
      : undefined
    trace.level = statusCode >= 500 ? 'error' : 'warn'
    trace.statusCode = statusCode
    trace.error = { code, message }
    trace.clientResponse = buildResponseSnapshot({
      statusCode,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      bodyValue: routeErrorPayload(kind, message, code, errorDetails),
      contentType: 'application/json; charset=utf-8',
      maxBodyBytes: this.getConfig().maxBodyBytes ?? AI_GATEWAY_DEFAULT_MAX_BODY_BYTES,
    })
    this.recordGatewayLog(
      {
        ...requestContext,
        level: statusCode >= 500 ? 'error' : 'warn',
        message: `Route ${kind} request failed`,
        statusCode,
        errorCode: code,
        bodyPreview: message,
      },
      {
        statusCode,
        code,
        message,
        requestMethod: requestContext.requestMethod,
        requestPath: requestContext.requestPath,
        route: requestContext.route,
        profileId: requestContext.profileId,
        unsupportedFeature,
      },
    )
    this.finalizeGatewayTrace(trace)
    jsonResponse(res, statusCode, routeErrorPayload(kind, message, code, errorDetails))
  }
}
