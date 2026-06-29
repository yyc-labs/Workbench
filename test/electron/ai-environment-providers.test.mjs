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

test('custom profile command opens a visible Linux terminal', async () => {
  const profile = {
    id: 'custom-local',
    name: 'Local AI',
    kind: 'custom',
    mode: 'custom-script',
    command: 'my-ai',
    args: ['--profile', 'fast'],
    env: {
      AI_VENDOR: 'local',
    },
    passProjectPath: true,
  }
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
    cli: 'claude',
    profile,
  })

  assert.equal(plan.startCommand, 'x-terminal-emulator')
  assert.deepEqual(plan.startArgs.slice(0, 3), ['-e', 'bash', '-ilc'])
  assert.match(plan.startArgs[3], /cd '\/repo\/demo'/)
  assert.match(plan.startArgs[3], /AI_VENDOR='local'/)
  assert.match(plan.startArgs[3], /my-ai '--profile' 'fast' '\/repo\/demo'; exec bash -i/)
  assert.equal(plan.env?.AI_RUNTIME_PROFILE_ID, 'custom-local')
  assert.equal(plan.env?.AI_RUNTIME_COMMAND, "my-ai '--profile' 'fast' '/repo/demo'")
})

test('custom profile command opens a visible Windows host terminal', async () => {
  const profile = {
    id: 'custom-windows',
    name: 'Windows AI',
    kind: 'custom',
    mode: 'custom-script',
    command: 'my-ai.exe',
    args: ['--fast'],
    env: {},
    passProjectPath: false,
  }
  const plan = await customScriptProvider.resolveRuntimeLaunch({
    capability: {
      hostPlatform: 'windows',
      backend: 'direct-pty',
      hasPty: true,
      hasWsl: false,
      hasTmux: false,
      wslDistro: undefined,
      wslShell: 'bash',
      wslEnv: undefined,
    },
    config: {
      mode: 'custom-script',
      shell: 'cmd',
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
    cli: 'claude',
    profile,
  })

  assert.equal(plan.startCommand, 'cmd.exe')
  assert.deepEqual(plan.startArgs.slice(0, 4), ['/d', '/c', 'start', 'Windows AI Runtime'])
  assert.equal(plan.startArgs[4], 'cmd.exe')
  assert.deepEqual(plan.startArgs.slice(5), ['/d', '/k', 'my-ai.exe --fast'])
  assert.equal(plan.cwd, 'D:\\work\\demo')
})

test('custom profile POSIX command opens a visible WSL terminal on Windows', async () => {
  const profile = {
    id: 'custom-wsl',
    name: 'WSL AI',
    kind: 'custom',
    mode: 'custom-script',
    command: '/home/ubuntu/bin/my-ai',
    args: ['--fast'],
    env: {},
    passProjectPath: true,
  }
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
    cli: 'claude',
    profile,
  })

  assert.equal(plan.startCommand, 'cmd.exe')
  assert.deepEqual(plan.startArgs.slice(0, 5), ['/d', '/c', 'start', 'WSL AI Runtime', 'wsl.exe'])
  assert.deepEqual(plan.startArgs.slice(5, 11), ['-d', 'Ubuntu', '--', 'bash', '-ilc', plan.startArgs[10]])
  assert.match(plan.startArgs[10], /cd '\/mnt\/d\/work\/demo'/)
  assert.match(plan.startArgs[10], /\/home\/ubuntu\/bin\/my-ai '--fast' '\/mnt\/d\/work\/demo'; exec bash -i/)
})

