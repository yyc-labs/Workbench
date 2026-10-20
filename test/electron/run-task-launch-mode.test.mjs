import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { RunTaskScheduler } = loadTsModule('src/core/electron/main/run-tasks/run-task-scheduler.ts')

/**
 * 假 ProcessManager：记录 start / startInteractive 调用；exit tap 在注册后按
 * 「最近一次启动的 key + code 0」异步触发，让 exit-readiness 的 waitReady 可 settle。
 */
function createFakeProcessManager() {
  const startCalls = []
  const interactiveCalls = []
  let lastLaunchedKey = null
  return {
    startCalls,
    interactiveCalls,
    isRunning: () => false,
    start: (...args) => {
      startCalls.push(args)
      lastLaunchedKey = args[0]
      return true
    },
    startInteractive: (...args) => {
      interactiveCalls.push(args)
      lastLaunchedKey = args[0]
      return true
    },
    addOutputTap: () => () => {},
    addExitTap: (listener) => {
      const key = lastLaunchedKey
      setTimeout(() => listener(key, 0), 0)
      return () => {}
    },
    stop: () => true,
  }
}

function createScheduler(manager) {
  const progress = []
  const scheduler = new RunTaskScheduler(
    () => manager,
    (event) => progress.push(event),
  )
  return { scheduler, progress }
}

const PROJECT_PATH = 'D:\\repo'
const INITIAL_SIZE = { cols: 175, rows: 12 }

test('无 readiness 任务走交互 shell 启动并透传初始尺寸', async () => {
  const manager = createFakeProcessManager()
  const { scheduler } = createScheduler(manager)

  const started = await scheduler.start('proj-1', PROJECT_PATH, { id: 'dev', name: 'Dev', command: 'npm run dev', useWsl: false }, INITIAL_SIZE)

  assert.equal(started, true)
  assert.equal(manager.interactiveCalls.length, 1)
  assert.deepEqual(manager.interactiveCalls[0], ['proj-1::run::dev', 'npm run dev', PROJECT_PATH, false, INITIAL_SIZE])
  assert.equal(manager.startCalls.length, 0)
})

test('delay readiness 任务同样走交互 shell 启动', async () => {
  const manager = createFakeProcessManager()
  const { scheduler } = createScheduler(manager)

  // timeoutMs 调小：delay 分支的 reject 兜底定时器本就无法被清除（调度器既有行为），
  // 不给小值会让 node --test 进程被 60s 定时器拖住不退出。
  const started = await scheduler.start('proj-1', PROJECT_PATH, { id: 'wait', name: 'Wait', command: 'sleep 1', useWsl: false, readiness: { strategy: 'delay', delayMs: 5, timeoutMs: 50 } }, INITIAL_SIZE)

  assert.equal(started, true)
  assert.equal(manager.interactiveCalls.length, 1)
  assert.equal(manager.startCalls.length, 0)
})

test('exit readiness 任务保持一次性启动（调度器以进程退出判就绪）', async () => {
  const manager = createFakeProcessManager()
  const { scheduler } = createScheduler(manager)

  const started = await scheduler.start('proj-1', PROJECT_PATH, { id: 'docker', name: 'Docker', command: 'docker compose up -d', useWsl: false, readiness: { strategy: 'exit', timeoutMs: 50 } }, INITIAL_SIZE)

  assert.equal(started, true)
  assert.equal(manager.startCalls.length, 1)
  assert.deepEqual(manager.startCalls[0], ['proj-1::run::docker', 'docker compose up -d', PROJECT_PATH, false, INITIAL_SIZE])
  assert.equal(manager.interactiveCalls.length, 0)
})

test('startAll 对每个任务按 readiness 分发启动方式', async () => {
  const manager = createFakeProcessManager()
  const { scheduler } = createScheduler(manager)

  const result = await scheduler.startAll(
    'proj-1',
    PROJECT_PATH,
    [
      { id: 'docker', name: 'Docker', command: 'docker compose up -d', useWsl: false, readiness: { strategy: 'exit', timeoutMs: 50 } },
      { id: 'api', name: 'API', command: 'npm run api', useWsl: false, dependsOn: ['docker'] },
    ],
    INITIAL_SIZE,
  )

  assert.equal(result.started, true)
  assert.equal(manager.startCalls.length, 1)
  assert.equal(manager.interactiveCalls.length, 1)
  assert.deepEqual(manager.interactiveCalls[0][0], 'proj-1::run::api')
  assert.deepEqual(manager.interactiveCalls[0][4], INITIAL_SIZE)
})

test('未提供 initialSize 时透传 undefined（主进程兜底 80x24）', async () => {
  const manager = createFakeProcessManager()
  const { scheduler } = createScheduler(manager)

  await scheduler.start('proj-1', PROJECT_PATH, { id: 'dev', name: 'Dev', command: 'npm run dev', useWsl: false })

  assert.equal(manager.interactiveCalls.length, 1)
  assert.equal(manager.interactiveCalls[0][4], undefined)
})
