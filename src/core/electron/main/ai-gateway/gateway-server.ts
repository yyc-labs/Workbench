import { randomUUID } from 'crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import type {
  AgentLogLevel,
  AiGatewayConfig,
  AiGatewayLogDetail,
  AiGatewayLogEntry,
  AiGatewayLogRoute,
  AiGatewayProviderConfig,
  StructuredHttpRequestSnapshot,
  StructuredJsonSnapshot,
} from '../../../shared/types'
import {
  buildJsonSnapshot,
  buildRequestSnapshot,
  buildResponseSnapshot,
  hasStructuredTruncation,
} from '../agent-logs/log-snapshots'
import {
  AI_GATEWAY_DEFAULT_MAX_BODY_BYTES,
  getAiGatewayAnthropicBaseUrl,
  getAiGatewayListenUrl,
  getAiGatewayOpenAiBaseUrl,
  normalizeAiGatewayConfig,
} from './gateway-config'
import { AiGatewayProviderRegistry } from './provider-registry'
import type {
  AnthropicMessagesRequest,
  ChatCompletionRequest,
  ChatCompletionResponse,
  JsonObject,
  OpenAiResponsesRequest,
} from './protocol-types'
import { resolveMappedModel, UnsupportedGatewayFeatureError } from './protocol-types'
import { anthropicMessagesToChatCompletion } from './adapters/anthropic-to-chat'
import { responsesToChatCompletion } from './adapters/responses-to-chat'
import {
  chatCompletionToAnthropicMessage,
  chatStreamChunkToAnthropicEvents,
  createAnthropicStreamStart,
  createAnthropicStreamState,
  createAnthropicStreamStop,
} from './adapters/chat-to-anthropic'
import {
  chatCompletionToResponses,
  chatStreamChunkToResponsesEvents,
  createResponsesStreamIds,
  createResponsesStreamStart,
  createResponsesStreamStop,
} from './adapters/chat-to-responses'
import { decodeSseStream, encodeSseEvent } from './adapters/sse'

type AiGatewayServerOptions = {
  getConfig: () => AiGatewayConfig
  registry: AiGatewayProviderRegistry
}

type RouteKind = 'anthropic' | 'responses' | 'chat'

type RoutedPath = {
  path: string
  profileId?: string
}

type RequestLogContext = {
  route: AiGatewayLogRoute
  requestMethod: string
  requestPath: string
  profileId?: string
}

type HeaderValue = string | string[] | undefined
type ResolvedUpstreamAuth = {
  token: string
  source: string
}

type GatewayRequestTrace = {
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
  error?: AiGatewayLogDetail['error']
  statusCode?: number
  finalized: boolean
}

const AI_GATEWAY_DEBUG_ENV = 'IDE_ELECTRON_AI_GATEWAY_DEBUG'
const AI_GATEWAY_LOG_PREVIEW_CHARS = 1200
const AI_GATEWAY_MAX_DEBUG_SSE_EVENTS = 6
const AI_GATEWAY_RECENT_LOG_LIMIT = 200

function jsonResponse(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function emptyResponse(res: ServerResponse, statusCode: number): void {
  res.writeHead(statusCode)
  res.end()
}

function writeSseHeaders(res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  })
}

function routeErrorPayload(kind: RouteKind, message: string, code = 'ai_gateway_error'): JsonObject {
  if (kind === 'anthropic') {
    return {
      type: 'error',
      error: {
        type: code,
        message,
      },
    }
  }

  return {
    error: {
      message,
      type: code,
      code,
    },
  }
}

function routeTitle(route: AiGatewayLogRoute): string {
  if (route === 'anthropic') return 'Anthropic request'
  if (route === 'responses') return 'Responses request'
  if (route === 'chat') return 'Chat Completions request'
  return 'Gateway request'
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

function readRequestBody(req: IncomingMessage, maxBodyBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    let bytes = 0
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk)
      if (bytes > maxBodyBytes) {
        reject(new Error('REQUEST_BODY_TOO_LARGE'))
        req.destroy()
        return
      }
      body += chunk
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function parseJsonBody(rawBody: string): JsonObject {
  if (!rawBody.trim()) return {}
  const parsed = JSON.parse(rawBody) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Request body must be a JSON object.')
  }
  return parsed as JsonObject
}

