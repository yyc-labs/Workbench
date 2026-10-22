import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { createQuickActionLaunchRouter } = loadTsModule('src/core/electron/main/quick-actions/quickActionLaunchRouter.ts')

const ID_A = '11111111-1111-4111-8111-111111111111'
const ID_B = '22222222-2222-4222-8222-222222222222'

function setup() {
  const executed = []
  const warnings = []
  const router = createQuickActionLaunchRouter({
    execute: async (id) => {
      executed.push(id)
    },
    logWarn: (message) => warnings.push(message),
  })
  return { router, executed, warnings }
}

test('handleArgv returns false for argv without a quick action', () => {
  const { router, executed } = setup()
  router.markReady()
  assert.equal(router.handleArgv(['Workbench.exe']), false)
  assert.equal(router.handleArgv(['Workbench.exe', '--autostart']), false)
  assert.deepEqual(executed, [])
})

test('cold start queues the request until markReady drains it', () => {
  const { router, executed } = setup()
  assert.equal(router.handleArgv(['Workbench.exe', `--quick-action=${ID_A}`]), true)
  assert.deepEqual(executed, []) // 服务未就绪：只入队
  router.markReady()
  assert.deepEqual(executed, [ID_A])
})

test('hot start dispatches immediately once ready', () => {
  const { router, executed } = setup()
  router.markReady()
  assert.equal(router.handleArgv(['Workbench.exe', `--quick-action=${ID_A}`]), true)
  assert.deepEqual(executed, [ID_A])
})

test('queued duplicates collapse; distinct ids execute in order', () => {
  const { router, executed } = setup()
  router.handleArgv(['Workbench.exe', `--quick-action=${ID_A}`])
  router.handleArgv(['Workbench.exe', `--quick-action=${ID_A}`])
  router.handleArgv(['Workbench.exe', `--quick-action=${ID_B}`])
  router.markReady()
  assert.deepEqual(executed, [ID_A, ID_B])
})

test('markReady is idempotent', () => {
  const { router, executed } = setup()
  router.markReady()
  router.markReady()
  router.handleArgv(['Workbench.exe', `--quick-action=${ID_A}`])
  assert.deepEqual(executed, [ID_A])
})

test('a duplicate request while the action is still running is skipped', async () => {
  const executed = []
  const warnings = []
  let releaseResolve = () => {}
  let hanging = false
  const router = createQuickActionLaunchRouter({
    execute: async (id) => {
      executed.push(id)
      if (hanging)
        await new Promise((resolve) => {
          releaseResolve = resolve
        })
    },
    logWarn: (message) => warnings.push(message),
  })
  router.markReady()
  hanging = true
  router.handleArgv(['Workbench.exe', `--quick-action=${ID_A}`])
  router.handleArgv(['Workbench.exe', `--quick-action=${ID_A}`]) // 双击误触
  await Promise.resolve()
  assert.deepEqual(executed, [ID_A])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /Skipped duplicate/)
  hanging = false
  releaseResolve()
  // 等待 in-flight 清理（execute 的 finally 在微任务中移除）
  await new Promise((resolve) => setTimeout(resolve, 0))
  // 执行完成后同一 id 可再次触发（新的用户动作）
  router.handleArgv(['Workbench.exe', `--quick-action=${ID_A}`])
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(executed, [ID_A, ID_A])
})

test('execute failures are logged and do not break the router', async () => {
  const warnings = []
  const router = createQuickActionLaunchRouter({
    execute: async () => {
      throw new Error('boom')
    },
    logWarn: (message) => warnings.push(message),
  })
  router.markReady()
  router.handleArgv(['Workbench.exe', `--quick-action=${ID_A}`])
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /boom/)
  // 路由仍可继续工作
  const executed = []
  const router2 = createQuickActionLaunchRouter({ execute: async (id) => void executed.push(id), logWarn: () => {} })
  router2.markReady()
  router2.handleArgv(['Workbench.exe', `--quick-action=${ID_B}`])
  assert.deepEqual(executed, [ID_B])
})

test('relaunch arg filtering keeps quick-action out of restarts (integration)', async () => {
  const { buildInteractiveRelaunchArgs } = await loadTsModule('src/core/electron/main/launchArgs.ts')
  const relaunchArgs = buildInteractiveRelaunchArgs(['Workbench.exe', '--quick-action=' + ID_A, '--other'])
  assert.ok(!relaunchArgs.some((arg) => arg.startsWith('--quick-action=')))
  assert.ok(relaunchArgs.includes('--other'))
})
