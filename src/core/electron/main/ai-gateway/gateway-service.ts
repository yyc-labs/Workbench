import type {
  AiGatewayLogDetail,
  AiGatewayBindingResult,
  AiGatewayClientCli,
  AiGatewayConfig,
  AiGatewayLogEntry,
  AiGatewaySaveConfigResult,
  AiGatewayStatus,
  AppConfig,
  Capability,
  CodexSettingsSnapshot,
} from '../../../shared/types'
import { loadConfig, updateConfig } from '../config'
import {
  normalizeClaudeBashrcConfig,
  readClaudeBashrcConfig,
  writeClaudeBashrcConfig,
} from '../claude-bashrc'
import {
  normalizeCodexConfig,
  readCodexSettings,
  writeCodexSettings,
} from '../codex-config'
import { applyWindowsUserEnvToCurrentProcess, writeWindowsUserEnv } from '../windows-env'
import {
  AI_GATEWAY_LOCAL_ROUTER_PROVIDER_ID,
  getAiGatewayAnthropicBaseUrl,
  getAiGatewayOpenAiBaseUrl,
  normalizeAiGatewayConfig,
} from './gateway-config'
import { AiGatewayProviderRegistry } from './provider-registry'
import { AiGatewayServer } from './gateway-server'

type AiGatewayServiceOptions = {
  getCapability: () => Capability | null
}

function normalizeConfigFromApp(appConfig: AppConfig): AiGatewayConfig {
  return normalizeAiGatewayConfig(appConfig.aiGateway)
}

function withBinding(
  config: AiGatewayConfig,
  cli: AiGatewayClientCli,
  binding: AiGatewayConfig['clientBindings'][AiGatewayClientCli]
): AiGatewayConfig {
  return normalizeAiGatewayConfig({
    ...config,
    clientBindings: {
      ...config.clientBindings,
      [cli]: binding,
    },
  })
}

function hasCodexBackup(snapshot: CodexSettingsSnapshot | undefined): snapshot is CodexSettingsSnapshot {
  return Boolean(snapshot?.scope && snapshot.config)
}

export class AiGatewayService {
  private readonly getCapability: AiGatewayServiceOptions['getCapability']
  private readonly registry: AiGatewayProviderRegistry
  private readonly server: AiGatewayServer

  constructor(options: AiGatewayServiceOptions) {
    this.getCapability = options.getCapability
    const initialConfig = normalizeConfigFromApp(loadConfig())
    this.registry = new AiGatewayProviderRegistry(initialConfig)
    this.server = new AiGatewayServer({
      getConfig: () => this.getConfig(),
      registry: this.registry,
    })
  }

  getConfig(): AiGatewayConfig {
    const config = normalizeConfigFromApp(loadConfig())
    this.registry.update(config)
    return config
  }

  getStatus(): AiGatewayStatus {
    const config = this.getConfig()
    const endpoint = this.server.getActiveEndpoint()
    const activeProvider = config.providers.find((provider) => provider.id === config.activeProviderId)
    return {
      enabled: config.enabled,
      running: this.server.isRunning(),
      host: endpoint.host,
      port: endpoint.port,
      url: endpoint.url,
      anthropicBaseUrl: endpoint.anthropicBaseUrl,
      openAiBaseUrl: endpoint.openAiBaseUrl,
      activeProviderId: config.activeProviderId,
      activeProvider,
      providerCount: config.providers.length,
      clientBindings: config.clientBindings,
      modelRoutes: config.modelRoutes,
      error: this.server.getError(),
    }
  }

  getRecentLogs(): AiGatewayLogEntry[] {
    return this.server.getRecentLogs()
  }

  getRecentLogDetails(): AiGatewayLogDetail[] {
    return this.server.getRecentLogDetails()
  }

  async start(persistEnabled = true): Promise<AiGatewayStatus> {
    let config = this.getConfig()
    if (persistEnabled && !config.enabled) {
      const appConfig = await updateConfig({ aiGateway: { ...config, enabled: true } })
      config = normalizeConfigFromApp(appConfig)
    }
    this.registry.update(config)
    await this.server.start(config)
    return this.getStatus()
  }

  async stop(persistEnabled = true): Promise<AiGatewayStatus> {
    await this.server.stop()
    if (persistEnabled) {
      const config = this.getConfig()
      await updateConfig({ aiGateway: { ...config, enabled: false } })
    }
    return this.getStatus()
  }

