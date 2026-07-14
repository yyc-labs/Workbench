import { randomUUID } from 'crypto'
import type {
  ChatCompletionResponse,
  ChatCompletionToolCall,
  GatewaySseEvent,
  JsonObject,
} from '../protocol-types'

type ResponsesTextStreamItem = {
  id: string
  outputIndex: number
  text: string
  closed: boolean
}

type ResponsesFunctionStreamItem = {
  sourceIndex: number
  id?: string
  name?: string
  arguments: string
  outputIndex?: number
  itemId?: string
  started: boolean
}

export type ResponsesStreamState = {
  nextOutputIndex: number
  textItems: ResponsesTextStreamItem[]
  activeTextItem?: ResponsesTextStreamItem
  functionCalls: Map<number, ResponsesFunctionStreamItem>
}

function responseId(): string {
  return `resp_${randomUUID().replace(/-/g, '')}`
}

function itemId(): string {
  return `msg_${randomUUID().replace(/-/g, '')}`
}

function functionItemId(callId: string): string {
  return `fc_${callId}`
}

function extractText(response: ChatCompletionResponse): string {
  const content = response.choices?.[0]?.message?.content
  return typeof content === 'string' ? content : ''
}

function extractDeltaText(response: ChatCompletionResponse): string {
  const content = response.choices?.[0]?.delta?.content
  return typeof content === 'string' ? content : ''
}

function extractToolCalls(response: ChatCompletionResponse): ChatCompletionToolCall[] {
  const toolCalls = response.choices?.[0]?.message?.tool_calls
  return Array.isArray(toolCalls) ? toolCalls : []
}

function mapUsage(usage: JsonObject | undefined): JsonObject | undefined {
  if (!usage) return undefined
  const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0)
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0)
  const totalTokens = Number(usage.total_tokens ?? inputTokens + outputTokens)
  return {
    input_tokens: Number.isFinite(inputTokens) ? inputTokens : 0,
    output_tokens: Number.isFinite(outputTokens) ? outputTokens : 0,
    total_tokens: Number.isFinite(totalTokens) ? totalTokens : 0,
  }
}

function requireFunctionCallFields(toolCall: ChatCompletionToolCall, index: number): {
  callId: string
  name: string
  argumentsText: string
} {
  const callId = toolCall.id?.trim()
  const name = toolCall.function?.name?.trim()
  const argumentsText = toolCall.function?.arguments
  if (!callId) throw new Error(`Upstream Chat tool call at index ${index} is missing id.`)
  if (!name) throw new Error(`Upstream Chat tool call "${callId}" is missing function.name.`)
  if (typeof argumentsText !== 'string') {
    throw new Error(`Upstream Chat tool call "${callId}" is missing string function.arguments.`)
  }
  return { callId, name, argumentsText }
}

function responseTextItem(id: string, text: string): JsonObject {
  return {
    id,
    type: 'message',
    status: 'completed',
    role: 'assistant',
    content: [
      {
        type: 'output_text',
        text,
        annotations: [],
      },
    ],
  }
}

function responseFunctionCallItem(
  toolCall: ChatCompletionToolCall,
  index: number
): JsonObject {
  const { callId, name, argumentsText } = requireFunctionCallFields(toolCall, index)
  return {
    id: functionItemId(callId),
    type: 'function_call',
    status: 'completed',
    call_id: callId,
    name,
    arguments: argumentsText,
  }
}

export function chatCompletionToResponses(
  response: ChatCompletionResponse,
  fallbackModel: string,
  id = responseId()
): JsonObject {
  const text = extractText(response)
  const toolCalls = extractToolCalls(response)
  const output: JsonObject[] = []
  if (text.trim() || toolCalls.length === 0) {
    output.push(responseTextItem(itemId(), text))
  }
  toolCalls.forEach((toolCall, index) => {
    output.push(responseFunctionCallItem(toolCall, index))
  })

  return {
    id,
    object: 'response',
    created_at: response.created || Math.floor(Date.now() / 1000),
    status: 'completed',
    error: null,
    incomplete_details: null,
    model: response.model || fallbackModel,
    output,
    output_text: text,
    finish_reason: response.choices?.[0]?.finish_reason ?? null,
    usage: mapUsage(response.usage),
  }
}

export function createResponsesStreamState(): ResponsesStreamState {
  return {
    nextOutputIndex: 0,
    textItems: [],
    functionCalls: new Map(),
  }
}

export function createResponsesStreamCreated(id: string, model: string): GatewaySseEvent {
  return {
    event: 'response.created',
    data: JSON.stringify({
      type: 'response.created',
      response: {
        id,
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        status: 'in_progress',
        model,
        output: [],
      },
    }),
  }
}

