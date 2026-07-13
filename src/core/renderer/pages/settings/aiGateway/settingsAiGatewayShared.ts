import type {
  AiGatewayProviderCapabilities,
  AiGatewayProviderConfig,
} from '../../../../shared/types'

export type ProviderDraft = AiGatewayProviderConfig & {
  draftId: string
  modelMapText: string
}

export type ProviderUsage = {
  claudeProfiles: string[]
  codexScopes: string[]
  manualRoutes: string[]
}

export const EMPTY_PROVIDER_USAGE: ProviderUsage = {
  claudeProfiles: [],
  codexScopes: [],
  manualRoutes: [],
}

const DEFAULT_OPENAI_CHAT_CAPABILITIES: AiGatewayProviderCapabilities = {
  supportsStreaming: true,
  supportsTools: true,
  supportsStrictTools: false,
  supportsParallelToolCalls: true,
  supportsDeveloperMessages: false,
  supportsReasoning: false,
  supportsResponsesInputItems: false,
  supportsAnthropicContentBlocks: false,
  supportsImages: false,
  supportsDocuments: false,
}

function modelMapToText(modelMap: Record<string, string> | undefined): string {
  return Object.entries(modelMap ?? {})
    .map(([source, target]) => `${source}=${target}`)
    .join('\n')
}

function parseModelMap(value: string): Record<string, string> | undefined {
  const entries = value.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.includes('=>') ? '=>' : '='
      const [source, ...rest] = line.split(separator)
      const target = rest.join(separator)
      const sourceModel = source?.trim() ?? ''
      const targetModel = target?.trim() ?? ''
      return sourceModel && targetModel ? [sourceModel, targetModel] as const : null
    })
    .filter((entry): entry is readonly [string, string] => Boolean(entry))

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

export function providerToDraft(provider: AiGatewayProviderConfig): ProviderDraft {
  return {
    ...provider,
    streamRetryCount: provider.streamRetryCount ?? 0,
    streamRetryDelayMs: provider.streamRetryDelayMs ?? 500,
    draftId: `${provider.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    modelMapText: modelMapToText(provider.modelMap),
  }
}

export function draftToProvider(draft: ProviderDraft): AiGatewayProviderConfig {
  return {
    id: draft.id.trim(),
    name: draft.name.trim(),
    baseUrl: draft.baseUrl.trim(),
    apiKeyEnv: draft.apiKeyEnv?.trim() || undefined,
    apiKey: draft.apiKey?.trim() || undefined,
    protocol: draft.protocol,
    modelMap: parseModelMap(draft.modelMapText),
    capabilities: draft.capabilities,
    enabled: draft.enabled,
    timeoutMs: Number.isFinite(Number(draft.timeoutMs)) ? Number(draft.timeoutMs) : undefined,
    streamRetryCount: Number.isFinite(Number(draft.streamRetryCount)) ? Number(draft.streamRetryCount) : undefined,
    streamRetryDelayMs: Number.isFinite(Number(draft.streamRetryDelayMs)) ? Number(draft.streamRetryDelayMs) : undefined,
  }
}

export function createNewProviderDraft(index: number): ProviderDraft {
  const id = `openai-chat-${index + 1}`
  return {
    draftId: `${id}-${Date.now()}`,
    id,
    name: `OpenAI Chat ${index + 1}`,
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    protocol: 'openai_chat',
    modelMap: {},
    modelMapText: '',
    capabilities: { ...DEFAULT_OPENAI_CHAT_CAPABILITIES },
    enabled: true,
    timeoutMs: 60000,
    streamRetryCount: 0,
    streamRetryDelayMs: 500,
  }
}

export function isProviderUsageEmpty(usage: ProviderUsage): boolean {
  return usage.claudeProfiles.length === 0
    && usage.codexScopes.length === 0
    && usage.manualRoutes.length === 0
}
