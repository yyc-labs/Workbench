import type { IncomingMessage, ServerResponse } from 'http'
import type {
  AiGatewayLogEntry,
  AiGatewayProviderConfig,
} from '../../../shared/types'
import { buildResponseSnapshot } from '../agent-logs/log-snapshots'
import { jsonResponse, parseJsonBody, readRequestBody, type HeaderValue } from './gateway-http'
import { AiGatewayProviderRegistry } from './provider-registry'
import type {
  AnthropicMessagesRequest,
  ChatCompletionRequest,
  ChatCompletionResponse,
  OpenAiResponsesRequest,
} from './protocol-types'
import {
  GatewayRouteError,
  hasNonEmptyObject,
  resolveMappedModel,
  UnsupportedGatewayFeatureError,
} from './protocol-types'
import { anthropicMessagesToChatCompletion } from './adapters/anthropic-to-chat'
import { responsesToChatCompletion } from './adapters/responses-to-chat'
import { chatCompletionToAnthropicMessage } from './adapters/chat-to-anthropic'
import { chatCompletionToResponses } from './adapters/chat-to-responses'
import {
  assertToolValidationPassed,
  validateChatCompletionToolCalls,
  type ToolValidationReport,
} from './tool-validation'
import type { GatewayRequestTrace, RequestLogContext } from './gateway-trace'
import {
  extractRequestApiToken,
  toAnthropicMessagesUrl,
  toChatCompletionsUrl,
  toResponsesUrl,
} from './gateway-upstream'

type GatewayLogEntryInput = Omit<AiGatewayLogEntry, 'id' | 'timestamp'>

export type GatewayRouteHandlerDependencies = {
  registry: AiGatewayProviderRegistry
  beginGatewayTrace: (req: IncomingMessage, requestContext: RequestLogContext) => GatewayRequestTrace
  updateGatewayTraceIngressBody: (
    trace: GatewayRequestTrace,
    rawBody: string,
    parsedBody: unknown | undefined,
    maxBodyBytes: number
  ) => void
  setGatewayTraceRouteData: (
    trace: GatewayRequestTrace,
    provider: AiGatewayProviderConfig,
    model: string,
    requestedStream: boolean,
    normalizedRequest: unknown,
    maxBodyBytes: number,
    diagnostics?: {
      conversion?: 'passthrough' | 'lossy_conversion'
      lossyWarnings?: string[]
    }
  ) => void
  applyToolValidationReport: (trace: GatewayRequestTrace, report: ToolValidationReport) => void
  recordToolValidation: (
    provider: AiGatewayProviderConfig,
    requestContext: RequestLogContext,
    model: string,
    stream: boolean,
    report: ToolValidationReport
  ) => void
  finalizeGatewayTrace: (trace: GatewayRequestTrace) => void
  recordGatewayLog: (
    entry: GatewayLogEntryInput,
    consoleDetails?: Record<string, unknown>
  ) => void
  respondRouteError: (
    res: ServerResponse,
    kind: 'anthropic' | 'responses' | 'chat',
    requestContext: RequestLogContext,
    trace: GatewayRequestTrace,
    error: unknown
  ) => void
  fetchChatJson: (
    provider: AiGatewayProviderConfig,
    chatRequest: ChatCompletionRequest,
    requestContext: RequestLogContext,
    trace?: GatewayRequestTrace,
    apiTokenOverride?: string
  ) => Promise<ChatCompletionResponse>
  proxyChatStreamAsAnthropic: (
    provider: AiGatewayProviderConfig,
    chatRequest: ChatCompletionRequest,
    requestContext: RequestLogContext,
    apiTokenOverride: string,
    trace: GatewayRequestTrace,
    res: ServerResponse
  ) => Promise<void>
  proxyAnthropicMessagesStream: (
    provider: AiGatewayProviderConfig,
    payload: AnthropicMessagesRequest,
    incomingHeaders: Record<string, HeaderValue>,
    requestContext: RequestLogContext,
    apiTokenOverride: string,
    trace: GatewayRequestTrace,
    res: ServerResponse
  ) => Promise<void>
  proxyAnthropicMessagesJson: (
    provider: AiGatewayProviderConfig,
    payload: AnthropicMessagesRequest,
    incomingHeaders: Record<string, HeaderValue>,
    requestContext: RequestLogContext,
    apiTokenOverride: string,
    trace: GatewayRequestTrace,
    res: ServerResponse
  ) => Promise<void>
  proxyResponsesStream: (
    provider: AiGatewayProviderConfig,
    payload: OpenAiResponsesRequest,
    requestContext: RequestLogContext,
    trace: GatewayRequestTrace,
    res: ServerResponse
  ) => Promise<void>
  proxyResponsesJson: (
    provider: AiGatewayProviderConfig,
    payload: OpenAiResponsesRequest,
    requestContext: RequestLogContext,
    trace: GatewayRequestTrace,
    res: ServerResponse
  ) => Promise<void>
  proxyChatStreamAsResponses: (
    provider: AiGatewayProviderConfig,
    chatRequest: ChatCompletionRequest,
    requestContext: RequestLogContext,
    apiTokenOverride: string,
    trace: GatewayRequestTrace,
    res: ServerResponse
  ) => Promise<void>
  proxyChatStreamRaw: (
    provider: AiGatewayProviderConfig,
    chatRequest: ChatCompletionRequest,
    requestContext: RequestLogContext,
    apiTokenOverride: string,
    trace: GatewayRequestTrace,
    res: ServerResponse
  ) => Promise<void>
}

