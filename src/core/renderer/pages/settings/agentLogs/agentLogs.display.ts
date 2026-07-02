import type { StructuredJsonSnapshot } from '../../../../shared/types'

export type JsonRecord = Record<string, unknown>

export function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function displayText(value: string): string {
  return value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
}

export function displayJsonString(value: string): string {
  return value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
}

export function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') return displayJsonString(value)
  if (typeof value === 'undefined') return 'undefined'
  try {
    const json = JSON.stringify(value, null, 2)
    return typeof json === 'string' ? json : String(value)
  } catch {
    return String(value)
  }
}

export function snapshotValue(snapshot: StructuredJsonSnapshot | undefined): unknown {
  if (!snapshot) return undefined
  return typeof snapshot.parsed !== 'undefined' ? snapshot.parsed : snapshot.rawText
}

export function formatBytes(value: number | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export function getStringLength(value: string): { chars: number; lines: number } {
  const text = displayText(value)
  return {
    chars: text.length,
    lines: text.length === 0 ? 0 : text.split('\n').length,
  }
}

export function extractTextBlocks(value: unknown): string[] {
  if (typeof value === 'string') return [displayText(value)]
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === 'string') return [displayText(item)]
      if (!isRecord(item)) return [stringifyUnknown(item)]
      const label = typeof item.type === 'string' ? `[${item.type}]` : ''
      const text = typeof item.text === 'string'
        ? item.text
        : typeof item.content === 'string'
          ? item.content
          : typeof item.input === 'string'
            ? item.input
            : undefined
      if (text) return [`${label ? `${label}\n` : ''}${displayText(text)}`]
      return [stringifyUnknown(item)]
    })
  }
  if (isRecord(value)) {
    const text = typeof value.text === 'string'
      ? value.text
      : typeof value.content === 'string'
        ? value.content
        : typeof value.input === 'string'
          ? value.input
          : undefined
    if (text) return [displayText(text)]
  }
  return typeof value === 'undefined' ? [] : [stringifyUnknown(value)]
}

export function toDisplayString(value: unknown): string {
  return typeof value === 'string' ? displayText(value) : stringifyUnknown(value)
}
