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
  normalizedToolCalls: ChatCompletionToolCall[]
}

type JsonSchema = JsonObject
type NormalizedToolCallState = {
  toolCall: ChatCompletionToolCall
  rawArguments: string
  parsedArguments?: unknown
  parseError?: string
  compatibilityWarnings: string[]
}

const LEGACY_STRING_ENUM_ALIASES: Record<string, string[]> = {
  files_with_match: ['files_with_matches'],
}

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

function enumStringValues(schema: JsonSchema): string[] {
  return Array.isArray(schema.enum)
    ? schema.enum.filter((item): item is string => typeof item === 'string')
    : []
}

function resolveLegacyEnumAlias(value: unknown, schema: JsonSchema): string | undefined {
  if (typeof value !== 'string') return undefined
  const declaredEnumValues = enumStringValues(schema)
  if (declaredEnumValues.includes(value)) return undefined
  const candidates = LEGACY_STRING_ENUM_ALIASES[value]
  if (!candidates?.length) return undefined
  return candidates.find((candidate) => declaredEnumValues.includes(candidate))
}

function normalizeArgumentsForSchema(
  value: unknown,
  schema: JsonSchema,
  path: string[] = []
): {
  value: unknown
  warnings: string[]
} {
  let normalizedValue = value
  const warnings: string[] = []
  const aliasedValue = resolveLegacyEnumAlias(normalizedValue, schema)
  if (aliasedValue) {
    warnings.push(
      `${formatPath(path)} normalized from ${JSON.stringify(normalizedValue)} to ${JSON.stringify(aliasedValue)} for schema compatibility.`
    )
    normalizedValue = aliasedValue
  }

  if (Array.isArray(normalizedValue) && isJsonObject(schema.items)) {
    let changed = false
    const nextArray = normalizedValue.map((item, index) => {
      const normalizedItem = normalizeArgumentsForSchema(item, schema.items as JsonSchema, [...path, String(index)])
      warnings.push(...normalizedItem.warnings)
      if (!isEqualJsonValue(normalizedItem.value, item)) changed = true
      return normalizedItem.value
    })
    if (changed) normalizedValue = nextArray
  }

  if (isJsonObject(normalizedValue)) {
    const properties = propertySchemas(schema)
    const additionalProperties = isJsonObject(schema.additionalProperties)
      ? schema.additionalProperties as JsonSchema
      : undefined
    let changed = false
    const nextObject: JsonObject = { ...normalizedValue }
    for (const [key, childValue] of Object.entries(normalizedValue)) {
      const propertySchema = isJsonObject(properties[key])
        ? properties[key] as JsonSchema
        : additionalProperties
      if (!propertySchema) continue
      const normalizedChild = normalizeArgumentsForSchema(childValue, propertySchema, [...path, key])
      warnings.push(...normalizedChild.warnings)
      if (isEqualJsonValue(normalizedChild.value, childValue)) continue
      nextObject[key] = normalizedChild.value
      changed = true
    }
    if (changed) normalizedValue = nextObject
  }

  return {
    value: normalizedValue,
    warnings,
  }
}

function normalizeToolCallArguments(
  toolCall: ChatCompletionToolCall,
  schema: JsonSchema | undefined
): NormalizedToolCallState {
  const rawArguments = toolCall.function?.arguments ?? ''
  const parsed = parseToolArguments(rawArguments)
  if (!parsed.ok) {
    return {
      toolCall,
      rawArguments,
      parseError: parsed.error,
      compatibilityWarnings: [],
    }
  }

  const normalized = isJsonObject(schema)
    ? normalizeArgumentsForSchema(parsed.value, schema)
    : { value: parsed.value, warnings: [] }
  const normalizedArguments = normalized.warnings.length > 0
    ? JSON.stringify(normalized.value)
    : rawArguments

  return {
    toolCall: normalized.warnings.length > 0
      ? {
        ...toolCall,
        function: {
          ...toolCall.function,
          arguments: normalizedArguments,
        },
      }
      : toolCall,
    rawArguments,
    parsedArguments: normalized.value,
    compatibilityWarnings: normalized.warnings,
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
  const normalizedStates = toolCalls.map((toolCall, fallbackIndex) => {
    const index = typeof toolCall.index === 'number' && Number.isInteger(toolCall.index)
      ? toolCall.index
      : fallbackIndex
    const name = toolCall.function?.name?.trim()
    const schema = name ? schemasByName.get(name) : undefined
    return {
      index,
      name,
      normalized: normalizeToolCallArguments(toolCall, isJsonObject(schema) ? schema : undefined),
    }
  })

  const entries = normalizedStates.map(({ index, name, normalized }): AiGatewayToolValidationEntry => {
    const validationErrors: string[] = []
    let parsedArguments = normalized.parsedArguments

    if (!name) {
      validationErrors.push('Tool call is missing function.name.')
    } else if (!hasDeclaredTools || !schemasByName.has(name)) {
      validationErrors.push(`Tool call "${name}" was not declared in request.tools.`)
    }

    if (normalized.parseError) {
      validationErrors.push(normalized.parseError)
    } else {
      const schema = name ? schemasByName.get(name) : undefined
      if (isJsonObject(schema) && typeof parsedArguments !== 'undefined') {
        validationErrors.push(...validateSchema(parsedArguments, schema, []))
      }
    }

    const schemaValid = validationErrors.length === 0
    return {
      index,
      id: normalized.toolCall.id?.trim() || undefined,
      name: name || undefined,
      rawArguments: normalized.rawArguments,
      parsedArguments,
      schemaValid,
      validationErrors,
      diagnosticWarnings: [
        ...normalized.compatibilityWarnings,
        ...(typeof parsedArguments === 'undefined'
          ? []
          : collectDiagnosticWarnings(parsedArguments)),
      ],
      forwarded: schemaValid,
    }
  })

  return {
    valid: entries.every((entry) => entry.schemaValid),
    entries,
    normalizedToolCalls: normalizedStates.map(({ normalized }) => normalized.toolCall),
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
