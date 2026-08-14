import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { loadTsModule, resolveFromRepo } from '../helpers/load-ts-module.mjs'

const require = createRequire(import.meta.url)

const codexConfigModule = loadTsModule('src/core/electron/main/codex-config.ts')
const configModule = require(resolveFromRepo('src/core/electron/main/config.ts'))
const { wslBridge } = require(resolveFromRepo('src/core/electron/main/wsl-bridge.ts'))
const windowsEnvModule = require(resolveFromRepo('src/core/electron/main/windows-env.ts'))
const os = require('node:os')

test('normalizeCodexConfig forces danger-full-access when approval policy is never', () => {
  const normalized = codexConfigModule.normalizeCodexConfig({
    ...codexConfigModule.defaultCodexConfig(),
    approvalPolicy: 'never',
    sandboxMode: 'workspace-write',
  })

  assert.equal(normalized.approvalPolicy, 'never')
  assert.equal(normalized.sandboxMode, 'danger-full-access')
})

test('writeCodexSettings writes OPENAI_API_KEY into WSL bashrc for windows custom-script WSL scope', async () => {
  const originalLoadConfig = configModule.loadConfig
  const originalExec = wslBridge.exec
  const originalExecBashInteractiveLogin = wslBridge.execBashInteractiveLogin
  const originalHomedir = os.homedir
  const originalReadWindowsUserEnvVar = windowsEnvModule.readWindowsUserEnvVar
  const originalWriteWindowsUserEnvVar = windowsEnvModule.writeWindowsUserEnvVar

  const writes = []
  const windowsEnvWrites = []

  configModule.loadConfig = () => ({
    aiEnvironment: {
      mode: 'custom-script',
      runtimeEntrypoint: '/home/ubuntu/start-runtime.sh',
    },
  })

  os.homedir = () => '/home/windows-user'

  wslBridge.exec = async (cmd) => {
    if (cmd === 'printf %s "$HOME"') return '/home/ubuntu'
    if (cmd.includes("[ -f '/home/ubuntu/.codex/config.toml' ]")) return '0'
    if (cmd.includes("mkdir -p '/home/ubuntu/.codex'") || (cmd.includes("mv '") && cmd.includes("'/home/ubuntu/.codex/config.toml'"))) {
      writes.push({ kind: 'codex-config', cmd })
      return ''
    }
    if (cmd.includes("cp '/home/ubuntu/.bashrc' '/home/ubuntu/.bashrc.bak'")) {
      writes.push({ kind: 'bashrc-backup', cmd })
      return ''
    }
    if (cmd.includes("mv '") && cmd.includes("'/home/ubuntu/.bashrc'")) {
      writes.push({ kind: 'bashrc', cmd })
      return ''
    }
    throw new Error(`Unexpected WSL exec: ${cmd}`)
  }

  wslBridge.execBashInteractiveLogin = async (cmd) => {
    if (cmd === 'printf %s "${OPENAI_API_KEY:-}"') return ''
    throw new Error(`Unexpected WSL login exec: ${cmd}`)
  }

  windowsEnvModule.readWindowsUserEnvVar = async () => ''
  windowsEnvModule.writeWindowsUserEnvVar = async (name, value) => {
    windowsEnvWrites.push({ name, value })
  }

  try {
    const snapshot = await codexConfigModule.writeCodexSettings(
      {
        hostPlatform: 'windows',
        backend: 'wsl-pty',
        hasPty: true,
        hasWsl: true,
        hasTmux: true,
        wslDistro: 'Ubuntu',
        wslShell: 'bash',
        wslEnv: undefined,
      },
      {
        providerApiKeys: {
          openai: 'sk-test-wsl',
          aisz: '',
        },
        config: codexConfigModule.defaultCodexConfig(),
      },
    )

    assert.equal(snapshot.scope.target, 'wsl')
    assert.equal(snapshot.scope.envStorage, 'bashrc')
    assert.equal(windowsEnvWrites.length, 0)
    assert.ok(writes.some((item) => item.kind === 'bashrc'))
  } finally {
    configModule.loadConfig = originalLoadConfig
    wslBridge.exec = originalExec
    wslBridge.execBashInteractiveLogin = originalExecBashInteractiveLogin
    os.homedir = originalHomedir
    windowsEnvModule.readWindowsUserEnvVar = originalReadWindowsUserEnvVar
    windowsEnvModule.writeWindowsUserEnvVar = originalWriteWindowsUserEnvVar
  }
})