function getHeaderValue(headers: Record<string, HeaderValue>, name: string): string | undefined {
  const value = headers[name]
  if (Array.isArray(value)) {
    return value.find((item) => typeof item === 'string' && item.trim())?.trim()
  }
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function getContentType(headers: Record<string, HeaderValue>): string | undefined {
  return getHeaderValue(headers, 'content-type')
}

function getResponseContentType(response: Response): string | undefined {
  return response.headers.get('content-type') || undefined
}

export function extractRequestApiToken(headers: Record<string, HeaderValue>): string {
  const headerToken = getHeaderValue(headers, 'x-api-key')
    || getHeaderValue(headers, 'api-key')
  if (headerToken) return headerToken

  const authorization = getHeaderValue(headers, 'authorization')
  if (!authorization) return ''
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i)
  if (bearerMatch?.[1]?.trim()) return bearerMatch[1].trim()
  return authorization
}

function resolveUpstreamAuth(
  provider: AiGatewayProviderConfig,
  apiTokenOverride: string
): ResolvedUpstreamAuth {
  const override = apiTokenOverride.trim()
  if (override) {
    return {
      token: override,
      source: 'request-token',
    }
  }

  const inlineToken = provider.apiKey?.trim()
  if (inlineToken) {
    return {
      token: inlineToken,
      source: 'provider.apiKey',
    }
  }

  const envName = provider.apiKeyEnv?.trim()
  if (envName) {
    return {
      token: (process.env[envName] ?? '').trim(),
      source: `process.env.${envName}`,
    }
  }

  return {
    token: '',
    source: 'none',
  }
}

function toChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed
  return `${trimmed}/chat/completions`
}

function parseRoutedPath(pathname: string): RoutedPath {
  const match = pathname.match(/^\/profiles\/([^/]+)(\/.*)?$/)
  if (!match) return { path: pathname }
  return {
    profileId: decodeURIComponent(match[1] ?? ''),
    path: match[2] || '/',
  }
}

function extractFinishReason(chunk: ChatCompletionResponse): string | null | undefined {
  return chunk.choices?.[0]?.finish_reason
}

function extractUsage(chunk: ChatCompletionResponse): JsonObject | undefined {
  return chunk.usage
}

