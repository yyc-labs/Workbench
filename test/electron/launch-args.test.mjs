import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const {
  WINDOWS_AUTOSTART_ARG,
  WINDOWS_AUTOSTART_SILENT_ARG,
  buildInteractiveRelaunchArgs,
  buildWindowsAutostartArgs,
  isSilentAutostartLaunch,
  isWindowsAutostartLaunch,
} = loadTsModule('src/core/electron/main/launchArgs.ts')

test('interactive relaunch removes Windows autostart arguments', () => {
  assert.deepEqual(
    buildInteractiveRelaunchArgs([
      'IDE Electron.exe',
      '--user-data-dir=D:\\IDE Electron Data',
      WINDOWS_AUTOSTART_ARG,
      '--inspect=9229',
      WINDOWS_AUTOSTART_SILENT_ARG,
    ]),
    [
      '--user-data-dir=D:\\IDE Electron Data',
      '--inspect=9229',
    ]
  )
})

test('autostart launch detection uses exact startup flags', () => {
  assert.equal(isWindowsAutostartLaunch(['IDE Electron.exe', WINDOWS_AUTOSTART_ARG]), true)
  assert.equal(isSilentAutostartLaunch(['IDE Electron.exe', WINDOWS_AUTOSTART_SILENT_ARG]), true)
  assert.equal(isWindowsAutostartLaunch(['IDE Electron.exe', '--not-autostart']), false)
  assert.equal(isSilentAutostartLaunch(['IDE Electron.exe', '--autostart-silent=false']), false)
})

test('Windows autostart args reflect configured display mode', () => {
  assert.deepEqual(
    buildWindowsAutostartArgs('tray'),
    [WINDOWS_AUTOSTART_ARG, WINDOWS_AUTOSTART_SILENT_ARG]
  )
  assert.deepEqual(
    buildWindowsAutostartArgs('window'),
    [WINDOWS_AUTOSTART_ARG]
  )
})
