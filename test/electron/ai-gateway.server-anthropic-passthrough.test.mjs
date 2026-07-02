import test from 'node:test'
import {
  assert,
  AiGatewayProviderRegistry,
  AiGatewayServer,
  closeServer,
  delay,
  encodeSseEvent,
  getFreePort,
  listen,
  normalizeAiGatewayConfig,
  readRequestBody,
  readStreamUntil,
} from '../helpers/ai-gateway-test-helpers.mjs'

test('passes Anthropic Messages providers through and records gateway logs', async (t) => {
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
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'deepseek-v4-flash',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }))
  })
  const upstreamPort = await listen(upstream)
  t.after(() => closeServer(upstream))

  const gatewayPort = await getFreePort()
  const config = normalizeAiGatewayConfig({
    enabled: true,
    host: '127.0.0.1',
    port: gatewayPort,
    activeProviderId: 'deepseek-anthropic',
    providers: [
      {
        id: 'deepseek-anthropic',
        name: 'DeepSeek Anthropic',
        baseUrl: `http://127.0.0.1:${upstreamPort}/anthropic`,
        apiKey: 'sk-provider',
        protocol: 'anthropic_messages',
        enabled: true,
      },
    ],
    modelRoutes: [
      {
        id: 'manual:claude-model',
        model: 'claude-profile-model',
        providerId: 'deepseek-anthropic',
        upstreamModel: 'deepseek-v4-flash',
        enabled: true,
        source: 'manual',
      },
    ],
  })
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
      model: 'claude-profile-model',
      max_tokens: 32,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'hello' }],
        },
      ],
    }),
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.content[0].text, 'ok')
  assert.equal(upstreamRequests.length, 1)
  assert.equal(upstreamRequests[0].method, 'POST')
  assert.equal(upstreamRequests[0].url, '/anthropic/v1/messages')
  assert.equal(upstreamRequests[0].body.model, 'deepseek-v4-flash')
  assert.equal(upstreamRequests[0].headers.authorization, 'Bearer sk-provider')
  assert.equal(upstreamRequests[0].headers['x-api-key'], 'sk-provider')

  const detail = gateway.getRecentLogDetails()[0]
  assert.equal(detail.summary.route, 'anthropic')
  assert.equal(detail.meta.providerId, 'deepseek-anthropic')
  assert.equal(detail.normalizedRequest.parsed.model, 'deepseek-v4-flash')
  assert.match(detail.upstreamRequest.url, /\/anthropic\/v1\/messages$/)
  assert.equal(detail.clientResponse.statusCode, 200)
})

test('records merged stream text for Anthropic passthrough streams', async (t) => {
  const { createServer } = await import('node:http')
  const upstream = createServer(async (req, res) => {
    await readRequestBody(req)
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
    res.write(encodeSseEvent('message_start', {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-upstream',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    }))
    res.write(encodeSseEvent('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Hello' },
    }))
    res.write(encodeSseEvent('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 1 },
    }))
    res.write(encodeSseEvent('message_stop', { type: 'message_stop' }))
    res.end()
  })
  const upstreamPort = await listen(upstream)
  t.after(() => closeServer(upstream))

  const gatewayPort = await getFreePort()
  const config = normalizeAiGatewayConfig({
    enabled: true,
    host: '127.0.0.1',
    port: gatewayPort,
    maxBodyBytes: 4096,
    activeProviderId: 'anthropic-provider',
    providers: [
      {
        id: 'anthropic-provider',
        name: 'Anthropic Provider',
        baseUrl: `http://127.0.0.1:${upstreamPort}/anthropic`,
        apiKey: 'sk-provider',
        protocol: 'anthropic_messages',
        enabled: true,
      },
    ],
  })
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
      model: 'claude-requested',
      stream: true,
      max_tokens: 32,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    }),
  })
  const bodyText = await response.text()

  assert.equal(response.status, 200)
  assert.match(bodyText, /message_stop/)

  const detail = gateway.getRecentLogDetails()[0]
  assert.equal(detail.summary.route, 'anthropic')
  assert.equal(detail.stream.enabled, true)
  assert.equal(detail.stream.upstreamEventCount, 4)
  assert.equal(detail.stream.merged.upstreamText.rawText, 'Hello')
  assert.equal(detail.stream.merged.clientText.rawText, 'Hello')
  assert.equal(detail.stream.merged.upstreamPayload.parsed.content[0].text, 'Hello')
  assert.equal(detail.stream.merged.clientPayload.parsed.stop_reason, 'end_turn')
})

