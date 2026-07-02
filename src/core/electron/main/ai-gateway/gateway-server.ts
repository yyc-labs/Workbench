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
  ChatCompletionToolCall,
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
import { decodeSseStream, drainSseEvents, encodeSseEvent } from './adapters/sse'
import {
  buildStreamMergedSnapshot,
  createLimitedTextAccumulator,
} from './stream-trace'

type AiGatewayServerOptions = {
  getConfig: () => AiGatewayConfig
  registry: AiGatewayProviderRegistry
  isLogCaptureEnabled?: () => boolean
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

function buildAnthropicAuthHeaders(
  provider: AiGatewayProviderConfig,
  incomingHeaders: Record<string, HeaderValue>,
  apiTokenOverride: string
): { auth: ResolvedUpstreamAuth; headers: Record<string, string> } {
  const auth = resolveUpstreamAuth(provider, apiTokenOverride)
  if (!auth.token) return { auth, headers: {} }

  const incomingAuthorization = getHeaderValue(incomingHeaders, 'authorization')
  const incomingXApiKey = getHeaderValue(incomingHeaders, 'x-api-key')
    || getHeaderValue(incomingHeaders, 'api-key')

  if (auth.source === 'request-token') {
    if (incomingAuthorization && !incomingXApiKey) {
      return {
        auth,
        headers: { authorization: incomingAuthorization },
      }
    }
    return {
      auth,
      headers: { 'x-api-key': auth.token },
    }
  }

  return {
    auth,
    headers: {
      authorization: `Bearer ${auth.token}`,
      'x-api-key': auth.token,
    },
  }
}

function toChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed
  return `${trimmed}/chat/completions`
}

export function toAnthropicMessagesUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (/\/(?:v1\/)?messages$/i.test(trimmed)) return trimmed
  if (/\/v1$/i.test(trimmed)) return `${trimmed}/messages`
  return `${trimmed}/v1/messages`
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

type ChatToolCallTrace = {
  index: number
  id?: string
  type?: string
  functionName?: string
  argumentFragments: string[]
}

type AnthropicTraceContentBlock = {
  index: number
  kind: 'text' | 'tool_use'
  text?: string
  id?: string
  name?: string
  initialInput?: unknown
  inputFragments: string[]
}

function isJsonRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseJsonRecord(value: string): JsonObject | undefined {
  try {
    const parsed = JSON.parse(value) as unknown
    return isJsonRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function getFiniteIndex(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : undefined
}

function createChatToolCallTraceAccumulator(): {
  append(chunk: ChatCompletionResponse): void
  snapshot(): ChatCompletionToolCall[]
} {
  const calls = new Map<number, ChatToolCallTrace>()

  return {
    append(chunk: ChatCompletionResponse): void {
      const deltaToolCalls = chunk.choices?.[0]?.delta?.tool_calls
      if (!Array.isArray(deltaToolCalls)) return

      deltaToolCalls.forEach((toolCall, fallbackIndex) => {
        const index = getFiniteIndex(toolCall.index) ?? fallbackIndex
        const current = calls.get(index) ?? {
          index,
          argumentFragments: [],
        }
        const id = toolCall.id?.trim()
        if (id) current.id = id
        const type = toolCall.type?.trim()
        if (type) current.type = type
        const functionName = toolCall.function?.name?.trim()
        if (functionName) current.functionName = functionName
        const argumentsDelta = toolCall.function?.arguments
        if (typeof argumentsDelta === 'string' && argumentsDelta) {
          current.argumentFragments.push(argumentsDelta)
        }
        calls.set(index, current)
      })
    },
    snapshot(): ChatCompletionToolCall[] {
      return Array.from(calls.values())
        .sort((a, b) => a.index - b.index)
        .filter((call) => Boolean(call.id || call.functionName || call.argumentFragments.length > 0))
        .map((call) => ({
          ...(call.id ? { id: call.id } : {}),
          index: call.index,
          type: call.type || 'function',
          function: {
            ...(call.functionName ? { name: call.functionName } : {}),
            arguments: call.argumentFragments.join(''),
          },
        }))
    },
  }
}

function buildChatStreamPayload(
  model: string,
  text: string,
  finishReason: string | null | undefined,
  usage: JsonObject | undefined,
  toolCalls: ChatCompletionToolCall[] = []
): JsonObject | undefined {
  const hasVisibleText = text.trim().length > 0
  if (!hasVisibleText && toolCalls.length === 0 && typeof finishReason === 'undefined' && typeof usage === 'undefined') return undefined
  return {
    object: 'chat.completion',
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: hasVisibleText ? text : (toolCalls.length > 0 ? null : ''),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finishReason ?? null,
      },
    ],
    usage,
  }
}

