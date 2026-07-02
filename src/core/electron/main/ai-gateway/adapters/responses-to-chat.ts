import type { AiGatewayProviderConfig } from '../../../../shared/types'
import {
  getFiniteNumber,
  hasNonEmptyArray,
  hasNonEmptyObject,
  isJsonObject,
  resolveMappedModel,
  type ChatCompletionMessage,
  type ChatCompletionRequest,
  type ChatMessageRole,
  type OpenAiResponsesRequest,
  UnsupportedGatewayFeatureError,
} from '../protocol-types'
import { flattenTextContent } from './content'

function normalizeRole(value: unknown): ChatMessageRole {
  if (value === 'assistant') return 'assistant'
  if (value === 'developer') return 'developer'
  if (value === 'system') return 'system'
  return 'user'
}

function inputItemToMessage(item: unknown): ChatCompletionMessage | null {
  if (typeof item === 'string') {
    return { role: 'user', content: item }
  }
  if (!isJsonObject(item)) return null

  const type = typeof item.type === 'string' ? item.type : ''
  if (type === 'function_call' || type === 'function_call_output' || type === 'tool_call') {
    throw new UnsupportedGatewayFeatureError('Responses tool calls are not supported by AI Gateway MVP.')
  }

  const role = normalizeRole(item.role)
  const content = flattenTextContent(item.content ?? item.text ?? item.input_text ?? item.output_text, 'Responses input')
  if (!content) return null
  return { role, content }
}

function collectInputMessages(input: unknown): ChatCompletionMessage[] {
  if (typeof input === 'string') return [{ role: 'user', content: input }]
  if (!Array.isArray(input)) return []

  const messages: ChatCompletionMessage[] = []
  for (const item of input) {
    const message = inputItemToMessage(item)
    if (message) messages.push(message)
  }
  return messages
}

export function responsesToChatCompletion(
  input: OpenAiResponsesRequest,
  provider: Pick<AiGatewayProviderConfig, 'modelMap' | 'capabilities'> = {}
): ChatCompletionRequest {
  if (hasNonEmptyArray(input.tools)) {
    throw new UnsupportedGatewayFeatureError('Responses tools are not supported by AI Gateway MVP.')
  }
  if (hasNonEmptyObject(input.reasoning)) {
    throw new UnsupportedGatewayFeatureError('Responses reasoning options are not supported by AI Gateway MVP.')
  }

  const model = resolveMappedModel(String(input.model || ''), provider.modelMap)
  if (!model) {
    throw new Error('Responses request is missing model.')
  }

  const messages = collectInputMessages(input.input)
  const instructions = flattenTextContent(input.instructions, 'Responses instructions')
  if (instructions) {
    messages.unshift({
      role: provider.capabilities?.supportsDeveloperMessages ? 'developer' : 'system',
      content: instructions,
    })
  }

  if (messages.length === 0) {
    throw new Error('Responses request has no text input.')
  }

  const request: ChatCompletionRequest = {
    model,
    messages,
  }

  const maxTokens = getFiniteNumber(input.max_output_tokens)
  if (maxTokens !== undefined) request.max_tokens = maxTokens
  const temperature = getFiniteNumber(input.temperature)
  if (temperature !== undefined) request.temperature = temperature
  const topP = getFiniteNumber(input.top_p)
  if (topP !== undefined) request.top_p = topP
  if (input.stream === true) request.stream = true

  return request
}
