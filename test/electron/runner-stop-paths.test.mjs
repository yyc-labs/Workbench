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

const wslCapability = { ...windowsCapability, hasWslInstalled: true, hasWsl: true, wslDistro: 'Ubuntu' }

const posixCapability = {
  hostPlatform: 'linux',
  backend: 'direct-pty',
  hasPty: true,
  hasWslInstalled: false,
  hasWsl: false,
  hasTmux: true,
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** withPlatform 的异步版：平台伪装持续到 fn（含其 await）完成后才恢复。 */
async function withPlatformAsync(platform, fn) {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { ...descriptor, value: platform })
  try {
    await fn()
  } finally {
    Object.defineProperty(process, 'platform', descriptor)
  }
}

/** 组装带假 pty / 假窗口 / 记录器的 ProcessManager。 */
function setup(capability, options = {}) {
  const pid = options.pid ?? 1000
  const state = { events: [], written: '', killSignals: [], killedPids: [], exitCallback: null }
  const manager = new ProcessManager(capability)
  manager.setOutputWindow({
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (channel, data) => state.events.push({ channel, data }),
    },
  })
  manager.killProcessTreeImmediate = (killedPid) => {
    state.killedPids.push(killedPid)
  }
  const fakePty = {
    pid,
    onData: () => undefined,
    onExit: (cb) => {
      state.exitCallback = cb
      if (options.exitAfterMs != null) setTimeout(() => cb({ exitCode: 0 }), options.exitAfterMs)
    },
    resize: () => undefined,
    write: (data) => {
      state.written += data
    },
    kill: (signal) => {
      state.killSignals.push(signal ?? 'default')
    },
  }
  manager.getPtySpawn = () => () => fakePty
  return { manager, state, fakePty }
}

function inventoryEvents(state) {
  return state.events.filter((event) => event.channel === INVENTORY_CHANNEL).map((event) => event.data)
}

// ── A 套：Windows 原生（direct-pty）——kill pid 可达整棵树 ──────────────────

test('A path (direct-pty, Windows): exit nudge, remove-on-stop, 300ms force, 1200ms retry', async () => {
  const { manager, state } = setup(windowsCapability, { pid: 2001 })
  const started = withPlatform('win32', () => manager.start('a-win', 'sleep 999', 'D:\\repo', false))
  assert.equal(started, true)
  state.events.length = 0

  // 乐观关闭：stop 返回时 remove 已推达。
  assert.equal(manager.stop('a-win'), true)
  assert.equal(inventoryEvents(state).filter((event) => event.type === 'remove').length, 1)
  // 写序：Ctrl+C（优雅通道）+ exit\r（空闲 shell 秒退）。
  assert.equal(state.written, '\x03exit\r')
  // 停止窗口内进程仍在 Map、快照不可见。
  assert.equal(manager.isRunning('a-win'), true)
  assert.equal(manager.getInventorySnapshot().managedProcesses.length, 0)

  // 300ms 前不强杀。
  await sleep(200)
  assert.deepEqual(state.killedPids, [])

  // 300ms 强杀：无信号 pty.kill（杀 ConPTY 控制台进程列表）+ taskkill 树。
  await sleep(250)
  assert.deepEqual(state.killSignals, ['default'])
  assert.deepEqual(state.killedPids, [2001])

  // 1200ms 重试 + 清理 + 状态结算。
  await sleep(1100)
  assert.deepEqual(state.killSignals, ['default', 'default'])
  assert.equal(manager.isRunning('a-win'), false)
  const statuses = state.events.filter((event) => event.channel === 'process:status').map((event) => event.data.status)
  assert.ok(statuses.includes('stopped'))
  // 全流程只推过一次 remove（入口一次，重试不重复推）。
  assert.equal(inventoryEvents(state).filter((event) => event.type === 'remove').length, 1)
})

