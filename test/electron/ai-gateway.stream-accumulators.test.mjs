import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const streams = loadTsModule('src/core/electron/main/ai-gateway/gateway-stream-accumulators.ts')
const observability = loadTsModule('src/core/electron/main/ai-gateway/gateway-stream-observability.ts')

test('chat stream accumulator joins fragmented tool calls in index order', () => {
  const accumulator = streams.createChatToolCallTraceAccumulator()
  accumulator.append({ choices: [{ delta: { tool_calls: [{ index: 1, id: 'call-b', function: { name: 'second', arguments: '{"b":' } }] } }] })
  accumulator.append({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-a', function: { name: 'first', arguments: '{"a":1}' } }] } }] })
  accumulator.append({ choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '2}' } }] } }] })

  assert.deepEqual(accumulator.snapshot(), [
    { id: 'call-a', index: 0, type: 'function', function: { name: 'first', arguments: '{"a":1}' } },
    { id: 'call-b', index: 1, type: 'function', function: { name: 'second', arguments: '{"b":2}' } },
  ])
})

test('Anthropic content accumulator preserves text and tool input blocks', () => {
  const accumulator = streams.createAnthropicContentTraceAccumulator()
  accumulator.appendParsed({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Hello' } })
  accumulator.appendParsed({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' world' } })
  accumulator.appendParsed({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tool-1', name: 'lookup' } })
  accumulator.appendParsed({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"q":"codex"}' } })

  assert.deepEqual(accumulator.snapshot(), [
    { type: 'text', text: 'Hello world' },
    { type: 'tool_use', id: 'tool-1', name: 'lookup', input: { q: 'codex' } },
  ])
})

test('raw SSE fallback and completed Responses payload are deterministic', () => {
  const raw = streams.buildRawSsePayload({ rawText: 'data: [DONE]\n\n', sizeBytes: 16, truncated: false })
  assert.equal(raw.format, 'server-sent-events')
  assert.deepEqual(streams.findResponseCompletedPayload([{ data: '{"type":"response.output_text.delta","delta":"hi"}' }, { data: '{"type":"response.completed","response":{"id":"resp_1","output_text":"hi"}}' }]), { id: 'resp_1', output_text: 'hi' })
})

test('stream helpers tolerate malformed SSE and preserve stop metadata', () => {
  assert.equal(streams.parseJsonRecord('{malformed'), undefined)
  assert.deepEqual(
    streams.readAnthropicStopMetadata(
      [
        { event: 'message_delta', data: '{"delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":7}}' },
        { event: 'message_delta', data: '{not-json' },
      ],
      null,
      { input_tokens: 2 },
    ),
    { stopReason: 'tool_use', usage: { output_tokens: 7 } },
  )
  assert.deepEqual(streams.buildChatStreamPayload('gpt-test', '', 'tool_calls', undefined, [{ id: 'call-1', index: 0, type: 'function', function: { name: 'lookup', arguments: '{"q":"x"}' } }]), {
    object: 'chat.completion',
    model: 'gpt-test',
    choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', index: 0, type: 'function', function: { name: 'lookup', arguments: '{"q":"x"}' } }] }, finish_reason: 'tool_calls' }],
    usage: undefined,
  })
})

test('stream observability keeps bounded merged snapshots provider-neutral', () => {
  const trace = {}
  observability.updateGatewayStreamTrace(trace, {
    requested: true,
    enabled: true,
    upstreamEventCount: 2,
    previewEvents: [{ event: 'message' }],
    upstreamText: 'upstream',
    upstreamPayload: { object: 'chat.completion' },
    clientText: 'client',
    clientPayload: { type: 'message' },
    finishReason: 'stop',
    usage: { output_tokens: 3 },
    maxBodyBytes: 1024,
  })
  assert.equal(trace.stream.upstreamEventCount, 2)
  assert.equal(trace.stream.merged.upstreamText.rawText, 'upstream')
  assert.equal(trace.stream.merged.clientPayload.parsed.type, 'message')
})
