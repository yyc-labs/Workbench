export type JsonObject = Record<string, unknown>

export type ChatMessageRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool'

export interface ChatCompletionTool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: JsonObject
    strict?: boolean
  }
}

export interface ChatCompletionToolCall {
  id?: string
  index?: number
  type?: string
  function?: {
    name?: string
    arguments?: string
  }
}

export type ChatCompletionToolChoice =
  | 'none'
  | 'auto'
  | 'required'
  | {
    type: 'function'
    function: {
      name: string
    }
  }

export interface ChatCompletionMessage extends JsonObject {
  role: ChatMessageRole
  content?: string | null
  tool_calls?: ChatCompletionToolCall[]
  tool_call_id?: string
  name?: string
}

export interface ChatCompletionRequest extends JsonObject {
  model: string
  messages: ChatCompletionMessage[]
  stream?: boolean
  max_tokens?: number
  temperature?: number
  top_p?: number
  tools?: ChatCompletionTool[]
  tool_choice?: ChatCompletionToolChoice
  parallel_tool_calls?: boolean
}

export interface ChatCompletionChoice {
  message?: {
    role?: string
    content?: string | null
    tool_calls?: ChatCompletionToolCall[]
  }
  delta?: {
    role?: string
    content?: string | null
    tool_calls?: ChatCompletionToolCall[]
  }
  finish_reason?: string | null
}

export interface ChatCompletionResponse extends JsonObject {
  id?: string
  object?: string
  created?: number
  model?: string
  choices?: ChatCompletionChoice[]
  usage?: JsonObject
}

export interface AnthropicMessagesRequest extends JsonObject {
  model: string
  messages?: unknown[]
  system?: unknown
  max_tokens?: number
  temperature?: number
  top_p?: number
  stream?: boolean
  tools?: unknown
  tool_choice?: unknown
}

export interface OpenAiResponsesRequest extends JsonObject {
  model: string
  input?: unknown
  instructions?: unknown
  stream?: boolean
  temperature?: number
  top_p?: number
  max_output_tokens?: number
  tools?: unknown
  reasoning?: unknown
}

export interface GatewaySseEvent {
  event?: string
  data: string
}

export class GatewayRouteError extends Error {
  readonly statusCode: number
  readonly code: string

  constructor(message: string, code: string, statusCode = 400) {
    super(message)
    this.name = 'GatewayRouteError'
    this.code = code
    this.statusCode = statusCode
  }
}

export class UnsupportedGatewayFeatureError extends GatewayRouteError {
  constructor(message: string) {
    super(message, 'unsupported_feature', 400)
    this.name = 'UnsupportedGatewayFeatureError'
  }
}

export class ToolValidationGatewayError extends GatewayRouteError {
  constructor(message: string) {
    super(message, 'tool_validation_failed', 400)
    this.name = 'ToolValidationGatewayError'
  }
}

export function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function getFiniteNumber(value: unknown): number | undefined {
  return Number.isFinite(value) ? Number(value) : undefined
}

export function resolveMappedModel(model: string, modelMap?: Record<string, string>): string {
  const normalized = model.trim()
  return modelMap?.[normalized]?.trim() || normalized
}

export function hasNonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0
}

export function hasNonEmptyObject(value: unknown): boolean {
  return isJsonObject(value) && Object.keys(value).length > 0
}
