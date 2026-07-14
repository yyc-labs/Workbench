import type { AiGatewayProviderConfig } from '../../../../shared/types'
import {
  getFiniteNumber,
  getString,
  hasNonEmptyObject,
  isJsonObject,
  resolveMappedModel,
  type ChatCompletionMessage,
  type ChatCompletionRequest,
  type ChatCompletionTool,
  type ChatCompletionToolCall,
  type ChatCompletionToolChoice,
  type ChatMessageRole,
  type OpenAiResponsesRequest,
  UnsupportedGatewayFeatureError,
} from '../protocol-types'
import { flattenTextContent } from './content'

type ResponsesInputState = {
  messages: ChatCompletionMessage[]
  pendingToolCalls: ChatCompletionToolCall[]
  declaredCallIds: Set<string>
  completedCallIds: Set<string>
}

function normalizeRole(value: unknown): ChatMessageRole {
  if (value === 'assistant') return 'assistant'
  if (value === 'developer') return 'developer'
  if (value === 'system') return 'system'
  return 'user'
}

function unsupportedToolCalls(message: string): UnsupportedGatewayFeatureError {
  return new UnsupportedGatewayFeatureError(message, 'responses_tool_calls')
}

function flushPendingToolCalls(state: ResponsesInputState): void {
  if (state.pendingToolCalls.length === 0) return
  state.messages.push({
    role: 'assistant',
    content: null,
    tool_calls: state.pendingToolCalls,
  })
  state.pendingToolCalls = []
}

function convertFunctionCallInput(item: Record<string, unknown>, index: number): ChatCompletionToolCall {
  const callId = getString(item.call_id)?.trim()
  const name = getString(item.name)?.trim()
  const argumentsText = getString(item.arguments)
  if (!callId) {
    throw unsupportedToolCalls(`Responses function_call input at index ${index} is missing call_id.`)
  }
  if (!name) {
    throw unsupportedToolCalls(`Responses function_call input at index ${index} is missing name.`)
  }
  if (typeof argumentsText !== 'string') {
    throw unsupportedToolCalls(`Responses function_call input at index ${index} is missing string arguments.`)
  }
  return {
    id: callId,
    type: 'function',
    function: {
      name,
      arguments: argumentsText,
    },
  }
}

function convertFunctionCallOutputInput(item: Record<string, unknown>, index: number): {
  callId: string
  content: string
} {
  const callId = getString(item.call_id)?.trim()
  if (!callId) {
    throw unsupportedToolCalls(`Responses function_call_output input at index ${index} is missing call_id.`)
  }
  if (!Object.prototype.hasOwnProperty.call(item, 'output')) {
    throw unsupportedToolCalls(`Responses function_call_output input at index ${index} is missing output.`)
  }
  return {
    callId,
    content: flattenTextContent(item.output, 'Responses function_call_output'),
  }
}

function inputItemToMessage(item: Record<string, unknown>): ChatCompletionMessage | null {
  const type = getString(item.type)?.trim() ?? ''
  if (type === 'tool_call') {
    throw unsupportedToolCalls('Responses tool_call input items are not supported; use function_call items.')
  }
  if (type && type !== 'message' && type !== 'input_text' && type !== 'output_text' && type !== 'text') {
    throw new UnsupportedGatewayFeatureError(
      `Responses input item type "${type}" cannot be converted to Chat Completions.`,
      'responses_input_items'
    )
  }

  const role = type === 'output_text' ? 'assistant' : normalizeRole(item.role)
  const content = flattenTextContent(
    item.content ?? item.text ?? item.input_text ?? item.output_text,
    'Responses input'
  )
  if (!content) return null
  return { role, content }
}

function collectInputMessages(input: unknown): ChatCompletionMessage[] {
  if (typeof input === 'string') return [{ role: 'user', content: input }]
  if (!Array.isArray(input)) return []

  const state: ResponsesInputState = {
    messages: [],
    pendingToolCalls: [],
    declaredCallIds: new Set(),
    completedCallIds: new Set(),
  }

  input.forEach((item, index) => {
    if (typeof item === 'string') {
      flushPendingToolCalls(state)
      state.messages.push({ role: 'user', content: item })
      return
    }
    if (!isJsonObject(item)) {
      throw new UnsupportedGatewayFeatureError(
        `Responses input item at index ${index} is invalid.`,
        'responses_input_items'
      )
    }

    const type = getString(item.type)?.trim() ?? ''
    if (type === 'function_call') {
      const toolCall = convertFunctionCallInput(item, index)
      const callId = toolCall.id!
      if (state.declaredCallIds.has(callId)) {
        throw unsupportedToolCalls(`Responses function_call input repeats call_id "${callId}".`)
      }
      state.declaredCallIds.add(callId)
      state.pendingToolCalls.push(toolCall)
      return
    }
    if (type === 'function_call_output') {
      flushPendingToolCalls(state)
      const toolOutput = convertFunctionCallOutputInput(item, index)
      if (!state.declaredCallIds.has(toolOutput.callId)) {
        throw unsupportedToolCalls(
          `Responses function_call_output for call_id "${toolOutput.callId}" has no earlier function_call in input.`
        )
      }
      if (state.completedCallIds.has(toolOutput.callId)) {
        throw unsupportedToolCalls(`Responses function_call_output repeats call_id "${toolOutput.callId}".`)
      }
      state.completedCallIds.add(toolOutput.callId)
      state.messages.push({
        role: 'tool',
        tool_call_id: toolOutput.callId,
        content: toolOutput.content,
      })
      return
    }

    flushPendingToolCalls(state)
    const message = inputItemToMessage(item)
    if (message) state.messages.push(message)
  })

  flushPendingToolCalls(state)
  return state.messages
}

