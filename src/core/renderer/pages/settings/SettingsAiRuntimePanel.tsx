import { AlertTriangle, ExternalLink, Pencil, Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  AiEnvironmentConfig,
  AiExecutionMode,
  AiGatewayConfig,
  Capability,
  ClaudeBashrcConfig,
  ClaudeRuntimeProfile,
} from '../../../shared/types'
import { shouldUseWslForRuntimeEntrypoint } from '../../../shared/runtimeEntrypoint'
import { ModalShell } from '../../components/ModalShell'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Select, type SelectOption } from '../../components/ui/select'
import { useI18n } from '../../i18n'
import {
  applyClaudeProfileGatewayBinding,
  getClaudeProfileDirectConfig,
  getClaudeProfileRuntimeConfig,
  withClaudeProfileModelRoutes,
} from '../../lib/claudeGatewayProfiles'

const DEEPSEEK_CLAUDE_CODE_DOC_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code'

type SettingsAiRuntimePanelProps = {
  capability: Capability | null
  mode?: AiExecutionMode
  aiEnvironment?: AiEnvironmentConfig
  profiles: ClaudeRuntimeProfile[]
  activeProfileId?: string
  onProfilesSave: (profiles: ClaudeRuntimeProfile[], activeProfileId: string) => Promise<void>
  embedded?: boolean
}

type RuntimeEnvField = {
  key: keyof ClaudeBashrcConfig
  label: string
  value: string
  placeholder: string
  type?: 'password'
  hint?: { __html: string }
}

type ClaudeModelFieldKey =
  | 'anthropicModel'
  | 'anthropicDefaultOpusModel'
  | 'anthropicDefaultSonnetModel'
  | 'anthropicDefaultHaikuModel'
  | 'claudeCodeSubagentModel'

type ClaudeModelEditMode = 'shared' | 'custom'

const CLAUDE_MODEL_FIELD_KEYS: ClaudeModelFieldKey[] = [
  'anthropicModel',
  'anthropicDefaultOpusModel',
  'anthropicDefaultSonnetModel',
  'anthropicDefaultHaikuModel',
  'claudeCodeSubagentModel',
]

function isClaudeModelFieldKey(key: keyof ClaudeBashrcConfig): key is ClaudeModelFieldKey {
  return CLAUDE_MODEL_FIELD_KEYS.includes(key as ClaudeModelFieldKey)
}

function getPrimaryClaudeModel(config: ClaudeBashrcConfig): string {
  return config.anthropicModel
    || config.anthropicDefaultSonnetModel
    || config.anthropicDefaultOpusModel
    || config.anthropicDefaultHaikuModel
    || config.claudeCodeSubagentModel
}

function areClaudeModelsUnified(config: ClaudeBashrcConfig): boolean {
  const primary = getPrimaryClaudeModel(config).trim()
  return CLAUDE_MODEL_FIELD_KEYS.every((key) => config[key].trim() === primary)
}

function withSharedClaudeModel(config: ClaudeBashrcConfig, model: string): ClaudeBashrcConfig {
  return {
    ...config,
    anthropicModel: model,
    anthropicDefaultOpusModel: model,
    anthropicDefaultSonnetModel: model,
    anthropicDefaultHaikuModel: model,
    claudeCodeSubagentModel: model,
  }
}

