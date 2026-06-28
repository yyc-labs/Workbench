import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

test('initApp does not refresh WSL sessions on cold startup without runtime entries', async () => {
  const originalWindow = globalThis.window
  const originalDocument = globalThis.document
  const originalLocalStorage = globalThis.localStorage

  globalThis.document = {
    documentElement: {
      getAttribute: () => 'system',
    },
  }
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => undefined,
  }

  const { createInitActionsSlice } = loadTsModule('src/core/renderer/stores/appStore.initSlice.ts')

  let refreshSessionsCalls = 0
  let loadRuntimeEntriesCalls = 0
  let syncManagedProcessesCalls = 0

  const state = {
    isAppReady: false,
    config: {
      projects: [],
      folders: [],
      tags: [],
      aiEnvironment: {
        mode: 'windows-wsl',
      },
    },
    projects: [],
    folders: [],
    tags: [],
    capability: null,
    runtimeEntries: {},
    tmuxSessions: [],
    rehydrateProcessUrlsFromStorage: () => undefined,
    refreshSessions: async () => {
      refreshSessionsCalls += 1
    },
    loadRuntimeEntries: async () => {
      loadRuntimeEntriesCalls += 1
      state.runtimeEntries = {}
    },
    syncManagedProcesses: async () => {
      syncManagedProcessesCalls += 1
    },
  }

  const set = (updater) => {
    const partial = typeof updater === 'function' ? updater(state) : updater
    Object.assign(state, partial)
  }
  const get = () => state

  globalThis.window = {
    electronAPI: {
      getConfig: async () => ({
        projects: [],
        folders: [],
        tags: [],
        aiEnvironment: {
          mode: 'windows-native',
        },
      }),
      detectProjects: async () => null,
      getCapability: async () => ({
        hostPlatform: 'windows',
        backend: 'direct-pty',
        hasPty: true,
        hasWsl: false,
        hasTmux: false,
        wslDistro: undefined,
        wslShell: 'bash',
        wslEnv: undefined,
      }),
      listTmuxSessions: async () => {
        throw new Error('listTmuxSessions should not be called on cold startup')
      },
    },
  }

  try {
    const slice = createInitActionsSlice(set, get)
    await slice.initApp()
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(state.isAppReady, true)
    assert.equal(loadRuntimeEntriesCalls, 1)
    assert.equal(refreshSessionsCalls, 0)
    assert.equal(syncManagedProcessesCalls, 1)
  } finally {
    globalThis.window = originalWindow
    globalThis.document = originalDocument
    globalThis.localStorage = originalLocalStorage
  }
})
