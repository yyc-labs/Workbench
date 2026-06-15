import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { loadTsModule, resolveFromRepo } from '../helpers/load-ts-module.mjs'

const {
  windowsWslProvider,
} = loadTsModule('src/core/electron/main/ai-environment/providers/windows-wsl-provider.ts')

const {
  windowsNativeProvider,
} = loadTsModule('src/core/electron/main/ai-environment/providers/windows-native-provider.ts')

const {
  customScriptProvider,
} = loadTsModule('src/core/electron/main/ai-environment/providers/custom-script-provider.ts')

const require = createRequire(import.meta.url)
const {
  wslBridge,
} = require(resolveFromRepo('src/core/electron/main/wsl-bridge.ts'))

test('windows-wsl diagnostics ignore legacy runtime launcher script path', async () => {
  const diagnostics = await windowsWslProvider.diagnose({
    capability: {
      hostPlatform: 'windows',
      backend: 'tmux',
      hasPty: true,
      hasWsl: true,
      hasTmux: true,
      wslDistro: 'Ubuntu',
      wslShell: 'bash',
      wslEnv: undefined,
    },
    config: {
      mode: 'windows-wsl',
      runtimeEntrypoint: '$HOME/tools/claude-code-script/start-claude-with-env.sh',
      runtimePassProjectPath: true,
    },
    aiCommitConfig: {
      enabled: true,
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini',
      wslPwshPath: '/snap/bin/pwsh',
      split: false,
      splitMaxBatches: 4,
      maxBullets: 8,
    },
  })

  assert.equal(diagnostics.supported, true)
  assert.deepEqual(diagnostics.issues, [])
  assert.equal(diagnostics.launcherScript, undefined)
  assert.equal(diagnostics.launcherScriptExists, undefined)
  assert.equal(diagnostics.launcherScriptExecutable, undefined)
})

test('custom-script runtime launch passes project path and cli arg', async () => {
  const plan = await customScriptProvider.resolveRuntimeLaunch({
    capability: {
      hostPlatform: 'linux',
      backend: 'direct-pty',
      hasPty: true,
      hasWsl: false,
      hasTmux: true,
      wslDistro: undefined,
      wslShell: 'bash',
      wslEnv: undefined,
    },
    config: {
      mode: 'custom-script',
      runtimeEntrypoint: '/tmp/start-runtime.sh',
      runtimePassProjectPath: true,
    },
    aiCommitConfig: {
      enabled: true,
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini',
      wslPwshPath: '/snap/bin/pwsh',
      split: false,
      splitMaxBatches: 4,
      maxBullets: 8,
    },
  }, {
    projectId: 'project-1',
    projectPath: '/repo/demo',
    cli: 'codex',
  })

  assert.equal(plan.startCommand, 'bash')
  assert.deepEqual(plan.env?.AI_RUNTIME_CLI, 'codex')
  assert.deepEqual(plan.env?.YYC_AI_RUNTIME_CLI, 'codex')
  assert.match(plan.startArgs[1], /exec '\/tmp\/start-runtime\.sh' '\/repo\/demo' '--cli' 'codex'/)
})

test('custom-script diagnostics expand HOME through WSL when boot capability skipped env capture', async () => {
  const originalExec = wslBridge.exec
  wslBridge.exec = async (cmd) => {
    assert.equal(cmd, 'printf %s "$HOME"')
    return '/home/ubuntu'
  }

  try {
    const diagnostics = await customScriptProvider.diagnose({
      capability: {
        hostPlatform: 'windows',
        backend: 'wsl-pty',
        hasPty: true,
        hasWsl: true,
        hasTmux: true,
        wslDistro: 'Ubuntu',
        wslShell: 'bash',
        wslEnv: undefined,
      },
      config: {
        mode: 'custom-script',
        runtimeEntrypoint: '$HOME/tools/claude-code-script/start-claude-with-env.sh',
        runtimePassProjectPath: true,
      },
      aiCommitConfig: {
        enabled: true,
        apiBaseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'gpt-4o-mini',
        wslPwshPath: '/snap/bin/pwsh',
        split: false,
        splitMaxBatches: 4,
        maxBullets: 8,
      },
    })

    assert.equal(diagnostics.runtimeEntrypoint, '/home/ubuntu/tools/claude-code-script/start-claude-with-env.sh')
  } finally {
    wslBridge.exec = originalExec
  }
})

