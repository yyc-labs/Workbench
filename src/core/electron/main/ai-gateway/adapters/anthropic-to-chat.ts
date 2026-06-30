import { randomUUID } from 'crypto'
import type { AiGatewayProviderConfig } from '../../../../shared/types'
import {
  getFiniteNumber,
  getString,
  isJsonObject,
  resolveMappedModel,
  type AnthropicMessagesRequest,
  type ChatCompletionMessage,
  type ChatCompletionRequest,
  type ChatCompletionTool,
  type ChatCompletionToolCall,
  type ChatCompletionToolChoice,
  type ChatMessageRole,
  UnsupportedGatewayFeatureError,
} from '../protocol-types'
import { flattenTextContent } from './content'

function normalizeRole(value: unknown): Extract<ChatMessageRole, 'system' | 'user' | 'assistant'> {
  if (value === 'assistant') return 'assistant'
  if (value === 'system') return 'system'
  return 'user'
}

function flattenSystem(system: unknown): string {
  if (system === undefined || system === null) return ''
  return flattenTextContent(system, 'Anthropic system')
}

function normalizeTextBlock(value: unknown, context: string): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null || value === undefined) return ''
  if (!isJsonObject(value)) return ''

  const type = getString(value.type)?.trim() || ''
  if (
    type === 'text'
    || type === 'input_text'
    || type === 'output_text'
    || type === 'summary_text'
    || !type
  ) {
    return flattenTextContent(value, context)
  }
  if (type === 'tool_use' || type === 'tool_result') {
    throw new UnsupportedGatewayFeatureError(`${context} contains tool content in an unexpected position.`)
  }

  throw new UnsupportedGatewayFeatureError(`${context} contains unsupported content block type "${type}".`)
}

function stringifyToolResultContent(value: unknown): string {
  const text = flattenTextContent(value, 'Anthropic tool_result')
  if (text) return text
  if (value === null || value === undefined) return ''
  return JSON.stringify(value)
}

function buildToolResultContent(block: Record<string, unknown>): string {
  const content = stringifyToolResultContent(block.content)
  if (block.is_error !== true) return content
  if (!content) return 'Tool returned an error.'
  return `Tool returned an error:\n${content}`
}

function buildToolUseCall(block: Record<string, unknown>): ChatCompletionToolCall {
  const name = getString(block.name)?.trim()
  if (!name) {
    throw new Error('Anthropic tool_use block is missing name.')
  }

  return {
    id: getString(block.id)?.trim() || `toolu_${randomUUID().replace(/-/g, '')}`,
    type: 'function',
    function: {
      name,
      arguments: JSON.stringify(block.input ?? {}),
    },
  }
}

function flushBufferedText(
  messages: ChatCompletionMessage[],
  role: Extract<ChatMessageRole, 'system' | 'user'>,
  textParts: string[]
): void {
  if (textParts.length === 0) return
  const content = textParts.join('\n').trim()
  textParts.length = 0
  if (!content) return
  messages.push({ role, content })
}

function anthropicUserMessageToChatMessages(
  role: Extract<ChatMessageRole, 'system' | 'user'>,
  content: unknown
): ChatCompletionMessage[] {
  const blocks = Array.isArray(content) ? content : [content]
  const messages: ChatCompletionMessage[] = []
  const textParts: string[] = []

  for (const block of blocks) {
    if (isJsonObject(block) && block.type === 'tool_result') {
      flushBufferedText(messages, role, textParts)
      const toolCallId = getString(block.tool_use_id)?.trim()
      if (!toolCallId) {
        throw new Error('Anthropic tool_result block is missing tool_use_id.')
      }
      messages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: buildToolResultContent(block),
      })
      continue
    }
    if (isJsonObject(block) && block.type === 'tool_use') {
      throw new UnsupportedGatewayFeatureError('Anthropic user message contains tool_use content.')
    }

    const text = normalizeTextBlock(block, 'Anthropic message')
    if (text) textParts.push(text)
  }

  flushBufferedText(messages, role, textParts)
  return messages
}

function anthropicAssistantMessageToChatMessages(content: unknown): ChatCompletionMessage[] {
  const blocks = Array.isArray(content) ? content : [content]
  const textParts: string[] = []
  const toolCalls: ChatCompletionToolCall[] = []

  for (const block of blocks) {
    if (isJsonObject(block) && block.type === 'tool_use') {
      toolCalls.push(buildToolUseCall(block))
      continue
    }
    if (isJsonObject(block) && block.type === 'tool_result') {
      throw new UnsupportedGatewayFeatureError('Anthropic assistant message contains tool_result content.')
    }

    const text = normalizeTextBlock(block, 'Anthropic message')
    if (text) textParts.push(text)
  }

  const contentText = textParts.join('\n').trim()
  if (!contentText && toolCalls.length === 0) return []

  return [{
    role: 'assistant',
    content: contentText || null,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  }]
}

