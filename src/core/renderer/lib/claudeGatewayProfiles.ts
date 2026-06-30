import type {
  AiGatewayConfig,
  AiGatewayModelRoute,
  ClaudeBashrcConfig,
  ClaudeRuntimeProfile,
  ClaudeRuntimeProfileGatewayBinding,
} from '../../shared/types'

function cloneClaudeConfig(config: ClaudeBashrcConfig): ClaudeBashrcConfig {
  return {
    anthropicBaseUrl: config.anthropicBaseUrl,
    anthropicAuthToken: config.anthropicAuthToken,
    anthropicModel: config.anthropicModel,
    anthropicDefaultOpusModel: config.anthropicDefaultOpusModel,
    anthropicDefaultSonnetModel: config.anthropicDefaultSonnetModel,
    anthropicDefaultHaikuModel: config.anthropicDefaultHaikuModel,
    claudeCodeSubagentModel: config.claudeCodeSubagentModel,
  }
}

function getAiGatewayAnthropicBaseUrl(config: Pick<AiGatewayConfig, 'host' | 'port'>): string {
  return `http://${config.host}:${config.port}`
}

function getAiGatewayClaudeProfileBaseUrl(
  config: Pick<AiGatewayConfig, 'host' | 'port'>,
  profileId: string
): string {
  return `${getAiGatewayAnthropicBaseUrl(config)}/profiles/${encodeURIComponent(profileId)}`
}

function getClaudeProfileRouteModel(profileId: string): string {
  return `__claude_profile__:${profileId.trim()}`
}

export function getClaudeProfileDirectConfig(profile: ClaudeRuntimeProfile): ClaudeBashrcConfig {
  return cloneClaudeConfig(profile.gateway?.directConfig ?? profile.config)
}

export function buildClaudeGatewayEffectiveConfig(
  directConfig: ClaudeBashrcConfig,
  gatewayConfig: Pick<AiGatewayConfig, 'host' | 'port'>,
  profileId: string
): ClaudeBashrcConfig {
  return {
    ...cloneClaudeConfig(directConfig),
    anthropicBaseUrl: getAiGatewayClaudeProfileBaseUrl(gatewayConfig, profileId),
  }
}

export function applyClaudeProfileGatewayBinding(
  profile: ClaudeRuntimeProfile,
  gatewayConfig: AiGatewayConfig,
  nextBinding: Partial<ClaudeRuntimeProfileGatewayBinding>
): ClaudeRuntimeProfile {
  const existingBinding = profile.gateway
  const providerId = nextBinding.providerId?.trim()
    || existingBinding?.providerId
    || gatewayConfig.activeProviderId
    || gatewayConfig.providers[0]?.id
    || ''
  const directConfig = nextBinding.directConfig
    ? cloneClaudeConfig(nextBinding.directConfig)
    : getClaudeProfileDirectConfig(profile)
  const enabled = Boolean(nextBinding.enabled)

  return {
    ...profile,
    config: directConfig,
    gateway: {
      enabled,
      providerId,
    },
  }
}

export function getClaudeProfileRuntimeConfig(
  profile: ClaudeRuntimeProfile,
  gatewayConfig: AiGatewayConfig
): ClaudeBashrcConfig {
  const directConfig = getClaudeProfileDirectConfig(profile)
  return profile.gateway?.enabled
    ? buildClaudeGatewayEffectiveConfig(directConfig, gatewayConfig, profile.id)
    : directConfig
}

export function syncClaudeGatewayProfileConfigs(
  profiles: ClaudeRuntimeProfile[],
  gatewayConfig: AiGatewayConfig
): ClaudeRuntimeProfile[] {
  return profiles.map((profile) => (
    profile.gateway
      ? applyClaudeProfileGatewayBinding(profile, gatewayConfig, profile.gateway)
      : profile
  ))
}

export function withClaudeProfileModelRoutes(
  config: AiGatewayConfig,
  profiles: ClaudeRuntimeProfile[]
): AiGatewayConfig {
  const preservedRoutes = (config.modelRoutes ?? []).filter((route) => (
    route.source !== 'claude-profile'
  ))
  const profileRoutes = profiles.flatMap((profile): AiGatewayModelRoute[] => {
    const binding = profile.gateway
    if (!binding?.enabled || !binding.providerId.trim()) return []
    return [{
      id: `claude-profile:${profile.id}`,
      model: getClaudeProfileRouteModel(profile.id),
      providerId: binding.providerId.trim(),
      enabled: true,
      source: 'claude-profile',
      profileId: profile.id,
    }]
  })

  return {
    ...config,
    modelRoutes: [...preservedRoutes, ...profileRoutes],
  }
}
