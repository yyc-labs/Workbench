import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { anthropicMessagesToChatCompletion } = loadTsModule('src/core/electron/main/ai-gateway/adapters/anthropic-to-chat.ts')
const { responsesToChatCompletion } = loadTsModule('src/core/electron/main/ai-gateway/adapters/responses-to-chat.ts')
const {
  chatCompletionToAnthropicMessage,
  chatStreamChunkToAnthropicEvents,
  createAnthropicStreamStart,
  createAnthropicStreamState,
  createAnthropicStreamStop,
} = loadTsModule('src/core/electron/main/ai-gateway/adapters/chat-to-anthropic.ts')
const { chatCompletionToResponses } = loadTsModule('src/core/electron/main/ai-gateway/adapters/chat-to-responses.ts')
const { drainSseEvents, encodeSseEvent } = loadTsModule('src/core/electron/main/ai-gateway/adapters/sse.ts')
const { normalizeAiGatewayConfig } = loadTsModule('src/core/electron/main/ai-gateway/gateway-config.ts')
const { AiGatewayProviderRegistry } = loadTsModule('src/core/electron/main/ai-gateway/provider-registry.ts')
const {
  buildStreamMergedSnapshot,
  createLimitedTextAccumulator,
} = loadTsModule('src/core/electron/main/ai-gateway/stream-trace.ts')
const {
  AiGatewayServer,
  extractRequestApiToken,
  toAnthropicMessagesUrl,
} = loadTsModule('src/core/electron/main/ai-gateway/gateway-server.ts')

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve local server port.'))
        return
      }
      resolve(address.port)
    })
  })
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve())
  })
}

async function getFreePort() {
  const server = createServer()
  const port = await listen(server)
  await closeServer(server)
  return port
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function writeChatCompletionStream(res, text = 'Hello') {
  const splitAt = Math.max(1, Math.floor(text.length / 2))
  const chunks = [text.slice(0, splitAt), text.slice(splitAt)].filter(Boolean)
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
  for (const chunk of chunks) {
    res.write(encodeSseEvent(undefined, {
      id: 'chatcmpl_1',
      object: 'chat.completion.chunk',
      model: 'gpt-upstream',
      choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }],
    }))
  }
  res.write(encodeSseEvent(undefined, {
    id: 'chatcmpl_1',
    object: 'chat.completion.chunk',
    model: 'gpt-upstream',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
  }))
  res.write('data: [DONE]\n\n')
  res.end()
}

