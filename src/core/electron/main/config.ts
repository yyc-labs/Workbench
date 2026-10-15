import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { defaultAiRuntimeProfileIdForCli, defaultAiRuntimeProfiles, isCliTool } from '../../shared/aiRuntimeProfiles'
import { getCodexScopeCacheKey } from '../../shared/codexScope'
import { type ConfigRecoveryInfo, CURRENT_CONFIG_SCHEMA_VERSION } from '../../shared/configSchema'
import { PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS } from '../../shared/projectDocLinks'
import type {
  AgentLogsConfig,
  AiCommitConfig,
  AiCommitProfile,
  AiRuntimeProfile,
  AppCacheLocationConfig,
  AppConfig,
  ClaudeBashrcConfig,
  ClaudeRuntimeProfile,
  ClaudeRuntimeProfileGatewayBinding,
  CloseWindowBehavior,
  CodexApprovalPolicy,
  CodexConfig,
  CodexEnvironmentScope,
  CodexGatewayBinding,
  CodexGatewayBindingMap,
  CodexModelProviderConfig,
  CodexSandboxMode,
  CodexSettingsSnapshot,
  CodexSettingsSnapshotMap,
  FloatingTerminalInstance,
  FloatingTerminalToggleAccelerator,
  LaunchOnLoginDisplayMode,
  ShortcutPreferencesConfig,
  ProjectFileExclusionsConfig,
} from '../../shared/types'
import { FLOATING_TERMINAL_TOGGLE_ACCELERATORS } from '../../shared/types'
import { migrateLegacyEnvironment } from './ai-environment/platform-detector'
import { defaultAiGatewayConfig, normalizeAiGatewayConfig } from './ai-gateway/gateway-config'
import { DEFAULT_BROWSER_AI_CONFIG, normalizeBrowserAiConfig } from './browser-ai/browserAiConfig'
import { capabilityManager } from './capability-manager'
import { defaultClaudeBashrcConfig, normalizeClaudeBashrcConfig } from './claude-bashrc'
import { migrateConfigDocument } from './config/config-migrations'
import { atomicWriteJson, backupCorruptConfigSync } from './config/config-persistence'

const CONFIG_FILE = 'project-launcher-config.json'
const MAX_CODE_SESSION_TABS = 5
const MAX_CODE_SESSION_CURSOR_ENTRIES = 60
export const DEFAULT_IMAGE_PREVIEW_LIMIT_MB = 10
export const DEFAULT_PDF_PREVIEW_LIMIT_MB = 3
export const DEFAULT_AUDIO_PREVIEW_LIMIT_MB = 5
export const DEFAULT_VIDEO_PREVIEW_LIMIT_MB = 10
const MIN_FILE_PREVIEW_LIMIT_MB = 1
const MAX_FILE_PREVIEW_LIMIT_MB = 1024
export const DEFAULT_CODE_TREE_AUTOLOAD_FILE_LIMIT = 4000
const MIN_CODE_TREE_AUTOLOAD_FILE_LIMIT = 500
const MAX_CODE_TREE_AUTOLOAD_FILE_LIMIT = 20000
const DEFAULT_AGENT_HOOK_CONFIG: NonNullable<AppConfig['agentHooks']> = {
  enabled: true,
  host: '0.0.0.0',
  port: 17373,
  token: '',
  maxBodyBytes: 256 * 1024,
  recentEventLimit: 200,
  transcriptImport: {
    enabled: true,
    token: '',
    openViewerByDefault: false,
  },
  feishu: {
    enabled: false,
    appId: '',
    appSecret: '',
    receiveId: '',
    receiveIdType: 'open_id',
    notifyOn: ['stop', 'permission-request'],
  },
}

const DEFAULT_AGENT_LOGS_CONFIG: AgentLogsConfig = {
  enabled: true,
}

const DEFAULT_CLAUDE_RUNTIME_PROFILE_ID = 'default'
const DEFAULT_CLAUDE_RUNTIME_PROFILE_NAME = 'DeepSeek Default'
const DEFAULT_AI_COMMIT_PROFILE_ID = 'default'
const DEFAULT_CACHE_LOCATION_CONFIG: AppCacheLocationConfig = {
  mode: 'default',
}
const DEFAULT_SHORTCUT_PREFERENCES: ShortcutPreferencesConfig = {
  quickTranscriptCaptureOpenViewer: false,
  floatingTerminalToggleAccelerator: 'CommandOrControl+J',
}
const DEFAULT_CODE_FILE_EXCLUSIONS: ProjectFileExclusionsConfig = {
  directories: ['.git', 'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', '.turbo', '.cache', 'coverage', '.venv', 'venv', '__pycache__'],
  files: ['.DS_Store', 'Thumbs.db'],
}

function getConfigPath(): string {
  return join(app.getPath('userData'), CONFIG_FILE)
}

function defaultAiCommitProfile(): AiCommitProfile {
  return {
    id: DEFAULT_AI_COMMIT_PROFILE_ID,
    name: 'Default OpenAI',
    source: 'manual',
    apiBaseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
  }
}

function defaultAiCommitConfig(): AiCommitConfig {
  const profile = defaultAiCommitProfile()
  return {
    enabled: true,
    activeProfileId: profile.id,
    profiles: [profile],
    loadedAgentProfileKeys: [],
    apiBaseUrl: profile.apiBaseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    wslPwshPath: '/snap/bin/pwsh',
    split: false,
    splitMaxBatches: 4,
    maxBullets: 8,
  }
}

const DEFAULT_CONFIG: AppConfig = {
  configVersion: CURRENT_CONFIG_SCHEMA_VERSION,
  projects: [],
  theme: 'system',
  locale: 'system',
  launchOnLogin: false,
  launchOnLoginDisplayMode: 'tray',
  closeWindowBehavior: 'quit',
  codeFileExclusions: DEFAULT_CODE_FILE_EXCLUSIONS,
  codeTreeAutoLoadFileLimit: DEFAULT_CODE_TREE_AUTOLOAD_FILE_LIMIT,
  imagePreviewLimitMb: DEFAULT_IMAGE_PREVIEW_LIMIT_MB,
  pdfPreviewLimitMb: DEFAULT_PDF_PREVIEW_LIMIT_MB,
  audioPreviewLimitMb: DEFAULT_AUDIO_PREVIEW_LIMIT_MB,
  videoPreviewLimitMb: DEFAULT_VIDEO_PREVIEW_LIMIT_MB,
  cacheLocation: DEFAULT_CACHE_LOCATION_CONFIG,
  removedProjects: [],
  folders: [],
  tags: [],
  docLinkTags: PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS.map((item) => ({ ...item })),
  startupDefaultFilter: undefined,
  aiEnvironment: undefined,
  aiRuntimeProfiles: defaultAiRuntimeProfiles(),
  activeAiRuntimeProfileId: defaultAiRuntimeProfileIdForCli('claude'),
  claudeRuntimeProfiles: [
    {
      id: DEFAULT_CLAUDE_RUNTIME_PROFILE_ID,
      name: DEFAULT_CLAUDE_RUNTIME_PROFILE_NAME,
      config: defaultClaudeBashrcConfig(),
    },
  ],
  activeClaudeRuntimeProfileId: DEFAULT_CLAUDE_RUNTIME_PROFILE_ID,
  runtimeLauncherScript: undefined,
  runtimeKeepAliveOnQuit: false,
  aiCommit: defaultAiCommitConfig(),
  codexProviderApiKeys: {},
  codexSettingsSnapshots: {},
  codexGatewayBindings: {},
  agentHooks: DEFAULT_AGENT_HOOK_CONFIG,
  agentLogs: DEFAULT_AGENT_LOGS_CONFIG,
  aiGateway: defaultAiGatewayConfig(),
  browserAi: DEFAULT_BROWSER_AI_CONFIG,
  shortcutPreferences: DEFAULT_SHORTCUT_PREFERENCES,
}