function createTextStreamStart(item: ResponsesTextStreamItem): GatewaySseEvent[] {
  return [
    {
      event: 'response.output_item.added',
      data: JSON.stringify({
        type: 'response.output_item.added',
        output_index: item.outputIndex,
        item: {
          id: item.id,
          type: 'message',
          status: 'in_progress',
          role: 'assistant',
          content: [],
        },
      }),
    },
    {
      event: 'response.content_part.added',
      data: JSON.stringify({
        type: 'response.content_part.added',
        item_id: item.id,
        output_index: item.outputIndex,
        content_index: 0,
        part: {
          type: 'output_text',
          text: '',
          annotations: [],
        },
      }),
    },
  ]
}

function createTextStreamStop(item: ResponsesTextStreamItem): GatewaySseEvent[] {
  if (item.closed) return []
  item.closed = true
  return [
    {
      event: 'response.output_text.done',
      data: JSON.stringify({
        type: 'response.output_text.done',
        item_id: item.id,
        output_index: item.outputIndex,
        content_index: 0,
        text: item.text,
      }),
    },
    {
      event: 'response.content_part.done',
      data: JSON.stringify({
        type: 'response.content_part.done',
        item_id: item.id,
        output_index: item.outputIndex,
        content_index: 0,
        part: {
          type: 'output_text',
          text: item.text,
          annotations: [],
        },
      }),
    },
    {
      event: 'response.output_item.done',
      data: JSON.stringify({
        type: 'response.output_item.done',
        output_index: item.outputIndex,
        item: responseTextItem(item.id, item.text),
      }),
    },
  ]
}

function createFunctionCallStreamStart(item: ResponsesFunctionStreamItem): GatewaySseEvent[] {
  if (!item.started || !item.id || !item.name || typeof item.outputIndex !== 'number' || !item.itemId) return []
  const events: GatewaySseEvent[] = [
    {
      event: 'response.output_item.added',
      data: JSON.stringify({
        type: 'response.output_item.added',
        output_index: item.outputIndex,
        item: {
          id: item.itemId,
          type: 'function_call',
          status: 'in_progress',
          call_id: item.id,
          name: item.name,
          arguments: '',
        },
      }),
    },
  ]
  if (item.arguments) {
    events.push({
      event: 'response.function_call_arguments.delta',
      data: JSON.stringify({
        type: 'response.function_call_arguments.delta',
        item_id: item.itemId,
        output_index: item.outputIndex,
        delta: item.arguments,
      }),
    })
  }
  return events
}

function ensureActiveTextItem(state: ResponsesStreamState): {
  item: ResponsesTextStreamItem
  events: GatewaySseEvent[]
} {
  if (state.activeTextItem && !state.activeTextItem.closed) {
    return { item: state.activeTextItem, events: [] }
  }
  const item: ResponsesTextStreamItem = {
    id: itemId(),
    outputIndex: state.nextOutputIndex++,
    text: '',
    closed: false,
  }
  state.textItems.push(item)
  state.activeTextItem = item
  return { item, events: createTextStreamStart(item) }
}

function closeActiveTextItem(state: ResponsesStreamState): GatewaySseEvent[] {
  const item = state.activeTextItem
  if (!item) return []
  const events = createTextStreamStop(item)
  state.activeTextItem = undefined
  return events
}

function appendToolCallDelta(
  toolCall: ChatCompletionToolCall,
  fallbackIndex: number,
  state: ResponsesStreamState
): GatewaySseEvent[] {
  const index = Number.isInteger(toolCall.index) && Number(toolCall.index) >= 0
    ? Number(toolCall.index)
    : fallbackIndex
  const item = state.functionCalls.get(index) ?? {
    sourceIndex: index,
    arguments: '',
    started: false,
  }
  const callId = toolCall.id?.trim()
  const name = toolCall.function?.name?.trim()
  const argumentDelta = toolCall.function?.arguments
  if (callId) item.id = callId
  if (name) item.name = name
  if (typeof argumentDelta === 'string' && argumentDelta) item.arguments += argumentDelta
  state.functionCalls.set(index, item)

  if (!item.started && item.id && item.name) {
    item.started = true
    item.outputIndex = state.nextOutputIndex++
    item.itemId = functionItemId(item.id)
    return createFunctionCallStreamStart(item)
  }
  if (!item.started || !item.itemId || typeof item.outputIndex !== 'number' || !argumentDelta) return []
  return [{
    event: 'response.function_call_arguments.delta',
    data: JSON.stringify({
      type: 'response.function_call_arguments.delta',
      item_id: item.itemId,
      output_index: item.outputIndex,
      delta: argumentDelta,
    }),
  }]
}

