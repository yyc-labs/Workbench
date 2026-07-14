import test from 'node:test'
import {
  assert,
  anthropicMessagesToChatCompletion,
  responsesToChatCompletion,
  chatCompletionToAnthropicMessage,
  chatStreamChunkToAnthropicEvents,
  createAnthropicStreamStart,
  createAnthropicStreamState,
  createAnthropicStreamStop,
  chatCompletionToResponses,
  chatStreamChunkToResponsesEvents,
  createResponsesStreamFinish,
  createResponsesStreamState,
  drainSseEvents,
  encodeSseEvent,
  buildStreamMergedSnapshot,
  createLimitedTextAccumulator,
} from '../helpers/ai-gateway-test-helpers.mjs'

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

test('uses developer messages and strict tools when provider capabilities allow them', () => {
  const chat = anthropicMessagesToChatCompletion({
    model: 'claude-sonnet',
    system: 'Follow developer policy.',
    tools: [
      {
        name: 'Write',
        input_schema: {
          type: 'object',
          properties: {
            file_path: { type: 'string', pattern: '^src/' },
          },
          required: ['file_path'],
          additionalProperties: false,
        },
      },
    ],
    messages: [{ role: 'user', content: 'edit a file' }],
  }, {
    capabilities: {
      supportsDeveloperMessages: true,
      supportsStrictTools: true,
    },
  })

  assert.equal(chat.messages[0].role, 'developer')
  assert.equal(chat.tools[0].function.strict, true)
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

test('converts Responses function tools and a completed tool loop to Chat Completions', () => {
  const chat = responsesToChatCompletion({
    model: 'codex-model',
    input: [
      {
        type: 'message',
        role: 'user',
        content: 'Look up the weather.',
      },
      {
        type: 'function_call',
        call_id: 'call_weather',
        name: 'lookup_weather',
        arguments: '{"city":"Shanghai"}',
      },
      {
        type: 'function_call_output',
        call_id: 'call_weather',
        output: '31 C and sunny',
      },
    ],
    tools: [
      {
        type: 'function',
        name: 'lookup_weather',
        description: 'Looks up a city weather report.',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
    ],
    tool_choice: { type: 'function', name: 'lookup_weather' },
    parallel_tool_calls: false,
  })

  assert.deepEqual(chat.tools, [
    {
      type: 'function',
      function: {
        name: 'lookup_weather',
        description: 'Looks up a city weather report.',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
    },
  ])
  assert.deepEqual(chat.tool_choice, {
    type: 'function',
    function: { name: 'lookup_weather' },
  })
  assert.equal(chat.parallel_tool_calls, false)
  assert.deepEqual(chat.messages, [
    { role: 'user', content: 'Look up the weather.' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_weather',
          type: 'function',
          function: {
            name: 'lookup_weather',
            arguments: '{"city":"Shanghai"}',
          },
        },
      ],
    },
    {
      role: 'tool',
      tool_call_id: 'call_weather',
      content: '31 C and sunny',
    },
  ])
})

test('rejects unsafe Responses tool downgrade inputs', () => {
  assert.throws(() => responsesToChatCompletion({
    model: 'codex-model',
    input: 'hello',
    tools: [{ type: 'web_search_preview' }],
  }), /cannot be converted/)
  assert.throws(() => responsesToChatCompletion({
    model: 'codex-model',
    input: [{
      type: 'function_call_output',
      call_id: 'call_missing',
      output: 'result',
    }],
  }), /no earlier function_call/)
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

test('converts Chat function calls to Responses function_call output items', () => {
  const response = chatCompletionToResponses({
    model: 'gpt-4.1',
    choices: [{
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_weather',
          type: 'function',
          function: {
            name: 'lookup_weather',
            arguments: '{"city":"Shanghai"}',
          },
        }],
      },
      finish_reason: 'tool_calls',
    }],
  }, 'fallback', 'resp_tools')

  assert.equal(response.id, 'resp_tools')
  assert.equal(response.output_text, '')
  assert.equal(response.finish_reason, 'tool_calls')
  assert.deepEqual(response.output, [{
    id: 'fc_call_weather',
    type: 'function_call',
    status: 'completed',
    call_id: 'call_weather',
    name: 'lookup_weather',
    arguments: '{"city":"Shanghai"}',
  }])
})

test('converts Chat tool-call stream fragments to Responses SSE events', () => {
  const state = createResponsesStreamState()
  const events = [
    ...chatStreamChunkToResponsesEvents({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call_weather',
            type: 'function',
            function: { name: 'lookup_weather', arguments: '{"city":' },
          }],
        },
      }],
    }, state),
    ...chatStreamChunkToResponsesEvents({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            function: { arguments: '"Shanghai"}' },
          }],
        },
      }],
    }, state),
    ...createResponsesStreamFinish('resp_stream_tools', 'gpt-4.1', state, undefined, 'tool_calls'),
  ]

  assert.deepEqual(events.map((event) => event.event), [
    'response.output_item.added',
    'response.function_call_arguments.delta',
    'response.function_call_arguments.delta',
    'response.function_call_arguments.done',
    'response.output_item.done',
    'response.completed',
  ])
  const completed = JSON.parse(events.at(-1).data).response
  assert.equal(completed.finish_reason, 'tool_calls')
  assert.deepEqual(completed.output, [{
    id: 'fc_call_weather',
    type: 'function_call',
    status: 'completed',
    call_id: 'call_weather',
    name: 'lookup_weather',
    arguments: '{"city":"Shanghai"}',
  }])
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
