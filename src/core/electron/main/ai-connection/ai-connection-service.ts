import type { AiConnectionTestRequest, AiConnectionTestResult } from '../../../shared/types'

const TEST_TIMEOUT_MS = 30_000
const RESPONSE_PREVIEW_LIMIT = 1_000

function getEndpoint(baseUrl: string, path: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}${path}`
}

function getErrorMessage(body: unknown, statusCode: number): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = (body as { error?: unknown }).error
    if (typeof error === 'string') return error
    if (error && typeof error === 'object' && 'message' in error) {
      const message = (error as { message?: unknown }).message
      if (typeof message === 'string') return message
    }
  }
  return `Request failed with status ${statusCode}.`
}

function getResponseText(protocol: AiConnectionTestRequest['protocol'], body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const value = body as Record<string, unknown>
  if (protocol === 'openai_chat') {
    const content = (value.choices as Array<{ message?: { content?: unknown } }> | undefined)?.[0]?.message?.content
    return typeof content === 'string' ? content : ''
  }
  if (protocol === 'anthropic_messages') {
    const content = (value.content as Array<{ text?: unknown }> | undefined)?.[0]?.text
    return typeof content === 'string' ? content : ''
  }
  const output = value.output as Array<{ content?: Array<{ text?: unknown }> }> | undefined
  return typeof output?.[0]?.content?.[0]?.text === 'string' ? output[0].content[0].text : ''
}

export function createAiConnectionService() {
  const testConnection = async (input: AiConnectionTestRequest): Promise<AiConnectionTestResult> => {
    const startedAt = Date.now()
    const baseUrl = input.baseUrl.trim()
    const model = input.model.trim()
    const apiKey = input.apiKey?.trim() || (input.apiKeyEnv ? process.env[input.apiKeyEnv]?.trim() : '')
    if (!baseUrl || !model) {
      return { ok: false, error: 'Base URL and model are required.', durationMs: Date.now() - startedAt }
    }

    const endpoint = input.protocol === 'openai_chat' ? getEndpoint(baseUrl, '/chat/completions') : input.protocol === 'openai_responses' ? getEndpoint(baseUrl, '/responses') : getEndpoint(baseUrl, '/messages')
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (input.protocol === 'anthropic_messages') {
      headers['anthropic-version'] = '2023-06-01'
      if (apiKey) headers['x-api-key'] = apiKey
    } else if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`
    }
    const payload = input.protocol === 'openai_chat' ? { model, messages: [{ role: 'user', content: 'Hello' }], max_tokens: 32, stream: false } : input.protocol === 'openai_responses' ? { model, input: 'Hello', max_output_tokens: 32 } : { model, max_tokens: 32, messages: [{ role: 'user', content: 'Hello' }] }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS)

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      const raw = await response.text()
      let body: unknown = raw
      try {
        body = raw ? JSON.parse(raw) : null
      } catch {
        // Keep non-JSON upstream errors readable.
      }
      if (!response.ok) {
        return { ok: false, statusCode: response.status, error: getErrorMessage(body, response.status), durationMs: Date.now() - startedAt }
      }
      const responseText = getResponseText(input.protocol, body) || raw
      return {
        ok: true,
        statusCode: response.status,
        response: responseText.slice(0, RESPONSE_PREVIEW_LIMIT),
        durationMs: Date.now() - startedAt,
      }
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError' ? `Connection timed out after ${TEST_TIMEOUT_MS / 1_000}s.` : error instanceof Error ? error.message : String(error)
      return { ok: false, error: message, durationMs: Date.now() - startedAt }
    } finally {
      clearTimeout(timer)
    }
  }

  return { testConnection }
}

export type AiConnectionService = ReturnType<typeof createAiConnectionService>