function ensureAnthropicTextBlock(
  blocks: Map<number, AnthropicTraceContentBlock>,
  index: number
): AnthropicTraceContentBlock {
  const existing = blocks.get(index)
  if (existing?.kind === 'text') return existing
  const created: AnthropicTraceContentBlock = {
    index,
    kind: 'text',
    text: '',
    inputFragments: [],
  }
  blocks.set(index, created)
  return created
}

function ensureAnthropicToolBlock(
  blocks: Map<number, AnthropicTraceContentBlock>,
  index: number
): AnthropicTraceContentBlock {
  const existing = blocks.get(index)
  if (existing?.kind === 'tool_use') return existing
  const created: AnthropicTraceContentBlock = {
    index,
    kind: 'tool_use',
    inputFragments: [],
  }
  blocks.set(index, created)
  return created
}

function resolveAnthropicToolInput(block: AnthropicTraceContentBlock): { input: unknown; rawInputJson?: string } {
  const rawInputJson = block.inputFragments.join('')
  if (rawInputJson.trim()) {
    try {
      return { input: JSON.parse(rawInputJson) as unknown }
    } catch {
      return {
        input: typeof block.initialInput === 'undefined' ? {} : block.initialInput,
        rawInputJson,
      }
    }
  }
  return {
    input: typeof block.initialInput === 'undefined' ? {} : block.initialInput,
  }
}

function createAnthropicContentTraceAccumulator(): {
  appendEvent(event: { data: string }): void
  appendParsed(parsed: JsonObject | undefined): void
  snapshot(fallbackText?: string): JsonObject[]
} {
  const blocks = new Map<number, AnthropicTraceContentBlock>()
  const appendParsed = (parsed: JsonObject | undefined): void => {
    if (!parsed) return
    const index = getFiniteIndex(parsed.index)

    if (parsed.type === 'content_block_start' && typeof index === 'number') {
      const contentBlock = isJsonRecord(parsed.content_block) ? parsed.content_block : undefined
      if (contentBlock?.type === 'text') {
        const block = ensureAnthropicTextBlock(blocks, index)
        if (typeof contentBlock.text === 'string') {
          block.text = `${block.text || ''}${contentBlock.text}`
        }
        return
      }
      if (contentBlock?.type === 'tool_use') {
        const block = ensureAnthropicToolBlock(blocks, index)
        const id = typeof contentBlock.id === 'string' ? contentBlock.id.trim() : ''
        const name = typeof contentBlock.name === 'string' ? contentBlock.name.trim() : ''
        if (id) block.id = id
        if (name) block.name = name
        if (typeof contentBlock.input !== 'undefined') block.initialInput = contentBlock.input
      }
      return
    }

    if (parsed.type !== 'content_block_delta' || typeof index !== 'number') return
    const delta = isJsonRecord(parsed.delta) ? parsed.delta : undefined
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      const block = ensureAnthropicTextBlock(blocks, index)
      block.text = `${block.text || ''}${delta.text}`
      return
    }
    if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
      const block = ensureAnthropicToolBlock(blocks, index)
      block.inputFragments.push(delta.partial_json)
    }
  }

  return {
    appendEvent(event: { data: string }): void {
      appendParsed(parseJsonRecord(event.data))
    },
    appendParsed,
    snapshot(fallbackText = ''): JsonObject[] {
      const content = Array.from(blocks.values())
        .sort((a, b) => a.index - b.index)
        .flatMap((block): JsonObject[] => {
          if (block.kind === 'text') {
            return block.text?.trim() ? [{ type: 'text', text: block.text }] : []
          }
          const { input, rawInputJson } = resolveAnthropicToolInput(block)
          return [{
            type: 'tool_use',
            id: block.id || `toolu_trace_${block.index}`,
            name: block.name || 'unknown_tool',
            input,
            ...(rawInputJson ? { raw_input_json: rawInputJson } : {}),
          }]
        })

      const hasTextBlock = content.some((block) => block.type === 'text')
      if (!hasTextBlock && fallbackText.trim()) {
        content.unshift({ type: 'text', text: fallbackText })
      }
      return content
    },
  }
}