test('windows-native runtime launch normalizes /mnt path to Windows host cwd', async () => {
  const plan = await windowsNativeProvider.resolveRuntimeLaunch({
    capability: {
      hostPlatform: 'windows',
      backend: 'direct-pty',
      hasPty: true,
      hasWsl: true,
      hasTmux: false,
      wslDistro: 'Ubuntu',
      wslShell: 'bash',
      wslEnv: undefined,
    },
    config: {
      mode: 'windows-native',
    },
    aiCommitConfig: {
      enabled: true,
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini',
      wslPwshPath: '/snap/bin/pwsh',
      split: false,
      splitMaxBatches: 4,
      maxBullets: 8,
    },
  }, {
    projectId: 'project-1',
    projectPath: '/mnt/d/work/demo',
    cli: 'codex',
  })

  assert.equal(plan.cwd, 'D:\\work\\demo')
})

test('windows-native ai commit launch normalizes /mnt path to Windows host cwd', async () => {
  const plan = await windowsNativeProvider.resolveAiCommitLaunch({
    capability: {
      hostPlatform: 'windows',
      backend: 'direct-pty',
      hasPty: true,
      hasWsl: true,
      hasTmux: false,
      wslDistro: 'Ubuntu',
      wslShell: 'bash',
      wslEnv: undefined,
    },
    config: {
      mode: 'windows-native',
    },
    aiCommitConfig: {
      enabled: true,
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini',
      wslPwshPath: '/snap/bin/pwsh',
      split: false,
      splitMaxBatches: 4,
      maxBullets: 8,
    },
  }, {
    repoRoot: '/mnt/d/work/demo',
    scriptPath: 'D:\\tools\\auto_commit.ps1',
    cliConfig: {
      enabled: true,
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini',
      split: false,
      splitMaxBatches: 4,
      maxBullets: 8,
      wslPwshPath: '/snap/bin/pwsh',
    },
  })

  assert.equal(plan.cwd, 'D:\\work\\demo')
})

test('custom-script runtime launch keeps WSL path for WSL entrypoint on Windows', async () => {
  const plan = await customScriptProvider.resolveRuntimeLaunch({
    capability: {
      hostPlatform: 'windows',
      backend: 'wsl-pty',
      hasPty: true,
      hasWsl: true,
      hasTmux: true,
      wslDistro: 'Ubuntu',
      wslShell: 'bash',
      wslEnv: undefined,
    },
    config: {
      mode: 'custom-script',
      runtimeEntrypoint: '/home/ubuntu/start-runtime.sh',
      runtimePassProjectPath: true,
      wslDistro: 'Ubuntu',
    },
    aiCommitConfig: {
      enabled: true,
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini',
      wslPwshPath: '/snap/bin/pwsh',
      split: false,
      splitMaxBatches: 4,
      maxBullets: 8,
    },
  }, {
    projectId: 'project-1',
    projectPath: '/mnt/d/work/demo',
    cli: 'codex',
  })

  assert.match(plan.startArgs.at(-1), /'\/mnt\/d\/work\/demo'/)
})

test('custom-script ai commit launch normalizes /mnt path to Windows host cwd for Windows PowerShell entrypoint', async () => {
  const plan = await customScriptProvider.resolveAiCommitLaunch({
    capability: {
      hostPlatform: 'windows',
      backend: 'direct-pty',
      hasPty: true,
      hasWsl: true,
      hasTmux: false,
      wslDistro: 'Ubuntu',
      wslShell: 'bash',
      wslEnv: undefined,
    },
    config: {
      mode: 'custom-script',
      aiCommitEntrypoint: 'D:\\tools\\auto_commit.ps1',
      wslDistro: 'Ubuntu',
    },
    aiCommitConfig: {
      enabled: true,
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini',
      wslPwshPath: '/snap/bin/pwsh',
      split: false,
      splitMaxBatches: 4,
      maxBullets: 8,
    },
  }, {
    repoRoot: '/mnt/d/work/demo',
    scriptPath: 'D:\\tools\\fallback.ps1',
    cliConfig: {
      enabled: true,
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini',
      split: false,
      splitMaxBatches: 4,
      maxBullets: 8,
      wslPwshPath: '/snap/bin/pwsh',
    },
  })

  assert.equal(plan.cwd, 'D:\\work\\demo')
})
