import { AlertTriangle, KeyRound, Plus, RefreshCw, Router, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getCodexScopeCacheKey, resolveCodexScopeDescriptor } from '../../../shared/codexScope'
import type { AiGatewayConfig, AiGatewayStatus, Capability, CodexApprovalPolicy, CodexConfig, CodexEnvironmentScope, CodexGatewayBinding, CodexModelProviderConfig, CodexSandboxMode, CodexSettingsSnapshot } from '../../../shared/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ModalShell } from '../../components/ModalShell'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Select, type SelectOption } from '../../components/ui/select'
import { useI18n } from '../../i18n'
import { getCodexActiveDirectProvider, getCodexDisplaySnapshot, getCodexEffectiveBaseUrl, getCodexGatewayBindingIssue, getCodexGatewayProvider } from '../../lib/codexGatewaySummary'
import { useAppStore } from '../../stores/appStore'

type SettingsCodexPanelProps = {
  capability: Capability | null
  embedded?: boolean
}

type ProviderDraft = CodexModelProviderConfig & {
  draftId: string
  key: string
  apiKey: string
}

const autoSyncScopeKeys = new Set<string>()

const APPROVAL_POLICY_VALUES: CodexApprovalPolicy[] = ['untrusted', 'on-request', 'on-failure', 'never']
const SANDBOX_MODE_VALUES: CodexSandboxMode[] = ['read-only', 'workspace-write', 'danger-full-access']
const APPROVALS_REVIEWER_PRESET_OPTIONS: SelectOption[] = [
  {
    value: 'user',
    label: 'user',
  },
  {
    value: 'auto_review',
    label: 'auto_review',
  },
  {
    value: 'guardian_subagent',
    label: 'guardian_subagent',
  },
]