function responsesToolsToChatTools(
  tools: unknown,
  provider: Pick<AiGatewayProviderConfig, 'capabilities'>
): ChatCompletionTool[] {
  if (typeof tools === 'undefined') return []
  if (!Array.isArray(tools)) {
    throw new UnsupportedGatewayFeatureError('Responses tools must be an array of function tools.', 'responses_tools')
  }

  return tools.map((tool, index): ChatCompletionTool => {
    if (!isJsonObject(tool)) {
      throw new UnsupportedGatewayFeatureError(`Responses tool at index ${index} is invalid.`, 'responses_tools')
    }
    if (tool.type !== 'function') {
      throw new UnsupportedGatewayFeatureError(
        `Responses tool type "${String(tool.type || 'unknown')}" cannot be converted to Chat Completions.`,
        'responses_builtin_tools'
      )
    }
    const name = getString(tool.name)?.trim()
    if (!name) {
      throw new UnsupportedGatewayFeatureError(`Responses function tool at index ${index} is missing name.`, 'responses_tools')
    }
    if (typeof tool.parameters !== 'undefined' && !isJsonObject(tool.parameters)) {
      throw new UnsupportedGatewayFeatureError(
        `Responses function tool "${name}" has non-object parameters.`,
        'responses_tools'
      )
    }
    if (tool.strict === true && provider.capabilities?.supportsStrictTools === false) {
      throw new UnsupportedGatewayFeatureError(
        `Provider does not support strict function tool "${name}" on the Chat downgrade route.`,
        'responses_tools'
      )
    }

    return {
      type: 'function',
      function: {
        name,
        ...(getString(tool.description)?.trim() ? { description: getString(tool.description)?.trim() } : {}),
        ...(isJsonObject(tool.parameters) ? { parameters: tool.parameters } : {}),
        ...(tool.strict === true ? { strict: true } : {}),
      },
    }
  })
}

function responsesToolChoiceToChatToolChoice(
  toolChoice: unknown,
  declaredTools: ChatCompletionTool[]
): ChatCompletionToolChoice | undefined {
  if (typeof toolChoice === 'undefined' || toolChoice === null) return undefined
  if (toolChoice === 'auto' || toolChoice === 'none' || toolChoice === 'required') return toolChoice
  if (!isJsonObject(toolChoice)) {
    throw new UnsupportedGatewayFeatureError('Responses tool_choice cannot be converted to Chat Completions.', 'responses_tool_choice')
  }

  const type = getString(toolChoice.type)?.trim()
  if (type === 'auto' || type === 'none' || type === 'required') return type
  if (type !== 'function') {
    throw new UnsupportedGatewayFeatureError(
      `Responses tool_choice type "${type || 'unknown'}" cannot be converted to Chat Completions.`,
      'responses_tool_choice'
    )
  }
  const nestedFunction = isJsonObject(toolChoice.function) ? toolChoice.function : undefined
  const name = getString(toolChoice.name)?.trim() ?? getString(nestedFunction?.name)?.trim()
  if (!name) {
    throw new UnsupportedGatewayFeatureError('Responses function tool_choice is missing name.', 'responses_tool_choice')
  }
  if (!declaredTools.some((tool) => tool.function.name === name)) {
    throw new UnsupportedGatewayFeatureError(
      `Responses function tool_choice references undeclared tool "${name}".`,
      'responses_tool_choice'
    )
  }
  return {
    type: 'function',
    function: { name },
  }
}

export function responsesToChatCompletion(
  input: OpenAiResponsesRequest,
  provider: Pick<AiGatewayProviderConfig, 'modelMap' | 'capabilities'> = {}
): ChatCompletionRequest {
  if (hasNonEmptyObject(input.reasoning)) {
    throw new UnsupportedGatewayFeatureError(
      'Responses reasoning options are not supported by the Responses to Chat downgrade route.',
      'responses_reasoning'
    )
  }

  const model = resolveMappedModel(String(input.model || ''), provider.modelMap)
  if (!model) {
    throw new Error('Responses request is missing model.')
  }

  const tools = responsesToolsToChatTools(input.tools, provider)
  if (typeof input.tool_choice !== 'undefined' && tools.length === 0) {
    throw new UnsupportedGatewayFeatureError(
      'Responses tool_choice requires declared function tools on the Chat downgrade route.',
      'responses_tool_choice'
    )
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
    throw new Error('Responses request has no convertible input.')
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

  if (tools.length > 0) {
    request.tools = tools
    const toolChoice = responsesToolChoiceToChatToolChoice(input.tool_choice, tools)
    if (toolChoice) request.tool_choice = toolChoice
    if (typeof input.parallel_tool_calls === 'boolean') {
      request.parallel_tool_calls = input.parallel_tool_calls
    }
  }

  return request
}