let configRecovery: ConfigRecoveryInfo | undefined

function normalizeAiRuntimeProfileKind(value: unknown): AiRuntimeProfile['kind'] {
  return value === 'custom' ? 'custom' : 'native'
}

function normalizeAiRuntimeProfileMode(value: unknown): AiRuntimeProfile['mode'] {
  if (value === 'windows-wsl' || value === 'windows-native' || value === 'linux-native' || value === 'macos-native' || value === 'custom-script' || value === 'disabled' || value === 'inherit') {
    return value
  }
  return 'inherit'
}

function normalizeAiRuntimeProfileEnv(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([rawKey, rawValue]) => {
        const key = rawKey.trim()
        if (!key) return null
        return [key, typeof rawValue === 'string' ? rawValue : String(rawValue ?? '')] as const
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry)),
  )
}

function normalizeAiRuntimeProfileArgs(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => (typeof item === 'string' ? item.trim() : String(item ?? '').trim())).filter(Boolean)
}

function normalizeAiRuntimeProfiles(profiles: AppConfig['aiRuntimeProfiles'] | unknown, activeProfileId: unknown): { profiles: AiRuntimeProfile[]; activeProfileId: string } {
  const defaults = defaultAiRuntimeProfiles()
  const normalizedInput = Array.isArray(profiles)
    ? profiles
        .map((item, index): AiRuntimeProfile | null => {
          if (!item || typeof item !== 'object') return null
          const raw = item as Partial<AiRuntimeProfile>
          const id = typeof raw.id === 'string' ? raw.id.trim() : ''
          if (!id) return null
          const kind = normalizeAiRuntimeProfileKind(raw.kind)
          const cli = isCliTool(raw.cli) ? raw.cli : undefined
          const fallback = defaults[index] ?? defaults[0]!
          const command = typeof raw.command === 'string' ? raw.command.trim() : ''
          const mode = normalizeAiRuntimeProfileMode(raw.mode)
          return {
            id,
            name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : fallback.name,
            kind,
            mode: kind === 'native' && mode === 'custom-script' ? 'inherit' : mode,
            cli,
            command: command || cli || (kind === 'native' ? fallback.command : ''),
            args: kind === 'custom' ? normalizeAiRuntimeProfileArgs(raw.args) : [],
            env: kind === 'custom' ? normalizeAiRuntimeProfileEnv(raw.env) : {},
            passProjectPath: kind === 'custom' ? (typeof raw.passProjectPath === 'boolean' ? raw.passProjectPath : true) : false,
          }
        })
        .filter((item): item is AiRuntimeProfile => Boolean(item))
    : []

  const merged: AiRuntimeProfile[] = []
  const usedIds = new Set<string>()
  for (const profile of [...defaults, ...normalizedInput]) {
    if (usedIds.has(profile.id)) {
      const existingIndex = merged.findIndex((item) => item.id === profile.id)
      if (existingIndex >= 0) merged[existingIndex] = profile
      continue
    }
    usedIds.add(profile.id)
    merged.push(profile)
  }

  const requestedActiveProfileId = typeof activeProfileId === 'string' ? activeProfileId.trim() : ''
  const active = merged.some((profile) => profile.id === requestedActiveProfileId) ? requestedActiveProfileId : defaultAiRuntimeProfileIdForCli('claude')

  return {
    profiles: merged,
    activeProfileId: merged.some((profile) => profile.id === active) ? active : merged[0]!.id,
  }
}

function normalizeAiCommitProfileSource(value: unknown): AiCommitProfile['source'] {
  return value === 'claude' || value === 'codex' || value === 'manual' ? value : 'manual'
}

function normalizeBooleanFlag(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  return fallback
}

function normalizeCloseWindowBehavior(value: unknown): CloseWindowBehavior {
  return value === 'tray' ? 'tray' : 'quit'
}

function normalizeLaunchOnLoginDisplayMode(value: unknown): LaunchOnLoginDisplayMode {
  return value === 'window' ? 'window' : 'tray'
}

function normalizeAiCommitProfiles(profiles: unknown, legacyConfig: Partial<AiCommitConfig>): AiCommitProfile[] {
  const normalizedProfiles = Array.isArray(profiles)
    ? profiles
        .map((item, index): AiCommitProfile | null => {
          if (!item || typeof item !== 'object') return null
          const raw = item as Partial<AiCommitProfile>
          const id = typeof raw.id === 'string' ? raw.id.trim() : `profile-${index + 1}`
          const name = typeof raw.name === 'string' ? raw.name.trim() : `Profile ${index + 1}`
          if (!id) return null
          return {
            id,
            name: name || `Profile ${index + 1}`,
            source: normalizeAiCommitProfileSource(raw.source),
            sourceKey: typeof raw.sourceKey === 'string' ? raw.sourceKey.trim() : undefined,
            apiBaseUrl: typeof raw.apiBaseUrl === 'string' ? raw.apiBaseUrl.trim() : '',
            apiKey: typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '',
            model: typeof raw.model === 'string' ? raw.model.trim() : '',
          }
        })
        .filter((item): item is AiCommitProfile => Boolean(item))
    : []

  const dedupedProfiles: AiCommitProfile[] = []
  const usedIds = new Set<string>()
  for (const profile of normalizedProfiles) {
    if (usedIds.has(profile.id)) continue
    usedIds.add(profile.id)
    dedupedProfiles.push(profile)
  }

  if (dedupedProfiles.length > 0) return dedupedProfiles

  return [
    {
      ...defaultAiCommitProfile(),
      apiBaseUrl: typeof legacyConfig.apiBaseUrl === 'string' ? legacyConfig.apiBaseUrl.trim() : defaultAiCommitProfile().apiBaseUrl,
      apiKey: typeof legacyConfig.apiKey === 'string' ? legacyConfig.apiKey.trim() : '',
      model: typeof legacyConfig.model === 'string' ? legacyConfig.model.trim() : defaultAiCommitProfile().model,
    },
  ]
}