function writeChatToolCallStream(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
  res.write(encodeSseEvent(undefined, {
    id: 'chatcmpl_tool_1',
    object: 'chat.completion.chunk',
    model: 'gpt-upstream',
    choices: [
      {
        index: 0,
        delta: {
          content: '            ',
          tool_calls: [
            {
              index: 0,
              id: 'call_1',
              type: 'function',
              function: { name: 'run_command', arguments: '' },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  }))
  res.write(encodeSseEvent(undefined, {
    id: 'chatcmpl_tool_1',
    object: 'chat.completion.chunk',
    model: 'gpt-upstream',
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              function: { arguments: '{"command":' },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  }))
  res.write(encodeSseEvent(undefined, {
    id: 'chatcmpl_tool_1',
    object: 'chat.completion.chunk',
    model: 'gpt-upstream',
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              function: { arguments: '"ls -la"}' },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  }))
  res.write(encodeSseEvent(undefined, {
    id: 'chatcmpl_tool_1',
    object: 'chat.completion.chunk',
    model: 'gpt-upstream',
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
    usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
  }))
  res.write('data: [DONE]\n\n')
  res.end()
}

function createOpenAiChatGatewayConfig({ gatewayPort, upstreamPort, maxBodyBytes = 4096 }) {
  return normalizeAiGatewayConfig({
    enabled: true,
    host: '127.0.0.1',
    port: gatewayPort,
    maxBodyBytes,
    activeProviderId: 'openai-chat',
    providers: [
      {
        id: 'openai-chat',
        name: 'OpenAI Chat',
        baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
        apiKey: 'sk-provider',
        protocol: 'openai_chat',
        enabled: true,
      },
    ],
  })
}

test('converts Anthropic Messages request to Chat Completions request', () => {
  const chat = anthropicMessagesToChatCompletion({
    model: 'claude-sonnet',
    system: 'You are concise.',
    max_tokens: 512,
    stream: true,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: 'world' },
        ],
      },
    ],
  }, {
    modelMap: {
      'claude-sonnet': 'gpt-4.1',
    },
  })

  assert.equal(chat.model, 'gpt-4.1')
  assert.equal(chat.stream, true)
  assert.equal(chat.max_tokens, 512)
  assert.deepEqual(chat.messages, [
    { role: 'system', content: 'You are concise.' },
    { role: 'user', content: 'Hello\nworld' },
  ])
})

test('converts Anthropic tools and tool_result messages to Chat Completions request', () => {
  const chat = anthropicMessagesToChatCompletion({
    model: 'claude-sonnet',
    tools: [
      {
        name: 'run_command',
        description: 'Run a shell command.',
        input_schema: {
          type: 'object',
          properties: {
            command: { type: 'string' },
          },
          required: ['command'],
        },
      },
    ],
    tool_choice: {
      type: 'tool',
      name: 'run_command',
      disable_parallel_tool_use: true,
    },
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: 'List the repo root.' }],
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Running a command.' },
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'run_command',
            input: { command: 'dir' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            content: [{ type: 'text', text: 'README.md' }],
          },
        ],
      },
    ],
  })

  assert.deepEqual(chat.tools, [
    {
      type: 'function',
      function: {
        name: 'run_command',
        description: 'Run a shell command.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string' },
          },
          required: ['command'],
        },
      },
    },
  ])
  assert.deepEqual(chat.tool_choice, {
    type: 'function',
    function: { name: 'run_command' },
  })
  assert.equal(chat.parallel_tool_calls, false)
  assert.deepEqual(chat.messages, [
    { role: 'user', content: 'List the repo root.' },
    {
      role: 'assistant',
      content: 'Running a command.',
      tool_calls: [
        {
          id: 'toolu_1',
          type: 'function',
          function: {
            name: 'run_command',
            arguments: '{"command":"dir"}',
          },
        },
      ],
    },
    {
      role: 'tool',
      tool_call_id: 'toolu_1',
      content: 'README.md',
    },
  ])
})

test('converts Responses request to Chat Completions request', () => {
  const chat = responsesToChatCompletion({
    model: 'codex-model',
    instructions: [{ type: 'input_text', text: 'Follow instructions.' }],
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Implement it.' }],
      },
    ],
    max_output_tokens: 300,
  }, {
    modelMap: {
      'codex-model': 'gpt-4.1-mini',
    },
  })

  assert.equal(chat.model, 'gpt-4.1-mini')
  assert.equal(chat.max_tokens, 300)
  assert.deepEqual(chat.messages, [
    { role: 'system', content: 'Follow instructions.' },
    { role: 'user', content: 'Implement it.' },
  ])
})

test('rejects unsupported Responses reasoning', () => {
  assert.throws(() => responsesToChatCompletion({
    model: 'codex-model',
    input: 'hello',
    reasoning: { effort: 'high' },
  }), /reasoning options are not supported/)
})

