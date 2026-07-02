import type {
  AiGatewayConfig,
  AiGatewayProviderConfig,
  AiGatewayStatus,
  CodexGatewayBinding,
  CodexSettingsSnapshot,
} from '../../shared/types'
import {
  AI_GATEWAY_LOCAL_ROUTER_PROVIDER_ID,
  findAiGatewayProvider,
} from '../../shared/aiGatewayCodex'

export type CodexGatewayBindingIssue = 'missing-provider' | 'disabled-provider' | null

export function isCodexLocalRouterSnapshot(snapshot: CodexSettingsSnapshot | undefined | null): boolean {
  return snapshot?.config.modelProvider === AI_GATEWAY_LOCAL_ROUTER_PROVIDER_ID
}

export function getCodexDisplaySnapshot(
  snapshot: CodexSettingsSnapshot | undefined,
  binding: CodexGatewayBinding | undefined
): CodexSettingsSnapshot | undefined {
  return binding?.enabled && binding.directSnapshot
    ? binding.directSnapshot
    : snapshot
}

export function getCodexActiveDirectProvider(snapshot: CodexSettingsSnapshot | undefined): {
  providerId: string
  providerName: string
  baseUrl: string
} | null {
  if (!snapshot) return null
  const providerId = snapshot.config.modelProvider
  const provider = snapshot.config.modelProviders[providerId]
  if (!provider) return null
  return {
    providerId,
    providerName: provider.name || providerId,
    baseUrl: provider.baseUrl,
  }
}

export function getCodexGatewayBindingIssue(
  binding: CodexGatewayBinding | undefined,
  gatewayConfig: AiGatewayConfig | null | undefined
): CodexGatewayBindingIssue {
  if (!binding?.enabled) return null
  const provider = findAiGatewayProvider(gatewayConfig, binding.providerId)
  if (!provider) return 'missing-provider'
  if (!provider.enabled) return 'disabled-provider'
  return null
}

export function getCodexGatewayProvider(
  binding: CodexGatewayBinding | undefined,
  gatewayConfig: AiGatewayConfig | null | undefined
): AiGatewayProviderConfig | undefined {
  return findAiGatewayProvider(gatewayConfig, binding?.providerId)
}

export function getCodexEffectiveBaseUrl(
  snapshot: CodexSettingsSnapshot | undefined,
  binding: CodexGatewayBinding | undefined,
  status: AiGatewayStatus | null | undefined
): string {
  if (binding?.enabled) return status?.openAiBaseUrl || ''
  return getCodexActiveDirectProvider(snapshot)?.baseUrl ?? ''
}

export function getCodexScopesUsingGateway(
  bindings: Record<string, CodexGatewayBinding> | undefined
): CodexGatewayBinding[] {
  return Object.values(bindings ?? {}).filter((binding) => binding.enabled)
}
