import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const {
  availableModesForCapability,
  migrateLegacyEnvironment,
} = loadTsModule('src/core/electron/main/ai-environment/platform-detector.ts')

test('availableModesForCapability hides windows-wsl when host-only WSL install is absent', () => {
  const modes = availableModesForCapability({
    hostPlatform: 'windows',
    backend: 'direct-pty',
    hasPty: true,
    hasWslInstalled: false,
    hasWsl: false,
    hasTmux: false,
    wslDistro: undefined,
    wslShell: 'bash',
    wslEnv: undefined,
  })

  assert.deepEqual(modes, ['windows-native', 'custom-script', 'disabled'])
})

test('availableModesForCapability shows windows-wsl when host-only WSL install is present', () => {
  const modes = availableModesForCapability({
    hostPlatform: 'windows',
    backend: 'direct-pty',
    hasPty: true,
    hasWslInstalled: true,
    hasWsl: false,
    hasTmux: false,
    wslDistro: 'Ubuntu',
    wslShell: 'bash',
    wslEnv: undefined,
  })

  assert.deepEqual(modes, ['windows-native', 'windows-wsl', 'custom-script', 'disabled'])
})

test('migrateLegacyEnvironment converts legacy string entrypoint into structured runtime entrypoint config', () => {
  const migrated = migrateLegacyEnvironment({
    mode: 'custom-script',
    runtimeEntrypoint: '$HOME/tools/claude-code-script/start-claude-with-env.sh',
    runtimeEntrypointHistory: ['$HOME/tools/claude-code-script/start-claude-with-env.sh'],
    runtimePassProjectPath: true,
  }, {
    hostPlatform: 'windows',
    backend: 'direct-pty',
    hasPty: true,
    hasWslInstalled: true,
    hasWsl: false,
    hasTmux: false,
    wslDistro: 'Ubuntu',
    wslShell: 'bash',
    wslEnv: undefined,
  }, {})

  assert.deepEqual(migrated.runtimeEntrypointConfig, {
    target: 'wsl',
    path: '$HOME/tools/claude-code-script/start-claude-with-env.sh',
    wslPrefix: '$HOME/',
    wslRelativePath: 'tools/claude-code-script/start-claude-with-env.sh',
  })
  assert.deepEqual(migrated.runtimeEntrypointHistoryEntries, [migrated.runtimeEntrypointConfig])
  assert.deepEqual(migrated.runtimeEntrypointHistory, ['$HOME/tools/claude-code-script/start-claude-with-env.sh'])
})
