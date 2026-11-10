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

/**
 * 重启测试用假 ProcessManager：用真实 Set 维护运行态，stop 异步释放 key
 * （模拟 Ctrl+C → 强杀安全网 → onExit 清理的延迟）。
 */
function createRestartableProcessManager() {
  const stopCalls = []
  const startCalls = []
  const interactiveCalls = []
  const running = new Set()
  let lastLaunchedKey = null
  return {
    stopCalls,
    startCalls,
    interactiveCalls,
    running,
    isRunning: (key) => running.has(key),
    stop: (key) => {
      stopCalls.push(key)
      setTimeout(() => running.delete(key), 20)
      return true
    },
    start: (...args) => {
      startCalls.push(args)
      running.add(args[0])
      lastLaunchedKey = args[0]
      return true
    },
    startInteractive: (...args) => {
      interactiveCalls.push(args)
      running.add(args[0])
      lastLaunchedKey = args[0]
      return true
    },
    addOutputTap: () => () => {},
    addExitTap: (listener) => {
      const key = lastLaunchedKey
      setTimeout(() => listener(key, 0), 0)
      return () => {}
    },
  }
}

test('restart 先停旧实例（含保活空壳终端）等 key 释放后再启动', async () => {
  const manager = createRestartableProcessManager()
  const { scheduler } = createScheduler(manager)

  // 旧实例：交互 shell 保活场景——dev server 已死，但空壳终端仍占着 key。
  manager.running.add('proj-1::run::dev')

  const started = await scheduler.restart('proj-1', PROJECT_PATH, { id: 'dev', name: 'Dev', command: 'npm run dev', useWsl: false }, INITIAL_SIZE)

  assert.equal(started, true)
  assert.deepEqual(manager.stopCalls, ['proj-1::run::dev'])
  // key 释放后全新 spawn。
  assert.equal(manager.interactiveCalls.length, 1)
  assert.equal(manager.running.has('proj-1::run::dev'), true)
})

test('restart 无旧实例时与 start 等价，不触发 stop', async () => {
  const manager = createRestartableProcessManager()
  const { scheduler } = createScheduler(manager)

  const started = await scheduler.restart('proj-1', PROJECT_PATH, { id: 'dev', name: 'Dev', command: 'npm run dev', useWsl: false })

  assert.equal(started, true)
  assert.equal(manager.stopCalls.length, 0)
  assert.equal(manager.interactiveCalls.length, 1)
  assert.equal(manager.interactiveCalls[0][0], 'proj-1::run::dev')
})

test('restartAll 先停掉所有在跑旧任务，再整体启动新计划', async () => {
  const manager = createRestartableProcessManager()
  const { scheduler } = createScheduler(manager)

  manager.running.add('proj-1::run::docker')
  manager.running.add('proj-1::run::api')

  const result = await scheduler.restartAll(
    'proj-1',
    PROJECT_PATH,
    [
      { id: 'docker', name: 'Docker', command: 'docker compose up -d', useWsl: false, readiness: { strategy: 'exit', timeoutMs: 50 } },
      { id: 'api', name: 'API', command: 'npm run api', useWsl: false, dependsOn: ['docker'] },
    ],
    INITIAL_SIZE,
  )

  assert.equal(result.started, true)
  assert.deepEqual(manager.stopCalls.sort(), ['proj-1::run::api', 'proj-1::run::docker'])
  assert.equal(manager.startCalls.length, 1)
  assert.equal(manager.interactiveCalls.length, 1)
})
