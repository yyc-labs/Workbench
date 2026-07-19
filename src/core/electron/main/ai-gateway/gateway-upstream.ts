import type { AiGatewayProviderConfig } from '../../../shared/types'
import type { AnthropicMessagesRequest, ChatCompletionRequest, OpenAiResponsesRequest } from './protocol-types'
import { getHeaderValue, type HeaderValue } from './gateway-http'

export type ResolvedUpstreamAuth = {
  token: string
  source: string
}

export function extractRequestApiToken(headers: Record<string, HeaderValue>): string {
  const headerToken = getHeaderValue(headers, 'x-api-key') || getHeaderValue(headers, 'api-key')
  if (headerToken) return headerToken

  const authorization = getHeaderValue(headers, 'authorization')
  if (!authorization) return ''
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i)
  if (bearerMatch?.[1]?.trim()) return bearerMatch[1].trim()
  return authorization
}

export function resolveUpstreamAuth(provider: AiGatewayProviderConfig, apiTokenOverride: string): ResolvedUpstreamAuth {
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

export function buildAnthropicAuthHeaders(provider: AiGatewayProviderConfig, incomingHeaders: Record<string, HeaderValue>, apiTokenOverride: string): { auth: ResolvedUpstreamAuth; headers: Record<string, string> } {
  const auth = resolveUpstreamAuth(provider, apiTokenOverride)
  if (!auth.token) return { auth, headers: {} }

  const incomingAuthorization = getHeaderValue(incomingHeaders, 'authorization')
  const incomingXApiKey = getHeaderValue(incomingHeaders, 'x-api-key') || getHeaderValue(incomingHeaders, 'api-key')

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

export function toChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed
  return `${trimmed}/chat/completions`
}

export function toResponsesUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (/\/responses$/i.test(trimmed)) return trimmed
  if (/\/v1$/i.test(trimmed)) return `${trimmed}/responses`
  return `${trimmed}/v1/responses`
}

export function toAnthropicMessagesUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (/\/(?:v1\/)?messages$/i.test(trimmed)) return trimmed
  if (/\/v1$/i.test(trimmed)) return `${trimmed}/messages`
  return `${trimmed}/v1/messages`
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export async function readResponseText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

export function buildUpstreamLogDetails(provider: AiGatewayProviderConfig, chatRequest: ChatCompletionRequest, extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    providerId: provider.id,
    providerName: provider.name,
    protocol: provider.protocol,
    capabilities: provider.capabilities,
    upstreamUrl: toChatCompletionsUrl(provider.baseUrl),
    model: chatRequest.model,
    stream: chatRequest.stream === true,
    ...extra,
  }
}

export function buildAnthropicUpstreamLogDetails(provider: AiGatewayProviderConfig, request: AnthropicMessagesRequest, extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    providerId: provider.id,
    providerName: provider.name,
    protocol: provider.protocol,
    capabilities: provider.capabilities,
    upstreamUrl: toAnthropicMessagesUrl(provider.baseUrl),
    model: request.model,
    stream: request.stream === true,
    ...extra,
  }
}

export function buildResponsesUpstreamLogDetails(provider: AiGatewayProviderConfig, request: OpenAiResponsesRequest, extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    providerId: provider.id,
    providerName: provider.name,
    protocol: provider.protocol,
    capabilities: provider.capabilities,
    upstreamUrl: toResponsesUrl(provider.baseUrl),
    model: request.model,
    stream: request.stream === true,
    ...extra,
  }
}