function createProviderDraftId(): string {
  return `provider-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function cloneProviderDrafts(modelProviders: CodexConfig['modelProviders'], providerApiKeys: Record<string, string>): ProviderDraft[] {
  return Object.entries(modelProviders).map(([key, provider]) => ({
    draftId: createProviderDraftId(),
    key,
    name: provider.name,
    model: provider.model,
    baseUrl: provider.baseUrl,
    wireApi: provider.wireApi,
    requiresOpenaiAuth: provider.requiresOpenaiAuth,
    envKey: provider.envKey,
    apiKey: providerApiKeys[key] ?? '',
  }))
}

function normalizeProviderKey(value: string): string {
  return value.trim().replace(/\s+/g, '-')
}

function buildConfig(drafts: ProviderDraft[], currentProvider: string, modelReasoningEffort: string, preferredAuthMethod: string, approvalPolicy: CodexApprovalPolicy, sandboxMode: CodexSandboxMode, approvalsReviewer: string): CodexConfig {
  const modelProviders = Object.fromEntries(
    drafts.map((provider) => [
      normalizeProviderKey(provider.key),
      {
        name: provider.name.trim(),
        model: provider.model.trim(),
        baseUrl: provider.baseUrl.trim(),
        wireApi: provider.wireApi.trim(),
        requiresOpenaiAuth: provider.requiresOpenaiAuth,
        envKey: provider.envKey.trim(),
      },
    ]),
  )

  const availableKeys = Object.keys(modelProviders)
  const resolvedProvider = modelProviders[currentProvider] ? currentProvider : (availableKeys[0] ?? '')
  const resolvedApprovalPolicy = APPROVAL_POLICY_VALUES.includes(approvalPolicy) ? approvalPolicy : 'on-request'
  const resolvedSandboxMode = SANDBOX_MODE_VALUES.includes(sandboxMode) ? sandboxMode : 'workspace-write'

  return {
    modelProvider: resolvedProvider,
    model: modelProviders[resolvedProvider]?.model ?? '',
    modelReasoningEffort: modelReasoningEffort.trim(),
    preferredAuthMethod: preferredAuthMethod.trim(),
    approvalPolicy: resolvedApprovalPolicy,
    sandboxMode: resolvedApprovalPolicy === 'never' ? 'danger-full-access' : resolvedSandboxMode,
    approvalsReviewer: approvalsReviewer.trim(),
    modelProviders,
  }
}

function renderScopeTarget(scope: CodexEnvironmentScope, t: ReturnType<typeof useI18n>['t']): string {
  return scope.target === 'wsl' ? t('settings.codex.targetWsl') : t('settings.codex.targetNative')
}

function renderEnvStorage(scope: CodexEnvironmentScope, t: ReturnType<typeof useI18n>['t']): string {
  return scope.envStorage === 'windows-user-env' ? t('settings.codex.envStorageWindows') : t('settings.codex.envStorageBashrc')
}

function createEmptySnapshot(): Pick<CodexSettingsSnapshot, 'config' | 'providerApiKeys' | 'configExists'> {
  const defaultProviderKey = 'openai'
  return {
    configExists: false,
    config: {
      modelProvider: defaultProviderKey,
      model: 'gpt-5.4',
      modelReasoningEffort: 'xhigh',
      preferredAuthMethod: 'apikey',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      approvalsReviewer: 'auto_review',
      modelProviders: {
        [defaultProviderKey]: {
          name: 'OpenAI',
          model: 'gpt-5.4',
          baseUrl: 'https://api.openai.com/v1',
          wireApi: 'responses',
          requiresOpenaiAuth: true,
          envKey: 'OPENAI_API_KEY',
        },
      },
    },
    providerApiKeys: {
      [defaultProviderKey]: '',
    },
  }
}

function applySnapshotToState(
  snapshot: Pick<CodexSettingsSnapshot, 'config' | 'providerApiKeys' | 'configExists'> & {
    scope?: CodexSettingsSnapshot['scope'] | null
  },
  apply: {
    setScope: (scope: CodexSettingsSnapshot['scope'] | null) => void
    setConfigExists: (configExists: boolean) => void
    setSelectedProviderDraftId: (value: string) => void
    setModelReasoningEffort: (value: string) => void
    setPreferredAuthMethod: (value: string) => void
    setApprovalPolicy: (value: CodexApprovalPolicy) => void
    setSandboxMode: (value: CodexSandboxMode) => void
    setApprovalsReviewer: (value: string) => void
    setProviders: (providers: ProviderDraft[]) => void
  },
): void {
  const drafts = cloneProviderDrafts(snapshot.config.modelProviders, snapshot.providerApiKeys)
  const selectedDraft = drafts.find((provider) => normalizeProviderKey(provider.key) === snapshot.config.modelProvider) ?? drafts[0] ?? null
  apply.setScope(snapshot.scope ?? null)
  apply.setConfigExists(snapshot.configExists)
  apply.setSelectedProviderDraftId(selectedDraft?.draftId ?? '')
  apply.setModelReasoningEffort(snapshot.config.modelReasoningEffort)
  apply.setPreferredAuthMethod(snapshot.config.preferredAuthMethod)
  apply.setApprovalPolicy(snapshot.config.approvalPolicy)
  apply.setSandboxMode(snapshot.config.sandboxMode)
  apply.setApprovalsReviewer(snapshot.config.approvalsReviewer)
  apply.setProviders(drafts)
}

function SettingsCodexPanel({ capability, embedded = false }: SettingsCodexPanelProps) {
  const { t, tHtml } = useI18n()
  const loadCodexSettings = useAppStore((s) => s.loadCodexSettings)
  const saveCodexSettings = useAppStore((s) => s.saveCodexSettings)
  const saveCodexGatewayBinding = useAppStore((s) => s.saveCodexGatewayBinding)
  const aiEnvironment = useAppStore((s) => s.config.aiEnvironment)
  const cachedSnapshots = useAppStore((s) => s.config.codexSettingsSnapshots ?? {})
  const codexGatewayBindings = useAppStore((s) => s.config.codexGatewayBindings ?? {})
  const [loaded, setLoaded] = useState(false)
  const [gatewayLoading, setGatewayLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedHint, setSavedHint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [gatewayError, setGatewayError] = useState<string | null>(null)
  const [gatewayConfig, setGatewayConfig] = useState<AiGatewayConfig | null>(null)
  const [gatewayStatus, setGatewayStatus] = useState<AiGatewayStatus | null>(null)
  const [resolvedScopeKey, setResolvedScopeKey] = useState<string | null>(null)
  const [scope, setScope] = useState<CodexSettingsSnapshot['scope'] | null>(null)
  const [configExists, setConfigExists] = useState(false)
  const [useGatewayMode, setUseGatewayMode] = useState(false)
  const [selectedGatewayProviderId, setSelectedGatewayProviderId] = useState('')
  const [selectedProviderDraftId, setSelectedProviderDraftId] = useState('')
  const [modelReasoningEffort, setModelReasoningEffort] = useState('')
  const [preferredAuthMethod, setPreferredAuthMethod] = useState('')
  const [approvalPolicy, setApprovalPolicy] = useState<CodexApprovalPolicy>('on-request')
  const [sandboxMode, setSandboxMode] = useState<CodexSandboxMode>('workspace-write')
  const [approvalsReviewer, setApprovalsReviewer] = useState('')
  const [providers, setProviders] = useState<ProviderDraft[]>([])
  const [dangerousSaveConfirmOpen, setDangerousSaveConfirmOpen] = useState(false)
  const [dangerousSaveConfirmed, setDangerousSaveConfirmed] = useState(false)
  const [deleteConfirmProviderDraftId, setDeleteConfirmProviderDraftId] = useState<string | null>(null)
  const cachedSnapshot = resolvedScopeKey ? cachedSnapshots[resolvedScopeKey] : undefined
  const codexGatewayBinding = resolvedScopeKey ? codexGatewayBindings[resolvedScopeKey] : undefined

  useEffect(() => {
    let mounted = true
    setLoaded(false)

    const descriptor = resolveCodexScopeDescriptor(capability, aiEnvironment)
    if (descriptor.target === 'wsl' && !capability?.hasWsl) {
      setResolvedScopeKey(getCodexScopeCacheKey(descriptor))
      setLoaded(true)
      return () => {
        mounted = false
      }
    }

    void window.electronAPI
      .getCodexEnvironmentScope()
      .then((resolvedScope) => {
        if (!mounted) return
        setResolvedScopeKey(getCodexScopeCacheKey(resolvedScope))
        setLoaded(true)
      })
      .catch(() => {
        if (!mounted) return
        setResolvedScopeKey(null)
        setLoaded(true)
      })

    return () => {
      mounted = false
    }
  }, [aiEnvironment, capability])

  useEffect(() => {
    let mounted = true
    setGatewayLoading(true)
    setGatewayError(null)

    Promise.all([window.electronAPI.getAiGatewayConfig(), window.electronAPI.getAiGatewayStatus()])
      .then(([nextConfig, nextStatus]) => {
        if (!mounted) return
        setGatewayConfig(nextConfig)
        setGatewayStatus(nextStatus)
      })
      .catch((loadError) => {
        if (!mounted) return
        const message = loadError instanceof Error ? loadError.message : String(loadError)
        setGatewayError(message || t('settings.codex.gatewayLoadError'))
      })
      .finally(() => {
        if (!mounted) return
        setGatewayLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [t])

  useEffect(() => {
    if (!loaded) return
    setError(null)
    setSavedHint(null)
    const displaySnapshot = getCodexDisplaySnapshot(cachedSnapshot, codexGatewayBinding)
    applySnapshotToState(displaySnapshot ?? createEmptySnapshot(), {
      setScope,
      setConfigExists,
      setSelectedProviderDraftId,
      setModelReasoningEffort,
      setPreferredAuthMethod,
      setApprovalPolicy,
      setSandboxMode,
      setApprovalsReviewer,
      setProviders,
    })
    const nextGatewayMode = Boolean(codexGatewayBinding?.enabled)
    setUseGatewayMode(nextGatewayMode)
    setSelectedGatewayProviderId(codexGatewayBinding?.providerId || gatewayConfig?.activeProviderId || gatewayConfig?.providers[0]?.id || '')
    setDeleteConfirmProviderDraftId(null)
  }, [cachedSnapshot, codexGatewayBinding, gatewayConfig, loaded])

  const normalizedProviderKeys = useMemo(() => providers.map((provider) => normalizeProviderKey(provider.key)), [providers])

  const getProviderValidationError = (sourceProviders: ProviderDraft[]) => {
    const seen = new Set<string>()
    for (const key of sourceProviders.map((provider) => normalizeProviderKey(provider.key))) {
      if (!key) return t('settings.codex.emptyProviderKey')
      if (seen.has(key)) return t('settings.codex.duplicateProviderKey')
      seen.add(key)
    }
    return null
  }

  const validationError = useMemo(() => {
    return getProviderValidationError(providers)
  }, [normalizedProviderKeys, t])

  const activeProvider = providers.find((provider) => provider.draftId === selectedProviderDraftId) ?? providers[0] ?? null
  const activeProviderIndex = activeProvider ? providers.findIndex((provider) => provider.draftId === activeProvider.draftId) : -1
  const activeProviderKey = normalizeProviderKey(activeProvider?.key ?? '')
  const activeProviderApiKey = activeProvider?.apiKey ?? ''
  const approvalPolicyOptions = useMemo<SelectOption[]>(
    () =>
      APPROVAL_POLICY_VALUES.map((value) => ({
        value,
        label: `${t(`settings.codex.approvalPolicyOptions.${value}`)} (${value})`,
      })),
    [t],
  )
  const sandboxModeOptions = useMemo<SelectOption[]>(
    () =>
      SANDBOX_MODE_VALUES.map((value) => ({
        value,
        label: `${t(`settings.codex.sandboxModeOptions.${value}`)} (${value})`,
      })),
    [t],
  )
  const approvalsReviewerPresetValue = APPROVALS_REVIEWER_PRESET_OPTIONS.some((option) => option.value === approvalsReviewer.trim()) ? approvalsReviewer.trim() : ''
  const approvalPolicyLabel = t(`settings.codex.approvalPolicyOptions.${approvalPolicy}`)
  const sandboxModeLabel = t(`settings.codex.sandboxModeOptions.${sandboxMode}`)
  const dangerousPermissionCombo = approvalPolicy === 'never' || sandboxMode === 'danger-full-access'
  const deleteConfirmProvider = providers.find((provider) => provider.draftId === deleteConfirmProviderDraftId) ?? null
  const hasCachedSnapshot = Boolean(cachedSnapshot)
  const gatewayProviderOptions = useMemo<SelectOption[]>(
    () =>
      (gatewayConfig?.providers ?? []).map((provider) => ({
        value: provider.id,
        label: provider.enabled ? provider.name || provider.id : `${provider.name || provider.id} (${t('settings.codex.gatewayProviderDisabled')})`,
        disabled: !provider.enabled,
      })),
    [gatewayConfig, t],
  )
  const selectedGatewayProvider = gatewayConfig?.providers.find((provider) => provider.id === selectedGatewayProviderId) ?? null
  const bindingIssue = getCodexGatewayBindingIssue(codexGatewayBinding, gatewayConfig)
  const gatewayBoundProvider = getCodexGatewayProvider(codexGatewayBinding, gatewayConfig)
  const directSummaryProvider = getCodexActiveDirectProvider(getCodexDisplaySnapshot(cachedSnapshot, codexGatewayBinding))
  const effectiveBaseUrl = getCodexEffectiveBaseUrl(
    getCodexDisplaySnapshot(cachedSnapshot, codexGatewayBinding),
    useGatewayMode
      ? ({
          enabled: true,
          scopeKey: resolvedScopeKey ?? '',
          providerId: selectedGatewayProviderId,
        } as CodexGatewayBinding)
      : undefined,
    gatewayStatus,
  )
  const gatewayValidationError = useGatewayMode && !selectedGatewayProvider ? t('settings.codex.gatewayProviderRequired') : useGatewayMode && selectedGatewayProvider && !selectedGatewayProvider.enabled ? t('settings.codex.gatewayProviderDisabledError') : null
  const formValidationError = validationError || gatewayValidationError

  const handleProviderChange = (index: number, field: keyof ProviderDraft, value: string | boolean) => {
    setProviders((current) => current.map((provider, providerIndex) => (providerIndex === index ? { ...provider, [field]: value } : provider)))
  }

  const handleApprovalPolicyChange = (value: string) => {
    const nextValue = APPROVAL_POLICY_VALUES.includes(value as CodexApprovalPolicy) ? (value as CodexApprovalPolicy) : 'on-request'
    setApprovalPolicy(nextValue)
    if (nextValue === 'never' && sandboxMode !== 'danger-full-access') {
      setSandboxMode('danger-full-access')
    }
  }

  const handleSandboxModeChange = (value: string) => {
    const nextValue = SANDBOX_MODE_VALUES.includes(value as CodexSandboxMode) ? (value as CodexSandboxMode) : 'workspace-write'
    setSandboxMode(nextValue)
    if (approvalPolicy === 'never' && nextValue !== 'danger-full-access') {
      setApprovalPolicy('on-request')
    }
  }

  const handleAddProvider = () => {
    const nextKeyBase = 'provider'
    let suffix = providers.length + 1
    let nextKey = `${nextKeyBase}-${suffix}`
    const used = new Set(normalizedProviderKeys.filter(Boolean))
    while (used.has(nextKey)) {
      suffix += 1
      nextKey = `${nextKeyBase}-${suffix}`
    }

    const nextProvider: ProviderDraft = {
      draftId: createProviderDraftId(),
      key: nextKey,
      name: nextKey,
      model: 'gpt-5.4',
      baseUrl: '',
      wireApi: 'responses',
      requiresOpenaiAuth: true,
      envKey: 'OPENAI_API_KEY',
      apiKey: '',
    }
    setProviders((current) => [...current, nextProvider])
    setSelectedProviderDraftId(nextProvider.draftId)
    setDeleteConfirmProviderDraftId(null)
  }

  const saveProviderDrafts = async (sourceProviders: ProviderDraft[], currentProvider: string) => {
    const normalizedProviderApiKeys = Object.fromEntries(sourceProviders.map((provider) => [normalizeProviderKey(provider.key), provider.apiKey.trim()] as const).filter(([key]) => Boolean(key)))
    const nextConfig = buildConfig(sourceProviders, currentProvider, modelReasoningEffort, preferredAuthMethod, approvalPolicy, sandboxMode, approvalsReviewer)

    if (useGatewayMode || codexGatewayBinding?.enabled) {
      if (useGatewayMode && !selectedGatewayProviderId) {
        throw new Error(t('settings.codex.gatewayProviderRequired'))
      }
      const result = await saveCodexGatewayBinding({
        enabled: useGatewayMode,
        providerId: selectedGatewayProviderId,
        providerApiKeys: normalizedProviderApiKeys,
        config: nextConfig,
      })
      const displaySnapshot = getCodexDisplaySnapshot(result.snapshot, result.binding) ?? result.snapshot
      setGatewayConfig(result.config)
      setGatewayStatus(result.status)
      applySnapshotToState(displaySnapshot, {
        setScope,
        setConfigExists,
        setSelectedProviderDraftId,
        setModelReasoningEffort,
        setPreferredAuthMethod,
        setApprovalPolicy,
        setSandboxMode,
        setApprovalsReviewer,
        setProviders,
      })
      return
    }

    const saved = await saveCodexSettings({
      providerApiKeys: normalizedProviderApiKeys,
      config: nextConfig,
    })

    applySnapshotToState(saved, {
      setScope,
      setConfigExists,
      setSelectedProviderDraftId,
      setModelReasoningEffort,
      setPreferredAuthMethod,
      setApprovalPolicy,
      setSandboxMode,
      setApprovalsReviewer,
      setProviders,
    })
  }

  const performSave = async () => {
    if (!hasCachedSnapshot) {
      setError(t('settings.codex.syncRequired'))
      return
    }

    if (formValidationError) {
      setError(formValidationError)
      return
    }

    setSaving(true)
    setSavedHint(null)
    setError(null)

    try {
      await saveProviderDrafts(providers, activeProviderKey)
      setSavedHint(useGatewayMode ? t('settings.codex.gatewaySavedHint') : t('settings.codex.savedHint'))
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError)
      setError(message || t('settings.codex.saveError'))
    } finally {
      setDangerousSaveConfirmed(false)
      setSaving(false)
    }
  }

  const handleSave = async () => {
    if (dangerousPermissionCombo && !dangerousSaveConfirmed) {
      setDangerousSaveConfirmOpen(true)
      return
    }

    await performSave()
  }

  const handleConfirmDangerousSave = async () => {
    setDangerousSaveConfirmOpen(false)
    setDangerousSaveConfirmed(true)
    await performSave()
  }

  const handleDeleteProvider = async (draftId: string) => {
    const index = providers.findIndex((provider) => provider.draftId === draftId)
    if (index < 0) return
    const deletingDraftId = providers[index]?.draftId ?? ''
    const nextProviders = providers.filter((_, providerIndex) => providerIndex !== index)
    const nextSelectedProviderDraftId = deletingDraftId && selectedProviderDraftId === deletingDraftId ? (nextProviders[0]?.draftId ?? '') : selectedProviderDraftId
    const nextActiveProvider = nextProviders.find((provider) => provider.draftId === nextSelectedProviderDraftId) ?? nextProviders[0] ?? null
    const nextValidationError = getProviderValidationError(nextProviders)
    if (nextValidationError) {
      setError(nextValidationError)
      return
    }

    setSaving(true)
    setSavedHint(null)
    setError(null)
    try {
      await saveProviderDrafts(nextProviders, normalizeProviderKey(nextActiveProvider?.key ?? ''))
      setDeleteConfirmProviderDraftId(null)
      setSavedHint(t('settings.codex.savedHint'))
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError)
      setError(message || t('settings.codex.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    setSavedHint(null)
    setError(null)

    try {
      const snapshot = await loadCodexSettings()
      const displaySnapshot = getCodexDisplaySnapshot(snapshot, codexGatewayBinding) ?? snapshot
      applySnapshotToState(displaySnapshot, {
        setScope,
        setConfigExists,
        setSelectedProviderDraftId,
        setModelReasoningEffort,
        setPreferredAuthMethod,
        setApprovalPolicy,
        setSandboxMode,
        setApprovalsReviewer,
        setProviders,
      })
      setSavedHint(t('settings.codex.syncedHint'))
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : String(loadError)
      setError(message || t('settings.codex.loadError'))
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => {
    if (!loaded || !resolvedScopeKey) return
    if (autoSyncScopeKeys.has(resolvedScopeKey)) return
    autoSyncScopeKeys.add(resolvedScopeKey)
    void handleSync()
  }, [handleSync, loaded, resolvedScopeKey])

  const inputDisabled = !loaded || gatewayLoading || saving || syncing || !hasCachedSnapshot
  const currentProviderValue = activeProvider?.key.trim() || activeProvider?.name.trim() || ''
  const providerOptions = useMemo<SelectOption[]>(
    () =>
      providers.map((provider) => ({
        value: provider.draftId,
        label: provider.key.trim() || provider.name.trim() || t('settings.codex.providerPlaceholder'),
      })),
    [providers, t],
  )

  return (
    <div className="space-y-8">
      {!embedded && (
        <div>
          <p className="section-label mb-3">{t('settings.codex.kicker')}</p>
          <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">{t('settings.codex.title')}</h2>
          <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2" dangerouslySetInnerHTML={tHtml('settings.codex.description')} />
        </div>
      )}

      <div className="rounded-[28px] border px-6 py-6 surface-card" style={{ borderColor: 'var(--color-border)' }}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="text-sm leading-6 text-[color:var(--color-muted-foreground)]">{hasCachedSnapshot ? t('settings.codex.cacheReady') : t('settings.codex.cacheEmpty')}</div>
          <Button variant="outline" className="h-10 rounded-full px-4 text-sm" onClick={() => void handleSync()} loading={syncing} disabled={saving}>
            <RefreshCw className="h-4 w-4" />
            {t('settings.codex.sync')}
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3">
            <div className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.currentScope')}</div>
            <div className="mt-1 text-sm font-medium text-[color:var(--color-foreground)]">{scope ? renderScopeTarget(scope, t) : t('settings.codex.notSynced')}</div>
          </div>
          <div className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3">
            <div className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.runtimeMode')}</div>
            <div className="mt-1 text-sm font-medium text-[color:var(--color-foreground)]">{scope?.runtimeMode ?? t('settings.codex.notSynced')}</div>
          </div>
          <div className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3">
            <div className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.envStorage')}</div>
            <div className="mt-1 text-sm font-medium text-[color:var(--color-foreground)]">{scope ? renderEnvStorage(scope, t) : t('settings.codex.notSynced')}</div>
          </div>
          <div className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3">
            <div className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.configExists')}</div>
            <div className="mt-1 text-sm font-medium text-[color:var(--color-foreground)]">{configExists ? t('settings.codex.configExistsYes') : t('settings.codex.configExistsNo')}</div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.configPath')}</p>
            <div className="quiet-control rounded-[16px] px-4 py-3 font-mono text-sm text-[color:var(--color-foreground)] break-all">{scope?.configPath ?? t('settings.codex.notSynced')}</div>
          </div>
        </div>
      </div>

      <div className="rounded-[28px] border px-6 py-6 surface-card space-y-5" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-card)] text-[color:var(--color-muted-foreground)]">
              <Router className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">{t('settings.codex.gatewayModeTitle')}</h3>
              <p className="mt-1 text-sm leading-6 text-[color:var(--color-muted-foreground)]">{t('settings.codex.gatewayModeDescription')}</p>
            </div>
          </div>
          <label className="quiet-control flex h-10 items-center gap-2 rounded-full px-4 text-sm text-[color:var(--color-foreground)]">
            <input
              type="checkbox"
              checked={useGatewayMode}
              onChange={(event) => {
                setUseGatewayMode(event.target.checked)
                setSavedHint(null)
                setError(null)
              }}
              disabled={inputDisabled}
            />
            {t('settings.codex.useGatewayMode')}
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3">
            <div className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.connectionMode')}</div>
            <div className="mt-1 text-sm font-medium text-[color:var(--color-foreground)]">{useGatewayMode ? t('settings.codex.connectionGateway') : t('settings.codex.connectionDirect')}</div>
          </div>
          <div className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3">
            <div className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.currentModel')}</div>
            <div className="mt-1 truncate text-sm font-medium text-[color:var(--color-foreground)]">{activeProvider?.model || t('settings.codex.notSynced')}</div>
          </div>
          <div className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3">
            <div className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.directProvider')}</div>
            <div className="mt-1 truncate text-sm font-medium text-[color:var(--color-foreground)]">{directSummaryProvider?.providerName ?? currentProviderValue ?? t('settings.codex.notSynced')}</div>
          </div>
          <div className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3">
            <div className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.connectionStatus')}</div>
            <div className={`mt-1 text-sm font-medium ${bindingIssue || (useGatewayMode && !gatewayStatus?.running) ? 'text-[color:var(--color-destructive)]' : 'text-[color:var(--color-foreground)]'}`}>
              {bindingIssue
                ? bindingIssue === 'missing-provider'
                  ? t('settings.codex.gatewayMissingProvider')
                  : t('settings.codex.gatewayDisabledProvider')
                : useGatewayMode
                  ? gatewayStatus?.running
                    ? t('settings.codex.gatewayRouteReady')
                    : t('settings.codex.gatewayStopped')
                  : t('settings.codex.directConfigActive')}
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.gatewayProvider')}</p>
            <Select
              ariaLabel={t('settings.codex.gatewayProvider')}
              value={selectedGatewayProviderId}
              options={gatewayProviderOptions}
              onChange={setSelectedGatewayProviderId}
              placeholder={t('settings.codex.gatewayProviderPlaceholder')}
              disabled={!useGatewayMode || inputDisabled || gatewayProviderOptions.length === 0}
              triggerClassName="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.effectiveBaseUrl')}</p>
            <div className="quiet-control h-11 rounded-full px-4 py-3 font-mono text-xs text-[color:var(--color-foreground)] truncate">{effectiveBaseUrl || t('settings.codex.notSynced')}</div>
          </div>
        </div>

        {useGatewayMode && selectedGatewayProvider && (
          <div className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
            {t('settings.codex.gatewayEnabledSummary', {
              provider: selectedGatewayProvider.name || selectedGatewayProvider.id,
            })}
          </div>
        )}
        {!useGatewayMode && gatewayConfig && (
          <div className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
            {t('settings.codex.directSummary', {
              provider: directSummaryProvider?.providerName ?? currentProviderValue,
            })}
          </div>
        )}
        {codexGatewayBinding?.enabled && gatewayBoundProvider && (
          <p className="text-xs text-[color:var(--color-muted-foreground)]">
            {t('settings.codex.gatewayBoundProvider', {
              provider: gatewayBoundProvider.name || gatewayBoundProvider.id,
            })}
          </p>
        )}
        {bindingIssue && <p className="text-xs text-[color:var(--color-destructive)]">{bindingIssue === 'missing-provider' ? t('settings.codex.gatewayMissingProvider') : t('settings.codex.gatewayDisabledProvider')}</p>}
        {gatewayError && <p className="text-xs text-[color:var(--color-destructive)]">{gatewayError}</p>}
      </div>

      <div className="rounded-[28px] border px-6 py-6 surface-card space-y-5" style={{ borderColor: 'var(--color-border)' }}>
        <div>
          <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">{t('settings.codex.providerTitle')}</h3>
          <p className="mt-2 text-sm leading-6 text-[color:var(--color-muted-foreground)]" dangerouslySetInnerHTML={tHtml('settings.codex.providerDescription')} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.providerTitle')}</p>
            <Select
              ariaLabel={t('settings.codex.providerTitle')}
              value={selectedProviderDraftId}
              options={providerOptions}
              onChange={setSelectedProviderDraftId}
              placeholder={t('settings.codex.providerPlaceholder')}
              disabled={inputDisabled || providers.length === 0}
              triggerClassName="h-11 hover:border-[color:var(--color-border-hover)]"
              renderValue={() => currentProviderValue || t('settings.codex.providerPlaceholder')}
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.apiKeyTitle')}</p>
            <Input
              type="password"
              value={activeProviderApiKey}
              onChange={(event) => {
                const nextValue = event.target.value
                if (activeProviderIndex < 0) return
                setProviders((current) => current.map((provider, providerIndex) => (providerIndex === activeProviderIndex ? { ...provider, apiKey: nextValue } : provider)))
              }}
              className="h-11"
              placeholder="sk-..."
              disabled={inputDisabled || activeProviderIndex < 0}
            />
          </div>
        </div>

        <div className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3 text-sm text-[color:var(--color-muted-foreground)]">
          <p>{t('settings.codex.apiKeyDescription')}</p>
          {activeProviderKey && <p className="mt-2 text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.apiKeyBoundProvider', { value: activeProviderKey })}</p>}
        </div>
      </div>

      <div className="rounded-[28px] border px-6 py-6 surface-card space-y-5" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">{t('settings.codex.providersTitle')}</h3>
            <p className="mt-2 text-sm leading-6 text-[color:var(--color-muted-foreground)]" dangerouslySetInnerHTML={tHtml('settings.codex.providersDescription')} />
          </div>
          <Button variant="outline" className="h-10 rounded-full px-4 text-sm" onClick={handleAddProvider} disabled={inputDisabled}>
            <Plus className="h-4 w-4" />
            {t('settings.codex.addProvider')}
          </Button>
        </div>

        {activeProvider && (
          <div className="rounded-[22px] border px-5 py-5" style={{ borderColor: 'var(--color-border)' }}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.providerKey')}</p>
                <Input value={activeProvider.key} onChange={(event) => handleProviderChange(activeProviderIndex, 'key', event.target.value)} placeholder={t('settings.codex.providerPlaceholder')} disabled={inputDisabled} />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.providerName')}</p>
                <Input value={activeProvider.name} onChange={(event) => handleProviderChange(activeProviderIndex, 'name', event.target.value)} disabled={inputDisabled} />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.model')}</p>
                <Input value={activeProvider.model} onChange={(event) => handleProviderChange(activeProviderIndex, 'model', event.target.value)} disabled={inputDisabled} />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.providerBaseUrl')}</p>
                <Input value={activeProvider.baseUrl} onChange={(event) => handleProviderChange(activeProviderIndex, 'baseUrl', event.target.value)} disabled={inputDisabled} />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.providerWireApi')}</p>
                <Input value={activeProvider.wireApi} onChange={(event) => handleProviderChange(activeProviderIndex, 'wireApi', event.target.value)} disabled={inputDisabled} />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.providerEnvKey')}</p>
                <Input value={activeProvider.envKey} onChange={(event) => handleProviderChange(activeProviderIndex, 'envKey', event.target.value)} disabled={inputDisabled} />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.providerRequiresOpenaiAuth')}</p>
                <label className="quiet-control flex h-10 items-center gap-2 rounded-full px-4 text-sm text-[color:var(--color-foreground)]">
                  <input type="checkbox" checked={activeProvider.requiresOpenaiAuth} onChange={(event) => handleProviderChange(activeProviderIndex, 'requiresOpenaiAuth', event.target.checked)} disabled={inputDisabled} />
                  {activeProvider.requiresOpenaiAuth ? 'true' : 'false'}
                </label>
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <Button variant="outline" className="h-10 rounded-full px-4 text-sm text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-background)]" onClick={() => setDeleteConfirmProviderDraftId(activeProvider.draftId)} disabled={inputDisabled || providers.length <= 1}>
                <Trash2 className="h-4 w-4" />
                {t('common.delete')}
              </Button>
            </div>
          </div>
        )}
      </div>

      <ModalShell
        open={Boolean(deleteConfirmProvider)}
        onClose={() => {
          if (saving) return
          setDeleteConfirmProviderDraftId(null)
        }}
        widthClassName="max-w-[560px]"
        ariaLabel={t('settings.codex.deleteProviderConfirmLabel')}
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
              <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">{t('settings.codex.deleteProviderConfirmTitle')}</h3>
              <p className="mt-1 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
                {t('settings.codex.deleteProviderConfirmHint', {
                  value: deleteConfirmProvider?.key || deleteConfirmProvider?.name || t('settings.codex.providerPlaceholder'),
                })}
              </p>
            </div>
          </div>

          <div className="rounded-[18px] border px-4 py-3" style={{ borderColor: 'var(--color-border)' }}>
            <p className="text-sm text-[color:var(--color-foreground)]">{deleteConfirmProvider?.key || deleteConfirmProvider?.name}</p>
          </div>

          {error && <p className="text-xs text-[color:var(--color-destructive)]">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" className="h-10 px-4" onClick={() => setDeleteConfirmProviderDraftId(null)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-10 px-4"
              onClick={() => {
                if (!deleteConfirmProvider) return
                void handleDeleteProvider(deleteConfirmProvider.draftId)
              }}
              loading={saving}
              disabled={inputDisabled || saving || !deleteConfirmProvider}
            >
              {t('common.delete')}
            </Button>
          </div>
        </div>
      </ModalShell>

      <div className="rounded-[28px] border px-6 py-6 surface-card space-y-5" style={{ borderColor: 'var(--color-border)' }}>
        <div>
          <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">{t('settings.codex.modelTitle')}</h3>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.modelReasoningEffort')}</p>
            <Input value={modelReasoningEffort} onChange={(event) => setModelReasoningEffort(event.target.value)} disabled={inputDisabled} />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.preferredAuthMethod')}</p>
            <Input value={preferredAuthMethod} onChange={(event) => setPreferredAuthMethod(event.target.value)} disabled={inputDisabled} />
          </div>
        </div>
      </div>

      <div className="rounded-[28px] border px-6 py-6 surface-card space-y-5" style={{ borderColor: 'var(--color-border)' }}>
        <div className="space-y-1.5">
          <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">{t('settings.codex.permissionsTitle')}</h3>
          <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)]">{t('settings.codex.permissionsDescription')}</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.approvalPolicy')}</p>
            <Select ariaLabel={t('settings.codex.approvalPolicy')} value={approvalPolicy} options={approvalPolicyOptions} onChange={handleApprovalPolicyChange} disabled={inputDisabled} />
            <p className="text-[11px] leading-5 text-[color:var(--color-muted-foreground)]">{t('settings.codex.approvalPolicyHint')}</p>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.sandboxMode')}</p>
            <Select ariaLabel={t('settings.codex.sandboxMode')} value={sandboxMode} options={sandboxModeOptions} onChange={handleSandboxModeChange} disabled={inputDisabled} />
            <p className="text-[11px] leading-5 text-[color:var(--color-muted-foreground)]">{approvalPolicy === 'never' ? t('settings.codex.sandboxModeNeverHint') : t('settings.codex.sandboxModeHint')}</p>
          </div>

          <div className="space-y-2 md:col-span-2">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.approvalsReviewer')}</p>
            <div className="grid gap-2 md:grid-cols-[220px_minmax(0,1fr)]">
              <div className="space-y-1.5">
                <p className="text-[11px] text-[color:var(--color-muted-foreground)]">{t('settings.codex.approvalsReviewerPreset')}</p>
                <Select
                  ariaLabel={t('settings.codex.approvalsReviewerPreset')}
                  value={approvalsReviewerPresetValue}
                  options={APPROVALS_REVIEWER_PRESET_OPTIONS}
                  onChange={(value) => setApprovalsReviewer(value)}
                  placeholder={t('settings.codex.approvalsReviewerPresetPlaceholder')}
                  disabled={inputDisabled}
                  emptyText={t('settings.codex.approvalsReviewerPresetEmpty')}
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-[11px] text-[color:var(--color-muted-foreground)]">{t('settings.codex.approvalsReviewerCustom')}</p>
                <Input value={approvalsReviewer} onChange={(event) => setApprovalsReviewer(event.target.value)} disabled={inputDisabled} placeholder={t('settings.codex.approvalsReviewerCustomPlaceholder')} />
              </div>
            </div>
            <p className="text-[11px] leading-5 text-[color:var(--color-muted-foreground)]">{t('settings.codex.approvalsReviewerHint')}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button className="h-10 rounded-full px-5 text-sm" onClick={() => void handleSave()} disabled={inputDisabled || Boolean(formValidationError) || !hasCachedSnapshot} loading={saving}>
            <Save className="h-4 w-4" />
            {saving ? t('common.saving') : useGatewayMode ? t('settings.codex.saveGateway') : t('settings.codex.save')}
          </Button>
        </div>

        {savedHint && <p className="text-xs text-[color:var(--color-muted-foreground)]">{savedHint}</p>}
        {(formValidationError || error) && <p className="text-xs text-[color:var(--color-destructive)]">{formValidationError || error}</p>}
      </div>

      <ConfirmDialog
        open={dangerousSaveConfirmOpen}
        onClose={() => setDangerousSaveConfirmOpen(false)}
        onConfirm={handleConfirmDangerousSave}
        ariaLabel={t('settings.codex.dangerousSaveConfirmLabel')}
        title={t('settings.codex.dangerousSaveConfirmTitle')}
        description={t('settings.codex.dangerousSaveConfirmDescription', {
          approvalPolicy: approvalPolicyLabel,
          sandboxMode: sandboxModeLabel,
        })}
        confirmLabel={t('settings.codex.dangerousSaveConfirmAction')}
        confirmVariant="destructive"
        busy={saving}
      >
        <div className="rounded-[18px] border px-4 py-3" style={{ borderColor: 'var(--color-border)' }}>
          <div className="space-y-2 text-sm leading-6 text-[color:var(--color-foreground)]">
            <p>{t('settings.codex.dangerousSaveConfirmPolicy', { value: approvalPolicyLabel })}</p>
            <p>{t('settings.codex.dangerousSaveConfirmSandbox', { value: sandboxModeLabel })}</p>
          </div>
        </div>
      </ConfirmDialog>

      <div className="rounded-[24px] border px-5 py-4 surface-card" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-start gap-3 text-sm text-[color:var(--color-muted-foreground)]">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="leading-6">{scope?.target === 'wsl' ? `WSL: ${scope.homePath}` : `${scope?.hostPlatform ?? 'native'}: ${scope?.homePath ?? ''}`}</div>
        </div>
      </div>
    </div>
  )
}

export { SettingsCodexPanel }