function anthropicMessageToChatMessages(message: unknown): ChatCompletionMessage[] {
  if (!isJsonObject(message)) return []
  const role = normalizeRole(message.role)
  if (role === 'assistant') {
    return anthropicAssistantMessageToChatMessages(message.content)
  }
  return anthropicUserMessageToChatMessages(role, message.content)
}

function anthropicToolsToChatTools(tools: unknown): ChatCompletionTool[] {
  if (!Array.isArray(tools)) return []

  return tools.map((tool, index): ChatCompletionTool => {
    if (!isJsonObject(tool)) {
      throw new Error(`Anthropic tool at index ${index} is invalid.`)
    }
    const name = getString(tool.name)?.trim()
    if (!name) {
      throw new Error(`Anthropic tool at index ${index} is missing name.`)
    }

    const converted: ChatCompletionTool = {
      type: 'function',
      function: { name },
    }
    const description = getString(tool.description)?.trim()
    if (description) converted.function.description = description
    if (isJsonObject(tool.input_schema)) {
      converted.function.parameters = tool.input_schema
    }
    return converted
  })
}

function anthropicToolChoiceToChatToolChoice(
  toolChoice: unknown
): { toolChoice?: ChatCompletionToolChoice; parallelToolCalls?: boolean } {
  if (!isJsonObject(toolChoice)) return {}

  const type = getString(toolChoice.type)?.trim()
  const disableParallelToolUse = typeof toolChoice.disable_parallel_tool_use === 'boolean'
    ? toolChoice.disable_parallel_tool_use
    : undefined

  if (!type) {
    return {
      parallelToolCalls: disableParallelToolUse === undefined ? undefined : !disableParallelToolUse,
    }
  }
  if (type === 'auto') {
    return {
      toolChoice: 'auto',
      parallelToolCalls: disableParallelToolUse === undefined ? undefined : !disableParallelToolUse,
    }
  }
  if (type === 'any') {
    return {
      toolChoice: 'required',
      parallelToolCalls: disableParallelToolUse === undefined ? undefined : !disableParallelToolUse,
    }
  }
  if (type === 'tool') {
    const name = getString(toolChoice.name)?.trim()
    if (!name) {
      throw new Error('Anthropic tool_choice of type "tool" is missing name.')
    }
    return {
      toolChoice: {
        type: 'function',
        function: { name },
      },
      parallelToolCalls: disableParallelToolUse === undefined ? undefined : !disableParallelToolUse,
    }
  }
  if (type === 'none') {
    return {
      toolChoice: 'none',
      parallelToolCalls: disableParallelToolUse === undefined ? undefined : !disableParallelToolUse,
    }
  }

  throw new UnsupportedGatewayFeatureError(`Anthropic tool_choice type "${type}" is not supported.`)
}

export function anthropicMessagesToChatCompletion(
  input: AnthropicMessagesRequest,
  provider: Pick<AiGatewayProviderConfig, 'modelMap'> = {}
): ChatCompletionRequest {
  const model = resolveMappedModel(String(input.model || ''), provider.modelMap)
  if (!model) {
    throw new Error('Anthropic request is missing model.')
  }

  const messages = Array.isArray(input.messages) ? input.messages : []
  const chatMessages = messages.flatMap((message) => anthropicMessageToChatMessages(message))

  const system = flattenSystem(input.system)
  if (system) {
    chatMessages.unshift({
      role: 'system',
      content: system,
    })
  }

  if (chatMessages.length === 0) {
    throw new Error('Anthropic request has no text messages.')
  }

  const request: ChatCompletionRequest = {
    model,
    messages: chatMessages,
  }

  const maxTokens = getFiniteNumber(input.max_tokens)
  if (maxTokens !== undefined) request.max_tokens = maxTokens
  const temperature = getFiniteNumber(input.temperature)
  if (temperature !== undefined) request.temperature = temperature
  const topP = getFiniteNumber(input.top_p)
  if (topP !== undefined) request.top_p = topP
  if (input.stream === true) request.stream = true

  const tools = anthropicToolsToChatTools(input.tools)
  if (tools.length > 0) {
    request.tools = tools
    const toolChoice = anthropicToolChoiceToChatToolChoice(input.tool_choice)
    if (toolChoice.toolChoice) request.tool_choice = toolChoice.toolChoice
    if (toolChoice.parallelToolCalls !== undefined) {
      request.parallel_tool_calls = toolChoice.parallelToolCalls
    }
  }

  return request
}
