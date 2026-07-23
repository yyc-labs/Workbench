import type { AppConfig, ClaudeBashrcConfig, CodexSettingsSnapshot } from '../types'

/** Gateway domain contract. Core gateway models live here; legacy callers keep importing ../types. */
export type AiGatewayUpstreamProtocol = 'openai_chat' | 'openai_responses' | 'anthropic_messages'

export type AiGatewayClientCli = 'claude' | 'codex'
export type AiGatewayLogLevel = 'info' | 'warn' | 'error'
export type AiGatewayLogRoute = 'anthropic' | 'responses' | 'chat' | 'health' | 'unknown'
export type AiGatewayProtocolConversionKind = 'passthrough' | 'lossless_conversion' | 'lossy_conversion'

export interface AiGatewayProviderCapabilities {
  supportsStreaming?: boolean
  supportsTools?: boolean
  nativeResponsesTools?: boolean
  responsesToolsViaChatDowngrade?: boolean
  responsesBuiltInTools?: boolean
  supportsStrictTools?: boolean
  supportsParallelToolCalls?: boolean
  supportsDeveloperMessages?: boolean
  supportsReasoning?: boolean
  supportsResponsesInputItems?: boolean
  supportsAnthropicContentBlocks?: boolean
  supportsImages?: boolean
  supportsDocuments?: boolean
}

export interface AiGatewayProviderConfig {
  id: string
  name: string
  baseUrl: string
  apiKeyEnv?: string
  apiKey?: string
  protocol: AiGatewayUpstreamProtocol
  modelMap?: Record<string, string>
  capabilities?: AiGatewayProviderCapabilities
  enabled: boolean
  timeoutMs?: number
  streamRetryCount?: number
  streamRetryDelayMs?: number
  timeoutRetryCount?: number
  timeoutRetryDelayMs?: number
}

export interface AiGatewayModelRoute {
  id: string
  model: string
  providerId: string
  upstreamModel?: string
  enabled: boolean
  source?: 'manual' | 'claude-profile' | 'codex-scope'
  profileId?: string
  scopeKey?: string
  cli?: 'codex'
}

export interface AiGatewayClientBindingBackup {
  createdAt: string
  claudeConfig?: ClaudeBashrcConfig
  codexSnapshot?: CodexSettingsSnapshot
}

export interface AiGatewayClientBinding {
  cli: AiGatewayClientCli
  enabled: boolean
  baseUrl: string
  providerId: string
  backupPath?: string
  backup?: AiGatewayClientBindingBackup
}

export interface AiGatewayConfig {
  enabled: boolean
  host: string
  port: number
  activeProviderId: string
  providers: AiGatewayProviderConfig[]
  clientBindings: Record<AiGatewayClientCli, AiGatewayClientBinding>
  modelRoutes?: AiGatewayModelRoute[]
  maxBodyBytes?: number
}

export interface AiGatewayStatus {
  enabled: boolean
  running: boolean
  host: string
  port: number
  url: string
  anthropicBaseUrl: string
  openAiBaseUrl: string
  activeProviderId: string
  activeProvider?: AiGatewayProviderConfig
  providerCount: number
  clientBindings: Record<AiGatewayClientCli, AiGatewayClientBinding>
  modelRoutes?: AiGatewayModelRoute[]
  error?: string
}

/** Compatibility exports for gateway models that still depend on shared cross-domain types. */
export type {
  AiGatewayBindingResult,
  AiGatewayLogDetail,
  AiGatewayLogEntry,
  AiGatewayProtocolDiagnostics,
  AiGatewaySaveConfigResult,
  AiGatewayToolValidationEntry,
  CodexGatewayBinding,
  CodexGatewayBindingMap,
  CodexGatewayBindingResult,
  CodexGatewayBindingSaveInput,
} from '../types'
