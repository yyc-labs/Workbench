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
  return typeof content === 'string' && content.trim() ? content : ''
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
  anthropicIndex?: number
  id: string
  name: string
  started: boolean
  pendingArgumentDeltas: string[]
  argumentSanitizer: JsonFragmentSanitizerState
}

type JsonFragmentSanitizerState = {
  inString: boolean
  pendingBackslash: boolean
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

function createJsonFragmentSanitizerState(): JsonFragmentSanitizerState {
  return {
    inString: false,
    pendingBackslash: false,
  }
}

function isJsonEscapeCharacter(char: string): boolean {
  return char === '"' || char === '\\' || char === '/' || char === 'b'
    || char === 'f' || char === 'n' || char === 'r' || char === 't'
}

function escapeControlCharacter(char: string): string {
  if (char === '\b') return '\\b'
  if (char === '\f') return '\\f'
  if (char === '\n') return '\\n'
  if (char === '\r') return '\\r'
  if (char === '\t') return '\\t'
  const code = char.charCodeAt(0).toString(16).padStart(4, '0')
  return `\\u${code}`
}

function sanitizeJsonFragmentForToolInput(
  fragment: string,
  state: JsonFragmentSanitizerState
): string {
  let result = ''

  for (const char of fragment) {
    if (!state.inString) {
      if (char === '"') state.inString = true
      result += char
      continue
    }

    if (state.pendingBackslash) {
      state.pendingBackslash = false
      if (isJsonEscapeCharacter(char)) {
        result += `\\${char}`
      } else if (char.charCodeAt(0) < 0x20) {
        result += `\\\\${escapeControlCharacter(char)}`
      } else {
        result += `\\\\${char}`
      }
      continue
    }

    if (char === '\\') {
      state.pendingBackslash = true
      continue
    }
    if (char === '"') {
      state.inString = false
      result += char
      continue
    }
    if (char.charCodeAt(0) < 0x20) {
      result += escapeControlCharacter(char)
      continue
    }
    result += char
  }

  return result
}

function flushJsonFragmentSanitizer(state: JsonFragmentSanitizerState): string {
  if (!state.pendingBackslash) return ''
  state.pendingBackslash = false
  return '\\\\'
}

function sanitizeToolArgumentsDelta(
  block: AnthropicStreamToolBlock,
  argumentsDelta: string
): string {
  return sanitizeJsonFragmentForToolInput(argumentsDelta, block.argumentSanitizer)
}

function findToolBlockByAnthropicIndex(
  state: AnthropicStreamState,
  index: number
): AnthropicStreamToolBlock | undefined {
  return Array.from(state.toolBlocks.values()).find((block) => block.anthropicIndex === index)
}

function closeOpenBlock(state: AnthropicStreamState): GatewaySseEvent[] {
  if (!state.openBlock) return []
  const events: GatewaySseEvent[] = []
  if (state.openBlock.kind === 'tool') {
    const toolBlock = findToolBlockByAnthropicIndex(state, state.openBlock.index)
    const finalArgumentDelta = toolBlock
      ? flushJsonFragmentSanitizer(toolBlock.argumentSanitizer)
      : ''
    if (finalArgumentDelta) {
      events.push(createToolInputDelta(state.openBlock.index, finalArgumentDelta))
    }
  }
  events.push(createContentBlockStop(state.openBlock.index))
  state.openBlock = undefined
  return events
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
    id: toolCall.id?.trim() || `toolu_${randomUUID().replace(/-/g, '')}`,
    name: toolCall.function?.name?.trim() || '',
    started: false,
    pendingArgumentDeltas: [],
    argumentSanitizer: createJsonFragmentSanitizerState(),
  }
  state.toolBlocks.set(toolIndex, created)
  return created
}

function ensureToolBlockIndex(state: AnthropicStreamState, block: AnthropicStreamToolBlock): number {
  if (block.anthropicIndex === undefined) {
    block.anthropicIndex = state.nextBlockIndex++
  }
  return block.anthropicIndex
}

function openToolBlock(
  state: AnthropicStreamState,
  toolIndex: number,
  toolCall: ChatCompletionToolCall
): GatewaySseEvent[] {
  const block = getToolBlockState(state, toolIndex, toolCall)
  if (!block.name) return []
  const blockIndex = ensureToolBlockIndex(state, block)

  if (state.openBlock?.kind === 'tool' && state.openBlock.index === blockIndex) {
    return []
  }

  const events = closeOpenBlock(state)
  state.openBlock = {
    kind: 'tool',
    index: blockIndex,
  }
  if (!block.started) {
    block.started = true
    events.push({
      event: 'content_block_start',
      data: JSON.stringify({
        type: 'content_block_start',
        index: blockIndex,
        content_block: {
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: {},
        },
      }),
    })
    for (const pending of block.pendingArgumentDeltas.splice(0)) {
      if (pending) {
        events.push(createToolInputDelta(blockIndex, pending))
      }
    }
  }
  return events
}

function createToolInputDelta(index: number, partialJson: string): GatewaySseEvent {
  return {
    event: 'content_block_delta',
    data: JSON.stringify({
      type: 'content_block_delta',
      index,
      delta: {
        type: 'input_json_delta',
        partial_json: partialJson,
      },
    }),
  }
}

function hasStartedToolBlocks(state: AnthropicStreamState): boolean {
  return Array.from(state.toolBlocks.values()).some((block) => block.started)
}

function mapStreamStopReason(finishReason: string | null | undefined, state: AnthropicStreamState): string {
  const hasToolUse = hasStartedToolBlocks(state)
  if (finishReason === 'tool_calls') return hasToolUse ? 'tool_use' : 'end_turn'
  return mapStopReason(finishReason) || (hasToolUse ? 'tool_use' : 'end_turn')
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
  const deltaToolCalls = extractDeltaToolCalls(chunk)
  if (delta && (delta.trim() || deltaToolCalls.length === 0)) {
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

  for (let index = 0; index < deltaToolCalls.length; index += 1) {
    const toolCall = deltaToolCalls[index]
    const toolIndex = Number.isInteger(toolCall.index) ? Number(toolCall.index) : index
    const toolBlock = getToolBlockState(state, toolIndex, toolCall)
    events.push(...openToolBlock(state, toolIndex, toolCall))

    const argumentsDelta = toolCall.function?.arguments
    if (typeof argumentsDelta !== 'string' || !argumentsDelta) continue
    const sanitizedArgumentsDelta = sanitizeToolArgumentsDelta(toolBlock, argumentsDelta)
    if (!sanitizedArgumentsDelta) continue

    if (!toolBlock.started) {
      toolBlock.pendingArgumentDeltas.push(sanitizedArgumentsDelta)
      continue
    }
    if (toolBlock.anthropicIndex !== undefined) {
      events.push(createToolInputDelta(toolBlock.anthropicIndex, sanitizedArgumentsDelta))
    }
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
          stop_reason: mapStreamStopReason(finishReason, state),
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
