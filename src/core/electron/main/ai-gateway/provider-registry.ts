import type {
  AiGatewayConfig,
  AiGatewayModelRoute,
  AiGatewayProviderConfig,
  AiGatewayUpstreamProtocol,
} from '../../../shared/types'
import { normalizeAiGatewayConfig } from './gateway-config'

function withRouteModelMap(
  provider: AiGatewayProviderConfig,
  route: AiGatewayModelRoute
): AiGatewayProviderConfig {
  const upstreamModel = route.upstreamModel?.trim()
  if (!upstreamModel) return provider
  return {
    ...provider,
    modelMap: {
      ...(provider.modelMap ?? {}),
      [route.model]: upstreamModel,
    },
  }
}

export class AiGatewayProviderRegistry {
  private config: AiGatewayConfig

  constructor(config: AiGatewayConfig) {
    this.config = normalizeAiGatewayConfig(config)
  }

  update(config: AiGatewayConfig): void {
    this.config = normalizeAiGatewayConfig(config)
  }

  getConfig(): AiGatewayConfig {
    return normalizeAiGatewayConfig(this.config)
  }

  getActiveProvider(protocol?: AiGatewayUpstreamProtocol): AiGatewayProviderConfig {
    const providers = this.config.providers.filter((provider) => provider.enabled)
    const active = providers.find((provider) => provider.id === this.config.activeProviderId)
      ?? providers[0]
      ?? this.config.providers[0]

    if (!active) {
      throw new Error('AI Gateway has no configured provider.')
    }
    if (protocol && active.protocol !== protocol) {
      throw new Error(`Provider "${active.name}" uses ${active.protocol}; ${protocol} is required for this route.`)
    }
    return active
  }

  private getProviderFromRoute(route: AiGatewayModelRoute, protocol?: AiGatewayUpstreamProtocol): AiGatewayProviderConfig {
    const provider = this.config.providers.find((item) => item.id === route.providerId)
    if (!provider) {
      throw new Error(`AI Gateway route "${route.id}" points to missing provider "${route.providerId}".`)
    }
    if (!provider.enabled) {
      throw new Error(`AI Gateway route "${route.id}" points to disabled provider "${provider.name}".`)
    }
    if (protocol && provider.protocol !== protocol) {
      throw new Error(`Provider "${provider.name}" uses ${provider.protocol}; ${protocol} is required for route "${route.id}".`)
    }
    return withRouteModelMap(provider, route)
  }

  getProviderForProfile(profileId: string | undefined, protocol?: AiGatewayUpstreamProtocol): AiGatewayProviderConfig | undefined {
    const normalizedProfileId = profileId?.trim()
    if (!normalizedProfileId) return undefined
    const route = this.config.modelRoutes?.find((item) => (
      item.enabled
      && item.source === 'claude-profile'
      && item.profileId === normalizedProfileId
    ))
    return route ? this.getProviderFromRoute(route, protocol) : undefined
  }

  getProviderForModel(model: string | undefined, protocol?: AiGatewayUpstreamProtocol): AiGatewayProviderConfig {
    const normalizedModel = model?.trim()
    const route = normalizedModel
      ? this.config.modelRoutes?.find((item) => (
        item.enabled
        && item.source !== 'claude-profile'
        && item.model === normalizedModel
      ))
      : undefined

    if (!route) return this.getActiveProvider(protocol)
    return this.getProviderFromRoute(route, protocol)
  }

  resolveApiKey(provider: AiGatewayProviderConfig): string {
    return provider.apiKey?.trim()
      || (provider.apiKeyEnv ? (process.env[provider.apiKeyEnv] ?? '').trim() : '')
  }
}
