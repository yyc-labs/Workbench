import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const {
  buildWindowsAutomationShellLaunch,
  buildWindowsTerminalTabArgs,
  buildWindowsTerminalShellLaunch,
  preferredWindowsShellForDiagnostics,
  resolveWindowsAutomationShell,
  resolveWindowsPowerShell,
  resolveWindowsTerminalShell,
} = loadTsModule('src/core/electron/main/shell/windows-shell.ts')

test('resolveWindowsTerminalShell prefers pwsh and falls back to powershell then cmd', () => {
  const unavailablePwsh = (kind) => kind !== 'pwsh'
  const resolved = resolveWindowsTerminalShell(undefined, unavailablePwsh)

  assert.deepEqual(resolved, {
    kind: 'powershell',
    command: 'powershell.exe',
  })

  const cmdOnly = resolveWindowsTerminalShell(undefined, (kind) => kind === 'cmd')
  assert.deepEqual(cmdOnly, {
    kind: 'cmd',
    command: 'cmd.exe',
  })
})

test('resolveWindowsTerminalShell respects explicit cmd preference when available', () => {
  const resolved = resolveWindowsTerminalShell('cmd', (kind) => kind === 'cmd' || kind === 'pwsh')

  assert.deepEqual(resolved, {
    kind: 'cmd',
    command: 'cmd.exe',
  })
})

test('resolveWindowsPowerShell prefers pwsh and falls back to powershell', () => {
  const resolved = resolveWindowsPowerShell(undefined, (kind) => kind === 'powershell')

  assert.deepEqual(resolved, {
    kind: 'powershell',
    command: 'powershell.exe',
  })
})

test('resolveWindowsAutomationShell prefers cmd and only falls back when needed', () => {
  const resolved = resolveWindowsAutomationShell(undefined, (kind) => kind === 'cmd' || kind === 'pwsh')

  assert.deepEqual(resolved, {
    kind: 'cmd',
    command: 'cmd.exe',
  })

  const fallback = resolveWindowsAutomationShell(undefined, (kind) => kind === 'pwsh')
  assert.deepEqual(fallback, {
    kind: 'pwsh',
    command: 'pwsh.exe',
  })
})

test('buildWindowsTerminalShellLaunch uses interactive args for pwsh-family shells', () => {
  const launch = buildWindowsTerminalShellLaunch('npm run dev', {
    preferredShell: 'pwsh',
    availability: (kind) => kind === 'pwsh',
  })

  assert.equal(launch.shell.kind, 'pwsh')
  assert.deepEqual(launch.args, ['-NoLogo', '-NoExit', '-Command', 'npm run dev'])
})

test('buildWindowsTerminalShellLaunch omits shell args when no command is provided', () => {
  const launch = buildWindowsTerminalShellLaunch(undefined, {
    availability: () => true,
  })

  assert.equal(launch.shell, undefined)
  assert.deepEqual(launch.args, [])
  assert.deepEqual(buildWindowsTerminalTabArgs('D:\\repo', undefined), ['-d', 'D:\\repo'])
})

test('buildWindowsAutomationShellLaunch uses cmd semantics by default and PowerShell fallback when needed', () => {
  const launch = buildWindowsAutomationShellLaunch('echo hi', {
    availability: (kind) => kind === 'cmd' || kind === 'pwsh',
  })
  assert.equal(launch.shell.kind, 'cmd')
  assert.deepEqual(launch.args, ['/d', '/c', 'echo hi'])

  const fallbackLaunch = buildWindowsAutomationShellLaunch('echo hi', {
    availability: (kind) => kind === 'pwsh',
  })
  assert.equal(fallbackLaunch.shell.kind, 'pwsh')
  assert.deepEqual(fallbackLaunch.args, ['-NoLogo', '-NoProfile', '-Command', 'echo hi'])
})

test('preferredWindowsShellForDiagnostics reports pwsh-first default', () => {
  assert.equal(preferredWindowsShellForDiagnostics(undefined), 'pwsh')
  assert.equal(preferredWindowsShellForDiagnostics('cmd'), 'cmd')
})