test('A path (POSIX): force kill sends SIGTERM instead of taskkill', async () => {
  const { manager, state } = setup(posixCapability, { pid: 6001 })
  // 平台伪装必须覆盖 stop 与其定时器（强杀分支在定时器里判 platform）。
  await withPlatformAsync('linux', async () => {
    const started = manager.start('e-posix', 'sleep 999', '/repo', false)
    assert.equal(started, true)
    state.events.length = 0

    assert.equal(manager.stop('e-posix'), true)
    assert.equal(state.written, '\x03exit\r')

    // 300ms 强杀 = SIGTERM（POSIX 上 node-pty 支持信号），不动进程树。
    await sleep(450)
    assert.deepEqual(state.killSignals, ['SIGTERM'])
    assert.deepEqual(state.killedPids, [])

    // 1200ms 重试：再补一次 SIGTERM + 清理。
    await sleep(1000)
    assert.deepEqual(state.killSignals, ['SIGTERM', 'SIGTERM'])
    assert.equal(manager.isRunning('e-posix'), false)
  })
})

// ── B 套：WSL——pty 输入是唯一可达 Linux 进程的通道 ────────────────────────

test('B path (wsl-pty, Windows): Ctrl+C + exit nudge, 500ms force, 1500ms retry', async () => {
  const { manager, state } = setup(wslCapability, { pid: 3001 })
  const started = withPlatform('win32', () => manager.start('b-wsl', 'sleep 999', 'D:\\repo', true))
  assert.equal(started, true)
  state.events.length = 0

  assert.equal(manager.stop('b-wsl'), true)
  assert.equal(state.written, '\x03exit\r')

  // A 套的 300ms 时点不应强杀——B 套 grace 500ms（给 WSL 内进程更长的退出时间）。
  await sleep(420)
  assert.deepEqual(state.killedPids, [])

  // 500ms 强杀 wsl.exe（Linux 侧孤儿是已知残留：Windows 侧 kill 打不到 VM 内进程）。
  await sleep(250)
  assert.deepEqual(state.killSignals, ['default'])
  assert.deepEqual(state.killedPids, [3001])

  // 1500ms 重试 + 清理。
  await sleep(1100)
  assert.deepEqual(state.killSignals, ['default', 'default'])
  assert.equal(manager.isRunning('b-wsl'), false)
})

test('B path (tmux backend): Ctrl+C only — exit would kill the kept-alive session', async () => {
  const { manager, state, fakePty } = setup(windowsCapability, { pid: 5001 })
  // tmux 后端当前不会经 start() 进入 Map（startWithTmux 无调用方，AI Runtime 会话
  // 走 runtime-service 自己的 spawn 路径），这里直接构造托管条目验证 stopPty 分支。
  const managed = { pty: fakePty, projectId: 'd-tmux', startTime: Date.now(), backend: 'tmux' }
  manager.processes.set('d-tmux', managed)
  manager.stopping.add('d-tmux')

  manager.stopPty(managed, 5001)
  // 只写 Ctrl+C：exit\r 会在 attach 的会话里真执行，杀会话 = 破坏隐藏保活。
  assert.equal(state.written, '\x03')

  // 500ms 强杀 = detach（杀 attach 的 wsl.exe），会话不受影响。
  await sleep(700)
  assert.deepEqual(state.killSignals, ['default'])
  assert.deepEqual(state.killedPids, [5001])

  // 1500ms 重试 + 清理。
  await sleep(1100)
  assert.equal(manager.isRunning('d-tmux'), false)
})

test('stop during start window: dying key stays invisible to snapshots', async () => {
  const { manager, state } = setup(windowsCapability, { pid: 7001 })
  withPlatform('win32', () => manager.start('f-win', 'sleep 999', 'D:\\repo', false))
  state.events.length = 0

  assert.equal(manager.stop('f-win'), true)
  // 整个停止窗口（含重试后）快照都不含该 key。
  await sleep(1500)
  assert.equal(manager.getInventorySnapshot().managedProcesses.length, 0)
  // 原始清单仍可见（float key 分配依赖它避开死键）。
  assert.equal(manager.isRunning('f-win'), false)
})
