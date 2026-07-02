import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { createAgentLogService } = loadTsModule(
  'src/core/electron/main/agent-logs/agent-log-service.ts'
)

function createGatewayDetail(id = 'gateway-1') {
  return {
    source: 'ai-gateway',
    summary: {
      id,
      source: 'ai-gateway',
      title: 'Gateway request',
      timestamp: 100,
      level: 'info',
      route: 'chat',
    },
    meta: {
      requestId: id,
      route: 'chat',
    },
  }
}

function createHookDetail(id = 'hook-1') {
  return {
    source: 'agent-hooks',
    summary: {
      id,
      source: 'agent-hooks',
      title: 'Hook event',
      timestamp: 200,
      level: 'info',
      providerEvent: 'Stop',
      canonicalEvent: 'stop',
      provider: 'codex-cli',
    },
    meta: {
      requestId: id,
      provider: 'codex-cli',
      providerEvent: 'Stop',
      canonicalEvent: 'stop',
    },
  }
}

test('clearAll removes gateway and hook logs from the aggregated service', () => {
  const gatewayLogs = [createGatewayDetail()]
  const hookLogs = [createHookDetail()]
  const service = createAgentLogService({
    getAiGatewayLogs: () => gatewayLogs,
    getAgentHookLogs: () => hookLogs,
    clearAiGatewayLogs: () => {
      gatewayLogs.length = 0
    },
    clearAgentHookLogs: () => {
      hookLogs.length = 0
    },
  })

  assert.equal(service.listSummaries().length, 2)
  assert.equal(service.getDetail('ai-gateway', 'gateway-1')?.summary.id, 'gateway-1')
  assert.equal(service.getDetail('agent-hooks', 'hook-1')?.summary.id, 'hook-1')

  service.clearAll()

  assert.deepEqual(service.listSummaries(), [])
  assert.equal(service.getDetail('ai-gateway', 'gateway-1'), null)
  assert.equal(service.getDetail('agent-hooks', 'hook-1'), null)
})
