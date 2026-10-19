import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

// terminalCollectionSlice 的依赖链 appStore.helpers 在模块级读取 document，先打桩再加载。
globalThis.document = { documentElement: { getAttribute: () => 'system' } }

const { hydrateFloatingPanel } = loadTsModule('src/core/renderer/stores/appStore.terminalCollectionSlice.ts')

test('hydrateFloatingPanel restores persisted dock and sizeRatio', () => {
  const panel = hydrateFloatingPanel({ dock: 'left', sizeRatio: 0.5, hidden: false })
  assert.deepEqual(panel, { dock: 'left', sizeRatio: 0.5, hidden: true })
})

test('hydrateFloatingPanel forces hidden true so restarts open collapsed', () => {
  assert.equal(hydrateFloatingPanel(undefined).hidden, true)
  assert.equal(hydrateFloatingPanel(null).hidden, true)
  assert.equal(hydrateFloatingPanel({ dock: 'top', sizeRatio: 0.3, hidden: true }).hidden, true)
  assert.equal(hydrateFloatingPanel({ dock: 'bottom', sizeRatio: 0.35, hidden: false }).hidden, true)
})

test('hydrateFloatingPanel tolerates un-normalized config values', () => {
  // 主进程 loadConfig 不 normalize floatingPanel（仅 updateConfig 归一化），
  // 旧版 free 停靠、越界比例、脏值都必须在 renderer 侧容错。
  assert.equal(hydrateFloatingPanel({ dock: 'free', sizeRatio: 0.5 }).dock, 'bottom')
  assert.equal(hydrateFloatingPanel({ dock: 'nonsense', sizeRatio: 0.5 }).dock, 'bottom')
  assert.equal(hydrateFloatingPanel({}).dock, 'bottom')
  assert.equal(hydrateFloatingPanel({ dock: 'left', sizeRatio: 5 }).sizeRatio, 0.8)
  assert.equal(hydrateFloatingPanel({ dock: 'left', sizeRatio: 0.01 }).sizeRatio, 0.2)
  assert.equal(hydrateFloatingPanel({ dock: 'left', sizeRatio: Number.NaN }).sizeRatio, 0.35)
  assert.equal(hydrateFloatingPanel({ dock: 'left', sizeRatio: 'oops' }).sizeRatio, 0.35)
})
