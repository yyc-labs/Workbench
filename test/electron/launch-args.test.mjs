import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { QUICK_ACTION_ARG_PREFIX, WINDOWS_AUTOSTART_ARG, WINDOWS_AUTOSTART_SILENT_ARG, buildInteractiveRelaunchArgs, buildWindowsAutostartArgs, isSilentAutostartLaunch, isWindowsAutostartLaunch, parseQuickActionArg } = loadTsModule('src/core/electron/main/launchArgs.ts')

test('interactive relaunch removes Windows autostart arguments', () => {
  assert.deepEqual(buildInteractiveRelaunchArgs(['Workbench.exe', '--user-data-dir=D:\\Workbench Data', WINDOWS_AUTOSTART_ARG, '--inspect=9229', WINDOWS_AUTOSTART_SILENT_ARG]), ['--user-data-dir=D:\\Workbench Data', '--inspect=9229'])
})

test('autostart launch detection uses exact startup flags', () => {
  assert.equal(isWindowsAutostartLaunch(['Workbench.exe', WINDOWS_AUTOSTART_ARG]), true)
  assert.equal(isSilentAutostartLaunch(['Workbench.exe', WINDOWS_AUTOSTART_SILENT_ARG]), true)
  assert.equal(isWindowsAutostartLaunch(['Workbench.exe', '--not-autostart']), false)
  assert.equal(isSilentAutostartLaunch(['Workbench.exe', '--autostart-silent=false']), false)
})

test('Windows autostart args reflect configured display mode', () => {
  assert.deepEqual(buildWindowsAutostartArgs('tray'), [WINDOWS_AUTOSTART_ARG, WINDOWS_AUTOSTART_SILENT_ARG])
  assert.deepEqual(buildWindowsAutostartArgs('window'), [WINDOWS_AUTOSTART_ARG])
})

test('parseQuickActionArg returns the first quick action id', () => {
  assert.equal(parseQuickActionArg(['Workbench.exe', `${QUICK_ACTION_ARG_PREFIX}11111111-1111-4111-8111-111111111111`]), '11111111-1111-4111-8111-111111111111')
  assert.equal(parseQuickActionArg(['Workbench.exe', WINDOWS_AUTOSTART_ARG, `${QUICK_ACTION_ARG_PREFIX}abc`, `${QUICK_ACTION_ARG_PREFIX}def`]), 'abc')
})

test('parseQuickActionArg returns null when absent or empty', () => {
  assert.equal(parseQuickActionArg(['Workbench.exe', WINDOWS_AUTOSTART_ARG]), null)
  assert.equal(parseQuickActionArg(['Workbench.exe', '--quick-action=']), null)
  assert.equal(parseQuickActionArg([]), null)
})

test('interactive relaunch strips quick action arguments', () => {
  assert.deepEqual(buildInteractiveRelaunchArgs(['Workbench.exe', `${QUICK_ACTION_ARG_PREFIX}abc`, '--inspect=9229']), ['--inspect=9229'])
})
