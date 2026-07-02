import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

test('startRuntime waits for a short mode-switch cooldown before diagnostics', async () => {
  const originalDocument = globalThis.document
  const originalLocalStorage = globalThis.localStorage
  const originalWindow = globalThis.window
  const originalDateNow = Date.now
  const originalSetTimeout = globalThis.setTimeout

  let now = 10_000
  const observedDelays = []
  let diagnosticsCallTime = null

  Date.now = () => now
  globalThis.setTimeout = (handler, delay, ...args) => {
    observedDelays.push(delay)
    now += Number(delay) || 0
    if (typeof handler === 'function') {
      handler(...args)
    }
    return 1
  }

  globalThis.document = {
    documentElement: {
      getAttribute: () => 'system',
    },
  }
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => undefined,
  }

  const { createRuntimeActionsSlice } = loadTsModule('src/core/renderer/stores/appStore.runtimeSlice.ts')
  const { createSettingsActionsSlice } = loadTsModule('src/core/renderer/stores/appStore.settingsSlice.ts')

  const state = {
    projects: [{ id: 'project-1', path: '/repo/demo', cli: 'claude' }],
    config: {
      aiEnvironment: {
        mode: 'windows-wsl',
      },
    },
    runtimeModeSwitchCooldownUntil: 0,
    runtimeEntries: {},
    sessions: {},
    loadRuntimeEntries: async () => undefined,
    refreshSessions: async () => undefined,
  }

  const set = (updater) => {
    const partial = typeof updater === 'function' ? updater(state) : updater
    Object.assign(state, partial)
  }
  const get = () => state

  const settingsSlice = createSettingsActionsSlice(set, get)
  const runtimeSlice = createRuntimeActionsSlice(set, get)

  globalThis.window = {
    setTimeout: globalThis.setTimeout,
    electronAPI: {
      setConfig: async (partial) => ({
        aiEnvironment: partial.aiEnvironment,
      }),
      getCapability: async () => ({
        hostPlatform: 'windows',
        backend: 'wsl',
        hasPty: true,
        hasWslInstalled: true,
        hasWsl: true,
        hasTmux: true,
        wslShell: '/bin/bash',
      }),
      getRuntimeDiagnostics: async () => {
        diagnosticsCallTime = now
        return {
          issues: [],
        }
      },
      startRuntime: async () => true,
      listRuntimeEntries: async () => [],
      listRuntimeSessions: async () => [],
      openTerminal: async () => true,
      killTmuxSession: async () => true,
    },
  }

  try {
    await settingsSlice.setAiEnvironmentConfig({
      mode: 'custom-script',
      runtimeEntrypoint: '/home/ubuntu/tools/claude-code-script/start-claude-with-env.sh',
      runtimePassProjectPath: true,
    })

    assert.equal(state.runtimeModeSwitchCooldownUntil, 11_200)

    await runtimeSlice.startRuntime('project-1')

    assert.equal(observedDelays[0], 1200)
    assert.equal(diagnosticsCallTime, 11_200)
  } finally {
    globalThis.document = originalDocument
    globalThis.localStorage = originalLocalStorage
    Date.now = originalDateNow
    globalThis.setTimeout = originalSetTimeout
    globalThis.window = originalWindow
  }
})