test('writeCodexSettings creates single-file backups before rewriting existing WSL config files', async () => {
  const originalLoadConfig = configModule.loadConfig
  const originalExec = wslBridge.exec
  const originalExecBashInteractiveLogin = wslBridge.execBashInteractiveLogin
  const originalHomedir = os.homedir
  const originalReadWindowsUserEnvVar = windowsEnvModule.readWindowsUserEnvVar
  const originalWriteWindowsUserEnvVar = windowsEnvModule.writeWindowsUserEnvVar

  const commands = []

  configModule.loadConfig = () => ({
    aiEnvironment: {
      mode: 'custom-script',
      runtimeEntrypoint: '/home/ubuntu/start-runtime.sh',
    },
  })

  os.homedir = () => '/home/windows-user'

  wslBridge.exec = async (cmd) => {
    commands.push(cmd)
    if (cmd === 'printf %s "$HOME"') return '/home/ubuntu'
    if (cmd.includes("cat '/home/ubuntu/.codex/config.toml'")) {
      return ['model_provider = "openai"', 'model = "older-model"', 'model_reasoning_effort = "xhigh"', 'preferred_auth_method = "apikey"', 'approval_policy = "on-request"', 'sandbox_mode = "workspace-write"', 'approvals_reviewer = "auto_review"', ''].join('\n')
    }
    if (cmd.includes("cat '/home/ubuntu/.bashrc'")) return 'export OPENAI_API_KEY="old-key"\n'
    if (cmd.includes("cp '/home/ubuntu/.codex/config.toml' '/home/ubuntu/.codex/config.toml.bak'")) return ''
    if (cmd.includes("cp '/home/ubuntu/.bashrc' '/home/ubuntu/.bashrc.bak'")) return ''
    if (cmd.includes('base64 -d >') || cmd.includes(' mv ')) return ''
    throw new Error(`Unexpected WSL exec: ${cmd}`)
  }

  wslBridge.execBashInteractiveLogin = async (cmd) => {
    if (cmd === 'printf %s "${OPENAI_API_KEY:-}"') return 'old-key'
    throw new Error(`Unexpected WSL login exec: ${cmd}`)
  }

  windowsEnvModule.readWindowsUserEnvVar = async () => ''
  windowsEnvModule.writeWindowsUserEnvVar = async () => {
    throw new Error('Windows user env should not be written for WSL scope')
  }

  try {
    await codexConfigModule.writeCodexSettings(
      {
        hostPlatform: 'windows',
        backend: 'wsl-pty',
        hasPty: true,
        hasWsl: true,
        hasTmux: true,
        wslDistro: 'Ubuntu',
        wslShell: 'bash',
        wslEnv: undefined,
      },
      {
        providerApiKeys: {
          openai: 'new-key',
          aisz: '',
        },
        config: codexConfigModule.defaultCodexConfig(),
      },
    )

    assert.ok(commands.some((cmd) => cmd.includes("cp '/home/ubuntu/.codex/config.toml' '/home/ubuntu/.codex/config.toml.bak'")))
    assert.ok(commands.some((cmd) => cmd.includes("cp '/home/ubuntu/.bashrc' '/home/ubuntu/.bashrc.bak'")))
  } finally {
    configModule.loadConfig = originalLoadConfig
    wslBridge.exec = originalExec
    wslBridge.execBashInteractiveLogin = originalExecBashInteractiveLogin
    os.homedir = originalHomedir
    windowsEnvModule.readWindowsUserEnvVar = originalReadWindowsUserEnvVar
    windowsEnvModule.writeWindowsUserEnvVar = originalWriteWindowsUserEnvVar
  }
})

