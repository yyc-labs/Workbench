import { useEffect, useMemo, useState } from 'react'
import type {
  AiGatewayClientCli,
  AiGatewayConfig,
  AiGatewayProviderCapabilities,
  AiGatewayStatus,
  ClaudeRuntimeProfile,
} from '../../../../shared/types'
import { useI18n } from '../../../i18n'
import {
  getCodexGatewayBindingIssue,
  getCodexScopesUsingGateway,
} from '../../../lib/codexGatewaySummary'
import {
  syncClaudeGatewayProfileConfigs,
  withClaudeProfileModelRoutes,
} from '../../../lib/claudeGatewayProfiles'
import { useAppStore } from '../../../stores/appStore'
import {
  createNewProviderDraft,
  draftToProvider,
  EMPTY_PROVIDER_USAGE,
  isProviderUsageEmpty,
  providerToDraft,
  type ProviderDraft,
  type ProviderUsage,
} from './settingsAiGatewayShared'

type SettingsAiGatewayDraftArgs = {
  profiles?: ClaudeRuntimeProfile[]
  activeProfileId?: string
  onProfilesSave?: (profiles: ClaudeRuntimeProfile[], activeProfileId: string) => Promise<void>
}

type BindingAction = 'apply' | 'restore'

export function useAiGatewaySettingsDraft({
  profiles = [],
  activeProfileId,
  onProfilesSave,
}: SettingsAiGatewayDraftArgs) {
  const { t } = useI18n()
  const codexGatewayBindings = useAppStore((s) => s.config.codexGatewayBindings ?? {})
  const [config, setConfig] = useState<AiGatewayConfig | null>(null)
  const [status, setStatus] = useState<AiGatewayStatus | null>(null)
  const [providers, setProviders] = useState<ProviderDraft[]>([])
  const [selectedProviderDraftId, setSelectedProviderDraftId] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedHint, setSavedHint] = useState('')
  const [deleteConfirmProviderDraftId, setDeleteConfirmProviderDraftId] = useState<string | null>(null)

  const activeProviderIndex = providers.findIndex((provider) => provider.draftId === selectedProviderDraftId)
  const activeProvider = activeProviderIndex >= 0 ? providers[activeProviderIndex] : null
  const deleteConfirmProvider = providers.find((provider) => provider.draftId === deleteConfirmProviderDraftId) ?? null
  const providerOptions = providers.map((provider) => ({
    value: provider.draftId,
    label: provider.name || provider.id,
  }))
  const inputDisabled = loading || saving
  const claudeGatewayProfiles = profiles.filter((profile) => profile.gateway?.enabled)
  const codexGatewayScopes = getCodexScopesUsingGateway(codexGatewayBindings)
  const invalidCodexBindingCount = codexGatewayScopes.filter((binding) => (
    getCodexGatewayBindingIssue(binding, config) !== null
  )).length

  const getProviderUsage = (providerId: string): ProviderUsage => ({
    claudeProfiles: profiles
      .filter((profile) => profile.gateway?.enabled && profile.gateway.providerId === providerId)
      .map((profile) => profile.name || profile.id),
    codexScopes: codexGatewayScopes
      .filter((binding) => binding.providerId === providerId)
      .map((binding) => binding.scopeKey),
    manualRoutes: (config?.modelRoutes ?? [])
      .filter((route) => (
        route.enabled
        && route.providerId === providerId
        && route.source !== 'claude-profile'
        && route.source !== 'codex-scope'
      ))
      .map((route) => route.model),
  })

  const activeProviderUsage = useMemo(
    () => (activeProvider ? getProviderUsage(activeProvider.id) : null),
    [activeProvider, profiles, codexGatewayScopes, config]
  )
  const deleteConfirmProviderUsage = useMemo(
    () => (deleteConfirmProvider ? getProviderUsage(deleteConfirmProvider.id) : null),
    [deleteConfirmProvider, profiles, codexGatewayScopes, config]
  )

  const refreshGatewayTelemetry = async () => {
    const nextStatus = await window.electronAPI.getAiGatewayStatus()
    setStatus(nextStatus)
  }

  const loadGateway = async () => {
    setLoading(true)
    setError('')
    try {
      const [nextConfig, nextStatus] = await Promise.all([
        window.electronAPI.getAiGatewayConfig(),
        window.electronAPI.getAiGatewayStatus(),
      ])
      setConfig(nextConfig)
      setStatus(nextStatus)
      const drafts = nextConfig.providers.map(providerToDraft)
      setProviders(drafts)
      const activeDraft = drafts.find((draft) => draft.id === nextConfig.activeProviderId) ?? drafts[0]
      setSelectedProviderDraftId(activeDraft?.draftId ?? '')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('settings.aiGateway.loadError'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadGateway()
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshGatewayTelemetry().catch(() => undefined)
    }, 2500)
    return () => window.clearInterval(timer)
  }, [])

  const buildDraftConfig = (): AiGatewayConfig => {
    const currentConfig = config
    if (!currentConfig) throw new Error(t('settings.aiGateway.loadFirst'))
    const nextProviders = providers.map(draftToProvider).filter((provider) => provider.id)
    if (nextProviders.length === 0) throw new Error(t('settings.aiGateway.providerRequired'))
    const selectedProvider = providers.find((provider) => provider.draftId === selectedProviderDraftId)
    return {
      ...currentConfig,
      providers: nextProviders,
      activeProviderId: selectedProvider?.id || nextProviders[0]!.id,
    }
  }

  const persistDraftConfig = async (): Promise<AiGatewayConfig> => {
    const nextConfig = buildDraftConfig()
    let result = await window.electronAPI.saveAiGatewayConfig(nextConfig)
    if (onProfilesSave && profiles.length > 0) {
      const syncedProfiles = syncClaudeGatewayProfileConfigs(profiles, result.config)
      await onProfilesSave(syncedProfiles, activeProfileId || syncedProfiles[0]?.id || '')
      result = await window.electronAPI.saveAiGatewayConfig(
        withClaudeProfileModelRoutes(result.config, syncedProfiles)
      )
    }
    setConfig(result.config)
    setStatus(result.status)
    const drafts = result.config.providers.map(providerToDraft)
    setProviders(drafts)
    const activeDraft = drafts.find((draft) => draft.id === result.config.activeProviderId) ?? drafts[0]
    setSelectedProviderDraftId(activeDraft?.draftId ?? '')
    return result.config
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setSavedHint('')
    try {
      await persistDraftConfig()
      setSavedHint(t('settings.aiGateway.savedHint'))
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('settings.aiGateway.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const handleStartStop = async (nextRunning: boolean) => {
    setSaving(true)
    setError('')
    setSavedHint('')
    try {
      await persistDraftConfig()
      const nextStatus = nextRunning
        ? await window.electronAPI.startAiGateway()
        : await window.electronAPI.stopAiGateway()
      setStatus(nextStatus)
      setConfig(await window.electronAPI.getAiGatewayConfig())
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t('settings.aiGateway.actionError'))
    } finally {
      setSaving(false)
    }
  }

  const handleBindingAction = async (cli: AiGatewayClientCli, action: BindingAction) => {
    setSaving(true)
    setError('')
    setSavedHint('')
    try {
      await persistDraftConfig()
      const result = action === 'apply'
        ? await window.electronAPI.applyAiGatewayClientBinding(cli)
        : await window.electronAPI.restoreAiGatewayClientBinding(cli)
      setConfig(result.config)
      setStatus(result.status)
      setSavedHint(action === 'apply'
        ? t('settings.aiGateway.bindingApplied')
        : t('settings.aiGateway.bindingRestored'))
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t('settings.aiGateway.actionError'))
    } finally {
      setSaving(false)
    }
  }

  const updateConfigDraft = (partial: Partial<AiGatewayConfig>) => {
    setConfig((current) => current ? { ...current, ...partial } : current)
  }

  const updateProvider = <K extends keyof ProviderDraft>(field: K, value: ProviderDraft[K]) => {
    if (activeProviderIndex < 0) return
    setProviders((current) => current.map((provider, index) => (
      index === activeProviderIndex ? { ...provider, [field]: value } : provider
    )))
  }

  const updateProviderCapability = (key: keyof AiGatewayProviderCapabilities, value: boolean) => {
    if (!activeProvider) return
    updateProvider('capabilities', {
      ...(activeProvider.capabilities ?? {}),
      [key]: value,
    })
  }

  const handleAddProvider = () => {
    const draft = createNewProviderDraft(providers.length)
    setProviders((current) => [...current, draft])
    setSelectedProviderDraftId(draft.draftId)
  }

  const deleteProviderDraft = (draftId: string) => {
    const nextProviders = providers.filter((provider) => provider.draftId !== draftId)
    setProviders(nextProviders)
    setSelectedProviderDraftId(nextProviders[0]?.draftId ?? '')
    setDeleteConfirmProviderDraftId(null)
  }

  const handleDeleteProvider = () => {
    if (!activeProvider || providers.length <= 1) return
    const usage = getProviderUsage(activeProvider.id)
    if (!isProviderUsageEmpty(usage)) {
      setDeleteConfirmProviderDraftId(activeProvider.draftId)
      return
    }
    deleteProviderDraft(activeProvider.draftId)
  }

  return {
    config,
    status,
    providers,
    selectedProviderDraftId,
    loading,
    saving,
    error,
    savedHint,
    inputDisabled,
    providerOptions,
    activeProvider,
    activeProviderUsage,
    deleteConfirmProvider,
    deleteConfirmProviderUsage,
    claudeGatewayProfiles,
    codexGatewayScopes,
    invalidCodexBindingCount,
    loadGateway,
    handleSave,
    handleStartStop,
    handleBindingAction,
    updateConfigDraft,
    updateProvider,
    updateProviderCapability,
    handleAddProvider,
    handleDeleteProvider,
    deleteProviderDraft,
    setSelectedProviderDraftId,
    dismissDeleteProviderConfirm: () => setDeleteConfirmProviderDraftId(null),
    emptyProviderUsage: EMPTY_PROVIDER_USAGE,
  }
}