test('converts Chat response to Anthropic message response', () => {
  const message = chatCompletionToAnthropicMessage({
    id: 'chatcmpl_1',
    model: 'gpt-4.1',
    choices: [
      {
        message: { role: 'assistant', content: 'Done' },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 3,
    },
  }, 'fallback')

  assert.equal(message.id, 'chatcmpl_1')
  assert.equal(message.stop_reason, 'end_turn')
  assert.deepEqual(message.content, [{ type: 'text', text: 'Done' }])
  assert.deepEqual(message.usage, { input_tokens: 10, output_tokens: 3 })
})

test('converts Chat tool response to Anthropic tool_use message response', () => {
  const message = chatCompletionToAnthropicMessage({
    id: 'chatcmpl_2',
    model: 'gpt-4.1',
    choices: [
      {
        message: {
          role: 'assistant',
          content: 'Need to inspect files first.',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'run_command',
                arguments: '{"command":"dir"}',
              },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: {
      prompt_tokens: 12,
      completion_tokens: 5,
    },
  }, 'fallback')

  assert.equal(message.stop_reason, 'tool_use')
  assert.deepEqual(message.content, [
    { type: 'text', text: 'Need to inspect files first.' },
    {
      type: 'tool_use',
      id: 'call_1',
      name: 'run_command',
      input: { command: 'dir' },
    },
  ])
})

test('drops whitespace-only Chat content when converting tool calls to Anthropic', () => {
  const message = chatCompletionToAnthropicMessage({
    object: 'chat.completion',
    model: 'GLM-5.1-ALi',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: '            ',
          tool_calls: [
            {
              id: 'call_aa8da16fd9e8422799e8ab90',
              index: 0,
              type: 'function',
              function: {
                name: 'Bash',
                arguments: '{"command": "ls -la", "description": "List all files in current directory"}',
              },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: {
      prompt_tokens: 26582,
      completion_tokens: 23,
      total_tokens: 26605,
    },
  }, 'fallback')

  assert.equal(message.stop_reason, 'tool_use')
  assert.deepEqual(message.content, [
    {
      type: 'tool_use',
      id: 'call_aa8da16fd9e8422799e8ab90',
      name: 'Bash',
      input: {
        command: 'ls -la',
        description: 'List all files in current directory',
      },
    },
  ])
})

test('converts Chat response to Responses response', () => {
  const response = chatCompletionToResponses({
    id: 'chatcmpl_1',
    model: 'gpt-4.1',
    choices: [
      {
        message: { role: 'assistant', content: 'Done' },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 3,
      total_tokens: 13,
    },
  }, 'fallback', 'resp_test')

  assert.equal(response.id, 'resp_test')
  assert.equal(response.status, 'completed')
  assert.equal(response.output_text, 'Done')
  assert.equal(response.output[0].content[0].text, 'Done')
  assert.deepEqual(response.usage, {
    input_tokens: 10,
    output_tokens: 3,
    total_tokens: 13,
  })
})

test('encodes and drains SSE events', () => {
  const encoded = encodeSseEvent('response.output_text.delta', {
    type: 'response.output_text.delta',
    delta: 'hi',
  })
  const drained = drainSseEvents(encoded)

  assert.equal(drained.rest, '')
  assert.equal(drained.events.length, 1)
  assert.equal(drained.events[0].event, 'response.output_text.delta')
  assert.deepEqual(JSON.parse(drained.events[0].data), {
    type: 'response.output_text.delta',
    delta: 'hi',
  })
})

test('converts Chat tool stream chunks to Anthropic stream events', () => {
  const state = createAnthropicStreamState()
  const events = [
    ...createAnthropicStreamStart('msg_1', 'gpt-4.1'),
    ...chatStreamChunkToAnthropicEvents({
      choices: [
        {
          delta: {
            content: 'Running a command.',
          },
        },
      ],
    }, state),
    ...chatStreamChunkToAnthropicEvents({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'run_command',
                  arguments: '',
                },
              },
            ],
          },
        },
      ],
    }, state),
    ...chatStreamChunkToAnthropicEvents({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                function: {
                  arguments: '{"command":"dir"}',
                },
              },
            ],
          },
        },
      ],
    }, state),
    ...createAnthropicStreamStop('tool_calls', {
      prompt_tokens: 11,
      completion_tokens: 4,
    }, state),
  ]

  assert.deepEqual(events.map((event) => event.event), [
    'message_start',
    'content_block_start',
    'content_block_delta',
    'content_block_stop',
    'content_block_start',
    'content_block_delta',
    'content_block_stop',
    'message_delta',
    'message_stop',
  ])
  assert.deepEqual(JSON.parse(events[1].data), {
    type: 'content_block_start',
    index: 0,
    content_block: {
      type: 'text',
      text: '',
    },
  })
  assert.deepEqual(JSON.parse(events[2].data), {
    type: 'content_block_delta',
    index: 0,
    delta: {
      type: 'text_delta',
      text: 'Running a command.',
    },
  })
  assert.deepEqual(JSON.parse(events[4].data), {
    type: 'content_block_start',
    index: 1,
    content_block: {
      type: 'tool_use',
      id: 'call_1',
      name: 'run_command',
      input: {},
    },
  })
  assert.deepEqual(JSON.parse(events[5].data), {
    type: 'content_block_delta',
    index: 1,
    delta: {
      type: 'input_json_delta',
      partial_json: '{"command":"dir"}',
    },
  })
  assert.deepEqual(JSON.parse(events[7].data), {
    type: 'message_delta',
    delta: {
      stop_reason: 'tool_use',
      stop_sequence: null,
    },
    usage: {
      input_tokens: 11,
      output_tokens: 4,
    },
  })
})