function buildRawSsePayload(snapshot: StructuredJsonSnapshot | undefined): JsonObject | undefined {
  if (!snapshot?.rawText) return undefined
  return {
    format: 'server-sent-events',
    note: 'Raw SSE captured because this stream route did not produce a final JSON payload.',
    rawText: snapshot.rawText,
    sizeBytes: snapshot.sizeBytes,
    truncated: snapshot.truncated,
  }
}

function findResponseCompletedPayload(events: Array<{ data: string }>): JsonObject | undefined {
  for (const event of events) {
    const parsed = parseJsonRecord(event.data)
    if (parsed?.type === 'response.completed' && isJsonRecord(parsed.response)) {
      return parsed.response
    }
  }
  return undefined
}

function readAnthropicStopMetadata(
  events: Array<{ event?: string; data: string }>,
  fallbackReason: string | null | undefined,
  fallbackUsage: JsonObject | undefined
): { stopReason: string | null | undefined; usage: unknown } {
  let stopReason: string | null | undefined = fallbackReason
  let usage: unknown = fallbackUsage
  for (const event of events) {
    if (event.event !== 'message_delta') continue
    const parsed = parseJsonRecord(event.data)
    const delta = isJsonRecord(parsed?.delta) ? parsed.delta : undefined
    if (typeof delta?.stop_reason === 'string' || delta?.stop_reason === null) {
      stopReason = delta.stop_reason
    }
    if (typeof parsed?.usage !== 'undefined') {
      usage = parsed.usage
    }
  }
  return { stopReason, usage }
}

function buildAnthropicMessagePayload({
  id,
  model,
  text,
  contentBlocks,
  stopReason,
  usage,
}: {
  id: string
  model: string
  text: string
  contentBlocks?: JsonObject[]
  stopReason: string | null | undefined
  usage: unknown
}): JsonObject | undefined {
  const content = contentBlocks && contentBlocks.length > 0
    ? contentBlocks
    : text.trim() || typeof stopReason !== 'undefined' || typeof usage !== 'undefined'
      ? [{ type: 'text', text }]
      : []
  if (content.length === 0 && typeof stopReason === 'undefined' && typeof usage === 'undefined') return undefined
  return {
    id,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: stopReason ?? null,
    stop_sequence: null,
    usage,
  }
}

function readAnthropicPassthroughEvent(
  parsed: JsonObject | undefined
): {
  message?: JsonObject
  textDelta?: string
  stopReason?: string | null
  usage?: unknown
} {
  if (!parsed) return {}
  if (parsed.type === 'message_start' && isJsonRecord(parsed.message)) {
    return { message: parsed.message }
  }
  if (parsed.type === 'content_block_start') {
    const contentBlock = isJsonRecord(parsed.content_block) ? parsed.content_block : undefined
    if (contentBlock?.type === 'text' && typeof contentBlock.text === 'string' && contentBlock.text) {
      return { textDelta: contentBlock.text }
    }
  }
  if (parsed.type === 'content_block_delta') {
    const delta = isJsonRecord(parsed.delta) ? parsed.delta : undefined
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      return { textDelta: delta.text }
    }
  }
  if (parsed.type === 'message_delta') {
    const delta = isJsonRecord(parsed.delta) ? parsed.delta : undefined
    return {
      stopReason: typeof delta?.stop_reason === 'string' || delta?.stop_reason === null
        ? delta.stop_reason
        : undefined,
      usage: parsed.usage,
    }
  }
  return {}
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

