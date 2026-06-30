import assert from 'node:assert/strict'
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
const { extractRequestApiToken } = loadTsModule('src/core/electron/main/ai-gateway/gateway-server.ts')

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
