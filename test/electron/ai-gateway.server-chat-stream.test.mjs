import test from 'node:test'
import {
  assert,
  AiGatewayProviderRegistry,
  AiGatewayServer,
  closeServer,
  createOpenAiChatGatewayConfig,
  getFreePort,
  listen,
  readRequestBody,
  writeChatCompletionStream,
  writeDelayedChatCompletionStream,
  writeGrepCompatToolCallStream,
  writeChatToolCallStream,
  writeInvalidChatToolCallStream,
} from '../helpers/ai-gateway-test-helpers.mjs'

test('records merged stream text for raw Chat streams', async (t) => {
  const { createServer } = await import('node:http')
  const upstream = createServer(async (req, res) => {
    await readRequestBody(req)
    writeChatCompletionStream(res)
  })
  const upstreamPort = await listen(upstream)
  t.after(() => closeServer(upstream))

  const gatewayPort = await getFreePort()
  const config = createOpenAiChatGatewayConfig({ gatewayPort, upstreamPort })
  const registry = new AiGatewayProviderRegistry(config)
  const gateway = new AiGatewayServer({ getConfig: () => config, registry })
  await gateway.start(config)
  t.after(() => gateway.stop())

  const response = await fetch(`http://127.0.0.1:${gatewayPort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-requested',
      stream: true,
      messages: [{ role: 'user', content: 'hello' }],
    }),
  })
  const bodyText = await response.text()

  assert.equal(response.status, 200)
  assert.match(bodyText, /\[DONE\]/)

  const detail = gateway.getRecentLogDetails()[0]
  assert.equal(detail.summary.route, 'chat')
  assert.equal(detail.stream.enabled, true)
  assert.equal(detail.stream.upstreamEventCount, 3)
  assert.equal(detail.stream.merged.upstreamText.rawText, 'Hello')
  assert.equal(detail.stream.merged.clientText.rawText, 'Hello')
  assert.equal(detail.stream.merged.upstreamPayload.parsed.choices[0].message.content, 'Hello')
  assert.equal(detail.stream.merged.clientPayload.parsed.choices[0].message.content, 'Hello')
})

test('records merged stream text for Chat to Anthropic streams', async (t) => {
  const { createServer } = await import('node:http')
  const upstream = createServer(async (req, res) => {
    await readRequestBody(req)
    writeChatCompletionStream(res)
  })
  const upstreamPort = await listen(upstream)
  t.after(() => closeServer(upstream))

  const gatewayPort = await getFreePort()
  const config = createOpenAiChatGatewayConfig({ gatewayPort, upstreamPort })
  const registry = new AiGatewayProviderRegistry(config)
  const gateway = new AiGatewayServer({ getConfig: () => config, registry })
  await gateway.start(config)
  t.after(() => gateway.stop())

  const response = await fetch(`http://127.0.0.1:${gatewayPort}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'gpt-requested',
      stream: true,
      max_tokens: 32,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    }),
  })
  const bodyText = await response.text()

  assert.equal(response.status, 200)
  assert.match(bodyText, /message_start/)
  assert.match(bodyText, /content_block_delta/)

  const detail = gateway.getRecentLogDetails()[0]
  assert.equal(detail.summary.route, 'anthropic')
  assert.equal(detail.stream.enabled, true)
  assert.equal(detail.stream.upstreamEventCount, 3)
  assert.equal(detail.stream.merged.upstreamText.rawText, 'Hello')
  assert.equal(detail.stream.merged.clientText.rawText, 'Hello')
  assert.equal(detail.stream.merged.upstreamPayload.parsed.choices[0].message.content, 'Hello')
  assert.equal(detail.stream.merged.clientPayload.parsed.content[0].text, 'Hello')
  assert.equal(detail.stream.merged.clientPayload.parsed.stop_reason, 'end_turn')
})

test('flushes Chat to Anthropic text deltas before upstream stream ends', async (t) => {
  const { createServer } = await import('node:http')
  let upstreamFinished = false
  const upstream = createServer(async (req, res) => {
    await readRequestBody(req)
    await writeDelayedChatCompletionStream(res)
    upstreamFinished = true
  })
  const upstreamPort = await listen(upstream)
  t.after(() => closeServer(upstream))

  const gatewayPort = await getFreePort()
  const config = createOpenAiChatGatewayConfig({ gatewayPort, upstreamPort })
  const registry = new AiGatewayProviderRegistry(config)
  const gateway = new AiGatewayServer({ getConfig: () => config, registry })
  await gateway.start(config)
  t.after(() => gateway.stop())

  const response = await fetch(`http://127.0.0.1:${gatewayPort}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'gpt-requested',
      stream: true,
      max_tokens: 32,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    }),
  })

  assert.equal(response.status, 200)
  assert.ok(response.body)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let received = ''
  try {
    while (!received.includes('"text":"First"')) {
      const { done, value } = await reader.read()
      assert.equal(done, false)
      received += decoder.decode(value, { stream: true })
    }
    assert.equal(upstreamFinished, false)
  } finally {
    await reader.cancel().catch(() => undefined)
  }
})

test('records merged stream tool_use for Chat to Anthropic streams', async (t) => {
  const { createServer } = await import('node:http')
  const upstream = createServer(async (req, res) => {
    await readRequestBody(req)
    writeChatToolCallStream(res)
  })
  const upstreamPort = await listen(upstream)
  t.after(() => closeServer(upstream))

  const gatewayPort = await getFreePort()
  const config = createOpenAiChatGatewayConfig({ gatewayPort, upstreamPort })
  const registry = new AiGatewayProviderRegistry(config)
  const gateway = new AiGatewayServer({ getConfig: () => config, registry })
  await gateway.start(config)
  t.after(() => gateway.stop())

  const response = await fetch(`http://127.0.0.1:${gatewayPort}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'gpt-requested',
      stream: true,
      max_tokens: 32,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'list files' }] }],
      tools: [
        {
          name: 'run_command',
          input_schema: {
            type: 'object',
            properties: { command: { type: 'string' } },
            required: ['command'],
          },
        },
      ],
    }),
  })
  const bodyText = await response.text()

  assert.equal(response.status, 200)
  assert.match(bodyText, /tool_use/)
  assert.match(bodyText, /input_json_delta/)

  const detail = gateway.getRecentLogDetails()[0]
  assert.equal(detail.summary.route, 'anthropic')
  assert.equal(detail.stream.enabled, true)
  assert.equal(detail.stream.upstreamEventCount, 4)
  assert.equal(
    detail.stream.merged.upstreamPayload.parsed.choices[0].message.tool_calls[0].function.arguments,
    '{"command":"ls -la"}'
  )
  assert.equal(detail.stream.merged.clientPayload.parsed.content[0].type, 'tool_use')
  assert.equal(detail.stream.merged.clientPayload.parsed.content[0].id, 'call_1')
  assert.equal(detail.stream.merged.clientPayload.parsed.content[0].name, 'run_command')
  assert.deepEqual(detail.stream.merged.clientPayload.parsed.content[0].input, { command: 'ls -la' })
  assert.equal(detail.stream.merged.clientPayload.parsed.stop_reason, 'tool_use')
})

