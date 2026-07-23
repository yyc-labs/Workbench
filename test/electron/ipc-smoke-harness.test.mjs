import assert from 'node:assert/strict'
import Module from 'node:module'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

async function withElectronIpcHarness(run) {
  const handlers = new Map()
  const ipcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
  }
  const ipcRenderer = {
    invoke(channel, ...args) {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`No IPC handler registered for ${channel}`)
      return Promise.resolve(handler({}, ...args))
    },
  }
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return { ipcMain, ipcRenderer }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    return await run({ handlers, ipcRenderer })
  } finally {
    Module._load = originalLoad
  }
}

test('AI Gateway preload invoke reaches the registered main handler', async () => {
  await withElectronIpcHarness(async ({ handlers }) => {
    const { registerAiGatewayIpcHandlers } = loadTsModule('src/core/electron/main/ipc/registerAiGatewayIpcHandlers.ts')
    const { createAiGatewayInvokeApi } = loadTsModule('src/core/electron/preload/invokeApi.aiGateway.ts')
    const calls = []
    const service = {
      getStatus: () => ({ running: true }),
      getConfig: () => ({ enabled: true }),
      getRecentLogs: () => [],
      saveConfig: async (config) => {
        calls.push(['save', config])
        return { config }
      },
      start: async () => ({ running: true }),
      stop: async () => ({ running: false }),
      applyClientBinding: async (cli) => {
        calls.push(['apply', cli])
        return { cli }
      },
      restoreClientBinding: async (cli) => {
        calls.push(['restore', cli])
        return { cli }
      },
      getCodexGatewayBinding: async () => null,
      saveCodexGatewayBinding: async (input) => {
        calls.push(['codex', input])
        return { input }
      },
    }
    registerAiGatewayIpcHandlers({ aiGatewayService: service })
    const api = createAiGatewayInvokeApi()

    assert.deepEqual(await api.getAiGatewayStatus(), { running: true })
    await api.saveAiGatewayConfig({ enabled: true })
    await api.applyAiGatewayClientBinding('codex')
    await api.restoreAiGatewayClientBinding('invalid')
    assert.ok(handlers.size >= 10)
    assert.deepEqual(calls, [
      ['save', { enabled: true }],
      ['apply', 'codex'],
      ['restore', 'claude'],
    ])
  })
})