test('writeCodexSettings skips config and bashrc rewrites when content is unchanged in WSL scope', async () => {
  const originalLoadConfig = configModule.loadConfig
  const originalExec = wslBridge.exec
  const originalExecBashInteractiveLogin = wslBridge.execBashInteractiveLogin
  const originalHomedir = os.homedir
  const originalReadWindowsUserEnvVar = windowsEnvModule.readWindowsUserEnvVar
  const originalWriteWindowsUserEnvVar = windowsEnvModule.writeWindowsUserEnvVar

  const defaultConfig = codexConfigModule.defaultCodexConfig()
  const existingToml = [
    'model_provider = "openai"',
    'model = "gpt-5.4"',
    'model_reasoning_effort = "xhigh"',
    'preferred_auth_method = "apikey"',
    'approval_policy = "on-request"',
    'sandbox_mode = "workspace-write"',
    'approvals_reviewer = "auto_review"',
    '',
    '[model_providers.openai]',
    'name = "OpenAI"',
    'base_url = "https://api.openai.com/v1"',
    'wire_api = "responses"',
    'requires_openai_auth = true',
    'env_key = "OPENAI_API_KEY"',
    '',
    '[model_providers.aisz]',
    'name = "aisz"',
    'base_url = "https://api.aisz.mom/v1"',
    'wire_api = "responses"',
    'requires_openai_auth = true',
    'env_key = "OPENAI_API_KEY"',
    '',
  ].join('\n')

  const writes = []

  configModule.loadConfig = () => ({
    aiEnvironment: {
      mode: 'custom-script',
      runtimeEntrypoint: '/home/ubuntu/start-runtime.sh',
    },
    codexProviderApiKeys: {},
    codexSettingsSnapshots: {},
  })

  os.homedir = () => '/home/windows-user'

  wslBridge.exec = async (cmd) => {
    if (cmd === 'printf %s "$HOME"') return '/home/ubuntu'
    if (cmd.includes("cat '/home/ubuntu/.codex/config.toml'")) return existingToml
    if (cmd.includes("cat '/home/ubuntu/.bashrc'")) return 'export OPENAI_API_KEY="sk-test-wsl"\n'
    if (cmd.includes('base64 -d >') || cmd.includes(' mv ')) {
      writes.push(cmd)
      return ''
    }
    throw new Error(`Unexpected WSL exec: ${cmd}`)
  }

  wslBridge.execBashInteractiveLogin = async (cmd) => {
    if (cmd === 'printf %s "${OPENAI_API_KEY:-}"') return 'sk-test-wsl'
    throw new Error(`Unexpected WSL login exec: ${cmd}`)
  }

  windowsEnvModule.readWindowsUserEnvVar = async () => ''
  windowsEnvModule.writeWindowsUserEnvVar = async () => {
    throw new Error('Windows user env should not be written for WSL scope')
  }

  try {
    const snapshot = await codexConfigModule.writeCodexSettings(
      {
        hostPlatform: 'windows',
        backend: 'wsl-pty',
        hasPty: true,
        hasWsl: true,
        hasTmux: true,
        wslDistro: 'Ubuntu',
        wslShell: 'bash',
        wslEnv: undefined,
      },
      {
        providerApiKeys: {
          openai: 'sk-test-wsl',
          aisz: '',
        },
        config: defaultConfig,
      },
    )

    assert.equal(snapshot.config.modelProvider, 'openai')
    assert.deepEqual(writes, [])
  } finally {
    configModule.loadConfig = originalLoadConfig
    wslBridge.exec = originalExec
    wslBridge.execBashInteractiveLogin = originalExecBashInteractiveLogin
    os.homedir = originalHomedir
    windowsEnvModule.readWindowsUserEnvVar = originalReadWindowsUserEnvVar
    windowsEnvModule.writeWindowsUserEnvVar = originalWriteWindowsUserEnvVar
  }
})

test('resolveCodexEnvironmentScope follows current mode target for custom-script and windows-native', async () => {
  const originalLoadConfig = configModule.loadConfig
  const originalExec = wslBridge.exec
  const originalHomedir = os.homedir

  os.homedir = () => '/home/windows-user'
  wslBridge.exec = async (cmd) => {
    if (cmd === 'printf %s "$HOME"') return '/home/ubuntu'
    throw new Error(`Unexpected WSL exec: ${cmd}`)
  }

  try {
    configModule.loadConfig = () => ({
      aiEnvironment: {
        mode: 'custom-script',
        runtimeEntrypoint: '/home/ubuntu/start-runtime.sh',
      },
    })

    const wslScope = await codexConfigModule.resolveCodexEnvironmentScope({
      hostPlatform: 'windows',
      backend: 'wsl-pty',
      hasPty: true,
      hasWsl: true,
      hasTmux: true,
      wslDistro: 'Ubuntu',
      wslShell: 'bash',
      wslEnv: undefined,
    })
    assert.equal(wslScope.target, 'wsl')
    assert.equal(wslScope.runtimeMode, 'custom-script')

    configModule.loadConfig = () => ({
      aiEnvironment: {
        mode: 'custom-script',
        runtimeEntrypoint: 'C:\\tools\\start-runtime.cmd',
      },
    })

    const nativeCustomScope = await codexConfigModule.resolveCodexEnvironmentScope({
      hostPlatform: 'windows',
      backend: 'spawn',
      hasPty: true,
      hasWsl: true,
      hasTmux: false,
      wslDistro: 'Ubuntu',
      wslShell: 'bash',
      wslEnv: undefined,
    })
    assert.equal(nativeCustomScope.target, 'native')
    assert.equal(nativeCustomScope.runtimeMode, 'custom-script')

    configModule.loadConfig = () => ({
      aiEnvironment: {
        mode: 'windows-native',
      },
    })

    const nativeScope = await codexConfigModule.resolveCodexEnvironmentScope({
      hostPlatform: 'windows',
      backend: 'spawn',
      hasPty: true,
      hasWsl: true,
      hasTmux: false,
      wslDistro: 'Ubuntu',
      wslShell: 'bash',
      wslEnv: undefined,
    })
    assert.equal(nativeScope.target, 'native')
    assert.equal(nativeScope.runtimeMode, 'windows-native')
  } finally {
    configModule.loadConfig = originalLoadConfig
    wslBridge.exec = originalExec
    os.homedir = originalHomedir
  }
})
