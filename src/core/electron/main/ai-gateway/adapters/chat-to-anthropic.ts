import { randomUUID } from 'crypto'
import type {
  ChatCompletionResponse,
  ChatCompletionToolCall,
  GatewaySseEvent,
  JsonObject,
} from '../protocol-types'

function extractText(response: ChatCompletionResponse): string {
  const choice = response.choices?.[0]
  const content = choice?.message?.content
  return typeof content === 'string' ? content : ''
}

function extractDeltaText(response: ChatCompletionResponse): string {
  const choice = response.choices?.[0]
  const content = choice?.delta?.content
  return typeof content === 'string' ? content : ''
}

function extractToolCalls(response: ChatCompletionResponse): ChatCompletionToolCall[] {
  const toolCalls = response.choices?.[0]?.message?.tool_calls
  return Array.isArray(toolCalls) ? toolCalls : []
}

function extractDeltaToolCalls(response: ChatCompletionResponse): ChatCompletionToolCall[] {
  const toolCalls = response.choices?.[0]?.delta?.tool_calls
  return Array.isArray(toolCalls) ? toolCalls : []
}

function mapStopReason(reason: string | null | undefined): string | null {
  if (!reason) return null
  if (reason === 'stop') return 'end_turn'
  if (reason === 'length') return 'max_tokens'
  if (reason === 'tool_calls') return 'tool_use'
  return reason
}

function mapUsage(usage: JsonObject | undefined): JsonObject {
  if (!usage) return {}
  const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0)
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0)
  return {
    input_tokens: Number.isFinite(inputTokens) ? inputTokens : 0,
    output_tokens: Number.isFinite(outputTokens) ? outputTokens : 0,
  }
}

function parseToolCallInput(argumentsText: string | undefined, context: string): unknown {
  const normalized = argumentsText?.trim()
  if (!normalized) return {}
  try {
    return JSON.parse(normalized) as unknown
  } catch {
    throw new Error(`${context} has invalid JSON arguments.`)
  }
}

function toolCallToAnthropicBlock(toolCall: ChatCompletionToolCall, fallbackIndex: number): JsonObject {
  const name = toolCall.function?.name?.trim()
  if (!name) {
    throw new Error(`Upstream tool call at index ${fallbackIndex} is missing function name.`)
  }

  return {
    type: 'tool_use',
    id: toolCall.id?.trim() || `toolu_${randomUUID().replace(/-/g, '')}`,
    name,
    input: parseToolCallInput(toolCall.function?.arguments, `Upstream tool call "${name}"`),
  }
}

export function chatCompletionToAnthropicMessage(
  response: ChatCompletionResponse,
  fallbackModel: string
): JsonObject {
  const choice = response.choices?.[0]
  const text = extractText(response)
  const toolBlocks = extractToolCalls(response).map((toolCall, index) => (
    toolCallToAnthropicBlock(toolCall, index)
  ))
  const content = [
    ...(text ? [{ type: 'text', text }] : []),
    ...toolBlocks,
  ]

  return {
    id: response.id || `msg_${randomUUID().replace(/-/g, '')}`,
    type: 'message',
    role: 'assistant',
    model: response.model || fallbackModel,
    content: content.length > 0 ? content : [{ type: 'text', text: '' }],
    stop_reason: mapStopReason(choice?.finish_reason) || (toolBlocks.length > 0 ? 'tool_use' : 'end_turn'),
    stop_sequence: null,
    usage: mapUsage(response.usage),
  }
}

type AnthropicStreamBlockKind = 'text' | 'tool'

type AnthropicStreamToolBlock = {
  anthropicIndex: number
  id: string
  name: string
}

export interface AnthropicStreamState {
  nextBlockIndex: number
  openBlock?: {
    kind: AnthropicStreamBlockKind
    index: number
  }
  toolBlocks: Map<number, AnthropicStreamToolBlock>
}

function createContentBlockStop(index: number): GatewaySseEvent {
  return {
    event: 'content_block_stop',
    data: JSON.stringify({
      type: 'content_block_stop',
      index,
    }),
  }
}

function closeOpenBlock(state: AnthropicStreamState): GatewaySseEvent[] {
  if (!state.openBlock) return []
  const event = createContentBlockStop(state.openBlock.index)
  state.openBlock = undefined
  return [event]
}

