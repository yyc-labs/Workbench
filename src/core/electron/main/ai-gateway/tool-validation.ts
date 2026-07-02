import type { AiGatewayToolValidationEntry } from '../../../shared/types'
import type {
  ChatCompletionResponse,
  ChatCompletionTool,
  ChatCompletionToolCall,
  JsonObject,
} from './protocol-types'
import {
  isJsonObject,
  ToolValidationGatewayError,
} from './protocol-types'

export type ToolValidationReport = {
  valid: boolean
  entries: AiGatewayToolValidationEntry[]
}

type JsonSchema = JsonObject

function schemaName(tool: ChatCompletionTool): string {
  return tool.function.name.trim()
}

function schemaTypeNames(schema: JsonSchema): string[] {
  const type = schema.type
  if (typeof type === 'string') return [type]
  if (Array.isArray(type)) return type.filter((item): item is string => typeof item === 'string')
  return []
}

function valueTypeName(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (Number.isInteger(value)) return 'integer'
  return typeof value
}

function valueMatchesType(value: unknown, type: string): boolean {
  if (type === 'null') return value === null
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return isJsonObject(value)
  if (type === 'integer') return Number.isInteger(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  return typeof value === type
}

function formatPath(path: string[]): string {
  if (path.length === 0) return '$'
  return `$${path.map((segment) => /^[A-Za-z_$][\w$]*$/.test(segment) ? `.${segment}` : `[${JSON.stringify(segment)}]`).join('')}`
}

function stringifyComparable(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function isEqualJsonValue(left: unknown, right: unknown): boolean {
  return stringifyComparable(left) === stringifyComparable(right)
}

function propertySchemas(schema: JsonSchema): Record<string, unknown> {
  return isJsonObject(schema.properties) ? schema.properties : {}
}

function requiredProperties(schema: JsonSchema): string[] {
  return Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function validateSchema(value: unknown, schema: JsonSchema, path: string[]): string[] {
  const errors: string[] = []
  const pathLabel = formatPath(path)
  const types = schemaTypeNames(schema)
  const effectiveTypes = types.length > 0
    ? types
    : isJsonObject(schema.properties) || Array.isArray(schema.required)
      ? ['object']
      : []

  if (effectiveTypes.length > 0 && !effectiveTypes.some((type) => valueMatchesType(value, type))) {
    errors.push(`${pathLabel} expected ${effectiveTypes.join(' or ')}, got ${valueTypeName(value)}.`)
    return errors
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((item) => isEqualJsonValue(item, value))) {
    errors.push(`${pathLabel} must be one of ${schema.enum.map(stringifyComparable).join(', ')}.`)
  }

  if (Object.prototype.hasOwnProperty.call(schema, 'const') && !isEqualJsonValue(schema.const, value)) {
    errors.push(`${pathLabel} must equal ${stringifyComparable(schema.const)}.`)
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(`${pathLabel} must contain at least ${schema.minLength} characters.`)
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push(`${pathLabel} must contain at most ${schema.maxLength} characters.`)
    }
    if (typeof schema.pattern === 'string') {
      try {
        const pattern = new RegExp(schema.pattern)
        if (!pattern.test(value)) {
          errors.push(`${pathLabel} must match pattern ${schema.pattern}.`)
        }
      } catch {
        errors.push(`${pathLabel} uses invalid schema pattern ${schema.pattern}.`)
      }
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${pathLabel} must be >= ${schema.minimum}.`)
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${pathLabel} must be <= ${schema.maximum}.`)
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${pathLabel} must contain at least ${schema.minItems} items.`)
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push(`${pathLabel} must contain at most ${schema.maxItems} items.`)
    }
    if (isJsonObject(schema.items)) {
      value.forEach((item, index) => {
        errors.push(...validateSchema(item, schema.items as JsonSchema, [...path, String(index)]))
      })
    }
  }

  if (isJsonObject(value)) {
    const properties = propertySchemas(schema)
    for (const required of requiredProperties(schema)) {
      if (!Object.prototype.hasOwnProperty.call(value, required)) {
        errors.push(`${pathLabel}.${required} is required.`)
      }
    }

    for (const [key, childSchema] of Object.entries(properties)) {
      if (!Object.prototype.hasOwnProperty.call(value, key) || !isJsonObject(childSchema)) continue
      errors.push(...validateSchema(value[key], childSchema as JsonSchema, [...path, key]))
    }

    const additionalProperties = schema.additionalProperties
    if (additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          errors.push(`${pathLabel}.${key} is not allowed by schema.additionalProperties=false.`)
        }
      }
    } else if (isJsonObject(additionalProperties)) {
      for (const key of Object.keys(value)) {
        if (Object.prototype.hasOwnProperty.call(properties, key)) continue
        errors.push(...validateSchema(value[key], additionalProperties as JsonSchema, [...path, key]))
      }
    }
  }

  return errors
}

function isPathLikeKey(key: string): boolean {
  const normalized = key.toLowerCase()
  return normalized === 'path'
    || normalized.endsWith('_path')
    || normalized === 'file'
    || normalized === 'file_path'
    || normalized === 'filepath'
    || normalized.endsWith('filename')
}

function isCommandLikeKey(key: string): boolean {
  const normalized = key.toLowerCase()
  return normalized === 'command'
    || normalized.endsWith('_command')
    || normalized === 'cmd'
    || normalized === 'shell'
}

function collectDiagnosticWarnings(value: unknown, path: string[] = []): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectDiagnosticWarnings(item, [...path, String(index)]))
  }
  if (!isJsonObject(value)) return []

  const warnings: string[] = []
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key]
    const pathLabel = formatPath(childPath)
    if (typeof child === 'string') {
      const trimmed = child.trim()
      if (isPathLikeKey(key)) {
        if (!trimmed) {
          warnings.push(`${pathLabel} is an empty path-like argument.`)
        } else if (/^(void|0|prettier|currentInputs|output\.probability|\(\)|,)$/.test(trimmed)) {
          warnings.push(`${pathLabel} looks like a code token rather than a file path.`)
        }
      }
      if (isCommandLikeKey(key) && /\bgit\s+add\s+-A\b/i.test(trimmed)) {
        warnings.push(`${pathLabel} stages all files; Gateway records this as diagnostic context only.`)
      }
    }
    warnings.push(...collectDiagnosticWarnings(child, childPath))
  }
  return warnings
}

function parseToolArguments(rawArguments: string | undefined): {
  ok: true
  value: unknown
} | {
  ok: false
  error: string
} {
  const normalized = rawArguments?.trim()
  if (!normalized) return { ok: true, value: {} }
  try {
    return { ok: true, value: JSON.parse(normalized) as unknown }
  } catch {
    return { ok: false, error: 'Tool arguments are not valid JSON.' }
  }
}

export function validateChatToolCalls(
  toolCalls: ChatCompletionToolCall[],
  tools: ChatCompletionTool[] | undefined
): ToolValidationReport {
  const schemasByName = new Map(
    (tools ?? [])
      .filter((tool) => tool.type === 'function' && schemaName(tool))
      .map((tool) => [schemaName(tool), tool.function.parameters] as const)
  )
  const hasDeclaredTools = schemasByName.size > 0

  const entries = toolCalls.map((toolCall, fallbackIndex): AiGatewayToolValidationEntry => {
    const index = typeof toolCall.index === 'number' && Number.isInteger(toolCall.index)
      ? toolCall.index
      : fallbackIndex
    const name = toolCall.function?.name?.trim()
    const rawArguments = toolCall.function?.arguments ?? ''
    const validationErrors: string[] = []
    let parsedArguments: unknown

    if (!name) {
      validationErrors.push('Tool call is missing function.name.')
    } else if (!hasDeclaredTools || !schemasByName.has(name)) {
      validationErrors.push(`Tool call "${name}" was not declared in request.tools.`)
    }

    const parsed = parseToolArguments(rawArguments)
    if (!parsed.ok) {
      validationErrors.push(parsed.error)
    } else {
      parsedArguments = parsed.value
      const schema = name ? schemasByName.get(name) : undefined
      if (isJsonObject(schema)) {
        validationErrors.push(...validateSchema(parsed.value, schema, []))
      }
    }

    const schemaValid = validationErrors.length === 0
    return {
      index,
      id: toolCall.id?.trim() || undefined,
      name: name || undefined,
      rawArguments,
      parsedArguments,
      schemaValid,
      validationErrors,
      diagnosticWarnings: typeof parsedArguments === 'undefined'
        ? undefined
        : collectDiagnosticWarnings(parsedArguments),
      forwarded: schemaValid,
    }
  })

  return {
    valid: entries.every((entry) => entry.schemaValid),
    entries,
  }
}

export function validateChatCompletionToolCalls(
  response: ChatCompletionResponse,
  tools: ChatCompletionTool[] | undefined
): ToolValidationReport {
  const toolCalls = response.choices?.[0]?.message?.tool_calls
  return validateChatToolCalls(Array.isArray(toolCalls) ? toolCalls : [], tools)
}

export function anthropicToolsToValidationTools(tools: unknown): ChatCompletionTool[] {
  if (!Array.isArray(tools)) return []
  return tools.flatMap((tool): ChatCompletionTool[] => {
    if (!isJsonObject(tool) || typeof tool.name !== 'string' || !tool.name.trim()) return []
    return [{
      type: 'function',
      function: {
        name: tool.name.trim(),
        ...(typeof tool.description === 'string' && tool.description.trim()
          ? { description: tool.description.trim() }
          : {}),
        ...(isJsonObject(tool.input_schema) ? { parameters: tool.input_schema } : {}),
      },
    }]
  })
}

export function validateAnthropicToolUseBlocks(
  content: unknown,
  tools: ChatCompletionTool[] | undefined
): ToolValidationReport {
  const blocks = Array.isArray(content) ? content : []
  const toolCalls = blocks.flatMap((block, index): ChatCompletionToolCall[] => {
    if (!isJsonObject(block) || block.type !== 'tool_use') return []
    return [{
      id: typeof block.id === 'string' ? block.id : undefined,
      index,
      type: 'function',
      function: {
        name: typeof block.name === 'string' ? block.name : undefined,
        arguments: JSON.stringify(block.input ?? {}),
      },
    }]
  })
  return validateChatToolCalls(toolCalls, tools)
}

export function toolValidationFailureMessage(report: ToolValidationReport): string {
  const firstFailure = report.entries.find((entry) => !entry.schemaValid)
  if (!firstFailure) return 'Tool arguments failed validation.'
  const label = firstFailure.name ? ` "${firstFailure.name}"` : ''
  const detail = firstFailure.validationErrors[0] || 'Tool arguments failed validation.'
  return `Tool call${label} failed validation: ${detail}`
}

export function assertToolValidationPassed(report: ToolValidationReport): void {
  if (report.valid) return
  throw new ToolValidationGatewayError(toolValidationFailureMessage(report))
}