test('buffers Chat tool stream argument deltas until the tool name is available', () => {
  const state = createAnthropicStreamState()
  const firstChunkEvents = chatStreamChunkToAnthropicEvents({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call_1',
              type: 'function',
              function: {
                arguments: '{"command":',
              },
            },
          ],
        },
      },
    ],
  }, state)
  const secondChunkEvents = chatStreamChunkToAnthropicEvents({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              function: {
                name: 'run_command',
                arguments: '"dir"}',
              },
            },
          ],
        },
      },
    ],
  }, state)
  const stopEvents = createAnthropicStreamStop('tool_calls', undefined, state)
  const events = [
    ...firstChunkEvents,
    ...secondChunkEvents,
    ...stopEvents,
  ]

  assert.deepEqual(firstChunkEvents, [])
  assert.deepEqual(events.map((event) => event.event), [
    'content_block_start',
    'content_block_delta',
    'content_block_delta',
    'content_block_stop',
    'message_delta',
    'message_stop',
  ])
  assert.deepEqual(JSON.parse(events[0].data), {
    type: 'content_block_start',
    index: 0,
    content_block: {
      type: 'tool_use',
      id: 'call_1',
      name: 'run_command',
      input: {},
    },
  })
  assert.deepEqual(JSON.parse(events[1].data), {
    type: 'content_block_delta',
    index: 0,
    delta: {
      type: 'input_json_delta',
      partial_json: '{"command":',
    },
  })
  assert.deepEqual(JSON.parse(events[2].data), {
    type: 'content_block_delta',
    index: 0,
    delta: {
      type: 'input_json_delta',
      partial_json: '"dir"}',
    },
  })
  assert.deepEqual(JSON.parse(events[4].data).delta.stop_reason, 'tool_use')
})

test('drops whitespace-only Chat stream content when the same chunk contains tool calls', () => {
  const state = createAnthropicStreamState()
  const events = [
    ...chatStreamChunkToAnthropicEvents({
      choices: [
        {
          delta: {
            content: '            ',
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'Bash',
                  arguments: '{"command":"ls -la"}',
                },
              },
            ],
          },
        },
      ],
    }, state),
    ...createAnthropicStreamStop('tool_calls', undefined, state),
  ]

  assert.deepEqual(events.map((event) => event.event), [
    'content_block_start',
    'content_block_delta',
    'content_block_stop',
    'message_delta',
    'message_stop',
  ])
  assert.equal(JSON.parse(events[0].data).content_block.type, 'tool_use')
  assert.equal(JSON.parse(events[0].data).content_block.name, 'Bash')
  assert.deepEqual(JSON.parse(events[1].data).delta, {
    type: 'input_json_delta',
    partial_json: '{"command":"ls -la"}',
  })
  assert.equal(JSON.parse(events[3].data).delta.stop_reason, 'tool_use')
})

test('sanitizes Chat tool stream arguments with raw newlines and Windows paths', () => {
  const state = createAnthropicStreamState()
  const invalidArguments = '{"path":"C:\\Users\\yyc20\\Desktop\\code-work","prompt":"Read files\n1. src/pages/Build"}'
  const events = [
    ...chatStreamChunkToAnthropicEvents({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'Agent',
                  arguments: invalidArguments,
                },
              },
            ],
          },
        },
      ],
    }, state),
    ...createAnthropicStreamStop('tool_calls', undefined, state),
  ]
  const argumentText = events
    .map((event) => JSON.parse(event.data))
    .filter((data) => data.delta?.type === 'input_json_delta')
    .map((data) => data.delta.partial_json)
    .join('')
  const parsedArguments = JSON.parse(argumentText)

  assert.equal(parsedArguments.path, 'C:\\Users\\yyc20\\Desktop\\code-work')
  assert.equal(parsedArguments.prompt, 'Read files\n1. src/pages/Build')
})

