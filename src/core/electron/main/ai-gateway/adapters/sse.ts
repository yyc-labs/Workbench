import type { GatewaySseEvent } from '../protocol-types'

function normalizeData(data: unknown): string {
  return typeof data === 'string' ? data : JSON.stringify(data)
}

export function encodeSseEvent(event: string | undefined, data: unknown): string {
  const lines: string[] = []
  if (event) lines.push(`event: ${event}`)
  const payload = normalizeData(data)
  for (const line of payload.split(/\r?\n/)) {
    lines.push(`data: ${line}`)
  }
  lines.push('', '')
  return lines.join('\n')
}

export function parseSseBlock(block: string): GatewaySseEvent | null {
  const lines = block.split(/\r?\n/)
  const dataLines: string[] = []
  let event: string | undefined

  for (const line of lines) {
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim()
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).replace(/^\s/, ''))
    }
  }

  if (dataLines.length === 0) return null
  return {
    event,
    data: dataLines.join('\n'),
  }
}

export function drainSseEvents(buffer: string): { events: GatewaySseEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const events: GatewaySseEvent[] = []
  let start = 0

  while (true) {
    const index = normalized.indexOf('\n\n', start)
    if (index < 0) break
    const block = normalized.slice(start, index)
    const event = parseSseBlock(block)
    if (event) events.push(event)
    start = index + 2
  }

  return {
    events,
    rest: normalized.slice(start),
  }
}

export async function* decodeSseStream(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<GatewaySseEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const drained = drainSseEvents(buffer)
      buffer = drained.rest
      for (const event of drained.events) {
        yield event
      }
    }

    buffer += decoder.decode()
    const drained = drainSseEvents(buffer)
    for (const event of drained.events) {
      yield event
    }
  } finally {
    reader.releaseLock()
  }
}