test('custom profile command diagnostics do not require a script file check', async () => {
  const diagnostics = await customScriptProvider.diagnose({
    capability: {
      hostPlatform: 'linux',
      backend: 'direct-pty',
      hasPty: true,
      hasWsl: false,
      hasTmux: false,
      wslDistro: undefined,
      wslShell: 'bash',
      wslEnv: undefined,
    },
    config: {
      mode: 'custom-script',
    },
    runtimeProfile: {
      id: 'custom-local',
      name: 'Local AI',
      kind: 'custom',
      mode: 'custom-script',
      command: 'my-ai',
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
  assert.equal(diagnostics.runtimeEntrypoint, 'my-ai')
  assert.equal(diagnostics.launcherScript, undefined)
  assert.equal(diagnostics.launcherScriptExists, undefined)
  assert.equal(diagnostics.launcherScriptExecutable, undefined)
})

test('custom profile POSIX command diagnostics require WSL on Windows', async () => {
  const diagnostics = await customScriptProvider.diagnose({
    capability: {
      hostPlatform: 'windows',
      backend: 'direct-pty',
      hasPty: true,
      hasWsl: false,
      hasTmux: false,
      wslDistro: undefined,
      wslShell: 'bash',
      wslEnv: undefined,
    },
    config: {
      mode: 'custom-script',
    },
    runtimeProfile: {
      id: 'custom-wsl',
      name: 'WSL AI',
      kind: 'custom',
      mode: 'custom-script',
      command: '/home/ubuntu/bin/my-ai',
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

  assert.equal(diagnostics.supported, false)
  assert.deepEqual(diagnostics.issues, ['WSL is required to run a POSIX custom runtime command on Windows'])
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

test('custom-script diagnostics still check $HOME entrypoint when WSL home probe fails', async () => {
  const originalExec = wslBridge.exec
  const calls = []
  wslBridge.exec = async (cmd) => {
    calls.push(cmd)
    if (cmd === 'printf %s "$HOME"') {
      throw new Error('WSL command exited with code 1: printf %s "$HOME"')
    }
    assert.equal(
      cmd,
      `[ -e "$HOME"'/tools/claude-code-script/start-claude-with-env.sh' ] && [ -x "$HOME"'/tools/claude-code-script/start-claude-with-env.sh' ] && echo EXISTS_EXEC || ([ -e "$HOME"'/tools/claude-code-script/start-claude-with-env.sh' ] && echo EXISTS_NOEXEC) || echo MISSING`
    )
    return 'EXISTS_EXEC'
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

    assert.equal(diagnostics.runtimeEntrypoint, '$HOME/tools/claude-code-script/start-claude-with-env.sh')
    assert.equal(diagnostics.launcherScriptExists, true)
    assert.equal(diagnostics.launcherScriptExecutable, true)
    assert.deepEqual(diagnostics.issues, [])
    assert.deepEqual(calls, [
      'printf %s "$HOME"',
      `[ -e "$HOME"'/tools/claude-code-script/start-claude-with-env.sh' ] && [ -x "$HOME"'/tools/claude-code-script/start-claude-with-env.sh' ] && echo EXISTS_EXEC || ([ -e "$HOME"'/tools/claude-code-script/start-claude-with-env.sh' ] && echo EXISTS_NOEXEC) || echo MISSING`,
    ])
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
  assert.equal(plan.startCommand, 'wt.exe')
  assert.deepEqual(plan.startArgs, [
    '-d',
    'D:\\work\\demo',
    'pwsh.exe',
    '-NoLogo',
    '-NoProfile',
    '-NoExit',
    '-Command',
    'codex',
  ])
  assert.equal(plan.detached, true)
  assert.equal(plan.windowsHide, false)
  assert.equal(plan.fallbackLaunches.length, 1)
  assert.equal(plan.fallbackLaunches[0].startCommand, 'cmd.exe')
  assert.deepEqual(plan.fallbackLaunches[0].startArgs, [
    '/d',
    '/c',
    'start',
    'Codex Runtime',
    'pwsh.exe',
    '-NoLogo',
    '-NoProfile',
    '-NoExit',
    '-Command',
    'codex',
  ])
})

test('windows-native diagnostics report configured AI Running shell preference', async () => {
  const diagnostics = await windowsNativeProvider.diagnose({
    capability: {
      hostPlatform: 'windows',
      backend: 'direct-pty',
      hasPty: true,
      hasWsl: false,
      hasTmux: false,
      wslDistro: undefined,
      wslShell: 'bash',
      wslEnv: undefined,
    },
    config: {
      mode: 'windows-native',
      shell: 'cmd',
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

  assert.equal(diagnostics.shell, 'cmd')
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
  assert.ok(['pwsh.exe', 'powershell.exe'].includes(plan.command))
  assert.ok(['pwsh', 'powershell'].includes(plan.outputLabel))
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
