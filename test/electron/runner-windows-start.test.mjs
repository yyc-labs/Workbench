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

function createFakePty() {
  return {
    onData: () => undefined,
    onExit: () => undefined,
    resize: () => undefined,
    write: () => undefined,
    kill: () => undefined,
  }
}

test('Windows direct-pty backend starts host-native instead of POSIX bash', () => {
  const manager = new ProcessManager(windowsCapability)
  let hostNativeArgs = null
  let startWithPtyCalled = false

  manager.startHostNative = (...args) => {
    hostNativeArgs = args
    return true
  }
  manager.startWithPty = () => {
    startWithPtyCalled = true
    return false
  }

  const started = withPlatform('win32', () => manager.start('project-1', 'npm run dev', 'D:\\repo'))

  assert.equal(started, true)
  assert.deepEqual(hostNativeArgs, ['project-1', 'npm run dev', 'D:\\repo'])
  assert.equal(startWithPtyCalled, false)
})

test('Windows host-native pty uses absolute cmd path for packaged environments', () => {
  const manager = new ProcessManager(windowsCapability)
  const originalSystemRoot = process.env.SystemRoot
  const originalComSpec = process.env.ComSpec
  const originalLowerComspec = process.env.comspec
  let spawnedCommand = null

  process.env.SystemRoot = 'C:\\Windows'
  delete process.env.ComSpec
  delete process.env.comspec
  manager.getPtySpawn = () => (command) => {
    spawnedCommand = command
    return createFakePty()
  }

  try {
    const started = withPlatform('win32', () => manager.start('project-2', 'echo hi', 'D:\\repo', false))

    assert.equal(started, true)
    assert.equal(spawnedCommand, 'C:\\Windows\\System32\\cmd.exe')
  } finally {
    if (originalSystemRoot === undefined) {
      delete process.env.SystemRoot
    } else {
      process.env.SystemRoot = originalSystemRoot
    }
    if (originalComSpec === undefined) {
      delete process.env.ComSpec
    } else {
      process.env.ComSpec = originalComSpec
    }
    if (originalLowerComspec === undefined) {
      delete process.env.comspec
    } else {
      process.env.comspec = originalLowerComspec
    }
  }
})
