import assert from 'node:assert/strict'
import Module from 'node:module'
import test from 'node:test'
import { loadTsModule, resolveFromRepo } from '../helpers/load-ts-module.mjs'

const { ProcessManager } = loadTsModule('src/core/electron/main/runner.ts')
// startInteractive 经主进程 resolveInteractiveShellCommand 解析交互 shell（探测真实 shell，
// 机器相关）。与 runner-windows-start 同一手法：把模块缓存里的解析器钉住，保证断言确定。
const windowsShellPath = resolveFromRepo('src/core/electron/main/shell/windows-shell.ts')
const windowsShellModule = Module._cache[windowsShellPath].exports
windowsShellModule.resolveInteractiveShellCommand = (useWsl) => (useWsl ? { command: 'bash -i', shellKind: 'bash' } : { command: 'pwsh.exe', shellKind: 'pwsh' })

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

const wslCapability = {
  ...windowsCapability,
  hasWslInstalled: true,
  hasWsl: true,
  wslDistro: 'Ubuntu',
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

/** 可脚本化触发输出的假 pty：onData 监听器由测试手动触发。 */
function createFakePty() {
  const listeners = []
  const writes = []
  return {
    writes,
    onData: (listener) => {
      listeners.push(listener)
      return { dispose: () => {} }
    },
    onExit: () => undefined,
    resize: () => undefined,
    write: (data) => writes.push(data),
    kill: () => undefined,
    emitData: (data) => {
      for (const listener of [...listeners]) listener(data)
    },
  }
}

test('startInteractive 起交互 shell 并把命令作为输入下发', () => {
  const manager = new ProcessManager(windowsCapability)
  let spawnCommand = null
  let spawnArgs = null
  let spawnOptions = null
  const pty = createFakePty()
  manager.getPtySpawn = () => (command, args, options) => {
    spawnCommand = command
    spawnArgs = args
    spawnOptions = options
    return pty
  }

  const started = withPlatform('win32', () => manager.startInteractive('p::run::dev', 'npm run dev', 'D:\\repo', false, { cols: 175, rows: 12 }))

  assert.equal(started, true)
  // 交互 shell（而非把命令交给 -Command 一次性执行）
  assert.equal(spawnCommand, 'pwsh.exe')
  assert.deepEqual(spawnArgs, ['-NoLogo', '-NoProfile', '-Command', 'pwsh.exe'])
  // 初始尺寸透传：pty 以面板视口尺寸启动，避开 conpty reflow
  assert.deepEqual({ cols: spawnOptions.cols, rows: spawnOptions.rows }, { cols: 175, rows: 12 })
  // shell 就绪（首条输出）前不下发
  assert.deepEqual(pty.writes, [])
  pty.emitData('PS D:\\repo> ')
  assert.deepEqual(pty.writes, ['npm run dev\r'])
  // 只发送一次：后续输出不重复下发
  pty.emitData('more output')
  assert.deepEqual(pty.writes, ['npm run dev\r'])
})

test('startInteractive 忽略空输出 chunk', () => {
  const manager = new ProcessManager(windowsCapability)
  const pty = createFakePty()
  manager.getPtySpawn = () => () => pty

  withPlatform('win32', () => manager.startInteractive('k', 'echo hi', 'D:\\repo', false))
  pty.emitData('')
  assert.deepEqual(pty.writes, [])
  pty.emitData('PS>')
  assert.deepEqual(pty.writes, ['echo hi\r'])
})

test('startInteractive 无输出时按超时兜底下发', async () => {
  const manager = new ProcessManager(windowsCapability)
  const pty = createFakePty()
  manager.getPtySpawn = () => () => pty

  withPlatform('win32', () => manager.startInteractive('k', 'npm run build', 'D:\\repo', false))
  assert.deepEqual(pty.writes, [])
  await new Promise((resolve) => setTimeout(resolve, 1200))
  assert.deepEqual(pty.writes, ['npm run build\r'])
})

test('startInteractive 在 WSL 项目解析 bash -i', () => {
  const manager = new ProcessManager(wslCapability)
  let spawnArgs = null
  const pty = createFakePty()
  manager.getPtySpawn = () => (_command, args) => {
    spawnArgs = args
    return pty
  }

  const started = withPlatform('win32', () => manager.startInteractive('p', 'ls', 'D:\\repo', true))
  assert.equal(started, true)
  assert.deepEqual(spawnArgs.slice(0, 4), ['-d', 'Ubuntu', '-e', 'bash'])
})

test('startInteractive 启动失败（重键）返回 false 且不下发', () => {
  const manager = new ProcessManager(windowsCapability)
  const pty = createFakePty()
  manager.getPtySpawn = () => () => pty

  withPlatform('win32', () => {
    assert.equal(manager.startInteractive('dup', 'cmd', 'D:\\repo', false), true)
    assert.equal(manager.startInteractive('dup', 'cmd', 'D:\\repo', false), false)
  })
  // 第二次启动被重键拒绝；就绪后只应收到第一次命令
  pty.emitData('PS>')
  assert.deepEqual(pty.writes, ['cmd\r'])
})