test('rejects invalid Chat tool stream arguments before forwarding Anthropic tool_use', async (t) => {
  const { createServer } = await import('node:http')
  const upstream = createServer(async (req, res) => {
    await readRequestBody(req)
    writeInvalidChatToolCallStream(res)
  })
  const upstreamPort = await listen(upstream)
  t.after(() => closeServer(upstream))

  const gatewayPort = await getFreePort()
  const config = createOpenAiChatGatewayConfig({ gatewayPort, upstreamPort })
  const registry = new AiGatewayProviderRegistry(config)
  const gateway = new AiGatewayServer({ getConfig: () => config, registry })
  await gateway.start(config)
  t.after(() => gateway.stop())

  const response = await fetch(`http://127.0.0.1:${gatewayPort}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'gpt-requested',
      stream: true,
      max_tokens: 32,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'write file' }] }],
      tools: [
        {
          name: 'Write',
          input_schema: {
            type: 'object',
            properties: {
              file_path: { type: 'string', pattern: '^src/' },
              content: { type: 'string' },
            },
            required: ['file_path', 'content'],
            additionalProperties: false,
          },
        },
      ],
    }),
  })
  const bodyText = await response.text()

  assert.equal(response.status, 200)
  assert.match(bodyText, /tool_validation_failed/)
  assert.doesNotMatch(bodyText, /"type":"tool_use"/)

  const detail = gateway.getRecentLogDetails()[0]
  assert.equal(detail.summary.route, 'anthropic')
  assert.equal(detail.error.code, 'tool_validation_failed')
  assert.equal(detail.protocolDiagnostics.toolValidation[0].forwarded, false)
  assert.match(detail.protocolDiagnostics.toolValidation[0].validationErrors.join('\n'), /must match pattern/)
  assert.match(detail.protocolDiagnostics.toolValidation[0].diagnosticWarnings.join('\n'), /code token/)
  assert.equal(
    detail.stream.merged.upstreamPayload.parsed.choices[0].message.tool_calls[0].function.arguments,
    '{"file_path":"void","content":""}'
  )
})

test('normalizes compatible Chat tool stream enum aliases before forwarding Anthropic tool_use', async (t) => {
  const { createServer } = await import('node:http')
  const upstream = createServer(async (req, res) => {
    await readRequestBody(req)
    writeGrepCompatToolCallStream(res)
  })
  const upstreamPort = await listen(upstream)
  t.after(() => closeServer(upstream))

  const gatewayPort = await getFreePort()
  const config = createOpenAiChatGatewayConfig({ gatewayPort, upstreamPort })
  const registry = new AiGatewayProviderRegistry(config)
  const gateway = new AiGatewayServer({ getConfig: () => config, registry })
  await gateway.start(config)
  t.after(() => gateway.stop())

  const response = await fetch(`http://127.0.0.1:${gatewayPort}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'gpt-requested',
      stream: true,
      max_tokens: 32,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'find config' }] }],
      tools: [
        {
          name: 'Grep',
          input_schema: {
            type: 'object',
            properties: {
              pattern: { type: 'string' },
              output_mode: {
                type: 'string',
                enum: ['content', 'files_with_matches', 'count'],
              },
            },
            required: ['pattern', 'output_mode'],
            additionalProperties: false,
          },
        },
      ],
    }),
  })
  const bodyText = await response.text()

  assert.equal(response.status, 200)
  assert.match(bodyText, /files_with_matches/)
  assert.doesNotMatch(bodyText, /tool_validation_failed/)

  const detail = gateway.getRecentLogDetails()[0]
  assert.equal(detail.summary.route, 'anthropic')
  assert.equal(detail.protocolDiagnostics.toolValidation[0].forwarded, true)
  assert.match(
    detail.protocolDiagnostics.toolValidation[0].diagnosticWarnings.join('\n'),
    /\$\.output_mode normalized from "files_with_match" to "files_with_matches"/
  )
  assert.equal(
    detail.stream.merged.upstreamPayload.parsed.choices[0].message.tool_calls[0].function.arguments,
    '{"pattern":"ToolPageRendererConfig","output_mode":"files_with_match"}'
  )
  assert.deepEqual(detail.stream.merged.clientPayload.parsed.content[0].input, {
    pattern: 'ToolPageRendererConfig',
    output_mode: 'files_with_matches',
  })
})