function openTextBlock(state: AnthropicStreamState): GatewaySseEvent[] {
  if (state.openBlock?.kind === 'text') return []

  const events = closeOpenBlock(state)
  const index = state.nextBlockIndex++
  state.openBlock = {
    kind: 'text',
    index,
  }
  events.push({
    event: 'content_block_start',
    data: JSON.stringify({
      type: 'content_block_start',
      index,
      content_block: {
        type: 'text',
        text: '',
      },
    }),
  })
  return events
}

function getToolBlockState(
  state: AnthropicStreamState,
  toolIndex: number,
  toolCall: ChatCompletionToolCall
): AnthropicStreamToolBlock {
  const existing = state.toolBlocks.get(toolIndex)
  if (existing) {
    if (!existing.name && toolCall.function?.name?.trim()) {
      existing.name = toolCall.function.name.trim()
    }
    if (!existing.id && toolCall.id?.trim()) {
      existing.id = toolCall.id.trim()
    }
    return existing
  }

  const created: AnthropicStreamToolBlock = {
    anthropicIndex: state.nextBlockIndex++,
    id: toolCall.id?.trim() || `toolu_${randomUUID().replace(/-/g, '')}`,
    name: toolCall.function?.name?.trim() || '',
  }
  state.toolBlocks.set(toolIndex, created)
  return created
}

function openToolBlock(
  state: AnthropicStreamState,
  toolIndex: number,
  toolCall: ChatCompletionToolCall
): GatewaySseEvent[] {
  const block = getToolBlockState(state, toolIndex, toolCall)
  if (state.openBlock?.kind === 'tool' && state.openBlock.index === block.anthropicIndex) {
    return []
  }

  const events = closeOpenBlock(state)
  state.openBlock = {
    kind: 'tool',
    index: block.anthropicIndex,
  }
  events.push({
    event: 'content_block_start',
    data: JSON.stringify({
      type: 'content_block_start',
      index: block.anthropicIndex,
      content_block: {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: {},
      },
    }),
  })
  return events
}

export function createAnthropicStreamStart(
  messageId: string,
  model: string
): GatewaySseEvent[] {
  return [
    {
      event: 'message_start',
      data: JSON.stringify({
        type: 'message_start',
        message: {
          id: messageId,
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
          },
        },
      }),
    },
  ]
}

export function createAnthropicStreamState(): AnthropicStreamState {
  return {
    nextBlockIndex: 0,
    toolBlocks: new Map(),
  }
}

export function chatStreamChunkToAnthropicEvents(
  chunk: ChatCompletionResponse,
  state: AnthropicStreamState
): GatewaySseEvent[] {
  const events: GatewaySseEvent[] = []
  const delta = extractDeltaText(chunk)
  if (delta) {
    events.push(...openTextBlock(state))
    events.push({
      event: 'content_block_delta',
      data: JSON.stringify({
        type: 'content_block_delta',
        index: state.openBlock?.index ?? 0,
        delta: {
          type: 'text_delta',
          text: delta,
        },
      }),
    })
  }

  const deltaToolCalls = extractDeltaToolCalls(chunk)
  for (let index = 0; index < deltaToolCalls.length; index += 1) {
    const toolCall = deltaToolCalls[index]
    const toolIndex = Number.isInteger(toolCall.index) ? Number(toolCall.index) : index
    events.push(...openToolBlock(state, toolIndex, toolCall))

    const argumentsDelta = toolCall.function?.arguments
    if (typeof argumentsDelta !== 'string' || !argumentsDelta) continue

    const toolBlock = state.toolBlocks.get(toolIndex)
    if (!toolBlock) continue
    events.push({
      event: 'content_block_delta',
      data: JSON.stringify({
        type: 'content_block_delta',
        index: toolBlock.anthropicIndex,
        delta: {
          type: 'input_json_delta',
          partial_json: argumentsDelta,
        },
      }),
    })
  }

  return events
}

export function createAnthropicStreamStop(
  finishReason: string | null | undefined,
  usage: JsonObject | undefined,
  state: AnthropicStreamState
): GatewaySseEvent[] {
  return [
    ...closeOpenBlock(state),
    {
      event: 'message_delta',
      data: JSON.stringify({
        type: 'message_delta',
        delta: {
          stop_reason: mapStopReason(finishReason) || (state.toolBlocks.size > 0 ? 'tool_use' : 'end_turn'),
          stop_sequence: null,
        },
        usage: mapUsage(usage),
      }),
    },
    {
      event: 'message_stop',
      data: JSON.stringify({
        type: 'message_stop',
      }),
    },
  ]
}
