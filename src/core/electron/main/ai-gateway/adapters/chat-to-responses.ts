import { randomUUID } from 'crypto'
import type {
  ChatCompletionResponse,
  GatewaySseEvent,
  JsonObject,
} from '../protocol-types'

function responseId(): string {
  return `resp_${randomUUID().replace(/-/g, '')}`
}

function itemId(): string {
  return `msg_${randomUUID().replace(/-/g, '')}`
}

function extractText(response: ChatCompletionResponse): string {
  const content = response.choices?.[0]?.message?.content
  return typeof content === 'string' ? content : ''
}

function extractDeltaText(response: ChatCompletionResponse): string {
  const content = response.choices?.[0]?.delta?.content
  return typeof content === 'string' ? content : ''
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

export function chatCompletionToResponses(
  response: ChatCompletionResponse,
  fallbackModel: string,
  id = responseId()
): JsonObject {
  const text = extractText(response)
  const outputItemId = itemId()
  return {
    id,
    object: 'response',
    created_at: response.created || Math.floor(Date.now() / 1000),
    status: 'completed',
    error: null,
    incomplete_details: null,
    model: response.model || fallbackModel,
    output: [
      {
        id: outputItemId,
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
      },
    ],
    output_text: text,
    usage: mapUsage(response.usage),
  }
}

export function createResponsesStreamStart(
  id: string,
  outputItemId: string,
  model: string
): GatewaySseEvent[] {
  const createdAt = Math.floor(Date.now() / 1000)
  return [
    {
      event: 'response.created',
      data: JSON.stringify({
        type: 'response.created',
        response: {
          id,
          object: 'response',
          created_at: createdAt,
          status: 'in_progress',
          model,
          output: [],
        },
      }),
    },
    {
      event: 'response.output_item.added',
      data: JSON.stringify({
        type: 'response.output_item.added',
        output_index: 0,
        item: {
          id: outputItemId,
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
        item_id: outputItemId,
        output_index: 0,
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

export function chatStreamChunkToResponsesEvents(
  chunk: ChatCompletionResponse,
  outputItemId: string
): GatewaySseEvent[] {
  const delta = extractDeltaText(chunk)
  if (!delta) return []

  return [
    {
      event: 'response.output_text.delta',
      data: JSON.stringify({
        type: 'response.output_text.delta',
        item_id: outputItemId,
        output_index: 0,
        content_index: 0,
        delta,
      }),
    },
  ]
}

export function createResponsesStreamStop(
  id: string,
  outputItemId: string,
  model: string,
  text: string,
  usage?: JsonObject
): GatewaySseEvent[] {
  return [
    {
      event: 'response.output_text.done',
      data: JSON.stringify({
        type: 'response.output_text.done',
        item_id: outputItemId,
        output_index: 0,
        content_index: 0,
        text,
      }),
    },
    {
      event: 'response.content_part.done',
      data: JSON.stringify({
        type: 'response.content_part.done',
        item_id: outputItemId,
        output_index: 0,
        content_index: 0,
        part: {
          type: 'output_text',
          text,
          annotations: [],
        },
      }),
    },
    {
      event: 'response.output_item.done',
      data: JSON.stringify({
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          id: outputItemId,
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
        },
      }),
    },
    {
      event: 'response.completed',
      data: JSON.stringify({
        type: 'response.completed',
        response: {
          id,
          object: 'response',
          created_at: Math.floor(Date.now() / 1000),
          status: 'completed',
          model,
          output: [
            {
              id: outputItemId,
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
            },
          ],
          output_text: text,
          usage: mapUsage(usage),
        },
      }),
    },
  ]
}

export function createResponsesStreamIds(): { responseId: string; outputItemId: string } {
  return {
    responseId: responseId(),
    outputItemId: itemId(),
  }
}
