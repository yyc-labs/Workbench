import type {
  AiGatewayClientBinding,
  AiGatewayClientCli,
  AiGatewayConfig,
  AiGatewayModelRoute,
  AiGatewayProviderConfig,
  AiGatewayUpstreamProtocol,
} from '../../../shared/types'

export const AI_GATEWAY_DEFAULT_HOST = '127.0.0.1'
export const AI_GATEWAY_DEFAULT_PORT = 17374
export const AI_GATEWAY_DEFAULT_PROVIDER_ID = 'openai-chat'
export const AI_GATEWAY_LOCAL_ROUTER_PROVIDER_ID = 'local-router'
export const AI_GATEWAY_DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024

const SUPPORTED_PROTOCOLS = new Set<AiGatewayUpstreamProtocol>([
  'openai_chat',
  'openai_responses',
  'anthropic_messages',
])

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizePort(value: unknown): number {
  const port = Number(value)
  if (!Number.isFinite(port)) return AI_GATEWAY_DEFAULT_PORT
  return Math.max(1, Math.min(65535, Math.trunc(port)))
}

function normalizeTimeout(value: unknown): number | undefined {
  const timeout = Number(value)
  if (!Number.isFinite(timeout) || timeout <= 0) return undefined
  return Math.max(1000, Math.min(300000, Math.trunc(timeout)))
}

function normalizeProtocol(value: unknown): AiGatewayUpstreamProtocol {
  return typeof value === 'string' && SUPPORTED_PROTOCOLS.has(value as AiGatewayUpstreamProtocol)
    ? value as AiGatewayUpstreamProtocol
    : 'openai_chat'
}

function normalizeModelMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([rawKey, rawValue]) => {
      const key = rawKey.trim()
      const mapped = typeof rawValue === 'string' ? rawValue.trim() : ''
      return key && mapped ? [key, mapped] as const : null
    })
    .filter((entry): entry is readonly [string, string] => Boolean(entry))
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function normalizeProviderId(value: unknown, fallback: string): string {
  return normalizeString(value, fallback)
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9_.-]/g, '')
    || fallback
}

function normalizeRouteSource(value: unknown): AiGatewayModelRoute['source'] {
  return value === 'claude-profile' ? 'claude-profile' : 'manual'
}

function normalizeModelRoute(value: unknown, index: number): AiGatewayModelRoute | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Partial<AiGatewayModelRoute>
  const model = normalizeOptionalString(raw.model)
  const providerId = normalizeOptionalString(raw.providerId)
  if (!model || !providerId) return null
  const source = normalizeRouteSource(raw.source)
  const fallbackId = `${source}:${model}:${index + 1}`
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9_.:-]/g, '')
  return {
    id: normalizeString(raw.id, fallbackId)
      .replace(/\s+/g, '-')
      .replace(/[^A-Za-z0-9_.:-]/g, '') || fallbackId,
    model,
    providerId: normalizeProviderId(providerId, providerId),
    upstreamModel: normalizeOptionalString(raw.upstreamModel),
    enabled: normalizeBoolean(raw.enabled, true),
    source,
    profileId: normalizeOptionalString(raw.profileId),
  }
}

function normalizeModelRoutes(value: unknown, providers: AiGatewayProviderConfig[]): AiGatewayModelRoute[] | undefined {
  if (!Array.isArray(value)) return undefined
  const providerIds = new Set(providers.map((provider) => provider.id))
  const usedRouteIds = new Set<string>()
  const routes = value
    .map(normalizeModelRoute)
    .filter((route): route is AiGatewayModelRoute => Boolean(route))
    .filter((route) => providerIds.has(route.providerId))
    .filter((route) => {
      if (usedRouteIds.has(route.id)) return false
      usedRouteIds.add(route.id)
      return true
    })
  return routes.length > 0 ? routes : undefined
}

function normalizeProvider(value: unknown, index: number): AiGatewayProviderConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Partial<AiGatewayProviderConfig>
  const id = normalizeProviderId(raw.id, index === 0 ? AI_GATEWAY_DEFAULT_PROVIDER_ID : `provider-${index + 1}`)
  const name = normalizeString(raw.name, id)
  const baseUrl = normalizeString(raw.baseUrl, 'https://api.openai.com/v1')
  return {
    id,
    name,
    baseUrl,
    apiKeyEnv: normalizeOptionalString(raw.apiKeyEnv) ?? 'OPENAI_API_KEY',
    apiKey: normalizeOptionalString(raw.apiKey),
    protocol: normalizeProtocol(raw.protocol),
    modelMap: normalizeModelMap(raw.modelMap),
    enabled: normalizeBoolean(raw.enabled, true),
    timeoutMs: normalizeTimeout(raw.timeoutMs),
  }
}