function normalizeAiCommitConfig(input: AppConfig['aiCommit'] | unknown): AiCommitConfig {
  const defaults = defaultAiCommitConfig()
  const raw = input && typeof input === 'object' ? (input as Partial<AiCommitConfig>) : {}
  const profiles = normalizeAiCommitProfiles(raw.profiles, raw)
  const requestedActiveProfileId = typeof raw.activeProfileId === 'string' ? raw.activeProfileId.trim() : ''
  const activeProfile = profiles.find((profile) => profile.id === requestedActiveProfileId) ?? profiles[0]!
  const loadedAgentProfileKeys = Array.isArray(raw.loadedAgentProfileKeys)
    ? Array.from(
        new Set(
          raw.loadedAgentProfileKeys
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      )
    : defaults.loadedAgentProfileKeys

  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : defaults.enabled,
    activeProfileId: activeProfile.id,
    profiles,
    loadedAgentProfileKeys,
    apiBaseUrl: activeProfile.apiBaseUrl || defaults.apiBaseUrl,
    apiKey: activeProfile.apiKey || '',
    model: activeProfile.model || defaults.model,
    wslPwshPath: typeof raw.wslPwshPath === 'string' && raw.wslPwshPath.trim() ? raw.wslPwshPath.trim() : defaults.wslPwshPath,
    split: typeof raw.split === 'boolean' ? raw.split : defaults.split,
    splitMaxBatches: Number.isFinite(raw.splitMaxBatches) ? Math.max(1, Math.min(12, Math.trunc(raw.splitMaxBatches as number))) : defaults.splitMaxBatches,
    maxBullets: Number.isFinite(raw.maxBullets) ? Math.max(1, Math.min(20, Math.trunc(raw.maxBullets as number))) : defaults.maxBullets,
  }
}

function normalizeCodexProviderApiKeys(input: AppConfig['codexProviderApiKeys'] | unknown, legacySnapshotInput?: unknown): Record<string, Record<string, string>> {
  if (!input || typeof input !== 'object') return {}

  const entries = Object.entries(input as Record<string, unknown>)
  const looksScoped = entries.some(([, value]) => value && typeof value === 'object')

  if (!looksScoped) {
    const legacyProviderApiKeys = Object.fromEntries(entries.map(([key, value]) => [key.trim(), typeof value === 'string' ? value.trim() : ''] as const).filter(([key]) => Boolean(key)))

    const legacySnapshot = normalizeSingleCodexSettingsSnapshot(legacySnapshotInput)
    if (legacySnapshot && Object.keys(legacyProviderApiKeys).length > 0) {
      return {
        [getCodexScopeCacheKey(legacySnapshot.scope)]: legacyProviderApiKeys,
      }
    }

    return Object.keys(legacyProviderApiKeys).length > 0 ? { legacy: legacyProviderApiKeys } : {}
  }

  return Object.fromEntries(
    entries
      .map(([scopeKey, value]) => {
        const normalizedScopeKey = scopeKey.trim()
        if (!normalizedScopeKey || !value || typeof value !== 'object') return null
        const scopedProviderApiKeys = Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .map(([providerKey, providerValue]) => [providerKey.trim(), typeof providerValue === 'string' ? providerValue.trim() : ''] as const)
            .filter(([providerKey]) => Boolean(providerKey)),
        )
        return [normalizedScopeKey, scopedProviderApiKeys] as const
      })
      .filter((entry): entry is readonly [string, Record<string, string>] => Boolean(entry)),
  )
}

function normalizeCodexEnvironmentScope(input: unknown): CodexEnvironmentScope | undefined {
  if (!input || typeof input !== 'object') return undefined
  const raw = input as Partial<CodexEnvironmentScope>
  const target = raw.target === 'wsl' ? 'wsl' : raw.target === 'native' ? 'native' : null
  const hostPlatform = raw.hostPlatform === 'windows' ? 'windows' : raw.hostPlatform === 'linux' ? 'linux' : raw.hostPlatform === 'macos' ? 'macos' : null
  const runtimeMode = typeof raw.runtimeMode === 'string' ? raw.runtimeMode.trim() : ''
  const homePath = typeof raw.homePath === 'string' ? raw.homePath.trim() : ''
  const configPath = typeof raw.configPath === 'string' ? raw.configPath.trim() : ''
  const envStorage = raw.envStorage === 'bashrc' ? 'bashrc' : raw.envStorage === 'windows-user-env' ? 'windows-user-env' : null
  const envStoragePath = typeof raw.envStoragePath === 'string' ? raw.envStoragePath.trim() : ''

  if (!target || !hostPlatform || !runtimeMode || !homePath || !configPath || !envStorage || !envStoragePath) {
    return undefined
  }

  return {
    target,
    hostPlatform,
    runtimeMode: runtimeMode as CodexEnvironmentScope['runtimeMode'],
    homePath,
    configPath,
    envStorage,
    envStoragePath,
  }
}

function normalizeCodexProviderKey(value: string): string {
  return value.trim().replace(/\s+/g, '-')
}

function normalizeCodexModelProviderConfig(providerKey: string, value: unknown): CodexModelProviderConfig | null {
  if (!value || typeof value !== 'object') return null

  const raw = value as Partial<CodexModelProviderConfig>
  const name = typeof raw.name === 'string' ? raw.name.trim() : providerKey
  const baseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : ''
  const wireApi = typeof raw.wireApi === 'string' ? raw.wireApi.trim() : 'responses'
  const envKey = typeof raw.envKey === 'string' ? raw.envKey.trim() : 'OPENAI_API_KEY'
  const requiresOpenaiAuth = typeof raw.requiresOpenaiAuth === 'boolean' ? raw.requiresOpenaiAuth : true

  return {
    name: name || providerKey,
    model: typeof raw.model === 'string' ? raw.model.trim() : '',
    baseUrl,
    wireApi: wireApi || 'responses',
    requiresOpenaiAuth,
    envKey: envKey || 'OPENAI_API_KEY',
  }
}

function normalizeCodexConfigSnapshot(input: unknown): CodexConfig | undefined {
  if (!input || typeof input !== 'object') return undefined

  const raw = input as Partial<CodexConfig>
  const rawProviders = raw.modelProviders && typeof raw.modelProviders === 'object' ? (raw.modelProviders as Record<string, unknown>) : {}

  const modelProviders = Object.fromEntries(
    Object.entries(rawProviders)
      .map(([rawKey, rawValue]) => {
        const key = normalizeCodexProviderKey(rawKey)
        if (!key) return null
        const normalized = normalizeCodexModelProviderConfig(key, rawValue)
        if (!normalized) return null
        return [key, normalized] as const
      })
      .filter((entry): entry is readonly [string, CodexModelProviderConfig] => Boolean(entry)),
  )

  const providerKeys = Object.keys(modelProviders)
  if (providerKeys.length === 0) return undefined

  const requestedModelProvider = typeof raw.modelProvider === 'string' ? raw.modelProvider.trim() : ''
  const modelProvider = modelProviders[requestedModelProvider] ? requestedModelProvider : providerKeys[0]!

  return {
    modelProvider,
    model: typeof raw.model === 'string' ? raw.model.trim() : '',
    modelReasoningEffort: typeof raw.modelReasoningEffort === 'string' ? raw.modelReasoningEffort.trim() : '',
    preferredAuthMethod: typeof raw.preferredAuthMethod === 'string' ? raw.preferredAuthMethod.trim() : '',
    approvalPolicy: typeof raw.approvalPolicy === 'string' && raw.approvalPolicy.trim() ? (raw.approvalPolicy.trim() as CodexApprovalPolicy) : 'on-request',
    sandboxMode: typeof raw.sandboxMode === 'string' && raw.sandboxMode.trim() ? (raw.sandboxMode.trim() as CodexSandboxMode) : 'workspace-write',
    approvalsReviewer: typeof raw.approvalsReviewer === 'string' ? raw.approvalsReviewer.trim() : '',
    modelProviders,
  }
}

