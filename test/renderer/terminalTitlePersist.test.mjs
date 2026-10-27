import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

/**
 * D24 固化：删除 renderer 侧标题防抖后，renameTerminal（唯一标题持久化触发点，人工低频）
 * 每次提交都走 persistWorkspace 全量提交——Renderer→Main 提交次数 = 操作次数；
 * 磁盘写入合并由主进程 WorkspacePersistenceCoordinator 负责（防抖 300ms，另见
 * test/electron/workspace-persistence.test.mjs 用例 2：debounce 窗口内多次 markDirty 只写 1 次）。
 * 两层职责分离：提交不合并、落盘合并。
 */
globalThis.window = {
  electronAPI: {
    setConfig: async () => ({}),
  },
}
globalThis.document = {
  documentElement: {
    getAttribute: () => null,
    setAttribute: () => undefined,
  },
}
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
}

const { createTerminalCollectionSlice } = loadTsModule('src/core/renderer/stores/appStore.terminalCollectionSlice.ts')
// persistWorkspace 有水合防护（未水合时跳过写盘）：标题持久化测试直接标记已水合
const { markWorkspaceHydrated } = loadTsModule('src/core/renderer/stores/appStore.helpers.ts')
markWorkspaceHydrated()

const tick = async (times = 4) => {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

test('用例 26：标题重命名 IPC 计数——连续 N 次提交 N 次，无 renderer 侧防抖合并', async () => {
  const setConfigCalls = []
  globalThis.window = {
    electronAPI: {
      setConfig: async (payload) => {
        setConfigCalls.push(payload)
        return {}
      },
    },
  }
  let state = {
    projects: [{ id: 'p1', path: 'D:/repos/app', terminalDock: { titles: {} } }],
    folders: [],
    tags: [],
    config: { removedProjects: [] },
    floatingPanel: { dock: 'bottom', sizeRatio: 0.35, hidden: true },
  }
  const store = {
    set: (updater) => {
      const partial = typeof updater === 'function' ? updater(state) : updater
      state = { ...state, ...partial }
    },
    get: () => state,
  }
  const actions = createTerminalCollectionSlice(store.set, store.get)

  await actions.renameTerminal('p1', 'proc-1', 'First')
  await tick()
  await actions.renameTerminal('p1', 'proc-1', 'Second')
  await tick()
  await actions.renameTerminal('p1', 'proc-1', 'Third')
  await tick()

  // 每次重命名都提交（latest-wins 由主进程合并）
  assert.equal(setConfigCalls.length, 3)
  // 每次提交都是全量最新态
  assert.equal(setConfigCalls[0].projects[0].terminalDock.titles['proc-1'], 'First')
  assert.equal(setConfigCalls[2].projects[0].terminalDock.titles['proc-1'], 'Third')
})