function cloneConfig(config: ClaudeBashrcConfig): ClaudeBashrcConfig {
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

function cloneProfile(profile: ClaudeRuntimeProfile): ClaudeRuntimeProfile {
  const gateway = profile.gateway
    ? {
      enabled: profile.gateway.enabled,
      providerId: profile.gateway.providerId,
      modelAlias: profile.gateway.modelAlias,
      upstreamModel: profile.gateway.upstreamModel,
    }
    : undefined

  return {
    ...profile,
    config: getClaudeProfileDirectConfig(profile),
    gateway,
  }
}

function createProfileId(): string {
  return `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function sanitizeProfileName(value: string, fallback: string): string {
  const trimmed = value.trim()
  return trimmed || fallback
}

function SettingsAiRuntimePanel({
  capability,
  mode,
  aiEnvironment,
  profiles,
  activeProfileId,
  onProfilesSave,
  embedded = false,
}: SettingsAiRuntimePanelProps) {
  const { t, tHtml } = useI18n()
  const [anthropicBaseUrl, setAnthropicBaseUrl] = useState('https://api.deepseek.com/anthropic')
  const [anthropicAuthToken, setAnthropicAuthToken] = useState('')
  const [anthropicModel, setAnthropicModel] = useState('deepseek-v4-pro[1m]')
  const [anthropicDefaultOpusModel, setAnthropicDefaultOpusModel] = useState('deepseek-v4-pro[1m]')
  const [anthropicDefaultSonnetModel, setAnthropicDefaultSonnetModel] = useState('deepseek-v4-pro[1m]')
  const [anthropicDefaultHaikuModel, setAnthropicDefaultHaikuModel] = useState('deepseek-v4-flash')
  const [claudeCodeSubagentModel, setClaudeCodeSubagentModel] = useState('deepseek-v4-flash')
  const [modelEditMode, setModelEditMode] = useState<ClaudeModelEditMode>('custom')
  const [sharedModel, setSharedModel] = useState('deepseek-v4-pro[1m]')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedHint, setSavedHint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [profileDrafts, setProfileDrafts] = useState<ClaudeRuntimeProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [profileNameDraft, setProfileNameDraft] = useState('')
  const [profileAction, setProfileAction] = useState<'create' | 'rename' | 'delete' | 'docs' | null>(null)
  const [deleteConfirmProfileId, setDeleteConfirmProfileId] = useState<string | null>(null)
  const [aiGatewayConfig, setAiGatewayConfig] = useState<AiGatewayConfig | null>(null)
  const [gatewayLoading, setGatewayLoading] = useState(false)

  const capabilityReady = capability !== null
  const isWindowsNativeMode = mode === 'windows-native'
  const usesWslShellScope = capability?.hostPlatform === 'windows' && (
    mode === 'windows-wsl'
    || (mode === 'custom-script' && shouldUseWslForRuntimeEntrypoint(aiEnvironment))
  )
  const supportsShellEnvConfig = Boolean(
    capability && (
      capability.hostPlatform === 'linux'
      || capability.hostPlatform === 'macos'
      || usesWslShellScope
    )
  )
  const supportsWindowsEnvConfig = isWindowsNativeMode && capability?.hostPlatform === 'windows'
  const isCustomScriptMode = mode === 'custom-script'
  const inputDisabled = !capabilityReady || !loaded || saving || (!supportsShellEnvConfig && !supportsWindowsEnvConfig)
  const shellConfigReadOnly = capabilityReady && !supportsShellEnvConfig && !supportsWindowsEnvConfig
  const showUnsupportedHostHint = shellConfigReadOnly && !isWindowsNativeMode
  const shellScopeLabel = supportsWindowsEnvConfig
    ? tHtml('settings.aiRuntime.shellScopeWindowsNative')
    : capability?.hostPlatform === 'windows'
      ? tHtml('settings.aiRuntime.shellScopeWsl')
      : tHtml('settings.aiRuntime.shellScopePosix')

  const activeProfile = useMemo(
    () => profileDrafts.find((profile) => profile.id === selectedProfileId) ?? profileDrafts[0] ?? null,
    [profileDrafts, selectedProfileId]
  )
  const profileGatewayEnabled = Boolean(activeProfile?.gateway?.enabled)
  const gatewayProviderOptions = useMemo<SelectOption[]>(() => (
    aiGatewayConfig?.providers
      .filter((provider) => provider.enabled)
      .map((provider) => ({ value: provider.id, label: provider.name || provider.id })) ?? []
  ), [aiGatewayConfig])
  const activeGatewayProviderId = activeProfile?.gateway?.providerId
    || aiGatewayConfig?.activeProviderId
    || gatewayProviderOptions[0]?.value
    || ''
  const activeGatewayProvider = aiGatewayConfig?.providers.find((provider) => provider.id === activeGatewayProviderId) ?? null
  const activeGatewayBaseUrl = aiGatewayConfig && activeProfile
    ? `http://${aiGatewayConfig.host}:${aiGatewayConfig.port}/profiles/${encodeURIComponent(activeProfile.id)}`
    : ''
  const deleteConfirmProfile = useMemo(
    () => profileDrafts.find((profile) => profile.id === deleteConfirmProfileId) ?? null,
    [deleteConfirmProfileId, profileDrafts]
  )

  const currentConfig = useMemo<ClaudeBashrcConfig>(() => ({
    anthropicBaseUrl,
    anthropicAuthToken,
    anthropicModel,
    anthropicDefaultOpusModel,
    anthropicDefaultSonnetModel,
    anthropicDefaultHaikuModel,
    claudeCodeSubagentModel,
  }), [
    anthropicAuthToken,
    anthropicBaseUrl,
    anthropicDefaultHaikuModel,
    anthropicDefaultOpusModel,
    anthropicDefaultSonnetModel,
    anthropicModel,
    claudeCodeSubagentModel,
  ])

  const activeProfileWithCurrentConfig = useMemo<ClaudeRuntimeProfile | null>(() => (
    activeProfile
      ? { ...activeProfile, config: cloneConfig(currentConfig) }
      : null
  ), [activeProfile, currentConfig])

  const runtimeConfig = useMemo<ClaudeBashrcConfig>(() => (
    activeProfileWithCurrentConfig?.gateway?.enabled && aiGatewayConfig
      ? getClaudeProfileRuntimeConfig(activeProfileWithCurrentConfig, aiGatewayConfig)
      : cloneConfig(currentConfig)
  ), [activeProfileWithCurrentConfig, aiGatewayConfig, currentConfig])

  const applyConfig = (
    result: ClaudeBashrcConfig,
    options: { inferModelMode?: boolean } = {}
  ) => {
    setAnthropicBaseUrl(result.anthropicBaseUrl)
    setAnthropicAuthToken(result.anthropicAuthToken)
    setAnthropicModel(result.anthropicModel)
    setAnthropicDefaultOpusModel(result.anthropicDefaultOpusModel)
    setAnthropicDefaultSonnetModel(result.anthropicDefaultSonnetModel)
    setAnthropicDefaultHaikuModel(result.anthropicDefaultHaikuModel)
    setClaudeCodeSubagentModel(result.claudeCodeSubagentModel)
    setSharedModel(getPrimaryClaudeModel(result))
    if (options.inferModelMode ?? true) {
      setModelEditMode(areClaudeModelsUnified(result) ? 'shared' : 'custom')
    }
  }

  useEffect(() => {
    const normalizedProfiles = profiles.length > 0
      ? profiles.map(cloneProfile)
      : [{
        id: 'default',
        name: 'DeepSeek Default',
        config: cloneConfig({
          anthropicBaseUrl: 'https://api.deepseek.com/anthropic',
          anthropicAuthToken: '',
          anthropicModel: 'deepseek-v4-pro[1m]',
          anthropicDefaultOpusModel: 'deepseek-v4-pro[1m]',
          anthropicDefaultSonnetModel: 'deepseek-v4-pro[1m]',
          anthropicDefaultHaikuModel: 'deepseek-v4-flash',
          claudeCodeSubagentModel: 'deepseek-v4-flash',
        }),
      }]
    const nextActiveProfileId = normalizedProfiles.some((profile) => profile.id === activeProfileId)
      ? activeProfileId as string
      : normalizedProfiles[0]!.id
    setProfileDrafts(normalizedProfiles)
    setSelectedProfileId(nextActiveProfileId)
    const nextActiveProfile = normalizedProfiles.find((profile) => profile.id === nextActiveProfileId) ?? normalizedProfiles[0]!
    setProfileNameDraft(nextActiveProfile.name)
    applyConfig(getClaudeProfileDirectConfig(nextActiveProfile))
    setLoaded(true)
  }, [activeProfileId, profiles])

  useEffect(() => {
    let mounted = true
    setGatewayLoading(true)
    void window.electronAPI.getAiGatewayConfig()
      .then((result) => {
        if (!mounted) return
        setAiGatewayConfig(result)
      })
      .catch(() => {
        if (!mounted) return
        setAiGatewayConfig(null)
      })
      .finally(() => {
        if (mounted) setGatewayLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    setSavedHint(null)
    setError(null)
    if (capabilityReady) setLoaded(true)
  }, [capabilityReady])

  useEffect(() => {
    if (!activeProfile) return
    setProfileNameDraft(activeProfile.name)
  }, [activeProfile])

  const envFields = useMemo<RuntimeEnvField[]>(() => ([
    {
      key: 'anthropicBaseUrl',
      label: 'ANTHROPIC_BASE_URL',
      value: anthropicBaseUrl,
      placeholder: 'https://api.deepseek.com/anthropic',
    },
    {
      key: 'anthropicAuthToken',
      label: 'ANTHROPIC_AUTH_TOKEN',
      value: anthropicAuthToken,
      placeholder: loaded ? 'sk-...' : (supportsWindowsEnvConfig ? 'Loading...' : 'Loading ~/.bashrc...'),
      type: 'password' as const,
      hint: tHtml(supportsWindowsEnvConfig ? 'settings.aiRuntime.tokenHintWindows' : 'settings.aiRuntime.tokenHint'),
    },
    {
      key: 'anthropicModel',
      label: 'ANTHROPIC_MODEL',
      value: anthropicModel,
      placeholder: 'deepseek-v4-pro[1m]',
    },
    {
      key: 'anthropicDefaultOpusModel',
      label: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
      value: anthropicDefaultOpusModel,
      placeholder: 'deepseek-v4-pro[1m]',
    },
    {
      key: 'anthropicDefaultSonnetModel',
      label: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
      value: anthropicDefaultSonnetModel,
      placeholder: 'deepseek-v4-pro[1m]',
    },
    {
      key: 'anthropicDefaultHaikuModel',
      label: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      value: anthropicDefaultHaikuModel,
      placeholder: 'deepseek-v4-flash',
    },
    {
      key: 'claudeCodeSubagentModel',
      label: 'CLAUDE_CODE_SUBAGENT_MODEL',
      value: claudeCodeSubagentModel,
      placeholder: 'deepseek-v4-flash',
    },
  ]), [
    anthropicAuthToken,
    anthropicBaseUrl,
    anthropicDefaultHaikuModel,
    anthropicDefaultOpusModel,
    anthropicDefaultSonnetModel,
    anthropicModel,
    claudeCodeSubagentModel,
    loaded,
    supportsWindowsEnvConfig,
    tHtml,
  ])

  const connectionFields = useMemo(
    () => envFields.filter((field) => !isClaudeModelFieldKey(field.key)),
    [envFields]
  )
  const modelFields = useMemo(
    () => envFields.filter((field) => isClaudeModelFieldKey(field.key)),
    [envFields]
  )

  const shellCommand = useMemo(() => ([
    `export ANTHROPIC_BASE_URL=${runtimeConfig.anthropicBaseUrl || 'https://api.deepseek.com/anthropic'}`,
    `export ANTHROPIC_AUTH_TOKEN=${runtimeConfig.anthropicAuthToken || '<YOUR_DEEPSEEK_API_KEY>'}`,
    `export ANTHROPIC_MODEL=${runtimeConfig.anthropicModel || 'deepseek-v4-pro[1m]'}`,
    `export ANTHROPIC_DEFAULT_OPUS_MODEL=${runtimeConfig.anthropicDefaultOpusModel || 'deepseek-v4-pro[1m]'}`,
    `export ANTHROPIC_DEFAULT_SONNET_MODEL=${runtimeConfig.anthropicDefaultSonnetModel || 'deepseek-v4-pro[1m]'}`,
    `export ANTHROPIC_DEFAULT_HAIKU_MODEL=${runtimeConfig.anthropicDefaultHaikuModel || 'deepseek-v4-flash'}`,
    `export CLAUDE_CODE_SUBAGENT_MODEL=${runtimeConfig.claudeCodeSubagentModel || 'deepseek-v4-flash'}`,
  ].join('\n')), [runtimeConfig])

  const launchCommand = useMemo(() => ([
    'cd /path/to/my-project',
    'claude',
  ].join('\n')), [])

  const updateActiveProfileDraft = (updater: (profile: ClaudeRuntimeProfile) => ClaudeRuntimeProfile) => {
    if (!activeProfile) return
    setProfileDrafts((current) => current.map((profile) => (
      profile.id === activeProfile.id ? updater(profile) : profile
    )))
  }

  const buildDirectConfigFromCurrent = (): ClaudeBashrcConfig => {
    return cloneConfig(currentConfig)
  }

  const updateCurrentConfigField = (key: keyof ClaudeBashrcConfig, value: string) => {
    const nextConfig: ClaudeBashrcConfig = {
      ...currentConfig,
      [key]: value,
    }
    applyConfig(nextConfig, { inferModelMode: false })
    updateActiveProfileDraft((profile) => ({
      ...profile,
      config: nextConfig,
    }))
  }

  const updateSharedModel = (value: string) => {
    const nextConfig = withSharedClaudeModel(currentConfig, value)
    applyConfig(nextConfig, { inferModelMode: false })
    setModelEditMode('shared')
    setSharedModel(value)
    updateActiveProfileDraft((profile) => ({
      ...profile,
      config: nextConfig,
    }))
  }

  const handleModelEditModeChange = (nextMode: ClaudeModelEditMode) => {
    setModelEditMode(nextMode)
    setSavedHint(null)
    setError(null)
    if (nextMode === 'shared') {
      updateSharedModel(sharedModel || getPrimaryClaudeModel(currentConfig))
    }
  }

  const buildRuntimeConfigForProfile = (profile: ClaudeRuntimeProfile): ClaudeBashrcConfig => {
    if (!profile.gateway?.enabled) return cloneConfig(profile.config)
    if (!aiGatewayConfig) throw new Error(t('settings.aiRuntime.gatewayConfigMissing'))
    return getClaudeProfileRuntimeConfig(profile, aiGatewayConfig)
  }

  const mergeSavedRuntimeConfigForProfile = (
    profile: ClaudeRuntimeProfile,
    savedRuntimeConfig: ClaudeBashrcConfig
  ): ClaudeBashrcConfig => (
    profile.gateway?.enabled
      ? {
        ...cloneConfig(savedRuntimeConfig),
        anthropicBaseUrl: profile.config.anthropicBaseUrl,
      }
      : cloneConfig(savedRuntimeConfig)
  )

  const persistGatewayRoutes = async (nextProfiles: ClaudeRuntimeProfile[], gatewayConfig = aiGatewayConfig) => {
    if (!gatewayConfig) return
    const result = await window.electronAPI.saveAiGatewayConfig(withClaudeProfileModelRoutes(gatewayConfig, nextProfiles))
    setAiGatewayConfig(result.config)
  }

  const updateActiveGatewayDraft = (partial: { enabled?: boolean; providerId?: string }) => {
    if (!activeProfile || !aiGatewayConfig) return
    setSavedHint(null)
    setError(null)
    updateActiveProfileDraft((profile) => applyClaudeProfileGatewayBinding(profile, aiGatewayConfig, {
      enabled: partial.enabled ?? profileGatewayEnabled,
      providerId: partial.providerId ?? activeGatewayProviderId,
      directConfig: buildDirectConfigFromCurrent(),
    }))
  }

  const handleSelectProfile = (profileId: string) => {
    const nextProfile = profileDrafts.find((profile) => profile.id === profileId)
    if (!nextProfile) {
      setSelectedProfileId(profileId)
      return
    }

    setSavedHint(null)
    setError(null)
    setSelectedProfileId(profileId)
    setProfileNameDraft(nextProfile.name)
    applyConfig(getClaudeProfileDirectConfig(nextProfile))
  }

  const handleCreateProfile = async () => {
    setProfileAction('create')
    const nextProfileName = t('settings.aiRuntime.newProfileName', { value: profileDrafts.length + 1 })
    const nextProfile: ClaudeRuntimeProfile = {
      id: createProfileId(),
      name: nextProfileName,
      config: cloneConfig(currentConfig),
    }
    const nextProfiles = [...profileDrafts, nextProfile]
    setProfileDrafts(nextProfiles)
    setSelectedProfileId(nextProfile.id)
    setProfileNameDraft(nextProfile.name)
    setSavedHint(null)
    setError(null)
    applyConfig(getClaudeProfileDirectConfig(nextProfile))
    setProfileAction(null)
  }

  const handleDeleteProfile = async () => {
    if (profileDrafts.length <= 1 || !deleteConfirmProfile) return
    setProfileAction('delete')
    const nextProfiles = profileDrafts.filter((profile) => profile.id !== deleteConfirmProfile.id)
    const nextActiveProfileId = nextProfiles[0]!.id
    const nextActiveProfile = nextProfiles[0]!
    setProfileDrafts(nextProfiles)
    setSelectedProfileId(nextActiveProfileId)
    setProfileNameDraft(nextActiveProfile.name)
    applyConfig(getClaudeProfileDirectConfig(nextActiveProfile))
    setSavedHint(null)
    setError(null)
    setDeleteConfirmProfileId(null)
    setProfileAction(null)
  }

  const handleRenameProfile = async () => {
    if (!activeProfile) return
    setProfileAction('rename')
    const nextName = sanitizeProfileName(profileNameDraft, activeProfile.name)
    const nextProfiles = profileDrafts.map((profile) => (
      profile.id === activeProfile.id ? { ...profile, name: nextName } : profile
    ))
    setProfileDrafts(nextProfiles)
    setProfileNameDraft(nextName)
    setSavedHint(null)
    setError(null)
    setProfileAction(null)
  }

  const handleSaveCurrentIntoProfile = async () => {
    if (!activeProfile) return
    setSaving(true)
    setSavedHint(null)
    setError(null)
    try {
      const directPayload = {
        anthropicBaseUrl: anthropicBaseUrl.trim(),
        anthropicAuthToken: anthropicAuthToken.trim(),
        anthropicModel: anthropicModel.trim(),
        anthropicDefaultOpusModel: anthropicDefaultOpusModel.trim(),
        anthropicDefaultSonnetModel: anthropicDefaultSonnetModel.trim(),
        anthropicDefaultHaikuModel: anthropicDefaultHaikuModel.trim(),
        claudeCodeSubagentModel: claudeCodeSubagentModel.trim(),
      }
      const directConfig = directPayload
      if (profileGatewayEnabled && !aiGatewayConfig) {
        throw new Error(t('settings.aiRuntime.gatewayConfigMissing'))
      }
      const nextProfile = profileGatewayEnabled && aiGatewayConfig
        ? applyClaudeProfileGatewayBinding(activeProfile, aiGatewayConfig, {
          enabled: true,
          providerId: activeGatewayProviderId,
          directConfig,
        })
        : {
          ...activeProfile,
          config: cloneConfig(directConfig),
          gateway: activeProfile.gateway?.enabled
            ? { ...activeProfile.gateway, enabled: false }
            : activeProfile.gateway,
        }
      const saveApi = supportsWindowsEnvConfig
        ? window.electronAPI.setWindowsUserEnv
        : window.electronAPI.setClaudeBashrcConfig
      const savedRuntimeConfig = await saveApi(buildRuntimeConfigForProfile(nextProfile))
      const savedProfileConfig = mergeSavedRuntimeConfigForProfile(nextProfile, savedRuntimeConfig)
      applyConfig(savedProfileConfig)
      const nextProfiles = profileDrafts.map((profile) => (
        profile.id === activeProfile.id
          ? {
            ...nextProfile,
            name: sanitizeProfileName(profileNameDraft, profile.name),
            config: savedProfileConfig,
          }
          : profile
      )).map((profile, index) => ({
        ...profile,
        name: sanitizeProfileName(profile.name, t('settings.aiRuntime.newProfileName', { value: index + 1 })),
      }))
      setProfileDrafts(nextProfiles)
      await onProfilesSave(nextProfiles, activeProfile.id)
      await persistGatewayRoutes(nextProfiles)
      setSavedHint(t(supportsWindowsEnvConfig ? 'settings.aiRuntime.savedHintWindows' : 'settings.aiRuntime.savedHint'))
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError)
      setError(message || t('settings.aiRuntime.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const handleOpenDocs = async () => {
    setProfileAction('docs')
    try {
      await window.electronAPI.openExternal(DEEPSEEK_CLAUDE_CODE_DOC_URL)
    } finally {
      setProfileAction(null)
    }
  }

  return (
    <div className="space-y-8">
      {!embedded && (
        <div>
          <p className="section-label mb-3">{t('settings.aiRuntime.kicker')}</p>
          <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">
            {t('settings.aiRuntime.title')}
          </h2>
          <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2 mb-6">
            {t('settings.aiRuntime.description')}
          </p>
          <div className="mb-6 rounded-[18px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/45 px-4 py-3 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
            <p>{t('settings.aiRuntime.runtimeModelSummary')}</p>
            <p className="mt-2">{t('settings.aiRuntime.runtimeModelShell')}</p>
            <p className="mt-2" dangerouslySetInnerHTML={tHtml('settings.aiRuntime.runtimeModelClaude')} />
            {isCustomScriptMode && (
              <p className="mt-2" dangerouslySetInnerHTML={tHtml('settings.aiRuntime.customScriptHint')} />
            )}
            {showUnsupportedHostHint && (
              <p className="mt-2 text-[color:var(--color-destructive)]">{t('settings.aiRuntime.unsupportedHostHint')}</p>
            )}
          </div>
          <Button
            variant="outline"
            className="h-10 rounded-full px-4 text-sm"
            onClick={() => void handleOpenDocs()}
            loading={profileAction === 'docs'}
          >
            <ExternalLink className="h-4 w-4" />
            {t('settings.aiRuntime.openDocs')}
          </Button>
        </div>
      )}

      {embedded && (
        <div className="rounded-[18px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/45 px-4 py-3 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
          <p>{t('settings.aiRuntime.runtimeModelSummary')}</p>
          <p className="mt-2">{t('settings.aiRuntime.runtimeModelShell')}</p>
          <p className="mt-2" dangerouslySetInnerHTML={tHtml('settings.aiRuntime.runtimeModelClaude')} />
          {isCustomScriptMode && (
            <p className="mt-2" dangerouslySetInnerHTML={tHtml('settings.aiRuntime.customScriptHint')} />
          )}
          {showUnsupportedHostHint && (
            <p className="mt-2 text-[color:var(--color-destructive)]">{t('settings.aiRuntime.unsupportedHostHint')}</p>
          )}
          <Button
            variant="outline"
            className="mt-4 h-10 rounded-full px-4 text-sm"
            onClick={() => void handleOpenDocs()}
            loading={profileAction === 'docs'}
          >
            <ExternalLink className="h-4 w-4" />
            {t('settings.aiRuntime.openDocs')}
          </Button>
        </div>
      )}

      <div className="rounded-[28px] border px-6 py-6 surface-card space-y-5" style={{ borderColor: 'var(--color-border)' }}>
        <div className="space-y-4">
          <div>
            <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">
              {t('settings.aiRuntime.profileTitle')}
            </h3>
            <p className="mt-2 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
              {t('settings.aiRuntime.profileDescription')}
            </p>
          </div>

          <div className="quiet-control inline-flex flex-wrap rounded-full p-1 gap-0.5">
            {profileDrafts.map((profile) => (
              <button
                key={profile.id}
                onClick={() => handleSelectProfile(profile.id)}
                disabled={saving}
                className={`button-interactive flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all disabled:opacity-50 ${
                  selectedProfileId === profile.id
                    ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm'
                    : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
                }`}
                aria-current={selectedProfileId === profile.id ? 'page' : undefined}
              >
                {profile.name}
              </button>
            ))}
            <button
              onClick={() => void handleCreateProfile()}
              disabled={saving}
              className="button-interactive flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium text-[color:var(--color-muted-foreground)] transition-all hover:text-[color:var(--color-foreground)] disabled:opacity-50"
              aria-busy={profileAction === 'create' || undefined}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t('settings.aiRuntime.addProfile')}
            </button>
          </div>

          {activeProfile && (
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
              <Input
                value={profileNameDraft}
                onChange={(event) => {
                  const nextName = event.target.value
                  setProfileNameDraft(nextName)
                  updateActiveProfileDraft((profile) => ({
                    ...profile,
                    name: nextName,
                  }))
                }}
                className="quiet-control h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]"
                placeholder={t('settings.aiRuntime.profileNamePlaceholder')}
                disabled={saving}
              />
              <Button
                variant="outline"
                className="h-11 rounded-full px-4 text-sm"
                onClick={() => void handleRenameProfile()}
                disabled={saving}
                loading={profileAction === 'rename'}
              >
                <Pencil className="h-4 w-4" />
                {t('settings.aiRuntime.renameProfile')}
              </Button>
              <Button
                variant="outline"
                className="h-11 rounded-full px-4 text-sm text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-background)]"
                onClick={() => setDeleteConfirmProfileId(activeProfile.id)}
                disabled={saving || profileDrafts.length <= 1}
                loading={profileAction === 'delete'}
              >
                <Trash2 className="h-4 w-4" />
                {t('settings.aiRuntime.deleteProfile')}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-[28px] border px-6 py-6 surface-card space-y-5" style={{ borderColor: 'var(--color-border)' }}>
        <div>
          <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">
            {t('settings.aiRuntime.shellTitle')}
          </h3>
          <p className="mt-2 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
            {t('settings.aiRuntime.shellDescription')}
          </p>
          {capabilityReady && (
            <p className="mt-2 text-xs leading-5 text-[color:var(--color-muted-foreground)]" dangerouslySetInnerHTML={shellScopeLabel} />
          )}
          <p className="mt-2 text-xs leading-5 text-[color:var(--color-muted-foreground)]">
            {t('settings.aiRuntime.restartHint')}
          </p>
        </div>

        <div className="rounded-[20px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/45 px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('settings.aiRuntime.gatewayTitle')}</h4>
              <p className="mt-1 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('settings.aiRuntime.gatewayDescription')}</p>
            </div>
            <label className="quiet-control flex h-10 items-center gap-2 rounded-full px-4 text-sm text-[color:var(--color-foreground)]">
              <input
                type="checkbox"
                checked={profileGatewayEnabled}
                onChange={(event) => updateActiveGatewayDraft({ enabled: event.target.checked })}
                disabled={inputDisabled || gatewayLoading || !aiGatewayConfig || !activeProfile}
              />
              {t('settings.aiRuntime.gatewayUseProfile')}
            </label>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiRuntime.gatewayProvider')}</p>
              <Select
                ariaLabel={t('settings.aiRuntime.gatewayProvider')}
                value={activeGatewayProviderId}
                options={gatewayProviderOptions}
                onChange={(value) => updateActiveGatewayDraft({ enabled: profileGatewayEnabled, providerId: value })}
                disabled={inputDisabled || gatewayLoading || !aiGatewayConfig || gatewayProviderOptions.length === 0 || !activeProfile}
                triggerClassName="h-11"
              />
              {activeGatewayProvider?.baseUrl && (
                <p className="text-[11px] leading-5 text-[color:var(--color-muted-foreground)]">
                  {t('settings.aiGateway.providerBaseUrl')}: {activeGatewayProvider.baseUrl}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiRuntime.gatewayBaseUrl')}</p>
              <div className="quiet-control min-h-11 rounded-[18px] px-4 py-3 font-mono text-xs leading-5 text-[color:var(--color-muted-foreground)] break-all">
                {activeGatewayBaseUrl || t(profileGatewayEnabled
                  ? 'settings.aiRuntime.notAvailable'
                  : 'settings.aiRuntime.gatewayUnavailable')}
              </div>
            </div>
          </div>

          <p className="mt-3 text-xs leading-5 text-[color:var(--color-muted-foreground)]">
            {profileGatewayEnabled
              ? t('settings.aiRuntime.gatewayEnabledDetail')
              : t('settings.aiRuntime.gatewayDisabledDetail')}
          </p>
          {!aiGatewayConfig && (
            <p className="mt-2 text-xs text-[color:var(--color-destructive)]">{t('settings.aiRuntime.gatewayConfigMissing')}</p>
          )}
        </div>

        {connectionFields.map((field) => (
          <div key={field.label} className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{field.label}</p>
            <Input
              type={field.type}
              value={field.value}
              onChange={(event) => updateCurrentConfigField(field.key, event.target.value)}
              className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]"
              placeholder={field.placeholder}
              disabled={inputDisabled}
            />
            {field.hint && (
              <p className="text-[11px] text-[color:var(--color-muted-foreground)]" dangerouslySetInnerHTML={field.hint} />
            )}
          </div>
        ))}

        <div className="rounded-[20px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/35 px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('settings.aiRuntime.modelModeTitle')}</h4>
              <p className="mt-1 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('settings.aiRuntime.modelModeDescription')}</p>
            </div>
            <div className="quiet-control inline-flex rounded-full p-1">
              {(['shared', 'custom'] as const).map((modeValue) => (
                <button
                  key={modeValue}
                  type="button"
                  onClick={() => handleModelEditModeChange(modeValue)}
                  disabled={inputDisabled}
                  className={`button-interactive rounded-full px-3.5 py-1.5 text-xs font-medium transition-all disabled:opacity-50 ${
                    modelEditMode === modeValue
                      ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm'
                      : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
                  }`}
                >
                  {modeValue === 'shared'
                    ? t('settings.aiRuntime.modelModeShared')
                    : t('settings.aiRuntime.modelModeCustom')}
                </button>
              ))}
            </div>
          </div>

          {modelEditMode === 'shared' ? (
            <div className="mt-4 space-y-1.5">
              <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiRuntime.sharedModel')}</p>
              <Input
                value={sharedModel}
                onChange={(event) => updateSharedModel(event.target.value)}
                className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]"
                placeholder="deepseek-v4-pro[1m]"
                disabled={inputDisabled}
              />
              <p className="text-[11px] leading-5 text-[color:var(--color-muted-foreground)]">
                {t('settings.aiRuntime.sharedModelHint')}
              </p>
            </div>
          ) : (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {modelFields.map((field) => (
                <div key={field.label} className="space-y-1.5">
                  <p className="text-xs text-[color:var(--color-muted-foreground)]">{field.label}</p>
                  <Input
                    value={field.value}
                    onChange={(event) => updateCurrentConfigField(field.key, event.target.value)}
                    className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]"
                    placeholder={field.placeholder}
                    disabled={inputDisabled}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {supportsWindowsEnvConfig && (
          <div className="rounded-[18px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/45 px-4 py-3">
            <p className="text-xs leading-5 text-[color:var(--color-muted-foreground)]" dangerouslySetInnerHTML={tHtml('settings.aiRuntime.effortLevelNotice')} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            className="h-10 rounded-full px-5 text-sm disabled:opacity-60"
            disabled={inputDisabled || !activeProfile}
            onClick={() => void handleSaveCurrentIntoProfile()}
          >
            <Save className="h-4 w-4" />
            {saving ? t('common.saving') : t(supportsWindowsEnvConfig ? 'settings.aiRuntime.saveWindows' : 'settings.aiRuntime.save')}
          </Button>
        </div>
        {shellConfigReadOnly && (
          <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiRuntime.shellReadOnlyHint')}</p>
        )}
        {savedHint && (
          <p className="text-xs text-[color:var(--color-muted-foreground)]">{savedHint}</p>
        )}
        {error && (
          <p className="text-xs text-[color:var(--color-destructive)]">{error}</p>
        )}
      </div>

      <div className="rounded-[28px] border px-6 py-6 surface-card space-y-5" style={{ borderColor: 'var(--color-border)' }}>
        <div>
          <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">
            {t('settings.aiRuntime.claudeTitle')}
          </h3>
          <p className="mt-2 text-sm leading-6 text-[color:var(--color-muted-foreground)]" dangerouslySetInnerHTML={tHtml('settings.aiRuntime.claudeDescription')} />
        </div>

        <div className="space-y-2">
          <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiRuntime.shellCommandLabel')}</p>
          <pre className="max-h-[320px] overflow-auto rounded-[16px] bg-[color:var(--color-card)] p-4 font-mono text-xs leading-5 text-[color:var(--color-foreground)] whitespace-pre-wrap">
            {shellCommand}
          </pre>
        </div>

        <div className="space-y-2">
          <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiRuntime.launchCommandLabel')}</p>
          <pre className="rounded-[16px] bg-[color:var(--color-card)] p-4 font-mono text-xs leading-5 text-[color:var(--color-foreground)] whitespace-pre-wrap">
            {launchCommand}
          </pre>
        </div>
      </div>

      <ModalShell
        open={Boolean(deleteConfirmProfile)}
        onClose={() => {
          if (profileAction === 'delete') return
          setDeleteConfirmProfileId(null)
        }}
        widthClassName="max-w-[560px]"
        ariaLabel={t('settings.aiRuntime.deleteConfirmLabel')}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div
              className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
              style={{
                background: 'var(--color-destructive-background)',
                color: 'var(--color-destructive)',
              }}
            >
              <AlertTriangle className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">
                {t('settings.aiRuntime.deleteConfirmTitle')}
              </h3>
              <p className="mt-1 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
                {t('settings.aiRuntime.deleteConfirmHint', {
                  value: deleteConfirmProfile?.name ?? '',
                })}
              </p>
            </div>
          </div>

          <div
            className="rounded-[18px] border px-4 py-3"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <p className="text-sm text-[color:var(--color-foreground)]">
              {deleteConfirmProfile?.name}
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-10 px-4"
              onClick={() => setDeleteConfirmProfileId(null)}
              disabled={profileAction === 'delete'}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-10 px-4"
              onClick={() => void handleDeleteProfile()}
              disabled={profileAction === 'delete' || !deleteConfirmProfile}
            >
              {t('common.delete')}
            </Button>
          </div>
        </div>
      </ModalShell>
    </div>
  )
}

export { SettingsAiRuntimePanel }