function normalizeSingleCodexSettingsSnapshot(input: unknown): CodexSettingsSnapshot | undefined {
  if (!input || typeof input !== 'object') return undefined

  const raw = input as Partial<CodexSettingsSnapshot>
  const scope = normalizeCodexEnvironmentScope(raw.scope)
  if (!scope) return undefined

  const config = normalizeCodexConfigSnapshot(raw.config)
  if (!config) return undefined
  const rawProviderApiKeys = raw.providerApiKeys && typeof raw.providerApiKeys === 'object' ? (raw.providerApiKeys as Record<string, unknown>) : {}
  const normalizedProviderApiKeys = Object.fromEntries(Object.keys(config.modelProviders).map((key) => [key, typeof rawProviderApiKeys[key] === 'string' ? String(rawProviderApiKeys[key]).trim() : '']))

  return {
    scope,
    providerApiKeys: normalizedProviderApiKeys,
    configExists: Boolean(raw.configExists),
    config,
  }
}

function normalizeCodexSettingsSnapshots(input: AppConfig['codexSettingsSnapshots'] | unknown, legacySnapshotInput?: unknown): CodexSettingsSnapshotMap {
  const normalizedMap: CodexSettingsSnapshotMap = {}
  let hasScopedSnapshots = false

  if (input && typeof input === 'object') {
    for (const [scopeKey, value] of Object.entries(input as Record<string, unknown>)) {
      const normalizedScopeKey = scopeKey.trim()
      if (!normalizedScopeKey) continue
      const normalizedSnapshot = normalizeSingleCodexSettingsSnapshot(value)
      if (!normalizedSnapshot) continue
      normalizedMap[normalizedScopeKey] = normalizedSnapshot
      hasScopedSnapshots = true
    }
  }

  const legacySnapshot = normalizeSingleCodexSettingsSnapshot(legacySnapshotInput)
  if (legacySnapshot && !hasScopedSnapshots) {
    normalizedMap[getCodexScopeCacheKey(legacySnapshot.scope)] = legacySnapshot
  }

  return normalizedMap
}

function normalizeSingleCodexGatewayBinding(scopeKey: string, input: unknown): CodexGatewayBinding | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const normalizedScopeKey = scopeKey.trim()
  if (!normalizedScopeKey) return undefined

  const raw = input as Partial<CodexGatewayBinding>
  const providerId = typeof raw.providerId === 'string' ? raw.providerId.trim() : ''
  const directSnapshot = normalizeSingleCodexSettingsSnapshot(raw.directSnapshot)
  const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt.trim() : ''

  return {
    enabled: Boolean(raw.enabled),
    scopeKey: typeof raw.scopeKey === 'string' && raw.scopeKey.trim() ? raw.scopeKey.trim() : normalizedScopeKey,
    providerId,
    directSnapshot,
    updatedAt: updatedAt || undefined,
  }
}

function normalizeCodexGatewayBindings(input: AppConfig['codexGatewayBindings'] | unknown): CodexGatewayBindingMap {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}

  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>)
      .map(([scopeKey, value]) => {
        const normalized = normalizeSingleCodexGatewayBinding(scopeKey, value)
        return normalized ? ([normalized.scopeKey, normalized] as const) : null
      })
      .filter((entry): entry is readonly [string, CodexGatewayBinding] => Boolean(entry)),
  )
}

function normalizeClaudeRuntimeProfileGateway(input: unknown): ClaudeRuntimeProfileGatewayBinding | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const raw = input as Partial<ClaudeRuntimeProfileGatewayBinding>
  const providerId = typeof raw.providerId === 'string' ? raw.providerId.trim() : ''
  const modelAlias = typeof raw.modelAlias === 'string' ? raw.modelAlias.trim() : ''
  const upstreamModel = typeof raw.upstreamModel === 'string' ? raw.upstreamModel.trim() : ''
  const directConfig = raw.directConfig && typeof raw.directConfig === 'object' ? normalizeClaudeBashrcConfig(raw.directConfig as unknown as Record<string, unknown>) : undefined

  if (!providerId && !modelAlias && !directConfig) return undefined

  const binding: ClaudeRuntimeProfileGatewayBinding = {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : false,
    providerId,
    directConfig,
  }
  if (modelAlias) binding.modelAlias = modelAlias
  if (upstreamModel) binding.upstreamModel = upstreamModel
  return binding
}

function stripLegacyClaudeGatewayDirectConfig(gateway: ClaudeRuntimeProfileGatewayBinding | undefined): ClaudeRuntimeProfileGatewayBinding | undefined {
  if (!gateway) return undefined
  if (!gateway.enabled && !gateway.providerId && !gateway.modelAlias && !gateway.upstreamModel) return undefined

  const binding: ClaudeRuntimeProfileGatewayBinding = {
    enabled: gateway.enabled,
    providerId: gateway.providerId,
  }
  if (gateway.modelAlias) binding.modelAlias = gateway.modelAlias
  if (gateway.upstreamModel) binding.upstreamModel = gateway.upstreamModel
  return binding
}

