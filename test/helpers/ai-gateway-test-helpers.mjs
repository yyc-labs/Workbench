import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { loadTsModule } from './load-ts-module.mjs'

export { assert }

export const { anthropicMessagesToChatCompletion } = loadTsModule('src/core/electron/main/ai-gateway/adapters/anthropic-to-chat.ts')
export const { responsesToChatCompletion } = loadTsModule('src/core/electron/main/ai-gateway/adapters/responses-to-chat.ts')
export const {
  chatCompletionToAnthropicMessage,
  chatStreamChunkToAnthropicEvents,
  createAnthropicStreamStart,
  createAnthropicStreamState,
  createAnthropicStreamStop,
} = loadTsModule('src/core/electron/main/ai-gateway/adapters/chat-to-anthropic.ts')
export const {
  chatCompletionToResponses,
  chatStreamChunkToResponsesEvents,
  createResponsesStreamFinish,
  createResponsesStreamState,
} = loadTsModule('src/core/electron/main/ai-gateway/adapters/chat-to-responses.ts')
export const { drainSseEvents, encodeSseEvent } = loadTsModule('src/core/electron/main/ai-gateway/adapters/sse.ts')
export const { normalizeAiGatewayConfig } = loadTsModule('src/core/electron/main/ai-gateway/gateway-config.ts')
export const { AiGatewayProviderRegistry } = loadTsModule('src/core/electron/main/ai-gateway/provider-registry.ts')
export const {
  assertToolValidationPassed,
  validateChatToolCalls,
} = loadTsModule('src/core/electron/main/ai-gateway/tool-validation.ts')
export const {
  buildStreamMergedSnapshot,
  createLimitedTextAccumulator,
} = loadTsModule('src/core/electron/main/ai-gateway/stream-trace.ts')
export const {
  AiGatewayServer,
  extractRequestApiToken,
  toAnthropicMessagesUrl,
} = loadTsModule('src/core/electron/main/ai-gateway/gateway-server.ts')

export function listen(server, port = 0) {
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

export function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve())
  })
}

export function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function getFreePort() {
  const server = createServer()
  const port = await listen(server)
  await closeServer(server)
  return port
}

export function readRequestBody(req) {
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

export async function readStreamUntil(reader, decoder, predicate, timeoutMs = 1000) {
  let received = ''
  const deadline = Date.now() + timeoutMs
  while (!predicate(received)) {
    const remainingMs = deadline - Date.now()
    assert.ok(remainingMs > 0, `Timed out waiting for stream chunk. Received: ${received}`)
    const result = await Promise.race([
      reader.read(),
      delay(remainingMs).then(() => ({ timedOut: true })),
    ])
    assert.equal(result.timedOut, undefined, `Timed out waiting for stream chunk. Received: ${received}`)
    assert.equal(result.done, false)
    received += decoder.decode(result.value, { stream: true })
  }
  return received
}

export function writeChatCompletionStream(res, text = 'Hello') {
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

export async function writeDelayedChatCompletionStream(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
  res.write(encodeSseEvent(undefined, {
    id: 'chatcmpl_delayed',
    object: 'chat.completion.chunk',
    model: 'gpt-upstream',
    choices: [{ index: 0, delta: { content: 'First' }, finish_reason: null }],
  }))
  await delay(150)
  res.write(encodeSseEvent(undefined, {
    id: 'chatcmpl_delayed',
    object: 'chat.completion.chunk',
    model: 'gpt-upstream',
    choices: [{ index: 0, delta: { content: 'Second' }, finish_reason: null }],
  }))
  res.write(encodeSseEvent(undefined, {
    id: 'chatcmpl_delayed',
    object: 'chat.completion.chunk',
    model: 'gpt-upstream',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  }))
  res.write('data: [DONE]\n\n')
  res.end()
}

export function writeChatToolCallStream(res) {
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

export function writeInvalidChatToolCallStream(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
  res.write(encodeSseEvent(undefined, {
    id: 'chatcmpl_tool_invalid',
    object: 'chat.completion.chunk',
    model: 'gpt-upstream',
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call_invalid',
              type: 'function',
              function: { name: 'Write', arguments: '{"file_path":"void","content":""}' },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  }))
  res.write(encodeSseEvent(undefined, {
    id: 'chatcmpl_tool_invalid',
    object: 'chat.completion.chunk',
    model: 'gpt-upstream',
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
  }))
  res.write('data: [DONE]\n\n')
  res.end()
}

export function writeGrepCompatToolCallStream(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
  res.write(encodeSseEvent(undefined, {
    id: 'chatcmpl_tool_grep_compat',
    object: 'chat.completion.chunk',
    model: 'gpt-upstream',
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call_grep_compat',
              type: 'function',
              function: {
                name: 'Grep',
                arguments: '{"pattern":"ToolPageRendererConfig","output_mode":"files_with_match"}',
              },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  }))
  res.write(encodeSseEvent(undefined, {
    id: 'chatcmpl_tool_grep_compat',
    object: 'chat.completion.chunk',
    model: 'gpt-upstream',
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
  }))
  res.write('data: [DONE]\n\n')
  res.end()
}

export function createOpenAiChatGatewayConfig({ gatewayPort, upstreamPort, maxBodyBytes = 4096 }) {
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

export function createOpenAiResponsesGatewayConfig({ gatewayPort, upstreamPort, maxBodyBytes = 4096 }) {
  return normalizeAiGatewayConfig({
    enabled: true,
    host: '127.0.0.1',
    port: gatewayPort,
    maxBodyBytes,
    activeProviderId: 'openai-responses',
    providers: [
      {
        id: 'openai-responses',
        name: 'OpenAI Responses',
        baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
        apiKey: 'sk-provider',
        protocol: 'openai_responses',
        enabled: true,
      },
    ],
  })
}
