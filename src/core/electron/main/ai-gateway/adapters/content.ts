import {
  isJsonObject,
  UnsupportedGatewayFeatureError,
} from '../protocol-types'

function stringifyPrimitive(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

export function flattenTextContent(value: unknown, context: string): string {
  const primitive = stringifyPrimitive(value)
  if (primitive) return primitive
  if (value === null || value === undefined) return ''

  if (Array.isArray(value)) {
    return value.map((item) => flattenTextContent(item, context)).filter(Boolean).join('\n')
  }

  if (!isJsonObject(value)) return ''

  const type = typeof value.type === 'string' ? value.type : ''
  if (
    type === 'tool_use'
    || type === 'tool_result'
    || type === 'function_call'
    || type === 'function_call_output'
  ) {
    throw new UnsupportedGatewayFeatureError(`${context} contains tool content, which is not supported by AI Gateway MVP.`)
  }

  if (
    type === 'text'
    || type === 'input_text'
    || type === 'output_text'
    || type === 'summary_text'
    || !type
  ) {
    return stringifyPrimitive(value.text)
      || stringifyPrimitive(value.output_text)
      || stringifyPrimitive(value.input_text)
      || stringifyPrimitive(value.content)
  }

  throw new UnsupportedGatewayFeatureError(`${context} contains unsupported content block type "${type}".`)
}
