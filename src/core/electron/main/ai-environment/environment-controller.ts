import type {
  AiCommitConfig,
  AiEnvironmentConfig,
  AiExecutionMode,
  AppConfig,
  Capability,
  RuntimeDiagnostics,
  RuntimeSessionInfo,
} from '../../../shared/types'
import { availableModesForCapability, migrateLegacyEnvironment } from './platform-detector'
import type {
  AiCommitLaunchPlan,
  AiExecutionProvider,
  ProviderContext,
  RuntimeLaunchPlan,
} from './provider-types'
import { windowsWslProvider } from './providers/windows-wsl-provider'
import { windowsNativeProvider } from './providers/windows-native-provider'
import { posixNativeProvider } from './providers/posix-native-provider'
import { customScriptProvider } from './providers/custom-script-provider'
import { disabledProvider } from './providers/disabled-provider'
import { resolveWslVsCodeTarget } from '../shell/openers'

const PROVIDERS: AiExecutionProvider[] = [
  windowsWslProvider,
  windowsNativeProvider,
  posixNativeProvider,
  customScriptProvider,
  disabledProvider,
]

function normalizeAiCommitConfig(input: AppConfig['aiCommit'] | undefined): AiCommitConfig {
  return {
    enabled: input?.enabled ?? true,
    apiBaseUrl: input?.apiBaseUrl || 'https://api.openai.com/v1',
    apiKey: input?.apiKey || '',
    model: input?.model || 'gpt-4o-mini',
    wslPwshPath: input?.wslPwshPath || '/snap/bin/pwsh',
    split: input?.split ?? false,
    splitMaxBatches: input?.splitMaxBatches ?? 4,
    maxBullets: input?.maxBullets ?? 8,
  }
}

export class AiEnvironmentController {
  constructor(
    private readonly getCapability: () => Capability | null,
    private readonly getConfig: () => AppConfig,
  ) {}

  getEnvironmentConfig(): AiEnvironmentConfig {
    const capability = this.requireCapability()
    const config = this.getConfig()
    return migrateLegacyEnvironment(config.aiEnvironment, capability, {
      runtimeLauncherScript: config.runtimeLauncherScript,
      aiCommitEntrypoint: config.aiEnvironment?.aiCommitEntrypoint,
    })
  }

  getAvailableModes(): AiExecutionMode[] {
    return availableModesForCapability(this.requireCapability())
  }

  async diagnoseRuntime(): Promise<RuntimeDiagnostics> {
    const provider = await this.getProvider()
    const diagnostics = await provider.diagnose(this.buildContext())
    return {
      ...diagnostics,
      availableModes: this.getAvailableModes(),
    }
  }

  async resolveRuntimeLaunch(input: {
    projectId: string
    projectPath: string
    cli: 'claude' | 'codex'
  }): Promise<RuntimeLaunchPlan> {
    const provider = await this.getProvider()
    return provider.resolveRuntimeLaunch(this.buildContext(), input)
  }

  async resolveAiCommitLaunch(input: {
    repoRoot: string
    scriptPath: string
    scriptWslPath?: string | null
    aiCommitConfig?: AiCommitConfig
  }): Promise<AiCommitLaunchPlan> {
    const aiCommitConfig = normalizeAiCommitConfig(input.aiCommitConfig ?? this.getConfig().aiCommit)
    const provider = await this.getAiCommitProvider(input.repoRoot)
    return provider.resolveAiCommitLaunch(this.buildContext(), {
      ...input,
      cliConfig: {
        enabled: aiCommitConfig.enabled ?? true,
        apiBaseUrl: aiCommitConfig.apiBaseUrl || 'https://api.openai.com/v1',
        apiKey: aiCommitConfig.apiKey || '',
        model: aiCommitConfig.model || 'gpt-4o-mini',
        split: Boolean(aiCommitConfig.split),
        splitMaxBatches: Math.max(1, Math.min(12, Math.trunc(aiCommitConfig.splitMaxBatches ?? 4))),
        maxBullets: Math.max(1, Math.min(20, Math.trunc(aiCommitConfig.maxBullets ?? 8))),
        wslPwshPath: aiCommitConfig.wslPwshPath || '/snap/bin/pwsh',
      },
    })
  }

  async listRuntimeSessions(): Promise<RuntimeSessionInfo[]> {
    const provider = await this.getProvider()
    if (!provider.listRuntimeSessions) return []
    return provider.listRuntimeSessions(this.buildContext())
  }

  async stopRuntimeSession(sessionName: string): Promise<boolean> {
    const provider = await this.getProvider()
    if (!provider.stopRuntimeSession) return false
    return provider.stopRuntimeSession(this.buildContext(), sessionName)
  }

  private async getAiCommitProvider(repoRoot: string): Promise<AiExecutionProvider> {
    const context = this.buildContext()
    const explicitAiCommitEntrypoint = context.config.aiCommitEntrypoint?.trim()

    if (explicitAiCommitEntrypoint) {
      return customScriptProvider
    }

    if (context.capability.hostPlatform === 'windows') {
      const defaultDistro = context.config.wslDistro || context.capability.wslDistro || 'Ubuntu'
      const wslTarget = resolveWslVsCodeTarget(repoRoot, defaultDistro)
      if (wslTarget) {
        if (await windowsWslProvider.isSupported(context)) {
          return windowsWslProvider
        }
        throw new Error(`WSL is required to run AI Commit for WSL repository: ${repoRoot}`)
      }
      return windowsNativeProvider
    }

    if (await posixNativeProvider.isSupported(context)) {
      return posixNativeProvider
    }

    return this.getProvider()
  }

  private async getProvider(): Promise<AiExecutionProvider> {
    const context = this.buildContext()
    const preferredMode = context.config.mode
    const provider = PROVIDERS.find((item) => item.mode === preferredMode)
    if (provider && await provider.isSupported(context)) {
      return provider
    }

    for (const candidate of PROVIDERS) {
      if (candidate.mode === 'custom-script' || candidate.mode === 'disabled') continue
      if (await candidate.isSupported(context)) return candidate
    }
    return disabledProvider
  }

  private buildContext(): ProviderContext {
    const capability = this.requireCapability()
    return {
      capability,
      config: this.getEnvironmentConfig(),
      aiCommitConfig: normalizeAiCommitConfig(this.getConfig().aiCommit),
    }
  }

  private requireCapability(): Capability {
    const capability = this.getCapability()
    if (!capability) {
      throw new Error('Capability is not initialized')
    }
    return capability
  }
}
