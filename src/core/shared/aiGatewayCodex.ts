import type { AiGatewayConfig, AiGatewayModelRoute, AiGatewayProviderConfig, CodexConfig, CodexModelProviderConfig } from './types'

export const AI_GATEWAY_LOCAL_ROUTER_PROVIDER_ID = 'local-router'

export function getAiGatewayListenUrl(config: Pick<AiGatewayConfig, 'host' | 'port'>): string {
  return `http://${config.host}:${config.port}`
}

export function getAiGatewayOpenAiBaseUrl(config: Pick<AiGatewayConfig, 'host' | 'port'>): string {
  return `${getAiGatewayListenUrl(config)}/v1`
}

export function buildCodexLocalRouterProvider(config: Pick<AiGatewayConfig, 'host' | 'port'>, model: string): CodexModelProviderConfig {
  return {
    name: 'Local Router',
    model: model.trim() || 'gpt-5.4',
    baseUrl: getAiGatewayOpenAiBaseUrl(config),
    wireApi: 'responses',
    requiresOpenaiAuth: true,
    envKey: 'OPENAI_API_KEY',
  }
}

export function buildCodexGatewayConfig(directConfig: CodexConfig, gatewayConfig: Pick<AiGatewayConfig, 'host' | 'port'>): CodexConfig {
  const activeProviderId = directConfig.modelProvider
  return {
    ...directConfig,
    modelProviders: {
      ...directConfig.modelProviders,
      [activeProviderId]: buildCodexLocalRouterProvider(gatewayConfig, directConfig.model),
    },
  }
}

function sanitizeRouteIdPart(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9_.:-]/g, '')
}

export function buildCodexScopeModelRoute(scopeKey: string, model: string, providerId: string): AiGatewayModelRoute {
  const normalizedScopeKey = sanitizeRouteIdPart(scopeKey) || 'scope'
  const normalizedModel = model.trim()
  return {
    id: `codex-scope:${normalizedScopeKey}`,
    model: normalizedModel,
    providerId: providerId.trim(),
    enabled: true,
    source: 'codex-scope',
    scopeKey: normalizedScopeKey,
    cli: 'codex',
  }
}

export function withCodexScopeModelRoute(config: AiGatewayConfig, scopeKey: string, model: string, providerId: string): AiGatewayConfig {
  const normalizedModel = model.trim()
  const normalizedProviderId = providerId.trim()
  const preservedRoutes = (config.modelRoutes ?? []).filter((route) => route.source !== 'codex-scope' || route.scopeKey !== scopeKey)

  if (!normalizedModel || !normalizedProviderId) {
    return {
      ...config,
      modelRoutes: preservedRoutes,
    }
  }

  return {
    ...config,
    modelRoutes: [...preservedRoutes, buildCodexScopeModelRoute(scopeKey, normalizedModel, normalizedProviderId)],
  }
}

export function withoutCodexScopeModelRoute(config: AiGatewayConfig, scopeKey: string): AiGatewayConfig {
  return {
    ...config,
    modelRoutes: (config.modelRoutes ?? []).filter((route) => route.source !== 'codex-scope' || route.scopeKey !== scopeKey),
  }
}

export function findAiGatewayProvider(config: Pick<AiGatewayConfig, 'providers'> | null | undefined, providerId: string | undefined): AiGatewayProviderConfig | undefined {
  const normalizedProviderId = providerId?.trim()
  if (!normalizedProviderId) return undefined
  return config?.providers.find((provider) => provider.id === normalizedProviderId)
}
