import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { buildWindowsAutomationShellLaunch, buildWindowsTerminalTabArgs, buildWindowsTerminalShellLaunch, preferredWindowsShellForDiagnostics, resolveWindowsAutomationShell, resolveWindowsPowerShell, resolveWindowsTerminalShell } = loadTsModule('src/core/electron/main/shell/windows-shell.ts')

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

test('resolveWindowsAutomationShell prefers pwsh and falls back to powershell then cmd', () => {
  const resolved = resolveWindowsAutomationShell(undefined, (kind) => kind === 'cmd' || kind === 'pwsh')

  assert.deepEqual(resolved, {
    kind: 'pwsh',
    command: 'pwsh.exe',
  })

  const noPwsh = resolveWindowsAutomationShell(undefined, (kind) => kind === 'cmd' || kind === 'powershell')
  assert.deepEqual(noPwsh, {
    kind: 'powershell',
    command: 'powershell.exe',
  })

  const fallback = resolveWindowsAutomationShell(undefined, (kind) => kind === 'cmd')
  assert.deepEqual(fallback, {
    kind: 'cmd',
    command: 'cmd.exe',
  })
})

test('buildWindowsTerminalShellLaunch uses interactive args for pwsh-family shells', () => {
  const launch = buildWindowsTerminalShellLaunch('npm run dev', {
    preferredShell: 'pwsh',
    availability: (kind) => kind === 'pwsh',
  })

  assert.equal(launch.shell.kind, 'pwsh')
  assert.deepEqual(launch.args, ['-NoLogo', '-NoProfile', '-NoExit', '-Command', 'npm run dev'])
})

test('buildWindowsTerminalShellLaunch omits shell args when no command is provided', () => {
  const launch = buildWindowsTerminalShellLaunch(undefined, {
    availability: () => true,
  })

  assert.equal(launch.shell, undefined)
  assert.deepEqual(launch.args, [])
  assert.deepEqual(buildWindowsTerminalTabArgs('D:\\repo', undefined), ['-d', 'D:\\repo'])
})

test('buildWindowsAutomationShellLaunch uses PowerShell semantics by default and cmd only when explicitly preferred', () => {
  const launch = buildWindowsAutomationShellLaunch('echo hi', {
    availability: (kind) => kind === 'cmd' || kind === 'pwsh',
  })
  assert.equal(launch.shell.kind, 'pwsh')
  assert.deepEqual(launch.args, ['-NoLogo', '-NoProfile', '-Command', 'echo hi'])

  const cmdLaunch = buildWindowsAutomationShellLaunch('echo hi', {
    preferredShell: 'cmd',
    availability: (kind) => kind === 'cmd' || kind === 'pwsh',
  })
  assert.equal(cmdLaunch.shell.kind, 'cmd')
  assert.deepEqual(cmdLaunch.args, ['/d', '/c', 'echo hi'])
})

test('preferredWindowsShellForDiagnostics reports pwsh-first default', () => {
  assert.equal(preferredWindowsShellForDiagnostics(undefined), 'pwsh')
  assert.equal(preferredWindowsShellForDiagnostics('cmd'), 'cmd')
})