test('passes Anthropic passthrough stream bytes through before complete SSE event', async (t) => {
  const { createServer } = await import('node:http')
  let upstreamFinished = false
  const upstream = createServer(async (req, res) => {
    await readRequestBody(req)
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
    res.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel')
    await delay(150)
    upstreamFinished = true
    res.write('lo"}}\n\n')
    res.end()
  })
  const upstreamPort = await listen(upstream)
  t.after(() => closeServer(upstream))

  const gatewayPort = await getFreePort()
  const config = normalizeAiGatewayConfig({
    enabled: true,
    host: '127.0.0.1',
    port: gatewayPort,
    maxBodyBytes: 4096,
    activeProviderId: 'anthropic-provider',
    providers: [
      {
        id: 'anthropic-provider',
        name: 'Anthropic Provider',
        baseUrl: `http://127.0.0.1:${upstreamPort}/anthropic`,
        apiKey: 'sk-provider',
        protocol: 'anthropic_messages',
        enabled: true,
      },
    ],
  })
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
      model: 'claude-requested',
      stream: true,
      max_tokens: 32,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    }),
  })

  assert.equal(response.status, 200)
  assert.ok(response.body)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  try {
    await readStreamUntil(reader, decoder, (received) => received.includes('"text":"Hel'))
    assert.equal(upstreamFinished, false)
  } finally {
    while (!(await reader.read()).done) {
      // Drain the short fake stream so local HTTP sockets close cleanly.
    }
  }
})

test('records merged stream tool_use for Anthropic passthrough streams', async (t) => {
  const { createServer } = await import('node:http')
  const upstream = createServer(async (req, res) => {
    await readRequestBody(req)
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
    res.write(encodeSseEvent('message_start', {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-upstream',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    }))
    res.write(encodeSseEvent('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'run_command',
        input: {},
      },
    }))
    res.write(encodeSseEvent('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"command":' },
    }))
    res.write(encodeSseEvent('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '"ls -la"}' },
    }))
    res.write(encodeSseEvent('content_block_stop', {
      type: 'content_block_stop',
      index: 0,
    }))
    res.write(encodeSseEvent('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: { output_tokens: 1 },
    }))
    res.write(encodeSseEvent('message_stop', { type: 'message_stop' }))
    res.end()
  })
  const upstreamPort = await listen(upstream)
  t.after(() => closeServer(upstream))

  const gatewayPort = await getFreePort()
  const config = normalizeAiGatewayConfig({
    enabled: true,
    host: '127.0.0.1',
    port: gatewayPort,
    maxBodyBytes: 4096,
    activeProviderId: 'anthropic-provider',
    providers: [
      {
        id: 'anthropic-provider',
        name: 'Anthropic Provider',
        baseUrl: `http://127.0.0.1:${upstreamPort}/anthropic`,
        apiKey: 'sk-provider',
        protocol: 'anthropic_messages',
        enabled: true,
      },
    ],
  })
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
      model: 'claude-requested',
      stream: true,
      max_tokens: 32,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'list files' }] }],
    }),
  })
  const bodyText = await response.text()

  assert.equal(response.status, 200)
  assert.match(bodyText, /tool_use/)
  assert.match(bodyText, /message_stop/)

  const detail = gateway.getRecentLogDetails()[0]
  assert.equal(detail.summary.route, 'anthropic')
  assert.equal(detail.stream.enabled, true)
  assert.equal(detail.stream.upstreamEventCount, 7)
  assert.equal(detail.stream.merged.upstreamPayload.parsed.content[0].type, 'tool_use')
  assert.equal(detail.stream.merged.upstreamPayload.parsed.content[0].id, 'toolu_1')
  assert.equal(detail.stream.merged.upstreamPayload.parsed.content[0].name, 'run_command')
  assert.deepEqual(detail.stream.merged.upstreamPayload.parsed.content[0].input, { command: 'ls -la' })
  assert.equal(detail.stream.merged.clientPayload.parsed.stop_reason, 'tool_use')
})