function defaultProvider(): AiGatewayProviderConfig {
  return {
    id: AI_GATEWAY_DEFAULT_PROVIDER_ID,
    name: 'OpenAI Chat Compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    protocol: 'openai_chat',
    modelMap: {},
    enabled: true,
    timeoutMs: 60000,
  }
}

export function getAiGatewayListenUrl(config: Pick<AiGatewayConfig, 'host' | 'port'>): string {
  return `http://${config.host}:${config.port}`
}

export function getAiGatewayAnthropicBaseUrl(config: Pick<AiGatewayConfig, 'host' | 'port'>): string {
  return getAiGatewayListenUrl(config)
}

export function getAiGatewayOpenAiBaseUrl(config: Pick<AiGatewayConfig, 'host' | 'port'>): string {
  return `${getAiGatewayListenUrl(config)}/v1`
}

function normalizeBinding(
  cli: AiGatewayClientCli,
  value: unknown,
  providerId: string,
  config: Pick<AiGatewayConfig, 'host' | 'port'>
): AiGatewayClientBinding {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<AiGatewayClientBinding>
    : {}
  return {
    cli,
    enabled: normalizeBoolean(raw.enabled, false),
    baseUrl: cli === 'codex'
      ? getAiGatewayOpenAiBaseUrl(config)
      : getAiGatewayAnthropicBaseUrl(config),
    providerId: normalizeProviderId(raw.providerId, providerId),
    backupPath: normalizeOptionalString(raw.backupPath),
    backup: raw.backup,
  }
}

export function defaultAiGatewayConfig(): AiGatewayConfig {
  const provider = defaultProvider()
  const config = {
    enabled: false,
    host: AI_GATEWAY_DEFAULT_HOST,
    port: AI_GATEWAY_DEFAULT_PORT,
    activeProviderId: provider.id,
    providers: [provider],
    modelRoutes: [],
    maxBodyBytes: AI_GATEWAY_DEFAULT_MAX_BODY_BYTES,
  }

  return {
    ...config,
    clientBindings: {
      claude: normalizeBinding('claude', undefined, provider.id, config),
      codex: normalizeBinding('codex', undefined, provider.id, config),
    },
  }
}

export function normalizeAiGatewayConfig(input: unknown): AiGatewayConfig {
  const defaults = defaultAiGatewayConfig()
  const raw = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Partial<AiGatewayConfig>
    : {}

  const host = normalizeString(raw.host, defaults.host)
  const port = normalizePort(raw.port)
  const providerCandidates = Array.isArray(raw.providers)
    ? raw.providers.map(normalizeProvider).filter((provider): provider is AiGatewayProviderConfig => Boolean(provider))
    : []
  const providers = providerCandidates.length > 0 ? providerCandidates : defaults.providers
  const providerIds = new Set<string>()
  const dedupedProviders = providers.filter((provider) => {
    if (providerIds.has(provider.id)) return false
    providerIds.add(provider.id)
    return true
  })

  const requestedActiveProviderId = normalizeProviderId(raw.activeProviderId, defaults.activeProviderId)
  const activeProvider = dedupedProviders.find((provider) => provider.id === requestedActiveProviderId)
    ?? dedupedProviders.find((provider) => provider.enabled)
    ?? dedupedProviders[0]!

  const partialConfig = {
    host,
    port,
  }
  const rawBindings = raw.clientBindings && typeof raw.clientBindings === 'object'
    ? raw.clientBindings as Partial<Record<AiGatewayClientCli, AiGatewayClientBinding>>
    : {}

  return {
    enabled: normalizeBoolean(raw.enabled, defaults.enabled),
    host,
    port,
    activeProviderId: activeProvider.id,
    providers: dedupedProviders,
    clientBindings: {
      claude: normalizeBinding('claude', rawBindings.claude, activeProvider.id, partialConfig),
      codex: normalizeBinding('codex', rawBindings.codex, activeProvider.id, partialConfig),
    },
    modelRoutes: normalizeModelRoutes(raw.modelRoutes, dedupedProviders),
    maxBodyBytes: Number.isFinite(Number(raw.maxBodyBytes))
      ? Math.max(1024, Math.min(20 * 1024 * 1024, Math.trunc(Number(raw.maxBodyBytes))))
      : defaults.maxBodyBytes,
  }
}