test('keeps claude profile routes scoped to /profiles/<profileId>', () => {
  const config = normalizeAiGatewayConfig({
    enabled: true,
    activeProviderId: 'provider-a',
    providers: [
      {
        id: 'provider-a',
        name: 'Provider A',
        baseUrl: 'https://a.example/v1',
        protocol: 'openai_chat',
        enabled: true,
      },
      {
        id: 'provider-b',
        name: 'Provider B',
        baseUrl: 'https://b.example/v1',
        protocol: 'openai_chat',
        enabled: true,
      },
    ],
    modelRoutes: [
      {
        id: 'claude-profile:work',
        model: '__claude_profile__:work',
        providerId: 'provider-b',
        enabled: true,
        source: 'claude-profile',
        profileId: 'work',
      },
    ],
  })
  const registry = new AiGatewayProviderRegistry(config)

  const fallback = registry.getProviderForModel('same-claude-model-name', 'openai_chat')
  assert.equal(fallback.id, 'provider-a')

  const profileRouted = registry.getProviderForProfile('work', 'openai_chat')
  assert.equal(profileRouted.id, 'provider-b')
})

test('allows claude profile routes to use Anthropic Messages providers', () => {
  const config = normalizeAiGatewayConfig({
    enabled: true,
    activeProviderId: 'openai-provider',
    providers: [
      {
        id: 'openai-provider',
        name: 'OpenAI Provider',
        baseUrl: 'https://openai.example/v1',
        protocol: 'openai_chat',
        enabled: true,
      },
      {
        id: 'deepseek-anthropic',
        name: 'DeepSeek Anthropic',
        baseUrl: 'https://api.deepseek.com/anthropic',
        protocol: 'anthropic_messages',
        enabled: true,
      },
    ],
    modelRoutes: [
      {
        id: 'claude-profile:deepseek',
        model: '__claude_profile__:deepseek',
        providerId: 'deepseek-anthropic',
        upstreamModel: 'deepseek-v4-flash',
        enabled: true,
        source: 'claude-profile',
        profileId: 'deepseek',
      },
    ],
  })
  const registry = new AiGatewayProviderRegistry(config)

  const profileRouted = registry.getProviderForProfile('deepseek')
  assert.equal(profileRouted.id, 'deepseek-anthropic')
  assert.equal(profileRouted.protocol, 'anthropic_messages')
  assert.deepEqual(profileRouted.modelMap, {
    '__claude_profile__:deepseek': 'deepseek-v4-flash',
  })
})

test('builds Anthropic Messages upstream URL from provider base URL', () => {
  assert.equal(
    toAnthropicMessagesUrl('https://api.deepseek.com/anthropic'),
    'https://api.deepseek.com/anthropic/v1/messages'
  )
  assert.equal(
    toAnthropicMessagesUrl('https://api.anthropic.com/v1'),
    'https://api.anthropic.com/v1/messages'
  )
  assert.equal(
    toAnthropicMessagesUrl('https://proxy.example/v1/messages'),
    'https://proxy.example/v1/messages'
  )
})

test('limits merged stream text snapshots by UTF-8 bytes', () => {
  const accumulator = createLimitedTextAccumulator(5)
  accumulator.append('你a')
  accumulator.append('好')

  const snapshot = accumulator.snapshot()
  assert.equal(snapshot.rawText, '你a')
  assert.equal(snapshot.sizeBytes, 7)
  assert.equal(snapshot.truncated, true)

  const merged = buildStreamMergedSnapshot({
    clientText: '你a好',
    maxBodyBytes: 5,
  })
  assert.equal(merged.clientText.rawText, '你a')
  assert.equal(merged.clientText.sizeBytes, 7)
  assert.equal(merged.clientText.truncated, true)
})

test('passes Anthropic Messages providers through and records gateway logs', async (t) => {
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

test('records merged stream text and payload for Responses streams', async (t) => {
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
})

test('records merged stream text for raw Chat streams', async (t) => {
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

test('records merged stream tool_use for Chat to Anthropic streams', async (t) => {
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

test('records merged stream text for Anthropic passthrough streams', async (t) => {
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

test('records merged stream tool_use for Anthropic passthrough streams', async (t) => {
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

test('extracts gateway auth token from anthropic x-api-key header first', () => {
  const token = extractRequestApiToken({
    'x-api-key': 'sk-profile-token',
    authorization: 'Bearer should-not-win',
  })

  assert.equal(token, 'sk-profile-token')
})

test('extracts gateway auth token from bearer authorization header when x-api-key is absent', () => {
  const token = extractRequestApiToken({
    authorization: 'Bearer sk-bearer-token',
  })

  assert.equal(token, 'sk-bearer-token')
})