function normalizeClaudeRuntimeProfiles(profiles: AppConfig['claudeRuntimeProfiles'] | unknown, activeProfileId: unknown): { profiles: ClaudeRuntimeProfile[]; activeProfileId: string } {
  const normalizedProfiles = Array.isArray(profiles)
    ? profiles
        .map((item, index): (ClaudeRuntimeProfile & { sortOrder: number }) | null => {
          if (!item || typeof item !== 'object') return null
          const raw = item as Partial<ClaudeRuntimeProfile>
          const id = typeof raw.id === 'string' ? raw.id.trim() : ''
          const name = typeof raw.name === 'string' ? raw.name.trim() : ''
          const config = raw.config && typeof raw.config === 'object' ? normalizeClaudeBashrcConfig(raw.config as unknown as Record<string, unknown>) : defaultClaudeBashrcConfig()
          const gateway = normalizeClaudeRuntimeProfileGateway(raw.gateway)
          if (!id || !name) return null
          const profile: ClaudeRuntimeProfile & { sortOrder: number } = {
            id,
            name,
            config: gateway?.directConfig ?? config,
            sortOrder: index,
          }
          const nextGateway = stripLegacyClaudeGatewayDirectConfig(gateway)
          if (nextGateway) profile.gateway = nextGateway
          return profile
        })
        .filter((item): item is ClaudeRuntimeProfile & { sortOrder: number } => Boolean(item))
    : []

  const dedupedProfiles: ClaudeRuntimeProfile[] = []
  const usedIds = new Set<string>()
  for (const profile of normalizedProfiles) {
    if (usedIds.has(profile.id)) continue
    usedIds.add(profile.id)
    dedupedProfiles.push({
      id: profile.id,
      name: profile.name,
      config: profile.config,
      gateway: profile.gateway,
    })
  }

  if (dedupedProfiles.length === 0) {
    dedupedProfiles.push({
      id: DEFAULT_CLAUDE_RUNTIME_PROFILE_ID,
      name: DEFAULT_CLAUDE_RUNTIME_PROFILE_NAME,
      config: defaultClaudeBashrcConfig(),
    })
  }

  const normalizedActiveProfileId = typeof activeProfileId === 'string' ? activeProfileId.trim() : ''
  const active = dedupedProfiles.some((profile) => profile.id === normalizedActiveProfileId) ? normalizedActiveProfileId : dedupedProfiles[0]!.id

  return { profiles: dedupedProfiles, activeProfileId: active }
}

let cachedConfig: AppConfig | undefined
let saveQueue: Promise<void> = Promise.resolve()

function normalizeDocLinkTags(input: AppConfig['docLinkTags'] | unknown): NonNullable<AppConfig['docLinkTags']> {
  if (!Array.isArray(input)) return []

  const deduped: NonNullable<AppConfig['docLinkTags']> = []
  const used = new Set<string>()
  for (let i = 0; i < input.length; i += 1) {
    const item = input[i] as Partial<{ value: unknown; label: unknown; sortOrder: unknown }>
    const value = typeof item?.value === 'string' ? item.value.trim() : ''
    const label = typeof item?.label === 'string' ? item.label.trim() : ''
    if (!value || !label || used.has(value)) continue
    used.add(value)
    deduped.push({
      value,
      label,
      sortOrder: Number.isFinite(item?.sortOrder as number) ? Number(item?.sortOrder) : deduped.length,
    })
  }

  return deduped
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item, index) => ({ ...item, sortOrder: index }))
}

function normalizeCodeSession(value: unknown):
  | {
      tabs: string[]
      activePath?: string
      cursorPositions?: Record<string, { lineNumber: number; column: number }>
    }
  | undefined {
  if (!value || typeof value !== 'object') return undefined

  const raw = value as {
    tabs?: unknown
    activePath?: unknown
    cursorPositions?: unknown
  }
  const tabs = Array.isArray(raw.tabs)
    ? Array.from(
        new Set(
          raw.tabs
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ).slice(0, MAX_CODE_SESSION_TABS)
    : []

  const activePath = typeof raw.activePath === 'string' ? raw.activePath.trim() : ''

  const cursorEntries: Array<[string, { lineNumber: number; column: number }]> = []
  if (raw.cursorPositions && typeof raw.cursorPositions === 'object') {
    for (const [rawPath, rawPosition] of Object.entries(raw.cursorPositions as Record<string, unknown>)) {
      const path = rawPath.trim()
      if (!path) continue
      if (!rawPosition || typeof rawPosition !== 'object') continue
      const lineNumber = Math.max(1, Math.floor(Number((rawPosition as { lineNumber?: unknown }).lineNumber)))
      const column = Math.max(1, Math.floor(Number((rawPosition as { column?: unknown }).column)))
      if (!Number.isFinite(lineNumber) || !Number.isFinite(column)) continue
      cursorEntries.push([path, { lineNumber, column }])
      if (cursorEntries.length >= MAX_CODE_SESSION_CURSOR_ENTRIES) break
    }
  }

  const cursorPositions = cursorEntries.length > 0 ? Object.fromEntries(cursorEntries) : undefined

  const normalizedActivePath = activePath && tabs.includes(activePath) ? activePath : tabs[0]

  if (tabs.length <= 0 && !cursorPositions) return undefined

  return {
    tabs,
    activePath: normalizedActivePath,
    cursorPositions,
  }
}

function normalizeAgentHookConfig(value: AppConfig['agentHooks'] | unknown): NonNullable<AppConfig['agentHooks']> {
  const raw = value && typeof value === 'object' ? (value as NonNullable<AppConfig['agentHooks']>) : {}
  const rawFeishu = raw.feishu && typeof raw.feishu === 'object' ? raw.feishu : {}
  const rawTranscriptImport = raw.transcriptImport && typeof raw.transcriptImport === 'object' ? raw.transcriptImport : {}

  return {
    ...DEFAULT_AGENT_HOOK_CONFIG,
    ...raw,
    feishu: {
      ...DEFAULT_AGENT_HOOK_CONFIG.feishu,
      ...rawFeishu,
    },
    transcriptImport: {
      ...DEFAULT_AGENT_HOOK_CONFIG.transcriptImport,
      ...rawTranscriptImport,
    },
  }
}

function normalizeAgentLogsConfig(value: AppConfig['agentLogs'] | unknown): NonNullable<AppConfig['agentLogs']> {
  const raw = value && typeof value === 'object' ? (value as Partial<AgentLogsConfig>) : {}

  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_AGENT_LOGS_CONFIG.enabled,
  }
}

function normalizeCacheLocationConfig(value: AppConfig['cacheLocation'] | unknown): AppCacheLocationConfig {
  const raw = value && typeof value === 'object' ? (value as Partial<AppCacheLocationConfig>) : {}
  const mode = raw.mode === 'install' || raw.mode === 'custom' ? raw.mode : 'default'
  const customPath = typeof raw.customPath === 'string' && raw.customPath.trim() ? resolve(raw.customPath.trim()) : undefined

  if (mode === 'custom') {
    return {
      mode,
      customPath,
    }
  }

  return { mode }
}

function normalizePreviewLimitMb(value: unknown, defaultMb: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(parsed)) return defaultMb
  return Math.min(MAX_FILE_PREVIEW_LIMIT_MB, Math.max(MIN_FILE_PREVIEW_LIMIT_MB, Math.round(parsed)))
}

function normalizeCodeTreeAutoLoadFileLimit(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(parsed)) return DEFAULT_CODE_TREE_AUTOLOAD_FILE_LIMIT
  return Math.min(MAX_CODE_TREE_AUTOLOAD_FILE_LIMIT, Math.max(MIN_CODE_TREE_AUTOLOAD_FILE_LIMIT, Math.round(parsed)))
}

type FilePreviewLimits = Pick<AppConfig, 'imagePreviewLimitMb' | 'pdfPreviewLimitMb' | 'audioPreviewLimitMb' | 'videoPreviewLimitMb'>

