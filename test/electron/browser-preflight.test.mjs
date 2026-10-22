import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import Module from 'node:module'
import test, { after } from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

// ─── child_process / electron stubs ───────────────────────────
// Installed before any module under test is loaded so the transpiled
// `require('child_process')` / `require('electron')` bindings resolve here.
// The impls live in a mutable state holder, so the module under test (and its
// cached `./openers` dependency) always call the current test's behaviour.

const stubState = {
  execFileImpl: null,
  spawnImpl: null,
  openExternalImpl: null,
}

const childProcessStub = {
  execFile: (command, args, options, callback) => stubState.execFileImpl(command, args, options, callback),
  spawn: (command, args, options) => stubState.spawnImpl(command, args, options),
}

const electronStub = {
  shell: {
    openExternal: (url) => stubState.openExternalImpl(url),
  },
}

const originalModuleLoad = Module._load
Module._load = function loadWithElectronStubs(request, parent, isMain) {
  if (request === 'child_process') return childProcessStub
  if (request === 'electron') return electronStub
  return originalModuleLoad.call(this, request, parent, isMain)
}

after(() => {
  Module._load = originalModuleLoad
})

const { parseProgIdFromRegOutput, parseBrowserExePathFromRegOutput, parseProcessNameFromExePath } = loadTsModule('src/core/electron/main/shell/browser-preflight.ts')

