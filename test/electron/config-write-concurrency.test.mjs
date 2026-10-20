import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { stubElectronApp } from '../helpers/electron-app-stub.mjs'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

/**
 * config.ts 为模块级单例（cachedConfig 跨实例保留）。
 * loadTsModule 每次编译全新模块实例，stubElectronApp 在编译前替换 electron 缓存，
 * 因此每用例都拿到「全新 cachedConfig + 全新临时 userData」的干净组合。
 */
function loadFreshConfigModule() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'workspace-config-write-'))
  stubElectronApp(userDataDir)
  const mod = loadTsModule('src/core/electron/main/config.ts')
  const configPath = join(userDataDir, 'project-launcher-config.json')
  return { mod, userDataDir, configPath }
}

function readConfigOnDisk(configPath) {
  return JSON.parse(readFileSync(configPath, 'utf8'))
}

test('用例 12：并发提交不丢更新——两个不同字段的 updateConfig 几乎同时发起', async () => {
  const { mod, configPath } = loadFreshConfigModule()

  // 不等待彼此：p1 同步执行到 commitConfig 的已 resolve await 即让出，
  // p2 随后基于 p1 刚写入的最新 cachedConfig 合并（D18：读-合并-赋值单一同步段）。
  const [first, second] = await Promise.all([mod.updateConfig({ theme: 'dark' }), mod.updateConfig({ locale: 'en-US' })])

  const merged = mod.loadConfig()
  assert.equal(merged.theme, 'dark')
  assert.equal(merged.locale, 'en-US')
  // 后到者的返回值包含先到者的修改
  assert.equal(second.theme, 'dark')
  assert.ok(first)

  await mod.flushConfigPersistence()
  const onDisk = readConfigOnDisk(configPath)
  assert.equal(onDisk.theme, 'dark')
  assert.equal(onDisk.locale, 'en-US')
})

test('用例 13：写未完成时第三个 updateConfig 到达——合并结果包含前两者 + 新修改', async () => {
  const { mod, configPath } = loadFreshConfigModule()

  // updateConfig 返回时磁盘写入尚未发生（协调器 debounce 300ms 未到期）——
  // 三个并发提交天然覆盖「写在途、第三个 updateConfig 到达」的竞争窗口。
  const [r1, r2, r3] = await Promise.all([mod.updateConfig({ theme: 'light' }), mod.updateConfig({ locale: 'en-US' }), mod.updateConfig({ closeWindowBehavior: 'quit' })])

  assert.equal(r1.theme, 'light')
  assert.equal(r2.theme, 'light')
  assert.equal(r2.locale, 'en-US')
  assert.equal(r3.theme, 'light')
  assert.equal(r3.locale, 'en-US')
  assert.equal(r3.closeWindowBehavior, 'quit')

  const merged = mod.loadConfig()
  assert.equal(merged.theme, 'light')
  assert.equal(merged.locale, 'en-US')
  assert.equal(merged.closeWindowBehavior, 'quit')

  await mod.flushConfigPersistence()
  const onDisk = readConfigOnDisk(configPath)
  assert.equal(onDisk.theme, 'light')
  assert.equal(onDisk.locale, 'en-US')
  assert.equal(onDisk.closeWindowBehavior, 'quit')
})

test('用例 19：configRecovery 一致性——序列化永不含该字段、写后清除不 bump revision、磁盘与内存一致', async () => {
  const { mod, configPath } = loadFreshConfigModule()

  await mod.updateConfig({ theme: 'dark' })
  await mod.flushConfigPersistence()

  // 写后清除是纯内存行为，不 bump revision（D27）
  const status = mod.getWorkspacePersistenceStatus()
  assert.equal(status.revision, status.persistedRevision)
  assert.equal(status.phase, 'idle')

  // 序列化输出永不包含 configRecovery（磁盘从无此字段）
  const raw = readFileSync(configPath, 'utf8')
  assert.ok(!raw.includes('configRecovery'))
  const onDisk = readConfigOnDisk(configPath)
  assert.ok(!('configRecovery' in onDisk))

  // flush 后读盘内容与 loadConfig() 剔除该运行时字段后深度相等。
  // 内存对象可能含显式 undefined 值键，JSON.stringify 会跳过——内存侧同样走 JSON round-trip 才是序列化输出语义。
  const { configRecovery: _configRecovery, ...memory } = mod.loadConfig()
  assert.deepStrictEqual(onDisk, JSON.parse(JSON.stringify(memory)))
})

test('commitConfig 语义：返回即提交成功，磁盘写入由协调器防抖合并', async () => {
  const { mod, configPath } = loadFreshConfigModule()

  // commitConfig 同步更新内存并返回（提交成功），此时尚未落盘
  const updated = await mod.updateConfig({ theme: 'light' })
  assert.equal(updated.theme, 'light')
  assert.equal(mod.loadConfig().theme, 'light')
  let onDisk = null
  try {
    onDisk = readConfigOnDisk(configPath)
  } catch {
    onDisk = null // 防抖窗口内允许尚未落盘
  }
  if (onDisk) assert.equal(onDisk.theme, 'light')

  await mod.flushConfigPersistence()
  assert.equal(readConfigOnDisk(configPath).theme, 'light')
})
