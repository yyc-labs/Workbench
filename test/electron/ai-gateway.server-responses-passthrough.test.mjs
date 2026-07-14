import test from 'node:test'
import {
  assert,
  AiGatewayProviderRegistry,
  AiGatewayServer,
  closeServer,
  createOpenAiChatGatewayConfig,
  createOpenAiResponsesGatewayConfig,
  delay,
  getFreePort,
  listen,
  normalizeAiGatewayConfig,
  readRequestBody,
  readStreamUntil,
  writeChatCompletionStream,
} from '../helpers/ai-gateway-test-helpers.mjs'

test('records merged stream text and payload for Responses streams', async (t) => {
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

  const response = await fetch(`http://127.0.0.1:${gatewayPort}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-requested',
      stream: true,
      input: 'hello',
    }),
  })
  const bodyText = await response.text()

  assert.equal(response.status, 200)
  assert.match(bodyText, /response\.completed/)
  assert.match(bodyText, /Hello/)

  const detail = gateway.getRecentLogDetails()[0]
  assert.equal(detail.summary.route, 'responses')
  assert.equal(detail.stream.enabled, true)
  assert.equal(detail.stream.upstreamEventCount, 3)
  assert.equal(detail.stream.merged.upstreamText.rawText, 'Hello')
  assert.equal(detail.stream.merged.clientText.rawText, 'Hello')
  assert.equal(detail.stream.merged.finishReason, 'stop')
  assert.equal(detail.stream.merged.usage.prompt_tokens, 2)
  assert.equal(detail.stream.merged.upstreamPayload.parsed.choices[0].message.content, 'Hello')
  assert.equal(detail.stream.merged.clientPayload.parsed.output_text, 'Hello')
  assert.equal(detail.protocolDiagnostics.conversion, 'lossy_conversion')
  assert.match(detail.protocolDiagnostics.lossyWarnings[0], /downgrade/)
})

test('passes OpenAI Responses providers through natively', async (t) => {
  const { createServer } = await import('node:http')
  const upstreamRequests = []
  const upstream = createServer(async (req, res) => {
    const bodyText = await readRequestBody(req)
    upstreamRequests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: JSON.parse(bodyText),
    })
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({
      id: 'resp_1',
      object: 'response',
      status: 'completed',
      model: 'gpt-responses-upstream',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'ok' }],
        },
      ],
      output_text: 'ok',
    }))
  })
  const upstreamPort = await listen(upstream)
  t.after(() => closeServer(upstream))

  const gatewayPort = await getFreePort()
  const config = createOpenAiResponsesGatewayConfig({ gatewayPort, upstreamPort })
  config.providers[0].capabilities.supportsTools = false
  config.providers[0].capabilities.supportsReasoning = false
  const registry = new AiGatewayProviderRegistry(config)
  const gateway = new AiGatewayServer({ getConfig: () => config, registry })
  await gateway.start(config)
  t.after(() => gateway.stop())

  const response = await fetch(`http://127.0.0.1:${gatewayPort}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-requested',
      input: 'hello',
      tools: [
        {
          type: 'function',
          name: 'lookup',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      ],
      reasoning: { effort: 'low' },
    }),
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.output_text, 'ok')
  assert.equal(upstreamRequests.length, 1)
  assert.equal(upstreamRequests[0].method, 'POST')
  assert.equal(upstreamRequests[0].url, '/v1/responses')
  assert.equal(upstreamRequests[0].body.model, 'gpt-requested')
  assert.deepEqual(upstreamRequests[0].body.reasoning, { effort: 'low' })
  assert.equal(upstreamRequests[0].body.tools[0].name, 'lookup')

  const detail = gateway.getRecentLogDetails()[0]
  assert.equal(detail.summary.route, 'responses')
  assert.equal(detail.protocolDiagnostics.conversion, 'passthrough')
  assert.equal(detail.meta.providerId, 'openai-responses')
  assert.match(detail.upstreamRequest.url, /\/v1\/responses$/)
  assert.equal(detail.clientResponse.body.parsed.output_text, 'ok')
})