/**
 * Maintains backward compatibility for text-only callers when a string item id is supplied.
 * New stream proxies should pass a ResponsesStreamState so function calls can be accumulated.
 */
export function chatStreamChunkToResponsesEvents(
  chunk: ChatCompletionResponse,
  stateOrOutputItemId: ResponsesStreamState | string
): GatewaySseEvent[] {
  if (typeof stateOrOutputItemId === 'string') {
    const delta = extractDeltaText(chunk)
    if (!delta) return []
    return [{
      event: 'response.output_text.delta',
      data: JSON.stringify({
        type: 'response.output_text.delta',
        item_id: stateOrOutputItemId,
        output_index: 0,
        content_index: 0,
        delta,
      }),
    }]
  }

  const state = stateOrOutputItemId
  const events: GatewaySseEvent[] = []
  const delta = extractDeltaText(chunk)
  if (delta) {
    const textItem = ensureActiveTextItem(state)
    textItem.item.text += delta
    events.push(...textItem.events, {
      event: 'response.output_text.delta',
      data: JSON.stringify({
        type: 'response.output_text.delta',
        item_id: textItem.item.id,
        output_index: textItem.item.outputIndex,
        content_index: 0,
        delta,
      }),
    })
  }

  const toolCalls = chunk.choices?.[0]?.delta?.tool_calls
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return events
  events.push(...closeActiveTextItem(state))
  toolCalls.forEach((toolCall, index) => {
    events.push(...appendToolCallDelta(toolCall, index, state))
  })
  return events
}

function streamFunctionCallToOutputItem(item: ResponsesFunctionStreamItem): JsonObject {
  if (!item.id || !item.name || !item.itemId || typeof item.outputIndex !== 'number') {
    throw new Error(`Upstream Chat tool call at index ${item.sourceIndex} did not provide id and function.name.`)
  }
  return {
    id: item.itemId,
    type: 'function_call',
    status: 'completed',
    call_id: item.id,
    name: item.name,
    arguments: item.arguments,
  }
}

export function createResponsesStreamFinish(
  id: string,
  model: string,
  state: ResponsesStreamState,
  usage?: JsonObject,
  finishReason?: string | null
): GatewaySseEvent[] {
  const events = closeActiveTextItem(state)
  const functionCalls = Array.from(state.functionCalls.values())
    .sort((left, right) => left.sourceIndex - right.sourceIndex)

  for (const call of functionCalls) {
    const item = streamFunctionCallToOutputItem(call)
    events.push(
      {
        event: 'response.function_call_arguments.done',
        data: JSON.stringify({
          type: 'response.function_call_arguments.done',
          item_id: call.itemId,
          output_index: call.outputIndex,
          arguments: call.arguments,
        }),
      },
      {
        event: 'response.output_item.done',
        data: JSON.stringify({
          type: 'response.output_item.done',
          output_index: call.outputIndex,
          item,
        }),
      }
    )
  }

  const output = [
    ...state.textItems.map((item) => ({
      outputIndex: item.outputIndex,
      item: responseTextItem(item.id, item.text),
    })),
    ...functionCalls.map((call) => ({
      outputIndex: call.outputIndex!,
      item: streamFunctionCallToOutputItem(call),
    })),
  ]
    .sort((left, right) => left.outputIndex - right.outputIndex)
    .map(({ item }) => item)
  const outputText = state.textItems.map((item) => item.text).join('')
  events.push({
    event: 'response.completed',
    data: JSON.stringify({
      type: 'response.completed',
      response: {
        id,
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        status: 'completed',
        model,
        output,
        output_text: outputText,
        finish_reason: finishReason ?? null,
        usage: mapUsage(usage),
      },
    }),
  })
  return events
}

export function createResponsesStreamStart(
  id: string,
  outputItemId: string,
  model: string
): GatewaySseEvent[] {
  const textItem: ResponsesTextStreamItem = {
    id: outputItemId,
    outputIndex: 0,
    text: '',
    closed: false,
  }
  return [
    createResponsesStreamCreated(id, model),
    ...createTextStreamStart(textItem),
  ]
}

export function createResponsesStreamStop(
  id: string,
  outputItemId: string,
  model: string,
  text: string,
  usage?: JsonObject
): GatewaySseEvent[] {
  const state = createResponsesStreamState()
  const textItem: ResponsesTextStreamItem = {
    id: outputItemId,
    outputIndex: 0,
    text,
    closed: false,
  }
  state.textItems.push(textItem)
  state.activeTextItem = textItem
  state.nextOutputIndex = 1
  return createResponsesStreamFinish(id, model, state, usage)
}

export function createResponsesStreamIds(): { responseId: string; outputItemId: string } {
  return {
    responseId: responseId(),
    outputItemId: itemId(),
  }
}