/** 归一化四类预览上限；旧版单一 filePreviewLimitMb 不再继承，统一使用约定默认值。 */
function normalizeFilePreviewLimits(source: Partial<AppConfig> & { filePreviewLimitMb?: unknown }): FilePreviewLimits {
  return {
    imagePreviewLimitMb: normalizePreviewLimitMb(source.imagePreviewLimitMb, DEFAULT_IMAGE_PREVIEW_LIMIT_MB),
    pdfPreviewLimitMb: normalizePreviewLimitMb(source.pdfPreviewLimitMb, DEFAULT_PDF_PREVIEW_LIMIT_MB),
    audioPreviewLimitMb: normalizePreviewLimitMb(source.audioPreviewLimitMb, DEFAULT_AUDIO_PREVIEW_LIMIT_MB),
    videoPreviewLimitMb: normalizePreviewLimitMb(source.videoPreviewLimitMb, DEFAULT_VIDEO_PREVIEW_LIMIT_MB),
  }
}

function normalizeShortcutPreferences(value: AppConfig['shortcutPreferences'] | unknown): ShortcutPreferencesConfig {
  const raw = value && typeof value === 'object' ? (value as Partial<ShortcutPreferencesConfig>) : {}

  return {
    quickTranscriptCaptureOpenViewer: typeof raw.quickTranscriptCaptureOpenViewer === 'boolean' ? raw.quickTranscriptCaptureOpenViewer : DEFAULT_SHORTCUT_PREFERENCES.quickTranscriptCaptureOpenViewer,
    floatingTerminalToggleAccelerator: FLOATING_TERMINAL_TOGGLE_ACCELERATORS.includes(raw.floatingTerminalToggleAccelerator as FloatingTerminalToggleAccelerator) ? (raw.floatingTerminalToggleAccelerator as FloatingTerminalToggleAccelerator) : DEFAULT_SHORTCUT_PREFERENCES.floatingTerminalToggleAccelerator,
  }
}

/** 浮动终端实例几何归一化：sizeRatio clamp [0.2,0.8]、旧 free 停靠迁移为 bottom、zIndex 归一段。 */
function normalizeFloatingTerminals(value: unknown): FloatingTerminalInstance[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return undefined
  const clampNumber = (input: unknown, fallback: number, min: number, max: number): number => {
    const parsed = typeof input === 'number' ? input : Number(input)
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(max, Math.max(min, parsed))
  }
  const normalized: FloatingTerminalInstance[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Partial<FloatingTerminalInstance>
    if (typeof item.id !== 'string' || !item.id.trim()) continue
    if (typeof item.processKey !== 'string' || !item.processKey.trim()) continue
    if (typeof item.projectId !== 'string' || !item.projectId.trim()) continue
    if (typeof item.cwd !== 'string' || !item.cwd.trim()) continue
    // 旧版本遗留的 'free' 停靠已下线，迁移为 bottom，不丢实例。
    const dock = item.dock === 'top' || item.dock === 'bottom' || item.dock === 'left' || item.dock === 'right' ? item.dock : item.dock === 'free' ? 'bottom' : null
    if (!dock) continue
    normalized.push({
      id: item.id,
      processKey: item.processKey,
      projectId: item.projectId,
      cwd: item.cwd,
      useWsl: item.useWsl === true,
      title: typeof item.title === 'string' ? item.title.slice(0, 80) : 'Terminal',
      dock,
      sizeRatio: clampNumber(item.sizeRatio, 0.35, 0.2, 0.8),
      hidden: item.hidden === true,
      zIndex: clampNumber(item.zIndex, 9000, 9000, 9997),
    })
    if (normalized.length >= 12) break
  }
  return normalized
}

function normalizeCodeFileExclusions(value: AppConfig['codeFileExclusions'] | unknown): ProjectFileExclusionsConfig {
  const input = value && typeof value === 'object' ? (value as Partial<ProjectFileExclusionsConfig>) : {}
  const normalize = (items: unknown, fallback: string[]) => {
    if (!Array.isArray(items)) return [...fallback]
    return Array.from(
      new Set(
        items
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter((item) => item && item !== '.' && item !== '..' && !item.includes('/') && !item.includes('\\')),
      ),
    ).slice(0, 200)
  }
  return {
    directories: normalize(input.directories, DEFAULT_CODE_FILE_EXCLUSIONS.directories),
    files: normalize(input.files, DEFAULT_CODE_FILE_EXCLUSIONS.files),
  }
}

function normalizeAiEnvironmentConfig(config: AppConfig): AppConfig['aiEnvironment'] {
  try {
    const capability = capabilityManager.get()
    return migrateLegacyEnvironment(config.aiEnvironment, capability, {
      runtimeLauncherScript: config.runtimeLauncherScript,
      aiCommitEntrypoint: config.aiEnvironment?.aiCommitEntrypoint,
    })
  } catch {
    return config.aiEnvironment
  }
}

