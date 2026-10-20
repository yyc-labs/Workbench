import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

// store 级测试：迷你 set/get 驱动 workspaceSlice action，persistWorkspace 的 IPC 以桩替换。
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

const { createWorkspaceActionsSlice } = loadTsModule('src/core/renderer/stores/appStore.workspaceSlice.ts')

function createMiniStore(initialState) {
  let state = initialState
  return {
    set: (updater) => {
      const partial = typeof updater === 'function' ? updater(state) : updater
      state = { ...state, ...partial }
    },
    get: () => state,
  }
}

function createProjectStore() {
  const store = createMiniStore({
    projects: [{ id: 'p1', path: 'D:/repos/app', codeSession: { tabs: ['src/a.ts'] } }],
    folders: [],
    tags: [],
    config: { removedProjects: [] },
  })
  const actions = createWorkspaceActionsSlice(store.set, store.get)
  return { store, actions }
}

test('setProjectCodeSession 归一化 expandedDirectories（remembered）', async () => {
  const { store, actions } = createProjectStore()

  await actions.setProjectCodeSession('p1', {
    tabs: ['src/a.ts'],
    expandedDirectories: ['src\\components', 'src/', '/abs', '..', 'a//b'],
  })
  const project = store.get().projects[0]
  // 合法条目保留（反斜杠统一、去尾斜杠、去重排序）；绝对路径/.. /空段剔除
  assert.deepEqual(project.codeSession.expandedDirectories, ['src', 'src/components'])
  // 其他 session 字段不受影响
  assert.deepEqual(project.codeSession.tabs, ['src/a.ts'])
})

test('setProjectCodeSession：expandedDirectories 空数组 → undefined（空即权威）', async () => {
  const { store, actions } = createProjectStore()

  await actions.setProjectCodeSession('p1', { tabs: ['src/a.ts'], expandedDirectories: ['src'] })
  assert.deepEqual(store.get().projects[0].codeSession.expandedDirectories, ['src'])

  await actions.setProjectCodeSession('p1', { tabs: ['src/a.ts'], expandedDirectories: [] })
  assert.equal(store.get().projects[0].codeSession.expandedDirectories, undefined)
})

test('setProjectCodeSession：仅 expandedDirectories 无 tabs 也生成 session', async () => {
  const { store, actions } = createProjectStore()

  await actions.setProjectCodeSession('p1', { tabs: [], expandedDirectories: ['docs'] })
  const session = store.get().projects[0].codeSession
  assert.deepEqual(session.expandedDirectories, ['docs'])
  assert.deepEqual(session.tabs, [])
})

test('setProjectCodeSession：无任何有效内容时 codeSession 置空', async () => {
  const { store, actions } = createProjectStore()

  await actions.setProjectCodeSession('p1', { tabs: [], expandedDirectories: [] })
  assert.equal(store.get().projects[0].codeSession, undefined)
})

test('setProjectCodeSession：tabs 类提交缺省 expandedDirectories 字段时保留旧 remembered（覆盖 bug 回归）', async () => {
  const { store, actions } = createProjectStore()

  await actions.setProjectCodeSession('p1', { tabs: ['src/a.ts'], expandedDirectories: ['src', 'src/components'] })
  assert.deepEqual(store.get().projects[0].codeSession.expandedDirectories, ['src', 'src/components'])

  // 打开文件 / 光标 / 搜索历史等提交不带 expandedDirectories：不得冲掉展开记忆
  await actions.setProjectCodeSession('p1', { tabs: ['src/a.ts', 'src/b.ts'], activePath: 'src/b.ts' })
  let session = store.get().projects[0].codeSession
  assert.deepEqual(session.expandedDirectories, ['src', 'src/components'])
  assert.deepEqual(session.tabs, ['src/a.ts', 'src/b.ts'])

  // 显式空数组才清除
  await actions.setProjectCodeSession('p1', { tabs: ['src/a.ts'], expandedDirectories: [] })
  session = store.get().projects[0].codeSession
  assert.equal(session.expandedDirectories, undefined)
  assert.deepEqual(session.tabs, ['src/a.ts'])

  // 清除后其他提交不得复活旧 remembered
  await actions.setProjectCodeSession('p1', { tabs: ['src/a.ts', 'src/c.ts'] })
  session = store.get().projects[0].codeSession
  assert.equal(session.expandedDirectories, undefined)
})