  async saveConfig(input: unknown): Promise<AiGatewaySaveConfigResult> {
    const config = normalizeAiGatewayConfig(input)
    const appConfig = await updateConfig({ aiGateway: config })
    const savedConfig = normalizeConfigFromApp(appConfig)
    this.registry.update(savedConfig)
    if (savedConfig.enabled) {
      await this.server.start(savedConfig)
    } else {
      await this.server.stop()
    }
    return {
      config: savedConfig,
      status: this.getStatus(),
      appConfig: loadConfig(),
    }
  }

  async applyClientBinding(cli: AiGatewayClientCli): Promise<AiGatewayBindingResult> {
    await this.start(true)
    const config = this.getConfig()
    const provider = this.registry.getActiveProvider('openai_chat')
    const binding = config.clientBindings[cli]
    const backup = binding.backup ?? { createdAt: new Date().toISOString() }

    if (cli === 'claude') {
      const currentClaudeConfig = await readClaudeBashrcConfig()
      const nextClaudeConfig = normalizeClaudeBashrcConfig({
        ...currentClaudeConfig,
        anthropicBaseUrl: getAiGatewayAnthropicBaseUrl(config),
      })
      const saved = await writeClaudeBashrcConfig(nextClaudeConfig)
      await writeWindowsUserEnv(saved).catch(() => undefined)
      if (process.platform === 'win32') {
        applyWindowsUserEnvToCurrentProcess(saved)
      }
      backup.claudeConfig = backup.claudeConfig ?? currentClaudeConfig
    } else {
      const snapshot = await readCodexSettings(this.getCapability())
      const providerApiKey = this.registry.resolveApiKey(provider)
      const nextConfig = normalizeCodexConfig({
        ...snapshot.config,
        modelProvider: AI_GATEWAY_LOCAL_ROUTER_PROVIDER_ID,
        modelProviders: {
          ...snapshot.config.modelProviders,
          [AI_GATEWAY_LOCAL_ROUTER_PROVIDER_ID]: {
            name: 'Local Router',
            baseUrl: getAiGatewayOpenAiBaseUrl(config),
            wireApi: 'responses',
            requiresOpenaiAuth: true,
            envKey: 'OPENAI_API_KEY',
          },
        },
      })
      await writeCodexSettings(this.getCapability(), {
        config: nextConfig,
        providerApiKeys: {
          ...snapshot.providerApiKeys,
          [AI_GATEWAY_LOCAL_ROUTER_PROVIDER_ID]: providerApiKey,
        },
      })
      backup.codexSnapshot = backup.codexSnapshot ?? snapshot
    }

    const updatedConfig = withBinding(config, cli, {
      ...binding,
      enabled: true,
      providerId: provider.id,
      baseUrl: cli === 'codex'
        ? getAiGatewayOpenAiBaseUrl(config)
        : getAiGatewayAnthropicBaseUrl(config),
      backup,
    })
    const appConfig = await updateConfig({ aiGateway: updatedConfig })
    const savedConfig = normalizeConfigFromApp(appConfig)
    this.registry.update(savedConfig)
    return {
      config: savedConfig,
      status: this.getStatus(),
      appConfig,
    }
  }

  async restoreClientBinding(cli: AiGatewayClientCli): Promise<AiGatewayBindingResult> {
    const config = this.getConfig()
    const binding = config.clientBindings[cli]
    const backup = binding.backup
    if (!backup) {
      throw new Error(`No ${cli} AI Gateway backup is available.`)
    }

    if (cli === 'claude') {
      if (!backup.claudeConfig) {
        throw new Error('No Claude backup is available.')
      }
      const saved = await writeClaudeBashrcConfig(backup.claudeConfig)
      await writeWindowsUserEnv(saved).catch(() => undefined)
      if (process.platform === 'win32') {
        applyWindowsUserEnvToCurrentProcess(saved)
      }
    } else {
      if (!hasCodexBackup(backup.codexSnapshot)) {
        throw new Error('No Codex backup is available.')
      }
      await writeCodexSettings(this.getCapability(), {
        config: backup.codexSnapshot.config,
        providerApiKeys: backup.codexSnapshot.providerApiKeys,
      })
    }

    const updatedConfig = withBinding(config, cli, {
      ...binding,
      enabled: false,
      baseUrl: cli === 'codex'
        ? getAiGatewayOpenAiBaseUrl(config)
        : getAiGatewayAnthropicBaseUrl(config),
      backup,
    })
    const appConfig = await updateConfig({ aiGateway: updatedConfig })
    const savedConfig = normalizeConfigFromApp(appConfig)
    this.registry.update(savedConfig)
    return {
      config: savedConfig,
      status: this.getStatus(),
      appConfig,
    }
  }

  async shutdown(): Promise<void> {
    await this.server.stop()
  }
}

export function createAiGatewayService(options: AiGatewayServiceOptions): AiGatewayService {
  return new AiGatewayService(options)
}