export function loadConfig(): AppConfig {
  if (cachedConfig) return cachedConfig

  const configPath = getConfigPath()
  let rawConfigText: string | undefined
  try {
    rawConfigText = readFileSync(configPath, 'utf-8')
    const migrated = migrateConfigDocument(JSON.parse(rawConfigText))
    const parsed = migrated.document as unknown as AppConfig & { startupDefaultTagId?: string }
    const legacyStartupDefaultTagId = parsed.startupDefaultTagId
    const normalizedProjects = Array.isArray(parsed.projects)
      ? parsed.projects.map((project) => {
          const favorites = Array.isArray(project.codeFileDrawerState?.favorites)
            ? project.codeFileDrawerState.favorites
                .filter((item): item is string => typeof item === 'string')
                .map((item) => item.trim())
                .filter(Boolean)
            : []
          const recents = Array.isArray(project.codeFileDrawerState?.recents)
            ? project.codeFileDrawerState.recents
                .filter((item): item is string => typeof item === 'string')
                .map((item) => item.trim())
                .filter(Boolean)
            : []
          const hasDrawerState = favorites.length > 0 || recents.length > 0
          const codeSession = normalizeCodeSession(project.codeSession)
          return {
            ...project,
            cli: isCliTool(project.cli) ? project.cli : undefined,
            aiRuntimeProfileId: typeof project.aiRuntimeProfileId === 'string' && project.aiRuntimeProfileId.trim() ? project.aiRuntimeProfileId.trim() : undefined,
            codeFileDrawerState: hasDrawerState
              ? {
                  favorites: Array.from(new Set(favorites)),
                  recents: Array.from(new Set(recents)).slice(0, 40),
                }
              : undefined,
            codeSession,
          }
        })
      : []
    const normalizedRemovedProjects = Array.isArray(parsed.removedProjects)
      ? parsed.removedProjects.map((project) => {
          const favorites = Array.isArray(project.codeFileDrawerState?.favorites)
            ? project.codeFileDrawerState.favorites
                .filter((item): item is string => typeof item === 'string')
                .map((item) => item.trim())
                .filter(Boolean)
            : []
          const recents = Array.isArray(project.codeFileDrawerState?.recents)
            ? project.codeFileDrawerState.recents
                .filter((item): item is string => typeof item === 'string')
                .map((item) => item.trim())
                .filter(Boolean)
            : []
          const hasDrawerState = favorites.length > 0 || recents.length > 0
          const codeSession = normalizeCodeSession(project.codeSession)
          return {
            ...project,
            cli: isCliTool(project.cli) ? project.cli : undefined,
            aiRuntimeProfileId: typeof project.aiRuntimeProfileId === 'string' && project.aiRuntimeProfileId.trim() ? project.aiRuntimeProfileId.trim() : undefined,
            removedAt: Number.isFinite(project.removedAt) ? Math.trunc(project.removedAt) : Date.now(),
            codeFileDrawerState: hasDrawerState
              ? {
                  favorites: Array.from(new Set(favorites)),
                  recents: Array.from(new Set(recents)).slice(0, 40),
                }
              : undefined,
            codeSession,
          }
        })
      : []
    cachedConfig = {
      ...DEFAULT_CONFIG,
      ...parsed,
      configVersion: CURRENT_CONFIG_SCHEMA_VERSION,
      projects: normalizedProjects,
      removedProjects: normalizedRemovedProjects,
      docLinkTags: normalizeDocLinkTags(parsed.docLinkTags),
      codexProviderApiKeys: normalizeCodexProviderApiKeys(parsed.codexProviderApiKeys, (parsed as { codexSettingsSnapshot?: unknown }).codexSettingsSnapshot),
      codexSettingsSnapshots: normalizeCodexSettingsSnapshots(parsed.codexSettingsSnapshots, (parsed as { codexSettingsSnapshot?: unknown }).codexSettingsSnapshot),
      codexGatewayBindings: normalizeCodexGatewayBindings(parsed.codexGatewayBindings),
      aiCommit: normalizeAiCommitConfig(parsed.aiCommit),
      agentHooks: normalizeAgentHookConfig(parsed.agentHooks),
      agentLogs: normalizeAgentLogsConfig(parsed.agentLogs),
      aiGateway: normalizeAiGatewayConfig(parsed.aiGateway),
      browserAi: normalizeBrowserAiConfig(parsed.browserAi),
      shortcutPreferences: normalizeShortcutPreferences(parsed.shortcutPreferences),
      cacheLocation: normalizeCacheLocationConfig(parsed.cacheLocation),
      codeFileExclusions: normalizeCodeFileExclusions(parsed.codeFileExclusions),
      ...normalizeFilePreviewLimits(parsed),
      aiEnvironment: normalizeAiEnvironmentConfig({
        ...DEFAULT_CONFIG,
        ...parsed,
      }),
      configRecovery,
    }
    cachedConfig.launchOnLogin = normalizeBooleanFlag(parsed.launchOnLogin, DEFAULT_CONFIG.launchOnLogin ?? false)
    cachedConfig.launchOnLoginDisplayMode = normalizeLaunchOnLoginDisplayMode(parsed.launchOnLoginDisplayMode)
    cachedConfig.closeWindowBehavior = normalizeCloseWindowBehavior(parsed.closeWindowBehavior)
    delete (cachedConfig as AppConfig & { codexSettingsSnapshot?: unknown }).codexSettingsSnapshot
    delete (cachedConfig as AppConfig & { filePreviewLimitMb?: unknown }).filePreviewLimitMb
    {
      const runtimeProfiles = normalizeAiRuntimeProfiles(parsed.aiRuntimeProfiles, parsed.activeAiRuntimeProfileId)
      cachedConfig.aiRuntimeProfiles = runtimeProfiles.profiles
      cachedConfig.activeAiRuntimeProfileId = runtimeProfiles.activeProfileId
    }
    {
      const runtimeProfiles = normalizeClaudeRuntimeProfiles(parsed.claudeRuntimeProfiles, parsed.activeClaudeRuntimeProfileId)
      cachedConfig.claudeRuntimeProfiles = runtimeProfiles.profiles
      cachedConfig.activeClaudeRuntimeProfileId = runtimeProfiles.activeProfileId
    }
    if (!cachedConfig.startupDefaultFilter && legacyStartupDefaultTagId) {
      cachedConfig.startupDefaultFilter = { type: 'tag', tagId: legacyStartupDefaultTagId }
    }
  } catch (error) {
    const backupPath = rawConfigText ? backupCorruptConfigSync(configPath, rawConfigText) : undefined
    configRecovery = existsSync(configPath)
      ? {
          recovered: true,
          reason: rawConfigText ? 'invalid-json' : 'read-failed',
          backupPath,
          occurredAt: Date.now(),
          message: error instanceof Error ? error.message : String(error),
        }
      : undefined
    const runtimeProfiles = normalizeAiRuntimeProfiles(DEFAULT_CONFIG.aiRuntimeProfiles, DEFAULT_CONFIG.activeAiRuntimeProfileId)
    cachedConfig = {
      ...DEFAULT_CONFIG,
      configVersion: CURRENT_CONFIG_SCHEMA_VERSION,
      docLinkTags: normalizeDocLinkTags(DEFAULT_CONFIG.docLinkTags),
      codexProviderApiKeys: normalizeCodexProviderApiKeys(DEFAULT_CONFIG.codexProviderApiKeys),
      codexSettingsSnapshots: normalizeCodexSettingsSnapshots(DEFAULT_CONFIG.codexSettingsSnapshots),
      codexGatewayBindings: normalizeCodexGatewayBindings(DEFAULT_CONFIG.codexGatewayBindings),
      aiCommit: normalizeAiCommitConfig(DEFAULT_CONFIG.aiCommit),
      aiRuntimeProfiles: runtimeProfiles.profiles,
      activeAiRuntimeProfileId: runtimeProfiles.activeProfileId,
      agentHooks: normalizeAgentHookConfig(DEFAULT_CONFIG.agentHooks),
      agentLogs: normalizeAgentLogsConfig(DEFAULT_CONFIG.agentLogs),
      aiGateway: normalizeAiGatewayConfig(DEFAULT_CONFIG.aiGateway),
      browserAi: normalizeBrowserAiConfig(DEFAULT_CONFIG.browserAi),
      shortcutPreferences: normalizeShortcutPreferences(DEFAULT_CONFIG.shortcutPreferences),
      cacheLocation: normalizeCacheLocationConfig(DEFAULT_CONFIG.cacheLocation),
      codeFileExclusions: normalizeCodeFileExclusions(DEFAULT_CONFIG.codeFileExclusions),
      ...normalizeFilePreviewLimits(DEFAULT_CONFIG),
      aiEnvironment: normalizeAiEnvironmentConfig(DEFAULT_CONFIG),
      configRecovery,
    }
  }
  return cachedConfig!
}

