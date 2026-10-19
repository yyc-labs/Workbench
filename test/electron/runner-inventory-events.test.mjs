import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { ProcessManager } = loadTsModule('src/core/electron/main/runner.ts')

const INVENTORY_CHANNEL = 'terminal:inventory-changed'

const windowsCapability = {
  hostPlatform: 'windows',
  backend: 'direct-pty',
  hasPty: true,
  hasWslInstalled: false,
  hasWsl: false,
  hasTmux: false,
  wslDistro: undefined,
  wslShell: 'bash',
  wslEnv: undefined,
}

function withPlatform(platform, fn) {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { ...descriptor, value: platform })
  try {
    return fn()
  } finally {
    Object.defineProperty(process, 'platform', descriptor)
  }
}

function createFakeWindow(events) {
  return {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (channel, data) => {
        events.push({ channel, data })
      },
    },
  }
}

function inventoryEvents(events) {
  return events.filter((event) => event.channel === INVENTORY_CHANNEL).map((event) => event.data)
}

function createFakePty({ pid, exitHandler }) {
  return {
    pid,
    onData: () => undefined,
    onExit: (cb) => {
      exitHandler(cb)
    },
    resize: () => undefined,
    write: () => undefined,
    kill: () => undefined,
  }
}

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return false
}

test('pty start emits inventory upsert; exit emits remove with increasing revision', () => {
  const manager = new ProcessManager(windowsCapability)
  const events = []
  manager.setOutputWindow(createFakeWindow(events))

  let exitCallback = null
  let dataCallback = null
  const fakePty = {
    ...createFakePty({
      pid: 1001,
      exitHandler: (cb) => {
        exitCallback = cb
      },
    }),
    onData: (cb) => {
      dataCallback = cb
    },
  }
  manager.getPtySpawn = () => () => fakePty

  const started = withPlatform('win32', () => manager.start('inv-pty', 'sleep 5', 'D:\\repo', false))
  assert.equal(started, true)

  const [upsert] = inventoryEvents(events)
  assert.equal(upsert.type, 'upsert')
  assert.equal(upsert.revision, 1)
  assert.equal(upsert.process.processId, 'inv-pty')
  assert.equal(upsert.process.projectId, 'inv-pty')
  assert.equal(upsert.process.backend, 'direct-pty')
  assert.equal(typeof upsert.process.startTime, 'number')

  // 快照与事件共用版本号。
  const snapshot = manager.getInventorySnapshot()
  assert.equal(snapshot.revision, 1)
  assert.equal(snapshot.managedProcesses.length, 1)
  assert.equal(snapshot.managedProcesses[0].processId, 'inv-pty')

  // 终端输出不是清单事件：高频 process:output 不得触发清单 revision 变化。
  dataCallback('hello')
  assert.equal(inventoryEvents(events).length, 1)

  exitCallback({ exitCode: 0 })
  const [, remove] = inventoryEvents(events)
  assert.equal(remove.type, 'remove')
  assert.equal(remove.processKey, 'inv-pty')
  assert.equal(remove.revision, 2)
  assert.equal(manager.isRunning('inv-pty'), false)
})

test('spawn backend emits upsert on start and remove on exit', async () => {
  // win32 + hasPty=false + useWsl=false → host-native 走 spawn 兜底（shell:true 用 cmd.exe）。
  const manager = new ProcessManager({ ...windowsCapability, backend: 'spawn', hasPty: false })
  const events = []
  manager.setOutputWindow(createFakeWindow(events))

  const started = withPlatform('win32', () => manager.start('inv-spawn', 'echo spawn-inventory-ok', process.cwd(), false))
  assert.equal(started, true)

  // spawn 路径的 upsert 在 child 'spawn' 事件后发射（此时才有真实 pid）。
  const upserted = await waitFor(() => inventoryEvents(events).some((event) => event.type === 'upsert'))
  assert.equal(upserted, true)
  const upsert = inventoryEvents(events).find((event) => event.type === 'upsert')
  assert.equal(upsert.revision, 1)
  assert.equal(upsert.process.backend, 'spawn')
  assert.equal(typeof upsert.process.pid, 'number')

  const removed = await waitFor(() => inventoryEvents(events).some((event) => event.type === 'remove'))
  assert.equal(removed, true)
  const remove = inventoryEvents(events).find((event) => event.type === 'remove')
  assert.equal(remove.processKey, 'inv-spawn')
  assert.equal(remove.revision, 2)
  assert.equal(manager.isRunning('inv-spawn'), false)
})

test('stop emits remove immediately (optimistic close); late exit does not duplicate', async () => {
  const manager = new ProcessManager(windowsCapability)
  const events = []
  manager.setOutputWindow(createFakeWindow(events))
  manager.killProcessTreeImmediate = () => {}

  let exitCallback = null
  const fakePty = createFakePty({
    pid: 4242,
    exitHandler: (cb) => {
      exitCallback = cb
    },
  })
  manager.getPtySpawn = () => () => fakePty

  const started = withPlatform('win32', () => manager.start('inv-stop', 'sleep 999', 'D:\\repo', false))
  assert.equal(started, true)
  events.length = 0

  assert.equal(manager.stop('inv-stop'), true)
  // 乐观关闭：stop 返回时 remove 已同步推达，无需等待杀死完成。
  const removes = inventoryEvents(events).filter((event) => event.type === 'remove')
  assert.equal(removes.length, 1)
  assert.equal(removes[0].processKey, 'inv-stop')
  assert.equal(removes[0].revision, 2)

  // 停止窗口内：进程仍在 Map（重启仍被重键拒绝），但清单快照不可见——防止快照复活。
  assert.equal(manager.isRunning('inv-stop'), true)
  assert.equal(manager.getInventorySnapshot().managedProcesses.length, 0)

  // 迟到 onExit 不重复推送 remove，并完成清理。
  exitCallback({ exitCode: 0 })
  assert.equal(inventoryEvents(events).filter((event) => event.type === 'remove').length, 1)
  assert.equal(manager.isRunning('inv-stop'), false)
})

test('events are not emitted when no output window is attached', () => {
  const manager = new ProcessManager(windowsCapability)
  let exitCallback = null
  const fakePty = createFakePty({
    pid: 2002,
    exitHandler: (cb) => {
      exitCallback = cb
    },
  })
  manager.getPtySpawn = () => () => fakePty

  // 无窗口时 send 静默丢弃，但内部 revision 仍然推进（快照语义保持一致）。
  withPlatform('win32', () => manager.start('inv-nowin', 'sleep 5', 'D:\\repo', false))
  assert.equal(manager.getInventorySnapshot().revision, 1)

  exitCallback({ exitCode: 0 })
  assert.equal(manager.getInventorySnapshot().revision, 2)
  assert.equal(manager.getInventorySnapshot().managedProcesses.length, 0)
})
