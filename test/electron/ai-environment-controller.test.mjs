import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { loadTsModule, resolveFromRepo } from '../helpers/load-ts-module.mjs'

const { AiEnvironmentController } = loadTsModule('src/core/electron/main/ai-environment/environment-controller.ts')

const require = createRequire(import.meta.url)
const { wslBridge } = require(resolveFromRepo('src/core/electron/main/wsl-bridge.ts'))

function createCapability() {
  return {
    hostPlatform: 'windows',
    backend: 'direct-pty',
    hasPty: true,
    hasWslInstalled: true,
    hasWsl: false,
    hasTmux: false,
    wslDistro: undefined,
    wslShell: 'bash',
    wslEnv: undefined,
  }
}

function createAiCommitConfig() {
  return {
    enabled: true,
    apiBaseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    wslPwshPath: '/snap/bin/pwsh',
    split: false,
    splitMaxBatches: 4,
    maxBullets: 8,
  }
}

test('environment controller upgrades capability only when windows-wsl mode is used', async () => {
  let capability = createCapability()
  let setCalls = 0
  const originalIsAvailable = wslBridge.isAvailable
  const originalGetDistro = wslBridge.getDistro
  const originalGetShell = wslBridge.getShell

  wslBridge.isAvailable = () => true
  wslBridge.getDistro = () => 'Ubuntu'
  wslBridge.getShell = () => 'bash'

  try {
    const controller = new AiEnvironmentController(
      () => capability,
      (next) => {
        capability = next
        setCalls += 1
      },
      () => ({
        projects: [],
        theme: 'system',
        aiEnvironment: {
          mode: 'windows-native',
        },
        aiRuntimeProfiles: [],
        activeAiRuntimeProfileId: '',
        claudeRuntimeProfiles: [],
        activeClaudeRuntimeProfileId: '',
        runtimeKeepAliveOnQuit: false,
        aiCommit: createAiCommitConfig(),
      }),
    )

    const nativeDiagnostics = await controller.diagnoseRuntime()
    assert.equal(nativeDiagnostics.mode, 'windows-native')
    assert.equal(setCalls, 0)
    assert.equal(capability.hasWsl, false)

    const wslDiagnostics = await controller.diagnoseRuntime({
      id: 'native-wsl',
      name: 'Native WSL',
      kind: 'native',
      mode: 'windows-wsl',
      cli: 'claude',
      command: 'claude',
    })
    assert.equal(wslDiagnostics.mode, 'windows-wsl')
    assert.equal(setCalls, 1)
    assert.equal(capability.hasWsl, true)
    assert.equal(capability.wslDistro, 'Ubuntu')
  } finally {
    wslBridge.isAvailable = originalIsAvailable
    wslBridge.getDistro = originalGetDistro
    wslBridge.getShell = originalGetShell
  }
})

test('environment controller upgrades capability for Linux-style custom script on Windows', async () => {
  let capability = createCapability()
  let setCalls = 0
  const originalIsAvailable = wslBridge.isAvailable
  const originalGetDistro = wslBridge.getDistro
  const originalGetShell = wslBridge.getShell

  wslBridge.isAvailable = () => true
  wslBridge.getDistro = () => 'Ubuntu'
  wslBridge.getShell = () => 'bash'

  try {
    const controller = new AiEnvironmentController(
      () => capability,
      (next) => {
        capability = next
        setCalls += 1
      },
      () => ({
        projects: [],
        theme: 'system',
        aiEnvironment: {
          mode: 'custom-script',
          runtimeEntrypoint: '/home/ubuntu/bin/start-runtime.sh',
          runtimePassProjectPath: true,
        },
        aiRuntimeProfiles: [],
        activeAiRuntimeProfileId: '',
        claudeRuntimeProfiles: [],
        activeClaudeRuntimeProfileId: '',
        runtimeKeepAliveOnQuit: false,
        aiCommit: createAiCommitConfig(),
      }),
    )

    const diagnostics = await controller.diagnoseRuntime()
    assert.equal(diagnostics.mode, 'custom-script')
    assert.equal(setCalls, 1)
    assert.equal(capability.hasWsl, true)
  } finally {
    wslBridge.isAvailable = originalIsAvailable
    wslBridge.getDistro = originalGetDistro
    wslBridge.getShell = originalGetShell
  }
})

test('environment controller keeps custom-script native when structured target is native', async () => {
  let capability = createCapability()
  let setCalls = 0
  const originalIsAvailable = wslBridge.isAvailable

  wslBridge.isAvailable = () => true

  try {
    const controller = new AiEnvironmentController(
      () => capability,
      (next) => {
        capability = next
        setCalls += 1
      },
      () => ({
        projects: [],
        theme: 'system',
        aiEnvironment: {
          mode: 'custom-script',
          runtimeEntrypointConfig: {
            target: 'native',
            path: '/home/ubuntu/bin/start-runtime.sh',
          },
          runtimeEntrypoint: '/home/ubuntu/bin/start-runtime.sh',
          runtimePassProjectPath: true,
        },
        aiRuntimeProfiles: [],
        activeAiRuntimeProfileId: '',
        claudeRuntimeProfiles: [],
        activeClaudeRuntimeProfileId: '',
        runtimeKeepAliveOnQuit: false,
        aiCommit: createAiCommitConfig(),
      }),
    )

    await controller.diagnoseRuntime()
    assert.equal(setCalls, 0)
    assert.equal(capability.hasWsl, false)
  } finally {
    wslBridge.isAvailable = originalIsAvailable
  }
})
