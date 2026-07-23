import type { StructuredJsonSnapshot } from '../../../shared/types'
import type { ChatCompletionResponse, ChatCompletionToolCall, JsonObject } from './protocol-types'

export function extractFinishReason(chunk: ChatCompletionResponse): string | null | undefined {
  return chunk.choices?.[0]?.finish_reason
}

export function extractUsage(chunk: ChatCompletionResponse): JsonObject | undefined {
  return chunk.usage
}

export function extractDeltaText(chunk: ChatCompletionResponse): string {
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

export function isJsonRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function parseJsonRecord(value: string): JsonObject | undefined {
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

export function createChatToolCallTraceAccumulator(): {
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

export function buildChatStreamPayload(model: string, text: string, finishReason: string | null | undefined, usage: JsonObject | undefined, toolCalls: ChatCompletionToolCall[] = []): JsonObject | undefined {
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
          content: hasVisibleText ? text : toolCalls.length > 0 ? null : '',
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finishReason ?? null,
      },
    ],
    usage,
  }
}

function ensureAnthropicTextBlock(blocks: Map<number, AnthropicTraceContentBlock>, index: number): AnthropicTraceContentBlock {
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

function ensureAnthropicToolBlock(blocks: Map<number, AnthropicTraceContentBlock>, index: number): AnthropicTraceContentBlock {
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

export function createAnthropicContentTraceAccumulator(): {
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
          return [
            {
              type: 'tool_use',
              id: block.id || `toolu_trace_${block.index}`,
              name: block.name || 'unknown_tool',
              input,
              ...(rawInputJson ? { raw_input_json: rawInputJson } : {}),
            },
          ]
        })

      const hasTextBlock = content.some((block) => block.type === 'text')
      if (!hasTextBlock && fallbackText.trim()) {
        content.unshift({ type: 'text', text: fallbackText })
      }
      return content
    },
  }
}

export function buildRawSsePayload(snapshot: StructuredJsonSnapshot | undefined): JsonObject | undefined {
  if (!snapshot?.rawText) return undefined
  return {
    format: 'server-sent-events',
    note: 'Raw SSE captured because this stream route did not produce a final JSON payload.',
    rawText: snapshot.rawText,
    sizeBytes: snapshot.sizeBytes,
    truncated: snapshot.truncated,
  }
}

export function findResponseCompletedPayload(events: Array<{ data: string }>): JsonObject | undefined {
  for (const event of events) {
    const parsed = parseJsonRecord(event.data)
    if (parsed?.type === 'response.completed' && isJsonRecord(parsed.response)) {
      return parsed.response
    }
  }
  return undefined
}

export function readAnthropicStopMetadata(events: Array<{ event?: string; data: string }>, fallbackReason: string | null | undefined, fallbackUsage: JsonObject | undefined): { stopReason: string | null | undefined; usage: unknown } {
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

export function buildAnthropicMessagePayload({ id, model, text, contentBlocks, stopReason, usage }: { id: string; model: string; text: string; contentBlocks?: JsonObject[]; stopReason: string | null | undefined; usage: unknown }): JsonObject | undefined {
  const content = contentBlocks && contentBlocks.length > 0 ? contentBlocks : text.trim() || typeof stopReason !== 'undefined' || typeof usage !== 'undefined' ? [{ type: 'text', text }] : []
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

export function readAnthropicPassthroughEvent(parsed: JsonObject | undefined): {
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
      stopReason: typeof delta?.stop_reason === 'string' || delta?.stop_reason === null ? delta.stop_reason : undefined,
      usage: parsed.usage,
    }
  }
  return {}
}
