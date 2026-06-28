import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const {
  resolveCodexScopeDescriptor,
} = loadTsModule('src/core/shared/codexScope.ts')

test('resolveCodexScopeDescriptor uses WSL target for explicit windows-wsl mode without eager capability probe', () => {
  const scope = resolveCodexScopeDescriptor({
    hostPlatform: 'windows',
    backend: 'direct-pty',
    hasPty: true,
    hasWslInstalled: false,
    hasWsl: false,
    hasTmux: false,
    wslDistro: undefined,
    wslShell: 'bash',
    wslEnv: undefined,
  }, {
    mode: 'windows-wsl',
  })

  assert.deepEqual(scope, {
    hostPlatform: 'windows',
    runtimeMode: 'windows-wsl',
    target: 'wsl',
  })
})

test('resolveCodexScopeDescriptor keeps custom-script on native target for Windows-style entrypoint', () => {
  const scope = resolveCodexScopeDescriptor({
    hostPlatform: 'windows',
    backend: 'direct-pty',
    hasPty: true,
    hasWslInstalled: false,
    hasWsl: false,
    hasTmux: false,
    wslDistro: undefined,
    wslShell: 'bash',
    wslEnv: undefined,
  }, {
    mode: 'custom-script',
    runtimeEntrypoint: 'D:\\tools\\start-runtime.ps1',
  })

  assert.deepEqual(scope, {
    hostPlatform: 'windows',
    runtimeMode: 'custom-script',
    target: 'native',
  })
})

test('resolveCodexScopeDescriptor keeps empty custom-script target native on Windows', () => {
  const scope = resolveCodexScopeDescriptor({
    hostPlatform: 'windows',
    backend: 'direct-pty',
    hasPty: true,
    hasWslInstalled: false,
    hasWsl: false,
    hasTmux: false,
    wslDistro: undefined,
    wslShell: 'bash',
    wslEnv: undefined,
  }, {
    mode: 'custom-script',
    runtimeEntrypoint: '',
  })

  assert.deepEqual(scope, {
    hostPlatform: 'windows',
    runtimeMode: 'custom-script',
    target: 'native',
  })
})

test('resolveCodexScopeDescriptor uses WSL target for Linux-style custom-script on Windows', () => {
  const scope = resolveCodexScopeDescriptor({
    hostPlatform: 'windows',
    backend: 'direct-pty',
    hasPty: true,
    hasWslInstalled: false,
    hasWsl: false,
    hasTmux: false,
    wslDistro: undefined,
    wslShell: 'bash',
    wslEnv: undefined,
  }, {
    mode: 'custom-script',
    runtimeEntrypoint: '/home/ubuntu/bin/start-runtime.sh',
  })

  assert.deepEqual(scope, {
    hostPlatform: 'windows',
    runtimeMode: 'custom-script',
    target: 'wsl',
  })
})

test('resolveCodexScopeDescriptor prefers structured custom-script target over path heuristics', () => {
  const scope = resolveCodexScopeDescriptor({
    hostPlatform: 'windows',
    backend: 'direct-pty',
    hasPty: true,
    hasWslInstalled: true,
    hasWsl: false,
    hasTmux: false,
    wslDistro: 'Ubuntu',
    wslShell: 'bash',
    wslEnv: undefined,
  }, {
    mode: 'custom-script',
    runtimeEntrypointConfig: {
      target: 'native',
      path: '/home/ubuntu/bin/start-runtime.sh',
    },
    runtimeEntrypoint: '/home/ubuntu/bin/start-runtime.sh',
  })

  assert.deepEqual(scope, {
    hostPlatform: 'windows',
    runtimeMode: 'custom-script',
    target: 'native',
  })
})
