import test from 'node:test'
import {
  assert,
  normalizeAiGatewayConfig,
  AiGatewayProviderRegistry,
  extractRequestApiToken,
  toAnthropicMessagesUrl,
} from '../helpers/ai-gateway-test-helpers.mjs'

test('normalizes provider capability defaults by upstream protocol', () => {
  const config = normalizeAiGatewayConfig({
    providers: [
      {
        id: 'chat',
        name: 'Chat',
        baseUrl: 'https://chat.example/v1',
        protocol: 'openai_chat',
      },
      {
        id: 'responses',
        name: 'Responses',
        baseUrl: 'https://responses.example/v1',
        protocol: 'openai_responses',
      },
    ],
  })

  assert.equal(config.providers[0].capabilities.supportsTools, true)
  assert.equal(config.providers[0].capabilities.supportsStrictTools, false)
  assert.equal(config.providers[0].capabilities.supportsResponsesInputItems, false)
  assert.equal(config.providers[1].capabilities.supportsStrictTools, true)
  assert.equal(config.providers[1].capabilities.supportsResponsesInputItems, true)
})

test('normalizes timeout retry settings independently from stream retry settings', () => {
  const config = normalizeAiGatewayConfig({
    providers: [{
      id: 'provider-a',
      name: 'Provider A',
      baseUrl: 'https://a.example/v1',
      protocol: 'openai_chat',
      streamRetryCount: 4,
      streamRetryDelayMs: 700,
      timeoutRetryCount: 1,
      timeoutRetryDelayMs: 2400,
    }],
  })

  assert.equal(config.providers[0].streamRetryCount, 4)
  assert.equal(config.providers[0].streamRetryDelayMs, 700)
  assert.equal(config.providers[0].timeoutRetryCount, 1)
  assert.equal(config.providers[0].timeoutRetryDelayMs, 2400)
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