function buildAnthropicUpstreamLogDetails(
  provider: AiGatewayProviderConfig,
  request: AnthropicMessagesRequest,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  return {
    providerId: provider.id,
    providerName: provider.name,
    protocol: provider.protocol,
    upstreamUrl: toAnthropicMessagesUrl(provider.baseUrl),
    model: request.model,
    stream: request.stream === true,
    ...extra,
  }
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

  private recordGatewayLog(
    entry: Omit<AiGatewayLogEntry, 'id' | 'timestamp'>,
    consoleDetails?: Record<string, unknown>
  ): void {
    if (!this.isLogCaptureEnabled()) return
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
    if (!this.isLogCaptureEnabled()) return
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
          stream: trace.stream,
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
      const provider = this.registry.getProviderForProfile(profileId)
        ?? this.registry.getProviderForModel(String(payload.model || ''))
      const requestApiToken = profileId ? extractRequestApiToken(req.headers) : ''
      this.updateGatewayTraceIngressBody(trace, rawBody, payload, maxBodyBytes)

      if (provider.protocol === 'openai_chat') {
        const chatRequest = anthropicMessagesToChatCompletion(payload, provider)
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
        return
      }

      if (provider.protocol === 'anthropic_messages') {
        const upstreamRequest = {
          ...payload,
          model: resolveMappedModel(String(payload.model || ''), provider.modelMap),
        }
        if (!upstreamRequest.model) {
          throw new Error('Anthropic request is missing model.')
        }
        this.setGatewayTraceRouteData(trace, provider, upstreamRequest.model, upstreamRequest.stream === true, upstreamRequest, maxBodyBytes)
        this.recordGatewayLog({
          ...requestContext,
          level: 'info',
          message: 'Received Anthropic Messages request for Anthropic upstream passthrough',
          providerId: provider.id,
          providerName: provider.name,
          upstreamUrl: toAnthropicMessagesUrl(provider.baseUrl),
          model: upstreamRequest.model,
          stream: upstreamRequest.stream === true,
        })
        if (upstreamRequest.stream) {
          await this.proxyAnthropicMessagesStream(provider, upstreamRequest, req.headers, requestContext, requestApiToken, trace, res)
          this.finalizeGatewayTrace(trace)
          return
        }
        await this.proxyAnthropicMessagesJson(provider, upstreamRequest, req.headers, requestContext, requestApiToken, trace, res)
        this.finalizeGatewayTrace(trace)
        return
      }

      throw new Error(
        `Provider "${provider.name}" uses ${provider.protocol}; openai_chat or anthropic_messages is required for Anthropic route.`
      )
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

  private async fetchAnthropicMessages(
    provider: AiGatewayProviderConfig,
    payload: AnthropicMessagesRequest,
    incomingHeaders: Record<string, HeaderValue>,
    requestContext: RequestLogContext,
    trace: GatewayRequestTrace | undefined,
    apiTokenOverride = ''
  ): Promise<Response> {
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
      this.recordGatewayLog({
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
      }, buildAnthropicUpstreamLogDetails(provider, payload, {
        authSource: authResult.auth.source,
        hasAuthToken: Boolean(authResult.auth.token),
        timeoutMs,
      }))
      debugAiGateway('Forwarding request to upstream Anthropic Messages', buildAnthropicUpstreamLogDetails(provider, payload, {
        timeoutMs,
      }))
      const response = await fetch(toAnthropicMessagesUrl(provider.baseUrl), {
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
      debugAiGateway('Received upstream Anthropic response headers', buildAnthropicUpstreamLogDetails(provider, payload, {
        status: response.status,
        contentType: response.headers.get('content-type') || '',
      }))
      return response
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error(`Upstream Anthropic request timed out after ${timeoutMs}ms.`)
      }
      this.recordGatewayLog({
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
      }, buildAnthropicUpstreamLogDetails(provider, payload, {
        error: error instanceof Error ? error.message : String(error),
        timeoutMs,
      }))
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  private writePassthroughResponse(
    res: ServerResponse,
    statusCode: number,
    contentType: string,
    bodyText: string
  ): void {
    const headers: Record<string, string | number> = {}
    if (contentType) headers['content-type'] = contentType
    headers['content-length'] = Buffer.byteLength(bodyText)
    res.writeHead(statusCode, headers)
    res.end(bodyText)
  }

  private async proxyAnthropicMessagesJson(
    provider: AiGatewayProviderConfig,
    payload: AnthropicMessagesRequest,
    incomingHeaders: Record<string, HeaderValue>,
    requestContext: RequestLogContext,
    apiTokenOverride: string,
    trace: GatewayRequestTrace,
    res: ServerResponse
  ): Promise<void> {
    const response = await this.fetchAnthropicMessages(provider, { ...payload, stream: false }, incomingHeaders, requestContext, trace, apiTokenOverride)
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
    this.recordGatewayLog({
      ...requestContext,
      level: response.ok ? 'info' : 'warn',
      message: response.ok
        ? 'Returned Anthropic passthrough response'
        : 'Upstream Anthropic passthrough returned non-OK response',
      providerId: provider.id,
      providerName: provider.name,
      upstreamUrl: toAnthropicMessagesUrl(provider.baseUrl),
      model: payload.model,
      stream: false,
      statusCode: response.status,
      contentType,
      bodyPreview: response.ok ? undefined : responseText,
    }, buildAnthropicUpstreamLogDetails(provider, payload, {
      status: response.status,
      contentType,
      bodyPreview: response.ok ? undefined : responseText,
    }))
    this.writePassthroughResponse(res, response.status, contentType, responseText)
  }

  private async proxyAnthropicMessagesStream(
    provider: AiGatewayProviderConfig,
    payload: AnthropicMessagesRequest,
    incomingHeaders: Record<string, HeaderValue>,
    requestContext: RequestLogContext,
    apiTokenOverride: string,
    trace: GatewayRequestTrace,
    res: ServerResponse
  ): Promise<void> {
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
      this.recordGatewayLog({
        ...requestContext,
        level: 'warn',
        message: response.ok
          ? 'Upstream Anthropic stream returned non-SSE response'
          : 'Upstream Anthropic stream returned non-OK response',
        providerId: provider.id,
        providerName: provider.name,
        upstreamUrl: toAnthropicMessagesUrl(provider.baseUrl),
        model: payload.model,
        stream: true,
        statusCode: response.status,
        contentType: resolvedContentType,
        bodyPreview: responseText,
      }, buildAnthropicUpstreamLogDetails(provider, payload, {
        status: response.status,
        contentType: resolvedContentType,
        bodyPreview: responseText,
      }))
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
    const contentAccumulator = createAnthropicContentTraceAccumulator()
    let upstreamMessage: JsonObject | undefined
    let stopReason: string | null | undefined
    let usage: unknown
    const updateStreamTrace = (): void => {
      const text = textAccumulator.getText()
      const payloadSnapshot = buildAnthropicMessagePayload({
        id: typeof upstreamMessage?.id === 'string' ? upstreamMessage.id : 'msg_stream',
        model: typeof upstreamMessage?.model === 'string' ? upstreamMessage.model : payload.model,
        text,
        contentBlocks: contentAccumulator.snapshot(text),
        stopReason,
        usage,
      })
      const merged = buildStreamMergedSnapshot({
        upstreamText: text,
        upstreamPayload: payloadSnapshot,
        clientText: text,
        clientPayload: payloadSnapshot,
        finishReason: stopReason,
        usage,
        maxBodyBytes,
      })
      trace.stream = {
        ...(trace.stream ?? { requested: payload.stream === true, enabled: true }),
        upstreamEventCount,
        previewEvents,
        merged,
      }
    }
    try {
      for await (const event of decodeSseStream(response.body)) {
        upstreamEventCount += 1
        if (previewEvents.length < AI_GATEWAY_MAX_DEBUG_SSE_EVENTS) {
          previewEvents.push({
            event: event.event || 'message',
            data: event.data,
          })
        }
        const parsed = parseJsonRecord(event.data)
        contentAccumulator.appendParsed(parsed)
        const streamEvent = readAnthropicPassthroughEvent(parsed)
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
        res.write(encodeSseEvent(event.event, event.data))
      }
      updateStreamTrace()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      trace.level = 'warn'
      trace.error = {
        code: 'ai_gateway_error',
        message,
      }
      updateStreamTrace()
      this.recordGatewayLog({
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
      }, buildAnthropicUpstreamLogDetails(provider, payload, {
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
    const maxBodyBytes = this.getConfig().maxBodyBytes ?? AI_GATEWAY_DEFAULT_MAX_BODY_BYTES
    const decoder = new TextDecoder()
    const textAccumulator = createLimitedTextAccumulator(maxBodyBytes)
    const toolCallAccumulator = createChatToolCallTraceAccumulator()
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
      const parsed = parseJsonRecord(event.data) as ChatCompletionResponse | undefined
      if (!parsed) return
      finishReason = extractFinishReason(parsed) ?? finishReason
      usage = extractUsage(parsed) ?? usage
      toolCallAccumulator.append(parsed)
      textAccumulator.append(extractDeltaText(parsed))
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
      const rawPayload = buildRawSsePayload(rawSseAccumulator.snapshot())
      const finalPayload = buildChatStreamPayload(
        chatRequest.model,
        text,
        finishReason,
        usage,
        toolCallAccumulator.snapshot()
      ) ?? rawPayload
      const merged = buildStreamMergedSnapshot({
        upstreamText: text,
        upstreamPayload: finalPayload,
        clientText: text,
        clientPayload: finalPayload,
        finishReason,
        usage,
        maxBodyBytes,
      })
      trace.stream = {
        ...(trace.stream ?? { requested: chatRequest.stream === true, enabled: true }),
        upstreamEventCount,
        previewEvents,
        merged,
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
      this.recordGatewayLog({
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
      }, buildUpstreamLogDetails(provider, chatRequest, {
        error: message,
        upstreamEventCount,
      }))
      throw error
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
    const maxBodyBytes = this.getConfig().maxBodyBytes ?? AI_GATEWAY_DEFAULT_MAX_BODY_BYTES
    const upstreamTextAccumulator = createLimitedTextAccumulator(maxBodyBytes)
    const clientTextAccumulator = createLimitedTextAccumulator(maxBodyBytes)
    const upstreamToolCallAccumulator = createChatToolCallTraceAccumulator()
    const clientContentAccumulator = createAnthropicContentTraceAccumulator()
    const updateStreamTrace = (
      clientStopReason?: string | null,
      clientUsage?: unknown
    ): void => {
      const upstreamText = upstreamTextAccumulator.getText()
      const clientText = clientTextAccumulator.getText()
      const resolvedClientStopReason = typeof clientStopReason !== 'undefined'
        ? clientStopReason
        : finishReason
      const resolvedClientUsage = typeof clientUsage !== 'undefined' ? clientUsage : usage
      const upstreamPayload = buildChatStreamPayload(
        chatRequest.model,
        upstreamText,
        finishReason,
        usage,
        upstreamToolCallAccumulator.snapshot()
      )
      const clientPayload = buildAnthropicMessagePayload({
        id: messageId,
        model: chatRequest.model,
        text: clientText,
        contentBlocks: clientContentAccumulator.snapshot(clientText),
        stopReason: resolvedClientStopReason,
        usage: resolvedClientUsage,
      })
      const merged = buildStreamMergedSnapshot({
        upstreamText,
        upstreamPayload,
        clientText,
        clientPayload,
        finishReason,
        usage: typeof usage !== 'undefined' ? usage : clientUsage,
        maxBodyBytes,
      })
      trace.stream = {
        ...(trace.stream ?? { requested: chatRequest.stream === true, enabled: true }),
        upstreamEventCount,
        previewEvents,
        merged,
      }
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
        upstreamToolCallAccumulator.append(chunk)
        const deltaText = extractDeltaText(chunk)
        upstreamTextAccumulator.append(deltaText)
        clientTextAccumulator.append(deltaText)
        for (const mapped of chatStreamChunkToAnthropicEvents(chunk, streamState)) {
          clientContentAccumulator.appendEvent(mapped)
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
      const stopEvents = createAnthropicStreamStop(finishReason, usage, streamState)
      for (const event of stopEvents) {
        clientContentAccumulator.appendEvent(event)
        res.write(encodeSseEvent(event.event, event.data))
      }
      const stopMetadata = readAnthropicStopMetadata(stopEvents, finishReason, usage)
      updateStreamTrace(stopMetadata.stopReason, stopMetadata.usage)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      trace.level = 'warn'
      trace.error = {
        code: 'ai_gateway_error',
        message,
      }
      updateStreamTrace()
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
    let finishReason: string | null | undefined
    let usage: JsonObject | undefined
    const previewEvents: unknown[] = []
    const maxBodyBytes = this.getConfig().maxBodyBytes ?? AI_GATEWAY_DEFAULT_MAX_BODY_BYTES
    const updateStreamTrace = (clientPayload?: JsonObject): void => {
      const upstreamPayload = buildChatStreamPayload(chatRequest.model, fullText, finishReason, usage)
      const merged = buildStreamMergedSnapshot({
        upstreamText: fullText,
        upstreamPayload,
        clientText: fullText,
        clientPayload,
        finishReason,
        usage,
        maxBodyBytes,
      })
      trace.stream = {
        ...(trace.stream ?? { requested: chatRequest.stream === true, enabled: true }),
        upstreamEventCount,
        previewEvents,
        merged,
      }
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
        finishReason = extractFinishReason(chunk) ?? finishReason
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
      const stopEvents = createResponsesStreamStop(ids.responseId, ids.outputItemId, chatRequest.model, fullText, usage)
      for (const event of stopEvents) {
        res.write(encodeSseEvent(event.event, event.data))
      }
      updateStreamTrace(findResponseCompletedPayload(stopEvents))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      trace.level = 'warn'
      trace.error = {
        code: 'ai_gateway_error',
        message,
      }
      updateStreamTrace()
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
