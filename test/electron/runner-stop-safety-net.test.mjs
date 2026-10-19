import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { ProcessManager } = loadTsModule('src/core/electron/main/runner.ts')

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

test('stop safety net force-kills the process tree when exit never arrives', async () => {
  const manager = new ProcessManager(windowsCapability)
  const killedPids = []
  manager.killProcessTreeImmediate = (pid) => {
    killedPids.push(pid)
  }

  let written = ''
  const killSignals = []
  const fakePty = {
    pid: 4242,
    onData: () => undefined,
    // 永远不触发退出：模拟进程吞掉 Ctrl+C / exit 的场景。
    onExit: () => undefined,
    resize: () => undefined,
    write: (data) => {
      written += data
    },
    kill: (signal) => {
      killSignals.push(signal ?? 'default')
    },
  }
  manager.getPtySpawn = () => () => fakePty

  const started = withPlatform('win32', () => manager.start('safety-net-1', 'sleep 999', 'D:\\repo', false))
  assert.equal(started, true)

  assert.equal(manager.stop('safety-net-1'), true)
  // A 套（direct-pty）：Ctrl+C + exit\r 先写，300ms 后强杀。
  assert.equal(written, '\x03exit\r')

  // 300ms 强杀（无信号 pty.kill + taskkill 树），exit 仍没来。
  await new Promise((resolve) => setTimeout(resolve, 450))
  assert.deepEqual(killSignals, ['default'])
  assert.deepEqual(killedPids, [4242])

  // 1200ms 重试 + 清理（O6/O7：补杀 + warn + 结算状态）。
  await new Promise((resolve) => setTimeout(resolve, 900))
  assert.deepEqual(killSignals, ['default', 'default'])
  assert.equal(manager.isRunning('safety-net-1'), false)
})

test('stop safety net stays silent when the process exits in time', async () => {
  const manager = new ProcessManager(windowsCapability)
  const killedPids = []
  manager.killProcessTreeImmediate = (pid) => {
    killedPids.push(pid)
  }

  let writtenForExit = ''
  const fakePty = {
    pid: 5150,
    onData: () => undefined,
    onExit: (cb) => {
      // 模拟 Ctrl+C 后 200ms 正常退出。
      setTimeout(() => cb({ exitCode: 0 }), 200)
    },
    resize: () => undefined,
    write: (data) => {
      writtenForExit += data
    },
    kill: () => undefined,
  }
  manager.getPtySpawn = () => () => fakePty

  const started = withPlatform('win32', () => manager.start('safety-net-2', 'sleep 1', 'D:\\repo', false))
  assert.equal(started, true)

  assert.equal(manager.stop('safety-net-2'), true)
  assert.equal(writtenForExit, '\x03exit\r')
  // 200ms 自然退出后，300ms 强杀与 1200ms 重试都不应触发。
  await new Promise((resolve) => setTimeout(resolve, 1400))

  assert.deepEqual(killedPids, [])
  assert.equal(manager.isRunning('safety-net-2'), false)
})