function extractDeltaText(chunk: ChatCompletionResponse): string {
  const content = chunk.choices?.[0]?.delta?.content
  return typeof content === 'string' ? content : ''
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

async function readResponseText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

function buildUpstreamLogDetails(
  provider: AiGatewayProviderConfig,
  chatRequest: ChatCompletionRequest,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  return {
    providerId: provider.id,
    providerName: provider.name,
    protocol: provider.protocol,
    upstreamUrl: toChatCompletionsUrl(provider.baseUrl),
    model: chatRequest.model,
    stream: chatRequest.stream === true,
    ...extra,
  }
}

export class AiGatewayServer {
  private readonly getConfig: AiGatewayServerOptions['getConfig']
  private readonly registry: AiGatewayProviderRegistry
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

  getActiveEndpoint(): { host: string; port: number; url: string; anthropicBaseUrl: string; openAiBaseUrl: string } {
    const config = this.server
      ? { host: this.activeHost, port: this.activePort }
      : this.getConfig()
    return {
      host: config.host,
      port: config.port,
      url: getAiGatewayListenUrl(config),
      anthropicBaseUrl: getAiGatewayAnthropicBaseUrl(config),
      openAiBaseUrl: getAiGatewayOpenAiBaseUrl(config),
    }
  }

  private appendRecentLog(entry: Omit<AiGatewayLogEntry, 'id' | 'timestamp'>): void {
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
    this.recentLogDetails.unshift(detail)
    if (this.recentLogDetails.length > AI_GATEWAY_RECENT_LOG_LIMIT) {
      this.recentLogDetails = this.recentLogDetails.slice(0, AI_GATEWAY_RECENT_LOG_LIMIT)
    }
  }

  private recordGatewayLog(
    entry: Omit<AiGatewayLogEntry, 'id' | 'timestamp'>,
    consoleDetails?: Record<string, unknown>
  ): void {
    this.appendRecentLog(entry)
    if (entry.level === 'info' && !isAiGatewayDebugEnabled()) return
    logAiGateway(entry.level, entry.message, consoleDetails ?? {
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
      bodyPreview: entry.bodyPreview,
    })
  }

  private beginGatewayTrace(req: IncomingMessage, requestContext: RequestLogContext): GatewayRequestTrace {
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

  private updateGatewayTraceIngressBody(
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
      contentType: trace.ingressRequest.body?.contentType ?? getContentType({ 'content-type': trace.ingressRequest.headers['content-type'] }),
      maxBodyBytes,
    })
  }

  private setGatewayTraceRouteData(
    trace: GatewayRequestTrace,
    provider: AiGatewayProviderConfig,
    model: string,
    requestedStream: boolean,
    normalizedRequest: unknown,
    maxBodyBytes: number
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
    trace.statusCode = requestedStream ? 200 : trace.statusCode
  }

  private finalizeGatewayTrace(trace: GatewayRequestTrace): void {
    if (trace.finalized) return
    trace.finalized = true
    const durationMs = Math.max(0, Date.now() - trace.startedAt)
    trace.meta.requestId = trace.id
    trace.meta.durationMs = durationMs

    const detail: AiGatewayLogDetail = {
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
        truncated: hasStructuredTruncation({
          ingressRequest: trace.ingressRequest,
          normalizedRequest: trace.normalizedRequest,
          upstreamRequest: trace.upstreamRequest,
          upstreamResponse: trace.upstreamResponse,
          clientResponse: trace.clientResponse,
        }),
      },
      meta: trace.meta,
      ingressRequest: trace.ingressRequest,
      normalizedRequest: trace.normalizedRequest,
      upstreamRequest: trace.upstreamRequest,
      upstreamResponse: trace.upstreamResponse,
      clientResponse: trace.clientResponse,
      stream: trace.stream,
      error: trace.error,
    }
    this.appendRecentLogDetail(detail)
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
      await this.handleAnthropicMessages(req, res, maxBodyBytes, routedPath.profileId)
      return
    }
    if (routedPath.path === '/v1/responses' || routedPath.path === '/responses') {
      await this.handleResponses(req, res, maxBodyBytes)
      return
    }
    if (routedPath.path === '/v1/chat/completions' || routedPath.path === '/chat/completions') {
      await this.handleChatCompletions(req, res, maxBodyBytes)
      return
    }

    emptyResponse(res, 404)
  }

  private async handleAnthropicMessages(
    req: IncomingMessage,
    res: ServerResponse,
    maxBodyBytes: number,
    profileId?: string
  ): Promise<void> {
    const requestContext: RequestLogContext = {
      route: 'anthropic',
      requestMethod: req.method || 'POST',
      requestPath: req.url || '/v1/messages',
      profileId,
    }
    const trace = this.beginGatewayTrace(req, requestContext)
    try {
      const rawBody = await readRequestBody(req, maxBodyBytes)
      this.updateGatewayTraceIngressBody(trace, rawBody, undefined, maxBodyBytes)
      const payload = parseJsonBody(rawBody) as AnthropicMessagesRequest
      const provider = this.registry.getProviderForProfile(profileId, 'openai_chat')
        ?? this.registry.getProviderForModel(String(payload.model || ''), 'openai_chat')
      const chatRequest = anthropicMessagesToChatCompletion(payload, provider)
      const requestApiToken = profileId ? extractRequestApiToken(req.headers) : ''
      this.updateGatewayTraceIngressBody(trace, rawBody, payload, maxBodyBytes)
      this.setGatewayTraceRouteData(trace, provider, chatRequest.model, chatRequest.stream === true, chatRequest, maxBodyBytes)
      this.recordGatewayLog({
        ...requestContext,
        level: 'info',
        message: 'Received Anthropic Messages request',
        providerId: provider.id,
        providerName: provider.name,
        upstreamUrl: toChatCompletionsUrl(provider.baseUrl),
        model: chatRequest.model,
        stream: chatRequest.stream === true,
      })
      if (chatRequest.stream) {
        await this.proxyChatStreamAsAnthropic(provider, chatRequest, requestContext, requestApiToken, trace, res)
        this.finalizeGatewayTrace(trace)
        return
      }
      const chatResponse = await this.fetchChatJson(provider, chatRequest, requestContext, trace, requestApiToken)
      this.recordGatewayLog({
        ...requestContext,
        level: 'info',
        message: 'Returned Anthropic message response',
        providerId: provider.id,
        providerName: provider.name,
        upstreamUrl: toChatCompletionsUrl(provider.baseUrl),
        model: chatRequest.model,
        stream: false,
        statusCode: 200,
      })
      const clientPayload = chatCompletionToAnthropicMessage(chatResponse, chatRequest.model)
      trace.clientResponse = buildResponseSnapshot({
        statusCode: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        bodyValue: clientPayload,
        contentType: 'application/json; charset=utf-8',
        maxBodyBytes,
      })
      trace.statusCode = 200
      this.finalizeGatewayTrace(trace)
      jsonResponse(res, 200, clientPayload)
    } catch (error) {
      this.respondRouteError(res, 'anthropic', requestContext, trace, error)
    }
  }

  private async handleResponses(
    req: IncomingMessage,
    res: ServerResponse,
    maxBodyBytes: number
  ): Promise<void> {
    const requestContext: RequestLogContext = {
      route: 'responses',
      requestMethod: req.method || 'POST',
      requestPath: req.url || '/v1/responses',
    }
    const trace = this.beginGatewayTrace(req, requestContext)
    try {
      const rawBody = await readRequestBody(req, maxBodyBytes)
      this.updateGatewayTraceIngressBody(trace, rawBody, undefined, maxBodyBytes)
      const payload = parseJsonBody(rawBody) as OpenAiResponsesRequest
      const provider = this.registry.getProviderForModel(String(payload.model || ''), 'openai_chat')
      const chatRequest = responsesToChatCompletion(payload, provider)
      this.updateGatewayTraceIngressBody(trace, rawBody, payload, maxBodyBytes)
      this.setGatewayTraceRouteData(trace, provider, chatRequest.model, chatRequest.stream === true, chatRequest, maxBodyBytes)
      this.recordGatewayLog({
        ...requestContext,
        level: 'info',
        message: 'Received OpenAI Responses request',
        providerId: provider.id,
        providerName: provider.name,
        upstreamUrl: toChatCompletionsUrl(provider.baseUrl),
        model: chatRequest.model,
        stream: chatRequest.stream === true,
      })
      if (chatRequest.stream) {
        await this.proxyChatStreamAsResponses(provider, chatRequest, requestContext, '', trace, res)
        this.finalizeGatewayTrace(trace)
        return
      }
      const chatResponse = await this.fetchChatJson(provider, chatRequest, requestContext, trace)
      this.recordGatewayLog({
        ...requestContext,
        level: 'info',
        message: 'Returned Responses response',
        providerId: provider.id,
        providerName: provider.name,
        upstreamUrl: toChatCompletionsUrl(provider.baseUrl),
        model: chatRequest.model,
        stream: false,
        statusCode: 200,
      })
      const clientPayload = chatCompletionToResponses(chatResponse, chatRequest.model)
      trace.clientResponse = buildResponseSnapshot({
        statusCode: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        bodyValue: clientPayload,
        contentType: 'application/json; charset=utf-8',
        maxBodyBytes,
      })
      trace.statusCode = 200
      this.finalizeGatewayTrace(trace)
      jsonResponse(res, 200, clientPayload)
    } catch (error) {
      this.respondRouteError(res, 'responses', requestContext, trace, error)
    }
  }

  private async handleChatCompletions(
    req: IncomingMessage,
    res: ServerResponse,
    maxBodyBytes: number
  ): Promise<void> {
    const requestContext: RequestLogContext = {
      route: 'chat',
      requestMethod: req.method || 'POST',
      requestPath: req.url || '/v1/chat/completions',
    }
    const trace = this.beginGatewayTrace(req, requestContext)
    try {
      const rawBody = await readRequestBody(req, maxBodyBytes)
      this.updateGatewayTraceIngressBody(trace, rawBody, undefined, maxBodyBytes)
      const payload = parseJsonBody(rawBody) as ChatCompletionRequest
      const provider = this.registry.getProviderForModel(String(payload.model || ''), 'openai_chat')
      const chatRequest = {
        ...payload,
        model: resolveMappedModel(String(payload.model || ''), provider.modelMap),
      }
      this.updateGatewayTraceIngressBody(trace, rawBody, payload, maxBodyBytes)
      this.setGatewayTraceRouteData(trace, provider, chatRequest.model, chatRequest.stream === true, chatRequest, maxBodyBytes)
      this.recordGatewayLog({
        ...requestContext,
        level: 'info',
        message: 'Received Chat Completions request',
        providerId: provider.id,
        providerName: provider.name,
        upstreamUrl: toChatCompletionsUrl(provider.baseUrl),
        model: chatRequest.model,
        stream: chatRequest.stream === true,
      })
      if (chatRequest.stream === true) {
        await this.proxyChatStreamRaw(provider, chatRequest, requestContext, '', trace, res)
        this.finalizeGatewayTrace(trace)
        return
      }
      const chatResponse = await this.fetchChatJson(provider, chatRequest, requestContext, trace)
      this.recordGatewayLog({
        ...requestContext,
        level: 'info',
        message: 'Returned Chat Completions response',
        providerId: provider.id,
        providerName: provider.name,
        upstreamUrl: toChatCompletionsUrl(provider.baseUrl),
        model: chatRequest.model,
        stream: false,
        statusCode: 200,
      })
      trace.clientResponse = buildResponseSnapshot({
        statusCode: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        bodyValue: chatResponse,
        contentType: 'application/json; charset=utf-8',
        maxBodyBytes,
      })
      trace.statusCode = 200
      this.finalizeGatewayTrace(trace)
      jsonResponse(res, 200, chatResponse)
    } catch (error) {
      this.respondRouteError(res, 'chat', requestContext, trace, error)
    }
  }

  private async fetchChat(
    provider: AiGatewayProviderConfig,
    chatRequest: ChatCompletionRequest,
    requestContext: RequestLogContext,
    trace?: GatewayRequestTrace,
    apiTokenOverride = ''
  ): Promise<Response> {
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
      this.recordGatewayLog({
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
      }, buildUpstreamLogDetails(provider, chatRequest, {
        authSource: auth.source,
        hasAuthToken: Boolean(auth.token),
        timeoutMs,
      }))
      debugAiGateway('Forwarding request to upstream chat/completions', buildUpstreamLogDetails(provider, chatRequest, {
        timeoutMs,
      }))
      const response = await fetch(toChatCompletionsUrl(provider.baseUrl), {
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
      debugAiGateway('Received upstream response headers', buildUpstreamLogDetails(provider, chatRequest, {
        status: response.status,
        contentType: response.headers.get('content-type') || '',
      }))
      return response
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error(`Upstream request timed out after ${timeoutMs}ms.`)
      }
      this.recordGatewayLog({
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
      }, buildUpstreamLogDetails(provider, chatRequest, {
        error: error instanceof Error ? error.message : String(error),
        timeoutMs,
      }))
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  private async fetchChatJson(
    provider: AiGatewayProviderConfig,
    chatRequest: ChatCompletionRequest,
    requestContext: RequestLogContext,
    trace?: GatewayRequestTrace,
    apiTokenOverride = ''
  ): Promise<ChatCompletionResponse> {
    const response = await this.fetchChat(
      provider,
      { ...chatRequest, stream: false },
      requestContext,
      trace,
      apiTokenOverride,
    )
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
      this.recordGatewayLog({
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
      }, buildUpstreamLogDetails(provider, chatRequest, {
        status: response.status,
        contentType: response.headers.get('content-type') || '',
        bodyPreview: responseText,
      }))
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
      this.recordGatewayLog({
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
      }, buildUpstreamLogDetails(provider, chatRequest, {
        status: response.status,
        contentType: response.headers.get('content-type') || '',
        bodyPreview: responseText,
      }))
      throw new Error('Upstream chat/completions returned invalid JSON.')
    }
  }

  private async fetchChatStream(
    provider: AiGatewayProviderConfig,
    chatRequest: ChatCompletionRequest,
    requestContext: RequestLogContext,
    trace?: GatewayRequestTrace,
    apiTokenOverride = ''
  ): Promise<Response> {
    const response = await this.fetchChat(
      provider,
      { ...chatRequest, stream: true },
      requestContext,
      trace,
      apiTokenOverride,
    )
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
      this.recordGatewayLog({
        ...requestContext,
        level: 'warn',
        message: 'Upstream chat/completions stream returned non-OK response',
        providerId: provider.id,
        providerName: provider.name,
        upstreamUrl: toChatCompletionsUrl(provider.baseUrl),
        model: chatRequest.model,
        stream: true,
        statusCode: response.status,
        contentType: response.headers.get('content-type') || '',
        bodyPreview: responseText,
      }, buildUpstreamLogDetails(provider, chatRequest, {
        status: response.status,
        contentType: response.headers.get('content-type') || '',
        bodyPreview: responseText,
      }))
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
      this.recordGatewayLog({
        ...requestContext,
        level: 'warn',
        message: 'Upstream chat/completions stream returned empty body',
        providerId: provider.id,
        providerName: provider.name,
        upstreamUrl: toChatCompletionsUrl(provider.baseUrl),
        model: chatRequest.model,
        stream: true,
        statusCode: response.status,
        contentType: response.headers.get('content-type') || '',
      }, buildUpstreamLogDetails(provider, chatRequest, {
        status: response.status,
        contentType: response.headers.get('content-type') || '',
      }))
      throw new Error('Upstream chat/completions stream returned an empty body.')
    }
    const contentType = response.headers.get('content-type') || ''
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
      this.recordGatewayLog({
        ...requestContext,
        level: 'warn',
        message: 'Upstream chat/completions stream returned non-SSE content-type',
        providerId: provider.id,
        providerName: provider.name,
        upstreamUrl: toChatCompletionsUrl(provider.baseUrl),
        model: chatRequest.model,
        stream: true,
        statusCode: response.status,
        contentType,
        bodyPreview: responseText,
      }, buildUpstreamLogDetails(provider, chatRequest, {
        status: response.status,
        contentType,
        bodyPreview: responseText,
      }))
      throw new Error(
        responseText
        || `Upstream chat/completions stream returned content-type "${contentType || 'unknown'}" instead of text/event-stream.`
      )
    }
    if (trace) {
      trace.upstreamResponse = buildResponseSnapshot({
        statusCode: response.status,
        headers: response.headers,
        contentType,
      })
    }
    return response
  }

  private async proxyChatStreamRaw(
    provider: AiGatewayProviderConfig,
    chatRequest: ChatCompletionRequest,
    requestContext: RequestLogContext,
    apiTokenOverride: string,
    trace: GatewayRequestTrace,
    res: ServerResponse
  ): Promise<void> {
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
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) res.write(Buffer.from(value))
      }
    } finally {
      reader.releaseLock()
      res.end()
    }
  }

  private async proxyChatStreamAsAnthropic(
    provider: AiGatewayProviderConfig,
    chatRequest: ChatCompletionRequest,
    requestContext: RequestLogContext,
    apiTokenOverride: string,
    trace: GatewayRequestTrace,
    res: ServerResponse
  ): Promise<void> {
    const response = await this.fetchChatStream(provider, chatRequest, requestContext, trace, apiTokenOverride)
    const messageId = `msg_${randomUUID().replace(/-/g, '')}`
    const streamState = createAnthropicStreamState()
    let finishReason: string | null | undefined
    let upstreamEventCount = 0
    let usage: JsonObject | undefined
    const previewEvents: unknown[] = []

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
          debugAiGateway('Upstream SSE event preview for Anthropic route', buildUpstreamLogDetails(provider, chatRequest, {
            eventName: event.event || '',
            eventIndex: upstreamEventCount,
            dataPreview: event.data,
          }))
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
          this.recordGatewayLog({
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
          }, buildUpstreamLogDetails(provider, chatRequest, {
            eventName: event.event || '',
            eventIndex: upstreamEventCount,
            dataPreview: event.data,
          }))
          throw new Error('Upstream chat/completions stream emitted an invalid JSON SSE chunk.')
        }
        finishReason = extractFinishReason(chunk) ?? finishReason
        usage = extractUsage(chunk) ?? usage
        for (const mapped of chatStreamChunkToAnthropicEvents(chunk, streamState)) {
          res.write(encodeSseEvent(mapped.event, mapped.data))
        }
      }
      if (upstreamEventCount === 0) {
        this.recordGatewayLog({
          ...requestContext,
          level: 'warn',
          message: 'Upstream chat/completions stream produced no SSE chunks for Anthropic route',
          providerId: provider.id,
          providerName: provider.name,
          upstreamUrl: toChatCompletionsUrl(provider.baseUrl),
          model: chatRequest.model,
          stream: true,
        }, buildUpstreamLogDetails(provider, chatRequest))
      }
      for (const event of createAnthropicStreamStop(finishReason, usage, streamState)) {
        res.write(encodeSseEvent(event.event, event.data))
      }
      trace.stream = {
        ...(trace.stream ?? { requested: chatRequest.stream === true, enabled: true }),
        upstreamEventCount,
        previewEvents,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      trace.level = 'warn'
      trace.error = {
        code: 'ai_gateway_error',
        message,
      }
      trace.stream = {
        ...(trace.stream ?? { requested: chatRequest.stream === true, enabled: true }),
        upstreamEventCount,
        previewEvents,
      }
      this.recordGatewayLog({
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
      }, buildUpstreamLogDetails(provider, chatRequest, {
        error: message,
        upstreamEventCount,
      }))
      res.write(encodeSseEvent('error', {
        type: 'error',
        error: {
          type: 'api_error',
          message,
        },
      }))
    } finally {
      res.end()
    }
  }

  private async proxyChatStreamAsResponses(
    provider: AiGatewayProviderConfig,
    chatRequest: ChatCompletionRequest,
    requestContext: RequestLogContext,
    apiTokenOverride: string,
    trace: GatewayRequestTrace,
    res: ServerResponse
  ): Promise<void> {
    const response = await this.fetchChatStream(provider, chatRequest, requestContext, trace, apiTokenOverride)
    const ids = createResponsesStreamIds()
    let fullText = ''
    let upstreamEventCount = 0
    let usage: JsonObject | undefined
    const previewEvents: unknown[] = []

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
    for (const event of createResponsesStreamStart(ids.responseId, ids.outputItemId, chatRequest.model)) {
      res.write(encodeSseEvent(event.event, event.data))
    }

    try {
      for await (const event of decodeSseStream(response.body!)) {
        if (event.data === '[DONE]') break
        upstreamEventCount += 1
        if (upstreamEventCount <= AI_GATEWAY_MAX_DEBUG_SSE_EVENTS) {
          debugAiGateway('Upstream SSE event preview for Responses route', buildUpstreamLogDetails(provider, chatRequest, {
            eventName: event.event || '',
            eventIndex: upstreamEventCount,
            dataPreview: event.data,
          }))
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
          this.recordGatewayLog({
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
          }, buildUpstreamLogDetails(provider, chatRequest, {
            eventName: event.event || '',
            eventIndex: upstreamEventCount,
            dataPreview: event.data,
          }))
          throw new Error('Upstream chat/completions stream emitted an invalid JSON SSE chunk.')
        }
        usage = extractUsage(chunk) ?? usage
        fullText += extractDeltaText(chunk)
        for (const mapped of chatStreamChunkToResponsesEvents(chunk, ids.outputItemId)) {
          res.write(encodeSseEvent(mapped.event, mapped.data))
        }
      }
      if (upstreamEventCount === 0) {
        this.recordGatewayLog({
          ...requestContext,
          level: 'warn',
          message: 'Upstream chat/completions stream produced no SSE chunks for Responses route',
          providerId: provider.id,
          providerName: provider.name,
          upstreamUrl: toChatCompletionsUrl(provider.baseUrl),
          model: chatRequest.model,
          stream: true,
        }, buildUpstreamLogDetails(provider, chatRequest))
      }
      for (const event of createResponsesStreamStop(ids.responseId, ids.outputItemId, chatRequest.model, fullText, usage)) {
        res.write(encodeSseEvent(event.event, event.data))
      }
      trace.stream = {
        ...(trace.stream ?? { requested: chatRequest.stream === true, enabled: true }),
        upstreamEventCount,
        previewEvents,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      trace.level = 'warn'
      trace.error = {
        code: 'ai_gateway_error',
        message,
      }
      trace.stream = {
        ...(trace.stream ?? { requested: chatRequest.stream === true, enabled: true }),
        upstreamEventCount,
        previewEvents,
      }
      this.recordGatewayLog({
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
      }, buildUpstreamLogDetails(provider, chatRequest, {
        error: message,
        upstreamEventCount,
      }))
      res.write(encodeSseEvent('response.failed', {
        type: 'response.failed',
        response: {
          id: ids.responseId,
          status: 'failed',
          error: {
            code: 'ai_gateway_error',
            message,
          },
        },
      }))
    } finally {
      res.end()
    }
  }

  private respondRouteError(
    res: ServerResponse,
    kind: RouteKind,
    requestContext: RequestLogContext,
    trace: GatewayRequestTrace,
    error: unknown
  ): void {
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
    const statusCode = error instanceof UnsupportedGatewayFeatureError ? error.statusCode : 400
    const code = error instanceof UnsupportedGatewayFeatureError ? error.code : 'ai_gateway_error'
    const message = error instanceof Error ? error.message : String(error)
    trace.level = statusCode >= 500 ? 'error' : 'warn'
    trace.statusCode = statusCode
    trace.error = { code, message }
    trace.clientResponse = buildResponseSnapshot({
      statusCode,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      bodyValue: routeErrorPayload(kind, message, code),
      contentType: 'application/json; charset=utf-8',
      maxBodyBytes: this.getConfig().maxBodyBytes ?? AI_GATEWAY_DEFAULT_MAX_BODY_BYTES,
    })
    this.recordGatewayLog({
      ...requestContext,
      level: statusCode >= 500 ? 'error' : 'warn',
      message: `Route ${kind} request failed`,
      statusCode,
      errorCode: code,
      bodyPreview: message,
    }, {
      statusCode,
      code,
      message,
      requestMethod: requestContext.requestMethod,
      requestPath: requestContext.requestPath,
      route: requestContext.route,
      profileId: requestContext.profileId,
    })
    this.finalizeGatewayTrace(trace)
    jsonResponse(res, statusCode, routeErrorPayload(kind, message, code))
  }
}
