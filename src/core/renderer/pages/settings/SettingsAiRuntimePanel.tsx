import { AlertTriangle, ExternalLink, Loader2, Pencil, Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  AiExecutionMode,
  Capability,
  ClaudeBashrcConfig,
  ClaudeRuntimeProfile,
} from '../../../shared/types'
import { ModalShell } from '../../components/ModalShell'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { useI18n } from '../../i18n'

const DEEPSEEK_CLAUDE_CODE_DOC_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code'

type SettingsAiRuntimePanelProps = {
  capability: Capability | null
  mode?: AiExecutionMode
  profiles: ClaudeRuntimeProfile[]
  activeProfileId?: string
  onProfilesSave: (profiles: ClaudeRuntimeProfile[], activeProfileId: string) => Promise<void>
  embedded?: boolean
}

type RuntimeEnvField = {
  key: keyof ClaudeBashrcConfig
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  type?: 'password'
  hint?: { __html: string }
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
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedHint, setSavedHint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [profileDrafts, setProfileDrafts] = useState<ClaudeRuntimeProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [profileNameDraft, setProfileNameDraft] = useState('')
  const [profileAction, setProfileAction] = useState<'select' | 'create' | 'rename' | 'delete' | 'docs' | null>(null)
  const [pendingProfileId, setPendingProfileId] = useState<string | null>(null)
  const [deleteConfirmProfileId, setDeleteConfirmProfileId] = useState<string | null>(null)

  const capabilityReady = capability !== null
  const isWindowsNativeMode = mode === 'windows-native'
  const supportsShellEnvConfig = Boolean(
    capability && (
      capability.hostPlatform === 'linux'
      || capability.hostPlatform === 'macos'
      || (capability.hostPlatform === 'windows' && capability.hasWsl)
      || mode === 'custom-script'
    )
  )
  const supportsWindowsEnvConfig = isWindowsNativeMode && capability?.hostPlatform === 'windows'
  const isCustomScriptMode = mode === 'custom-script'
  const inputDisabled = !capabilityReady || !loaded || saving || (!supportsShellEnvConfig && !supportsWindowsEnvConfig)
  const shellConfigReadOnly = capabilityReady && !supportsShellEnvConfig && !supportsWindowsEnvConfig
  const shellScopeLabel = supportsWindowsEnvConfig
    ? tHtml('settings.aiRuntime.shellScopeWindowsNative')
    : capability?.hostPlatform === 'windows'
      ? tHtml('settings.aiRuntime.shellScopeWsl')
      : tHtml('settings.aiRuntime.shellScopePosix')

  const activeProfile = useMemo(
    () => profileDrafts.find((profile) => profile.id === selectedProfileId) ?? profileDrafts[0] ?? null,
    [profileDrafts, selectedProfileId]
  )
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

  const applyConfig = (result: ClaudeBashrcConfig) => {
    setAnthropicBaseUrl(result.anthropicBaseUrl)
    setAnthropicAuthToken(result.anthropicAuthToken)
    setAnthropicModel(result.anthropicModel)
    setAnthropicDefaultOpusModel(result.anthropicDefaultOpusModel)
    setAnthropicDefaultSonnetModel(result.anthropicDefaultSonnetModel)
    setAnthropicDefaultHaikuModel(result.anthropicDefaultHaikuModel)
    setClaudeCodeSubagentModel(result.claudeCodeSubagentModel)
  }

  useEffect(() => {
    const normalizedProfiles = profiles.length > 0
      ? profiles.map((profile) => ({ ...profile, config: cloneConfig(profile.config) }))
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
    setProfileNameDraft(normalizedProfiles.find((profile) => profile.id === nextActiveProfileId)?.name ?? '')
  }, [activeProfileId, profiles])

  useEffect(() => {
    if (!activeProfile || !supportsWindowsEnvConfig) return
    applyConfig(activeProfile.config)
    setLoaded(true)
  }, [activeProfile, supportsWindowsEnvConfig])

  useEffect(() => {
    let mounted = true
    setLoaded(false)
    setSavedHint(null)
    setError(null)

    if (!capabilityReady) {
      return () => {
        mounted = false
      }
    }

    if (!supportsShellEnvConfig && !supportsWindowsEnvConfig) {
      setLoaded(true)
      return () => {
        mounted = false
      }
    }

    if (supportsWindowsEnvConfig) {
      setLoaded(true)
      return () => {
        mounted = false
      }
    }

    void window.electronAPI.getClaudeBashrcConfig()
      .then((result: ClaudeBashrcConfig) => {
        if (!mounted) return
        applyConfig(result)
        setLoaded(true)
      })
      .catch((loadError) => {
        if (!mounted) return
        const message = loadError instanceof Error ? loadError.message : String(loadError)
        setError(message || t('settings.aiRuntime.loadError'))
        setLoaded(true)
      })

    return () => {
      mounted = false
    }
  }, [capabilityReady, supportsShellEnvConfig, supportsWindowsEnvConfig, t])

  useEffect(() => {
    if (!activeProfile) return
    setProfileNameDraft(activeProfile.name)
  }, [activeProfile])

  const envFields = useMemo<RuntimeEnvField[]>(() => ([
    {
      key: 'anthropicBaseUrl',
      label: 'ANTHROPIC_BASE_URL',
      value: anthropicBaseUrl,
      onChange: setAnthropicBaseUrl,
      placeholder: 'https://api.deepseek.com/anthropic',
    },
    {
      key: 'anthropicAuthToken',
      label: 'ANTHROPIC_AUTH_TOKEN',
      value: anthropicAuthToken,
      onChange: setAnthropicAuthToken,
      placeholder: loaded ? 'sk-...' : (supportsWindowsEnvConfig ? 'Loading...' : 'Loading ~/.bashrc...'),
      type: 'password' as const,
      hint: tHtml(supportsWindowsEnvConfig ? 'settings.aiRuntime.tokenHintWindows' : 'settings.aiRuntime.tokenHint'),
    },
    {
      key: 'anthropicModel',
      label: 'ANTHROPIC_MODEL',
      value: anthropicModel,
      onChange: setAnthropicModel,
      placeholder: 'deepseek-v4-pro[1m]',
    },
    {
      key: 'anthropicDefaultOpusModel',
      label: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
      value: anthropicDefaultOpusModel,
      onChange: setAnthropicDefaultOpusModel,
      placeholder: 'deepseek-v4-pro[1m]',
    },
    {
      key: 'anthropicDefaultSonnetModel',
      label: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
      value: anthropicDefaultSonnetModel,
      onChange: setAnthropicDefaultSonnetModel,
      placeholder: 'deepseek-v4-pro[1m]',
    },
    {
      key: 'anthropicDefaultHaikuModel',
      label: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      value: anthropicDefaultHaikuModel,
      onChange: setAnthropicDefaultHaikuModel,
      placeholder: 'deepseek-v4-flash',
    },
    {
      key: 'claudeCodeSubagentModel',
      label: 'CLAUDE_CODE_SUBAGENT_MODEL',
      value: claudeCodeSubagentModel,
      onChange: setClaudeCodeSubagentModel,
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
    t,
  ])

  const shellCommand = useMemo(() => ([
    `export ANTHROPIC_BASE_URL=${anthropicBaseUrl || 'https://api.deepseek.com/anthropic'}`,
    `export ANTHROPIC_AUTH_TOKEN=${anthropicAuthToken || '<YOUR_DEEPSEEK_API_KEY>'}`,
    `export ANTHROPIC_MODEL=${anthropicModel || 'deepseek-v4-pro[1m]'}`,
    `export ANTHROPIC_DEFAULT_OPUS_MODEL=${anthropicDefaultOpusModel || 'deepseek-v4-pro[1m]'}`,
    `export ANTHROPIC_DEFAULT_SONNET_MODEL=${anthropicDefaultSonnetModel || 'deepseek-v4-pro[1m]'}`,
    `export ANTHROPIC_DEFAULT_HAIKU_MODEL=${anthropicDefaultHaikuModel || 'deepseek-v4-flash'}`,
    `export CLAUDE_CODE_SUBAGENT_MODEL=${claudeCodeSubagentModel || 'deepseek-v4-flash'}`,
  ].join('\n')), [
    anthropicBaseUrl,
    anthropicAuthToken,
    anthropicModel,
    anthropicDefaultOpusModel,
    anthropicDefaultSonnetModel,
    anthropicDefaultHaikuModel,
    claudeCodeSubagentModel,
  ])

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

  const handleSelectProfile = async (profileId: string) => {
    const nextProfile = profileDrafts.find((profile) => profile.id === profileId)
    if (!nextProfile || (!supportsShellEnvConfig && !supportsWindowsEnvConfig)) {
      setSelectedProfileId(profileId)
      return
    }

    setProfileAction('select')
    setPendingProfileId(profileId)
    setSaving(true)
    setSavedHint(null)
    setError(null)
    try {
      const saveApi = supportsWindowsEnvConfig
        ? window.electronAPI.setWindowsUserEnv
        : window.electronAPI.setClaudeBashrcConfig
      const saved = await saveApi(nextProfile.config)
      applyConfig(saved)
      const nextProfiles = profileDrafts.map((profile) => (
        profile.id === nextProfile.id
          ? { ...profile, config: cloneConfig(saved) }
          : profile
      ))
      setProfileDrafts(nextProfiles)
      setSelectedProfileId(profileId)
      await onProfilesSave(nextProfiles, profileId)
      setSavedHint(t('settings.aiRuntime.profileSwitchedHint', { value: nextProfile.name }))
    } catch (switchError) {
      const message = switchError instanceof Error ? switchError.message : String(switchError)
      setError(message || t('settings.aiRuntime.saveError'))
    } finally {
      setSaving(false)
      setProfileAction(null)
      setPendingProfileId(null)
    }
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
    try {
      await onProfilesSave(nextProfiles, nextProfile.id)
    } finally {
      setProfileAction(null)
    }
  }

  const handleDeleteProfile = async () => {
    if (profileDrafts.length <= 1 || !deleteConfirmProfile) return
    setProfileAction('delete')
    const nextProfiles = profileDrafts.filter((profile) => profile.id !== deleteConfirmProfile.id)
    const nextActiveProfileId = nextProfiles[0]!.id
    setProfileDrafts(nextProfiles)
    setSelectedProfileId(nextActiveProfileId)
    setSavedHint(null)
    setError(null)
    try {
      await onProfilesSave(nextProfiles, nextActiveProfileId)
      setDeleteConfirmProfileId(null)
    } finally {
      setProfileAction(null)
    }
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
    try {
      await onProfilesSave(nextProfiles, selectedProfileId)
    } finally {
      setProfileAction(null)
    }
  }

  const handleSaveCurrentIntoProfile = async () => {
    if (!activeProfile) return
    setSaving(true)
    setSavedHint(null)
    setError(null)
    try {
      const payload = {
        anthropicBaseUrl: anthropicBaseUrl.trim(),
        anthropicAuthToken: anthropicAuthToken.trim(),
        anthropicModel: anthropicModel.trim(),
        anthropicDefaultOpusModel: anthropicDefaultOpusModel.trim(),
        anthropicDefaultSonnetModel: anthropicDefaultSonnetModel.trim(),
        anthropicDefaultHaikuModel: anthropicDefaultHaikuModel.trim(),
        claudeCodeSubagentModel: claudeCodeSubagentModel.trim(),
      }
      const saveApi = supportsWindowsEnvConfig
        ? window.electronAPI.setWindowsUserEnv
        : window.electronAPI.setClaudeBashrcConfig
      const saved = await saveApi(payload)
      applyConfig(saved)
      const nextProfiles = profileDrafts.map((profile) => (
        profile.id === activeProfile.id
          ? { ...profile, name: sanitizeProfileName(profileNameDraft, profile.name), config: cloneConfig(saved) }
          : profile
      ))
      setProfileDrafts(nextProfiles)
      await onProfilesSave(nextProfiles, activeProfile.id)
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
            {capabilityReady && !supportsShellEnvConfig && (
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
          {capabilityReady && !supportsShellEnvConfig && (
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
                onClick={() => void handleSelectProfile(profile.id)}
                disabled={saving}
                className={`button-interactive flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all disabled:opacity-50 ${
                  selectedProfileId === profile.id
                    ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm'
                    : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
                }`}
                aria-busy={profileAction === 'select' && pendingProfileId === profile.id || undefined}
              >
                {profileAction === 'select' && pendingProfileId === profile.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
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
                onChange={(event) => setProfileNameDraft(event.target.value)}
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

        {envFields.map((field) => (
          <div key={field.label} className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{field.label}</p>
            <Input
              type={field.type}
              value={field.value}
              onChange={(event) => {
                field.onChange(event.target.value)
                updateActiveProfileDraft((profile) => ({
                  ...profile,
                  config: {
                    ...profile.config,
                    [field.key]: event.target.value,
                  },
                }))
              }}
              className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]"
              placeholder={field.placeholder}
              disabled={inputDisabled}
            />
            {field.hint && (
              <p className="text-[11px] text-[color:var(--color-muted-foreground)]" dangerouslySetInnerHTML={field.hint} />
            )}
          </div>
        ))}

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