test('converts Responses function tools to Chat and returns Chat function calls as Responses output', async (t) => {
  const { createServer } = await import('node:http')
  const upstreamRequests = []
  const upstream = createServer(async (req, res) => {
    upstreamRequests.push({
      url: req.url,
      body: JSON.parse(await readRequestBody(req)),
    })
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({
      id: 'chatcmpl_tools',
      object: 'chat.completion',
      model: 'gpt-upstream',
      choices: [{
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_lookup',
            type: 'function',
            function: {
              name: 'lookup',
              arguments: '{"query":"gateway"}',
            },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    }))
  })
  const upstreamPort = await listen(upstream)
  t.after(() => closeServer(upstream))

  const gatewayPort = await getFreePort()
  const config = createOpenAiChatGatewayConfig({ gatewayPort, upstreamPort })
  const registry = new AiGatewayProviderRegistry(config)
  const gateway = new AiGatewayServer({ getConfig: () => config, registry })
  await gateway.start(config)
  t.after(() => gateway.stop())

  const response = await fetch(`http://127.0.0.1:${gatewayPort}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-requested',
      input: 'Search the gateway docs.',
      tools: [{
        type: 'function',
        name: 'lookup',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      }],
      tool_choice: { type: 'function', name: 'lookup' },
    }),
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(upstreamRequests.length, 1)
  assert.equal(upstreamRequests[0].url, '/v1/chat/completions')
  assert.deepEqual(upstreamRequests[0].body.tools, [{
    type: 'function',
    function: {
      name: 'lookup',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  }])
  assert.deepEqual(upstreamRequests[0].body.tool_choice, {
    type: 'function',
    function: { name: 'lookup' },
  })
  assert.equal(body.finish_reason, 'tool_calls')
  assert.deepEqual(body.output, [{
    id: 'fc_call_lookup',
    type: 'function_call',
    status: 'completed',
    call_id: 'call_lookup',
    name: 'lookup',
    arguments: '{"query":"gateway"}',
  }])

  const detail = gateway.getRecentLogDetails()[0]
  assert.equal(detail.protocolDiagnostics.conversion, 'lossy_conversion')
  assert.equal(detail.protocolDiagnostics.toolValidation[0].schemaValid, true)
  assert.equal(detail.clientResponse.body.parsed.output[0].call_id, 'call_lookup')
})

test('converts streaming Chat function-call deltas to Responses events and trace payloads', async (t) => {
  const { createServer } = await import('node:http')
  const upstream = createServer(async (req, res) => {
    await readRequestBody(req)
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
    res.write(`data: ${JSON.stringify({
      object: 'chat.completion.chunk',
      model: 'gpt-upstream',
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call_lookup',
            type: 'function',
            function: { name: 'lookup', arguments: '{"query":' },
          }],
        },
        finish_reason: null,
      }],
    })}\n\n`)
    res.write(`data: ${JSON.stringify({
      object: 'chat.completion.chunk',
      model: 'gpt-upstream',
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            function: { arguments: '"gateway"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    })}\n\n`)
    res.write('data: [DONE]\n\n')
    res.end()
  })
  const upstreamPort = await listen(upstream)
  t.after(() => closeServer(upstream))

  const gatewayPort = await getFreePort()
  const config = createOpenAiChatGatewayConfig({ gatewayPort, upstreamPort })
  const registry = new AiGatewayProviderRegistry(config)
  const gateway = new AiGatewayServer({ getConfig: () => config, registry })
  await gateway.start(config)
  t.after(() => gateway.stop())

  const response = await fetch(`http://127.0.0.1:${gatewayPort}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-requested',
      stream: true,
      input: 'Search the gateway docs.',
      tools: [{
        type: 'function',
        name: 'lookup',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      }],
    }),
  })
  const bodyText = await response.text()

  assert.equal(response.status, 200)
  assert.match(bodyText, /response\.function_call_arguments\.delta/)
  assert.match(bodyText, /response\.function_call_arguments\.done/)
  assert.match(bodyText, /"call_id":"call_lookup"/)

  const detail = gateway.getRecentLogDetails()[0]
  assert.equal(detail.stream.merged.finishReason, 'tool_calls')
  assert.equal(detail.stream.merged.upstreamPayload.parsed.choices[0].message.tool_calls[0].id, 'call_lookup')
  assert.equal(detail.stream.merged.clientPayload.parsed.output[0].call_id, 'call_lookup')
  assert.equal(detail.protocolDiagnostics.toolValidation[0].schemaValid, true)
})

test('passes native Responses stream bytes through before complete SSE event', async (t) => {
  const { createServer } = await import('node:http')
  let upstreamFinished = false
  const upstream = createServer(async (req, res) => {
    await readRequestBody(req)
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
    res.write('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hel')
    await delay(150)
    upstreamFinished = true
    res.write('lo"}\n\n')
    res.end()
  })
  const upstreamPort = await listen(upstream)
  t.after(() => closeServer(upstream))

  const gatewayPort = await getFreePort()
  const config = createOpenAiResponsesGatewayConfig({ gatewayPort, upstreamPort })
  const registry = new AiGatewayProviderRegistry(config)
  const gateway = new AiGatewayServer({ getConfig: () => config, registry })
  await gateway.start(config)
  t.after(() => gateway.stop())

  const response = await fetch(`http://127.0.0.1:${gatewayPort}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-requested',
      stream: true,
      input: 'hello',
    }),
  })

  assert.equal(response.status, 200)
  assert.ok(response.body)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  try {
    await readStreamUntil(reader, decoder, (received) => received.includes('"delta":"Hel'))
    assert.equal(upstreamFinished, false)
  } finally {
    while (!(await reader.read()).done) {
      // Drain the short fake stream so local HTTP sockets close cleanly.
    }
  }
})
