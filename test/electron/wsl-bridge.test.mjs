import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

test('wslBridge host availability probe does not enter the distro', () => {
  const require = createRequire(import.meta.url)
  const childProcess = require('node:child_process')
  const originalExecSync = childProcess.execSync
  const commands = []

  childProcess.execSync = (command) => {
    commands.push(command)
    if (command === 'wsl.exe --status') return Buffer.from('')
    if (command === 'wsl.exe -l -q') return Buffer.from('Ubuntu\n', 'utf8')
    throw new Error(`Unexpected command: ${command}`)
  }

  try {
    const { wslBridge } = loadTsModule('src/core/electron/main/wsl-bridge.ts')

    assert.equal(wslBridge.isAvailable(), true)
    assert.deepEqual(commands, ['wsl.exe --status', 'wsl.exe -l -q'])
    assert.equal(wslBridge.getDistro(), 'Ubuntu')
  } finally {
    childProcess.execSync = originalExecSync
  }
})
