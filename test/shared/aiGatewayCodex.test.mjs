import test from 'node:test'
import assert from 'node:assert/strict'

import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { buildCodexGatewayConfig } = loadTsModule('src/core/shared/aiGatewayCodex.ts')

test('buildCodexGatewayConfig preserves the direct model when binding Codex to the local gateway', () => {
  const config = buildCodexGatewayConfig(
    {
      modelProvider: 'openai',
      model: 'gpt-4.1',
      modelReasoningEffort: 'xhigh',
      preferredAuthMethod: 'apikey',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      approvalsReviewer: 'auto_review',
      modelProviders: {
        openai: {
          name: 'OpenAI',
          model: 'gpt-4.1',
          baseUrl: 'https://api.openai.com/v1',
          wireApi: 'responses',
          requiresOpenaiAuth: true,
          envKey: 'OPENAI_API_KEY',
        },
      },
    },
    {
      host: '127.0.0.1',
      port: 17374,
    },
  )

  assert.equal(config.modelProvider, 'openai')
  assert.equal(config.model, 'gpt-4.1')
  assert.equal(config.modelProviders.openai.model, 'gpt-4.1')
  assert.equal(config.modelProviders.openai.baseUrl, 'http://127.0.0.1:17374/v1')
  assert.equal(config.modelProviders.openai.name, 'Local Router')
})