function buildRequestContext(
  route: RequestLogContext['route'],
  req: IncomingMessage,
  requestPath: string,
  profileId?: string
): RequestLogContext {
  return {
    route,
    requestMethod: req.method || 'POST',
    requestPath: req.url || requestPath,
    profileId,
  }
}

export async function handleAnthropicMessagesRoute(
  req: IncomingMessage,
  res: ServerResponse,
  maxBodyBytes: number,
  deps: GatewayRouteHandlerDependencies,
  profileId?: string
): Promise<void> {
  const requestContext = buildRequestContext('anthropic', req, '/v1/messages', profileId)
  const trace = deps.beginGatewayTrace(req, requestContext)
  try {
    const rawBody = await readRequestBody(req, maxBodyBytes)
    deps.updateGatewayTraceIngressBody(trace, rawBody, undefined, maxBodyBytes)
    const payload = parseJsonBody(rawBody) as AnthropicMessagesRequest
    const provider = deps.registry.getProviderForProfile(profileId)
      ?? deps.registry.getProviderForModel(String(payload.model || ''))
    const requestApiToken = profileId ? extractRequestApiToken(req.headers) : ''
    deps.updateGatewayTraceIngressBody(trace, rawBody, payload, maxBodyBytes)

    if (provider.protocol === 'openai_chat') {
      if (payload.stream === true && provider.capabilities?.supportsStreaming === false) {
        throw new UnsupportedGatewayFeatureError(`Provider "${provider.name}" does not support streaming.`)
      }
      if (Array.isArray(payload.tools) && payload.tools.length > 0 && provider.capabilities?.supportsTools === false) {
        throw new UnsupportedGatewayFeatureError(`Provider "${provider.name}" does not support tools.`)
      }
      const chatRequest = anthropicMessagesToChatCompletion(payload, provider)
      if (chatRequest.parallel_tool_calls === true && provider.capabilities?.supportsParallelToolCalls === false) {
        throw new UnsupportedGatewayFeatureError(`Provider "${provider.name}" does not support parallel tool calls.`)
      }
      deps.setGatewayTraceRouteData(trace, provider, chatRequest.model, chatRequest.stream === true, chatRequest, maxBodyBytes, {
        conversion: 'lossy_conversion',
        lossyWarnings: [
          'Anthropic Messages to OpenAI Chat is a lossy conversion; provider tool-use prompting and content-block semantics are not equivalent.',
        ],
      })
      deps.recordGatewayLog({
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
        await deps.proxyChatStreamAsAnthropic(provider, chatRequest, requestContext, requestApiToken, trace, res)
        deps.finalizeGatewayTrace(trace)
        return
      }
      const chatResponse = await deps.fetchChatJson(provider, chatRequest, requestContext, trace, requestApiToken)
      deps.recordGatewayLog({
        ...requestContext,
        level: 'info',
        message: 'Received upstream Chat response for Anthropic conversion',
        providerId: provider.id,
        providerName: provider.name,
        upstreamUrl: toChatCompletionsUrl(provider.baseUrl),
        model: chatRequest.model,
        stream: false,
        statusCode: 200,
      })
      const validationReport = validateChatCompletionToolCalls(chatResponse, chatRequest.tools)
      deps.applyToolValidationReport(trace, validationReport)
      deps.recordToolValidation(provider, requestContext, chatRequest.model, false, validationReport)
      assertToolValidationPassed(validationReport)
      const clientPayload = chatCompletionToAnthropicMessage(chatResponse, chatRequest.model)
      trace.clientResponse = buildResponseSnapshot({
        statusCode: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        bodyValue: clientPayload,
        contentType: 'application/json; charset=utf-8',
        maxBodyBytes,
      })
      trace.statusCode = 200
      deps.finalizeGatewayTrace(trace)
      jsonResponse(res, 200, clientPayload)
      return
    }

    if (provider.protocol === 'anthropic_messages') {
      if (payload.stream === true && provider.capabilities?.supportsStreaming === false) {
        throw new UnsupportedGatewayFeatureError(`Provider "${provider.name}" does not support streaming.`)
      }
      const upstreamRequest = {
        ...payload,
        model: resolveMappedModel(String(payload.model || ''), provider.modelMap),
      }
      if (!upstreamRequest.model) {
        throw new Error('Anthropic request is missing model.')
      }
      deps.setGatewayTraceRouteData(trace, provider, upstreamRequest.model, upstreamRequest.stream === true, upstreamRequest, maxBodyBytes, {
        conversion: 'passthrough',
      })
      deps.recordGatewayLog({
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
        await deps.proxyAnthropicMessagesStream(
          provider,
          upstreamRequest,
          req.headers,
          requestContext,
          requestApiToken,
          trace,
          res
        )
        deps.finalizeGatewayTrace(trace)
        return
      }
      await deps.proxyAnthropicMessagesJson(
        provider,
        upstreamRequest,
        req.headers,
        requestContext,
        requestApiToken,
        trace,
        res
      )
      deps.finalizeGatewayTrace(trace)
      return
    }

    throw new Error(
      `Provider "${provider.name}" uses ${provider.protocol}; openai_chat or anthropic_messages is required for Anthropic route.`
    )
  } catch (error) {
    deps.respondRouteError(res, 'anthropic', requestContext, trace, error)
  }
}

export async function handleResponsesRoute(
  req: IncomingMessage,
  res: ServerResponse,
  maxBodyBytes: number,
  deps: GatewayRouteHandlerDependencies
): Promise<void> {
  const requestContext = buildRequestContext('responses', req, '/v1/responses')
  const trace = deps.beginGatewayTrace(req, requestContext)
  try {
    const rawBody = await readRequestBody(req, maxBodyBytes)
    deps.updateGatewayTraceIngressBody(trace, rawBody, undefined, maxBodyBytes)
    const payload = parseJsonBody(rawBody) as OpenAiResponsesRequest
    const provider = deps.registry.getProviderForModel(String(payload.model || ''))
    deps.updateGatewayTraceIngressBody(trace, rawBody, payload, maxBodyBytes)

    if (provider.protocol === 'openai_responses') {
      if (payload.stream === true && provider.capabilities?.supportsStreaming === false) {
        throw new UnsupportedGatewayFeatureError(`Provider "${provider.name}" does not support streaming.`)
      }
      if (Array.isArray(payload.tools) && payload.tools.length > 0 && provider.capabilities?.supportsTools === false) {
        throw new UnsupportedGatewayFeatureError(`Provider "${provider.name}" does not support Responses tools.`)
      }
      if (hasNonEmptyObject(payload.reasoning) && provider.capabilities?.supportsReasoning === false) {
        throw new UnsupportedGatewayFeatureError(`Provider "${provider.name}" does not support Responses reasoning.`)
      }
      const upstreamRequest = {
        ...payload,
        model: resolveMappedModel(String(payload.model || ''), provider.modelMap),
      }
      if (!upstreamRequest.model) {
        throw new Error('Responses request is missing model.')
      }
      deps.setGatewayTraceRouteData(trace, provider, upstreamRequest.model, upstreamRequest.stream === true, upstreamRequest, maxBodyBytes, {
        conversion: 'passthrough',
      })
      deps.recordGatewayLog({
        ...requestContext,
        level: 'info',
        message: 'Received OpenAI Responses request for native upstream passthrough',
        providerId: provider.id,
        providerName: provider.name,
        upstreamUrl: toResponsesUrl(provider.baseUrl),
        model: upstreamRequest.model,
        stream: upstreamRequest.stream === true,
      })
      if (upstreamRequest.stream) {
        await deps.proxyResponsesStream(provider, upstreamRequest, requestContext, trace, res)
        deps.finalizeGatewayTrace(trace)
        return
      }
      await deps.proxyResponsesJson(provider, upstreamRequest, requestContext, trace, res)
      deps.finalizeGatewayTrace(trace)
      return
    }

    if (provider.protocol === 'openai_chat') {
      if (payload.stream === true && provider.capabilities?.supportsStreaming === false) {
        throw new UnsupportedGatewayFeatureError(`Provider "${provider.name}" does not support streaming.`)
      }
      const chatRequest = responsesToChatCompletion(payload, provider)
      deps.setGatewayTraceRouteData(trace, provider, chatRequest.model, chatRequest.stream === true, chatRequest, maxBodyBytes, {
        conversion: 'lossy_conversion',
        lossyWarnings: [
          'OpenAI Responses to Chat Completions is a downgrade path; Responses tools, reasoning, and rich output items are not preserved.',
        ],
      })
      deps.recordGatewayLog({
        ...requestContext,
        level: 'info',
        message: 'Received OpenAI Responses request for Chat downgrade',
        providerId: provider.id,
        providerName: provider.name,
        upstreamUrl: toChatCompletionsUrl(provider.baseUrl),
        model: chatRequest.model,
        stream: chatRequest.stream === true,
      })
      if (chatRequest.stream) {
        await deps.proxyChatStreamAsResponses(provider, chatRequest, requestContext, '', trace, res)
        deps.finalizeGatewayTrace(trace)
        return
      }
      const chatResponse = await deps.fetchChatJson(provider, chatRequest, requestContext, trace)
      deps.recordGatewayLog({
        ...requestContext,
        level: 'info',
        message: 'Returned Responses response from Chat downgrade',
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
      deps.finalizeGatewayTrace(trace)
      jsonResponse(res, 200, clientPayload)
      return
    }

    throw new Error(
      `Provider "${provider.name}" uses ${provider.protocol}; openai_responses or openai_chat is required for Responses route.`
    )
  } catch (error) {
    deps.respondRouteError(res, 'responses', requestContext, trace, error)
  }
}

export async function handleChatCompletionsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  maxBodyBytes: number,
  deps: GatewayRouteHandlerDependencies
): Promise<void> {
  const requestContext = buildRequestContext('chat', req, '/v1/chat/completions')
  const trace = deps.beginGatewayTrace(req, requestContext)
  try {
    const rawBody = await readRequestBody(req, maxBodyBytes)
    deps.updateGatewayTraceIngressBody(trace, rawBody, undefined, maxBodyBytes)
    const payload = parseJsonBody(rawBody) as ChatCompletionRequest
    const provider = deps.registry.getProviderForModel(String(payload.model || ''), 'openai_chat')
    if (payload.stream === true && provider.capabilities?.supportsStreaming === false) {
      throw new UnsupportedGatewayFeatureError(`Provider "${provider.name}" does not support streaming.`)
    }
    if (Array.isArray(payload.tools) && payload.tools.length > 0 && provider.capabilities?.supportsTools === false) {
      throw new UnsupportedGatewayFeatureError(`Provider "${provider.name}" does not support tools.`)
    }
    if (payload.parallel_tool_calls === true && provider.capabilities?.supportsParallelToolCalls === false) {
      throw new UnsupportedGatewayFeatureError(`Provider "${provider.name}" does not support parallel tool calls.`)
    }
    const chatRequest = {
      ...payload,
      model: resolveMappedModel(String(payload.model || ''), provider.modelMap),
    }
    deps.updateGatewayTraceIngressBody(trace, rawBody, payload, maxBodyBytes)
    deps.setGatewayTraceRouteData(trace, provider, chatRequest.model, chatRequest.stream === true, chatRequest, maxBodyBytes, {
      conversion: 'passthrough',
    })
    deps.recordGatewayLog({
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
      await deps.proxyChatStreamRaw(provider, chatRequest, requestContext, '', trace, res)
      deps.finalizeGatewayTrace(trace)
      return
    }
    const chatResponse = await deps.fetchChatJson(provider, chatRequest, requestContext, trace)
    deps.recordGatewayLog({
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
    deps.finalizeGatewayTrace(trace)
    jsonResponse(res, 200, chatResponse)
  } catch (error) {
    deps.respondRouteError(res, 'chat', requestContext, trace, error)
  }
}