test('parseProgIdFromRegOutput extracts ProgId from reg query output', () => {
  const output = ['', 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice', '    ProgId    REG_SZ    ChromeHTML', ''].join('\n')

  assert.equal(parseProgIdFromRegOutput(output), 'ChromeHTML')
})

test('parseProgIdFromRegOutput returns null when the value is missing', () => {
  assert.equal(parseProgIdFromRegOutput('ERROR: The system was unable to find the specified registry key or value.'), null)
  assert.equal(parseProgIdFromRegOutput(''), null)
})

test('parseBrowserExePathFromRegOutput handles quoted and unquoted command values', () => {
  const quoted = ['', 'HKEY_CLASSES_ROOT\\ChromeHTML\\shell\\open\\command', '    (Default)    REG_SZ    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --single-argument %1', ''].join('\n')
  assert.equal(parseBrowserExePathFromRegOutput(quoted), 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')

  const unquoted = ['', 'HKEY_CLASSES_ROOT\\MSEdgeHTM\\shell\\open\\command', '    (Default)    REG_SZ    C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe --single-argument %1', ''].join('\n')
  assert.equal(parseBrowserExePathFromRegOutput(unquoted), 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')
})

test('parseBrowserExePathFromRegOutput returns null when no exe path is present', () => {
  assert.equal(parseBrowserExePathFromRegOutput('Value not found.'), null)
  assert.equal(parseBrowserExePathFromRegOutput(''), null)
})

test('parseProcessNameFromExePath normalizes separators and lowercases the basename', () => {
  assert.equal(parseProcessNameFromExePath('C:\\Program Files\\Google\\Chrome\\Application\\CHROME.EXE'), 'chrome.exe')
  assert.equal(parseProcessNameFromExePath('C:/Program Files/Mozilla Firefox/firefox.exe'), 'firefox.exe')
  assert.equal(parseProcessNameFromExePath('msedge.exe'), 'msedge.exe')
})

// ─── behavioral stubs ─────────────────────────────────────────

const BROWSER_EXE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BROWSER_PROCESS = 'msedge.exe'
const REG_USER_CHOICE = ['', 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice', '    ProgId    REG_SZ    MSEdgeHTM', ''].join('\n')
const REG_OPEN_COMMAND = ['', 'HKEY_CLASSES_ROOT\\MSEdgeHTM\\shell\\open\\command', '    (Default)    REG_SZ    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --single-argument %1', ''].join('\n')
const TASKLIST_RUNNING = ['"Image Name","PID","Session Name","Session#","Mem Usage"', '"msedge.exe","1234","Console","1","100,000 K"'].join('\r\n')
const REG_KEY_MISSING = 'ERROR: The system was unable to find the specified registry key or value.'

function createExecFileStub({ userChoice = REG_USER_CHOICE, openCommand = REG_OPEN_COMMAND, tasklist = '' } = {}) {
  const calls = []
  const impl = (command, args, _options, callback) => {
    calls.push({ command, args })
    let stdout = null
    if (command === 'reg') stdout = (args[1] ?? '').includes('UserChoice') ? userChoice : openCommand
    else if (command === 'tasklist') stdout = tasklist
    callback(null, stdout)
  }
  return { impl, calls }
}

function countOf(calls, command) {
  return calls.filter((call) => call.command === command).length
}

/** Fake ChildProcess that emits the given events on a microtask. */
function createFakeChild(events = ['spawn']) {
  const child = new EventEmitter()
  child.unrefCalls = 0
  child.unref = () => {
    child.unrefCalls += 1
  }
  queueMicrotask(() => {
    for (const event of events) {
      if (event === 'spawn') child.emit('spawn')
      else if (event === 'error') child.emit('error', new Error('spawn ENOENT'))
    }
  })
  return child
}

function createOpenExternalStub(behavior = 'ok') {
  const calls = []
  const impl = async (url) => {
    calls.push(url)
    if (behavior === 'fail') throw new Error('shell.openExternal failed')
  }
  return { impl, calls }
}

/**
 * Load a fresh browser-preflight instance (fresh module-level browser cache)
 * with the given child_process / electron behaviour wired in.
 */
function loadPreflight({ execFile, spawn, openExternal }) {
  stubState.execFileImpl = execFile.impl
  stubState.spawnImpl = spawn
  stubState.openExternalImpl = openExternal.impl
  return loadTsModule('src/core/electron/main/shell/browser-preflight.ts')
}

function withPlatform(platform, fn) {
  const original = process.platform
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  return Promise.resolve(fn()).finally(() => {
    Object.defineProperty(process, 'platform', { value: original, configurable: true })
  })
}

// ─── openExternalUrlWithBrowserPreflight behavior ─────────────

test('browser already running delegates to shell.openExternal without launching the browser executable', async () => {
  const exec = createExecFileStub({ tasklist: TASKLIST_RUNNING })
  const spawnCalls = []
  const openExternal = createOpenExternalStub()
  const { openExternalUrlWithBrowserPreflight } = loadPreflight({
    execFile: exec,
    spawn: (command, args, options) => {
      const child = createFakeChild(['spawn'])
      spawnCalls.push({ command, args, options, child })
      return child
    },
    openExternal,
  })

  await withPlatform('win32', () => openExternalUrlWithBrowserPreflight('http://localhost:5173/'))

  assert.deepEqual(openExternal.calls, ['http://localhost:5173/'])
  assert.equal(spawnCalls.length, 0)
  assert.equal(countOf(exec.calls, 'tasklist'), 1)
})

test('cold start launches the browser executable and resolves after spawn without polling for the process', async () => {
  const exec = createExecFileStub({ tasklist: '' })
  const spawnCalls = []
  const openExternal = createOpenExternalStub()
  const { openExternalUrlWithBrowserPreflight } = loadPreflight({
    execFile: exec,
    spawn: (command, args, options) => {
      const child = createFakeChild(['spawn'])
      spawnCalls.push({ command, args, options, child })
      return child
    },
    openExternal,
  })

  await withPlatform('win32', () => openExternalUrlWithBrowserPreflight('http://localhost:5173/'))

  assert.equal(spawnCalls.length, 1)
  assert.equal(spawnCalls[0].command, BROWSER_EXE)
  assert.deepEqual(spawnCalls[0].args, ['http://localhost:5173/'])
  assert.deepEqual(spawnCalls[0].options, { detached: true, windowsHide: true, stdio: 'ignore' })
  assert.equal(spawnCalls[0].child.unrefCalls, 1)
  assert.deepEqual(openExternal.calls, [])
  // The running check runs once; no tasklist polling follows the launch.
  assert.equal(countOf(exec.calls, 'tasklist'), 1)
})

test('spawn error event falls back to openExternal exactly once', async () => {
  const exec = createExecFileStub({ tasklist: '' })
  const spawnCalls = []
  const openExternal = createOpenExternalStub()
  const { openExternalUrlWithBrowserPreflight } = loadPreflight({
    execFile: exec,
    spawn: (command, args) => {
      const child = createFakeChild(['error'])
      spawnCalls.push({ command, args, child })
      return child
    },
    openExternal,
  })

  await withPlatform('win32', () => openExternalUrlWithBrowserPreflight('http://localhost:5173/'))

  assert.equal(spawnCalls.length, 1)
  assert.equal(spawnCalls[0].child.unrefCalls, 0)
  assert.deepEqual(openExternal.calls, ['http://localhost:5173/'])
})

test('synchronous spawn throw falls back to openExternal exactly once', async () => {
  const exec = createExecFileStub({ tasklist: '' })
  const openExternal = createOpenExternalStub()
  const { openExternalUrlWithBrowserPreflight } = loadPreflight({
    execFile: exec,
    spawn: () => {
      throw new Error('spawn EINVAL')
    },
    openExternal,
  })

  await withPlatform('win32', () => openExternalUrlWithBrowserPreflight('http://localhost:5173/'))

  assert.deepEqual(openExternal.calls, ['http://localhost:5173/'])
})

test('a late duplicate error after a successful spawn does not trigger a second open attempt', async () => {
  const exec = createExecFileStub({ tasklist: '' })
  const openExternal = createOpenExternalStub()
  const { openExternalUrlWithBrowserPreflight } = loadPreflight({
    execFile: exec,
    spawn: () => createFakeChild(['spawn', 'error']),
    openExternal,
  })

  await withPlatform('win32', () => openExternalUrlWithBrowserPreflight('http://localhost:5173/'))

  assert.deepEqual(openExternal.calls, [])
  assert.equal(countOf(exec.calls, 'tasklist'), 1)
})

test('shell.openExternal failure falls back to explorer.exe exactly once', async () => {
  const exec = createExecFileStub({ userChoice: '' })
  const openExternal = createOpenExternalStub('fail')
  const spawnCalls = []
  const { openExternalUrlWithBrowserPreflight } = loadPreflight({
    execFile: exec,
    spawn: (command, args) => {
      const child = createFakeChild(['spawn'])
      spawnCalls.push({ command, args, child })
      return child
    },
    openExternal,
  })

  await withPlatform('win32', () => openExternalUrlWithBrowserPreflight('http://localhost:5173/'))

  assert.equal(spawnCalls.length, 1)
  assert.equal(spawnCalls[0].command, 'explorer.exe')
  assert.deepEqual(spawnCalls[0].args, ['http://localhost:5173/'])
  assert.equal(openExternal.calls.length, 1)
})

test('explorer fallback failure does not retry the open request', async () => {
  const exec = createExecFileStub({ tasklist: '' })
  const openExternal = createOpenExternalStub('fail')
  const spawnCalls = []
  const { openExternalUrlWithBrowserPreflight } = loadPreflight({
    execFile: exec,
    spawn: (command, args) => {
      const child = createFakeChild(command === 'explorer.exe' ? ['error', 'error'] : ['error'])
      spawnCalls.push({ command, args, child })
      return child
    },
    openExternal,
  })

  await withPlatform('win32', () => openExternalUrlWithBrowserPreflight('http://localhost:5173/'))

  const explorerCalls = spawnCalls.filter((call) => call.command === 'explorer.exe')
  assert.equal(explorerCalls.length, 1)
  assert.deepEqual(explorerCalls[0].args, ['http://localhost:5173/'])
  assert.equal(openExternal.calls.length, 1)
})

test('browser resolution failure falls through to openExternal without probing processes', async () => {
  const exec = createExecFileStub({ userChoice: REG_KEY_MISSING })
  const openExternal = createOpenExternalStub()
  const { openExternalUrlWithBrowserPreflight } = loadPreflight({
    execFile: exec,
    spawn: () => createFakeChild(['spawn']),
    openExternal,
  })

  await withPlatform('win32', () => openExternalUrlWithBrowserPreflight('http://localhost:5173/'))

  assert.equal(countOf(exec.calls, 'reg'), 1)
  assert.equal(countOf(exec.calls, 'tasklist'), 0)
  assert.deepEqual(openExternal.calls, ['http://localhost:5173/'])
})

test('non-http urls bypass browser preflight', async () => {
  const exec = createExecFileStub({ tasklist: TASKLIST_RUNNING })
  const spawnCalls = []
  const openExternal = createOpenExternalStub()
  const { openExternalUrlWithBrowserPreflight } = loadPreflight({
    execFile: exec,
    spawn: (command, args) => {
      spawnCalls.push({ command, args })
      return createFakeChild(['spawn'])
    },
    openExternal,
  })

  await withPlatform('win32', () => openExternalUrlWithBrowserPreflight('workbench://route/code'))

  assert.equal(exec.calls.length, 0)
  assert.equal(spawnCalls.length, 0)
  assert.deepEqual(openExternal.calls, ['workbench://route/code'])
})

test('non-win32 platforms open without preflight resolution', async () => {
  const exec = createExecFileStub({ tasklist: TASKLIST_RUNNING })
  const openExternal = createOpenExternalStub()
  const { openExternalUrlWithBrowserPreflight } = loadPreflight({
    execFile: exec,
    spawn: () => createFakeChild(['spawn']),
    openExternal,
  })

  await withPlatform('linux', () => openExternalUrlWithBrowserPreflight('http://localhost:5173/'))

  assert.equal(exec.calls.length, 0)
  assert.deepEqual(openExternal.calls, ['http://localhost:5173/'])
})

// ─── default browser resolution ───────────────────────────────

test('resolveDefaultBrowser caches registry lookups within the process', async () => {
  const exec = createExecFileStub()
  const { resolveDefaultBrowser } = loadPreflight({
    execFile: exec,
    spawn: () => createFakeChild(['spawn']),
    openExternal: createOpenExternalStub(),
  })

  const first = await resolveDefaultBrowser()
  const second = await resolveDefaultBrowser()

  assert.deepEqual(first, { progId: 'MSEdgeHTM', processName: BROWSER_PROCESS, exePath: BROWSER_EXE })
  assert.equal(second, first)
  assert.equal(countOf(exec.calls, 'reg'), 2)
})

test('resolveDefaultBrowser returns null when the UserChoice ProgId is missing', async () => {
  const exec = createExecFileStub({ userChoice: REG_KEY_MISSING })
  const { resolveDefaultBrowser } = loadPreflight({
    execFile: exec,
    spawn: () => createFakeChild(['spawn']),
    openExternal: createOpenExternalStub(),
  })

  assert.equal(await resolveDefaultBrowser(), null)
  assert.equal(countOf(exec.calls, 'reg'), 1)
})