export function saveConfig(config: AppConfig): Promise<void> {
  cachedConfig = config
  const configPath = getConfigPath()
  const dir = dirname(configPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const { configRecovery: _configRecovery, ...persistedConfig } = config
  const serialized = JSON.stringify(
    {
      ...persistedConfig,
      configVersion: CURRENT_CONFIG_SCHEMA_VERSION,
    },
    null,
    2,
  )
  saveQueue = saveQueue
    .catch(() => undefined)
    .then(() => atomicWriteJson(configPath, serialized))
    .then(() => {
      if (cachedConfig === config) {
        cachedConfig = { ...config, configRecovery: undefined }
      }
    })
  return saveQueue
}

export async function updateConfig(partial: Partial<AppConfig>): Promise<AppConfig> {
  const current = loadConfig()
  const updated: AppConfig = {
    ...current,
    ...partial,
    codexProviderApiKeys: Object.prototype.hasOwnProperty.call(partial, 'codexProviderApiKeys') ? normalizeCodexProviderApiKeys(partial.codexProviderApiKeys) : current.codexProviderApiKeys,
    codexSettingsSnapshots: Object.prototype.hasOwnProperty.call(partial, 'codexSettingsSnapshots') ? normalizeCodexSettingsSnapshots(partial.codexSettingsSnapshots) : current.codexSettingsSnapshots,
    codexGatewayBindings: Object.prototype.hasOwnProperty.call(partial, 'codexGatewayBindings') ? normalizeCodexGatewayBindings(partial.codexGatewayBindings) : current.codexGatewayBindings,
    aiCommit: Object.prototype.hasOwnProperty.call(partial, 'aiCommit') ? normalizeAiCommitConfig(partial.aiCommit) : normalizeAiCommitConfig(current.aiCommit),
    agentHooks: Object.prototype.hasOwnProperty.call(partial, 'agentHooks') ? normalizeAgentHookConfig(partial.agentHooks) : current.agentHooks,
    agentLogs: Object.prototype.hasOwnProperty.call(partial, 'agentLogs') ? normalizeAgentLogsConfig(partial.agentLogs) : normalizeAgentLogsConfig(current.agentLogs),
    aiGateway: Object.prototype.hasOwnProperty.call(partial, 'aiGateway') ? normalizeAiGatewayConfig(partial.aiGateway) : normalizeAiGatewayConfig(current.aiGateway),
    browserAi: Object.prototype.hasOwnProperty.call(partial, 'browserAi') ? normalizeBrowserAiConfig(partial.browserAi) : normalizeBrowserAiConfig(current.browserAi),
    shortcutPreferences: Object.prototype.hasOwnProperty.call(partial, 'shortcutPreferences') ? normalizeShortcutPreferences(partial.shortcutPreferences) : normalizeShortcutPreferences(current.shortcutPreferences),
    floatingTerminals: Object.prototype.hasOwnProperty.call(partial, 'floatingTerminals') ? normalizeFloatingTerminals(partial.floatingTerminals) : current.floatingTerminals,
    cacheLocation: Object.prototype.hasOwnProperty.call(partial, 'cacheLocation') ? normalizeCacheLocationConfig(partial.cacheLocation) : normalizeCacheLocationConfig(current.cacheLocation),
    codeFileExclusions: Object.prototype.hasOwnProperty.call(partial, 'codeFileExclusions') ? normalizeCodeFileExclusions(partial.codeFileExclusions) : normalizeCodeFileExclusions(current.codeFileExclusions),
    codeTreeAutoLoadFileLimit: Object.prototype.hasOwnProperty.call(partial, 'codeTreeAutoLoadFileLimit') ? normalizeCodeTreeAutoLoadFileLimit(partial.codeTreeAutoLoadFileLimit) : normalizeCodeTreeAutoLoadFileLimit(current.codeTreeAutoLoadFileLimit),
    imagePreviewLimitMb: normalizePreviewLimitMb(Object.prototype.hasOwnProperty.call(partial, 'imagePreviewLimitMb') ? partial.imagePreviewLimitMb : current.imagePreviewLimitMb, DEFAULT_IMAGE_PREVIEW_LIMIT_MB),
    pdfPreviewLimitMb: normalizePreviewLimitMb(Object.prototype.hasOwnProperty.call(partial, 'pdfPreviewLimitMb') ? partial.pdfPreviewLimitMb : current.pdfPreviewLimitMb, DEFAULT_PDF_PREVIEW_LIMIT_MB),
    audioPreviewLimitMb: normalizePreviewLimitMb(Object.prototype.hasOwnProperty.call(partial, 'audioPreviewLimitMb') ? partial.audioPreviewLimitMb : current.audioPreviewLimitMb, DEFAULT_AUDIO_PREVIEW_LIMIT_MB),
    videoPreviewLimitMb: normalizePreviewLimitMb(Object.prototype.hasOwnProperty.call(partial, 'videoPreviewLimitMb') ? partial.videoPreviewLimitMb : current.videoPreviewLimitMb, DEFAULT_VIDEO_PREVIEW_LIMIT_MB),
  }
  updated.launchOnLogin = Object.prototype.hasOwnProperty.call(partial, 'launchOnLogin') ? normalizeBooleanFlag(partial.launchOnLogin, current.launchOnLogin ?? false) : (current.launchOnLogin ?? false)
  updated.launchOnLoginDisplayMode = Object.prototype.hasOwnProperty.call(partial, 'launchOnLoginDisplayMode') ? normalizeLaunchOnLoginDisplayMode(partial.launchOnLoginDisplayMode) : normalizeLaunchOnLoginDisplayMode(current.launchOnLoginDisplayMode)
  updated.closeWindowBehavior = Object.prototype.hasOwnProperty.call(partial, 'closeWindowBehavior') ? normalizeCloseWindowBehavior(partial.closeWindowBehavior) : normalizeCloseWindowBehavior(current.closeWindowBehavior)
  delete (updated as AppConfig & { codexSettingsSnapshot?: unknown }).codexSettingsSnapshot
  delete (updated as AppConfig & { filePreviewLimitMb?: unknown }).filePreviewLimitMb
  const runtimeProfiles = normalizeClaudeRuntimeProfiles(
    Object.prototype.hasOwnProperty.call(partial, 'claudeRuntimeProfiles') ? partial.claudeRuntimeProfiles : current.claudeRuntimeProfiles,
    Object.prototype.hasOwnProperty.call(partial, 'activeClaudeRuntimeProfileId') ? partial.activeClaudeRuntimeProfileId : current.activeClaudeRuntimeProfileId,
  )
  updated.claudeRuntimeProfiles = runtimeProfiles.profiles
  updated.activeClaudeRuntimeProfileId = runtimeProfiles.activeProfileId
  const aiRuntimeProfiles = normalizeAiRuntimeProfiles(
    Object.prototype.hasOwnProperty.call(partial, 'aiRuntimeProfiles') ? partial.aiRuntimeProfiles : current.aiRuntimeProfiles,
    Object.prototype.hasOwnProperty.call(partial, 'activeAiRuntimeProfileId') ? partial.activeAiRuntimeProfileId : current.activeAiRuntimeProfileId,
  )
  updated.aiRuntimeProfiles = aiRuntimeProfiles.profiles
  updated.activeAiRuntimeProfileId = aiRuntimeProfiles.activeProfileId
  updated.aiEnvironment = normalizeAiEnvironmentConfig(updated)
  await saveConfig(updated)
  return updated
}
