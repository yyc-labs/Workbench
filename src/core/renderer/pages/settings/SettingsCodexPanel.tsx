import { Check, ChevronDown, KeyRound, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  Capability,
  CodexConfig,
  CodexEnvironmentScope,
  CodexModelProviderConfig,
  CodexSettingsSnapshot,
} from '../../../shared/types'
import { getCodexScopeCacheKey } from '../../../shared/codexScope'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { useI18n } from '../../i18n'
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

function createProviderDraftId(): string {
  return `provider-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function cloneProviderDrafts(
  modelProviders: CodexConfig['modelProviders'],
  providerApiKeys: Record<string, string>,
): ProviderDraft[] {
  return Object.entries(modelProviders).map(([key, provider]) => ({
    draftId: createProviderDraftId(),
    key,
    name: provider.name,
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

function buildConfig(
  drafts: ProviderDraft[],
  currentProvider: string,
  model: string,
  modelReasoningEffort: string,
  preferredAuthMethod: string,
  approvalsReviewer: string,
): CodexConfig {
  const modelProviders = Object.fromEntries(
    drafts.map((provider) => [
      normalizeProviderKey(provider.key),
      {
        name: provider.name.trim(),
        baseUrl: provider.baseUrl.trim(),
        wireApi: provider.wireApi.trim(),
        requiresOpenaiAuth: provider.requiresOpenaiAuth,
        envKey: provider.envKey.trim(),
      },
    ]),
  )

  const availableKeys = Object.keys(modelProviders)
  const resolvedProvider = modelProviders[currentProvider] ? currentProvider : availableKeys[0] ?? ''

  return {
    modelProvider: resolvedProvider,
    model: model.trim(),
    modelReasoningEffort: modelReasoningEffort.trim(),
    preferredAuthMethod: preferredAuthMethod.trim(),
    approvalsReviewer: approvalsReviewer.trim(),
    modelProviders,
  }
}

function renderScopeTarget(scope: CodexEnvironmentScope, t: ReturnType<typeof useI18n>['t']): string {
  return scope.target === 'wsl' ? t('settings.codex.targetWsl') : t('settings.codex.targetNative')
}

function renderEnvStorage(scope: CodexEnvironmentScope, t: ReturnType<typeof useI18n>['t']): string {
  return scope.envStorage === 'windows-user-env'
    ? t('settings.codex.envStorageWindows')
    : t('settings.codex.envStorageBashrc')
}

function createEmptySnapshot(): Pick<
  CodexSettingsSnapshot,
  'config' | 'providerApiKeys' | 'configExists'
> {
  const defaultProviderKey = 'nowcoding'
  return {
    configExists: false,
    config: {
      modelProvider: defaultProviderKey,
      model: 'gpt-5.4',
      modelReasoningEffort: 'xhigh',
      preferredAuthMethod: 'apikey',
      approvalsReviewer: 'guardian_subagent',
      modelProviders: {
        [defaultProviderKey]: {
          name: 'NowCoding',
          baseUrl: 'https://nowcoding.ai/v1',
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
    setModel: (value: string) => void
    setModelReasoningEffort: (value: string) => void
    setPreferredAuthMethod: (value: string) => void
    setApprovalsReviewer: (value: string) => void
    setProviders: (providers: ProviderDraft[]) => void
  },
): void {
  const drafts = cloneProviderDrafts(snapshot.config.modelProviders, snapshot.providerApiKeys)
  const selectedDraft = drafts.find((provider) => normalizeProviderKey(provider.key) === snapshot.config.modelProvider) ?? drafts[0] ?? null
  apply.setScope(snapshot.scope ?? null)
  apply.setConfigExists(snapshot.configExists)
  apply.setSelectedProviderDraftId(selectedDraft?.draftId ?? '')
  apply.setModel(snapshot.config.model)
  apply.setModelReasoningEffort(snapshot.config.modelReasoningEffort)
  apply.setPreferredAuthMethod(snapshot.config.preferredAuthMethod)
  apply.setApprovalsReviewer(snapshot.config.approvalsReviewer)
  apply.setProviders(drafts)
}

function SettingsCodexPanel({ capability, embedded = false }: SettingsCodexPanelProps) {
  const { t, tHtml } = useI18n()
  const loadCodexSettings = useAppStore((s) => s.loadCodexSettings)
  const saveCodexSettings = useAppStore((s) => s.saveCodexSettings)
  const aiEnvironment = useAppStore((s) => s.config.aiEnvironment)
  const cachedSnapshots = useAppStore((s) => s.config.codexSettingsSnapshots ?? {})
  const [loaded, setLoaded] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedHint, setSavedHint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resolvedScopeKey, setResolvedScopeKey] = useState<string | null>(null)
  const [scope, setScope] = useState<CodexSettingsSnapshot['scope'] | null>(null)
  const [configExists, setConfigExists] = useState(false)
  const [selectedProviderDraftId, setSelectedProviderDraftId] = useState('')
  const [model, setModel] = useState('')
  const [modelReasoningEffort, setModelReasoningEffort] = useState('')
  const [preferredAuthMethod, setPreferredAuthMethod] = useState('')
  const [approvalsReviewer, setApprovalsReviewer] = useState('')
  const [providers, setProviders] = useState<ProviderDraft[]>([])
  const [providerDropdownOpen, setProviderDropdownOpen] = useState(false)
  const providerDropdownRef = useRef<HTMLDivElement | null>(null)
  const providerTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [providerDropdownLayout, setProviderDropdownLayout] = useState({
    top: 0,
    left: 0,
    width: 0,
    maxHeight: 240,
  })
  const cachedSnapshot = resolvedScopeKey ? cachedSnapshots[resolvedScopeKey] : undefined

  useEffect(() => {
    let mounted = true
    setLoaded(false)

    void window.electronAPI.getCodexEnvironmentScope()
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
    if (!loaded) return
    setError(null)
    setSavedHint(null)
    applySnapshotToState(cachedSnapshot ?? createEmptySnapshot(), {
      setScope,
      setConfigExists,
      setSelectedProviderDraftId,
      setModel,
      setModelReasoningEffort,
      setPreferredAuthMethod,
      setApprovalsReviewer,
      setProviders,
    })
  }, [cachedSnapshot, loaded])

  useEffect(() => {
    if (!providerDropdownOpen) return

    const updateProviderDropdownLayout = () => {
      if (!providerTriggerRef.current) return
      const rect = providerTriggerRef.current.getBoundingClientRect()
      const viewportPadding = 12
      const dropdownGap = 8
      const idealMaxHeight = 240
      const preferredTop = rect.bottom + dropdownGap
      const availableBelow = window.innerHeight - preferredTop - viewportPadding
      const availableAbove = rect.top - dropdownGap - viewportPadding
      const shouldOpenUpward = availableBelow < 120 && availableAbove > availableBelow
      const maxHeight = Math.max(96, Math.min(
        idealMaxHeight,
        shouldOpenUpward ? availableAbove : availableBelow,
      ))
      const top = shouldOpenUpward
        ? Math.max(viewportPadding, rect.top - dropdownGap - maxHeight)
        : rect.bottom + dropdownGap
      const width = rect.width
      const left = Math.max(
        viewportPadding,
        Math.min(rect.left, window.innerWidth - viewportPadding - width),
      )
      setProviderDropdownLayout({ top, left, width, maxHeight })
    }

    updateProviderDropdownLayout()

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (providerDropdownRef.current?.contains(target)) return
      if (providerTriggerRef.current?.contains(target)) return
      setProviderDropdownOpen(false)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProviderDropdownOpen(false)
      }
    }

    const handleReposition = () => {
      updateProviderDropdownLayout()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    window.addEventListener('resize', handleReposition)
    window.addEventListener('scroll', handleReposition, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
      window.removeEventListener('resize', handleReposition)
      window.removeEventListener('scroll', handleReposition, true)
    }
  }, [providerDropdownOpen])

  const normalizedProviderKeys = useMemo(
    () => providers.map((provider) => normalizeProviderKey(provider.key)),
    [providers],
  )

  const validationError = useMemo(() => {
    const seen = new Set<string>()
    for (const key of normalizedProviderKeys) {
      if (!key) return t('settings.codex.emptyProviderKey')
      if (seen.has(key)) return t('settings.codex.duplicateProviderKey')
      seen.add(key)
    }
    return null
  }, [normalizedProviderKeys, t])

  const activeProvider = providers.find((provider) => provider.draftId === selectedProviderDraftId) ?? providers[0] ?? null
  const activeProviderIndex = activeProvider ? providers.findIndex((provider) => provider.draftId === activeProvider.draftId) : -1
  const activeProviderKey = normalizeProviderKey(activeProvider?.key ?? '')
  const activeProviderApiKey = activeProvider?.apiKey ?? ''
  const hasCachedSnapshot = Boolean(cachedSnapshot)

  const handleProviderChange = (
    index: number,
    field: keyof ProviderDraft,
    value: string | boolean,
  ) => {
    setProviders((current) => current.map((provider, providerIndex) => (
      providerIndex === index
        ? { ...provider, [field]: value }
        : provider
    )))
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
      baseUrl: '',
      wireApi: 'responses',
      requiresOpenaiAuth: true,
      envKey: 'OPENAI_API_KEY',
      apiKey: '',
    }
    setProviders((current) => [...current, nextProvider])
    setSelectedProviderDraftId(nextProvider.draftId)
  }

  const handleDeleteProvider = (index: number) => {
    const deletingDraftId = providers[index]?.draftId ?? ''
    const nextProviders = providers.filter((_, providerIndex) => providerIndex !== index)
    setProviders(nextProviders)
    if (deletingDraftId && selectedProviderDraftId === deletingDraftId) {
      setSelectedProviderDraftId(nextProviders[0]?.draftId ?? '')
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    setSavedHint(null)
    setError(null)

    try {
      const snapshot = await loadCodexSettings()
      applySnapshotToState(snapshot, {
        setScope,
        setConfigExists,
        setSelectedProviderDraftId,
        setModel,
        setModelReasoningEffort,
        setPreferredAuthMethod,
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

  const handleSave = async () => {
    if (!hasCachedSnapshot) {
      setError(t('settings.codex.syncRequired'))
      return
    }

    if (validationError) {
      setError(validationError)
      return
    }

    setSaving(true)
    setSavedHint(null)
    setError(null)

    try {
      const normalizedProviderApiKeys = Object.fromEntries(
        providers
          .map((provider) => [normalizeProviderKey(provider.key), provider.apiKey.trim()] as const)
          .filter(([key]) => Boolean(key)),
      )
      const saved = await saveCodexSettings({
        providerApiKeys: normalizedProviderApiKeys,
        config: buildConfig(
          providers,
          activeProviderKey,
          model,
          modelReasoningEffort,
          preferredAuthMethod,
          approvalsReviewer,
        ),
      })

      applySnapshotToState(saved, {
        setScope,
        setConfigExists,
        setSelectedProviderDraftId,
        setModel,
        setModelReasoningEffort,
        setPreferredAuthMethod,
        setApprovalsReviewer,
        setProviders,
      })
      setSavedHint(t('settings.codex.savedHint'))
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError)
      setError(message || t('settings.codex.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const inputDisabled = !loaded || saving || syncing || !hasCachedSnapshot
  const currentProviderValue = activeProvider?.key.trim() || activeProvider?.name.trim() || ''

  return (
    <div className="space-y-8">
      {!embedded && (
        <div>
          <p className="section-label mb-3">{t('settings.codex.kicker')}</p>
          <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">
            {t('settings.codex.title')}
          </h2>
          <p
            className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2"
            dangerouslySetInnerHTML={tHtml('settings.codex.description')}
          />
        </div>
      )}

      <div className="rounded-[28px] border px-6 py-6 surface-card" style={{ borderColor: 'var(--color-border)' }}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="text-sm leading-6 text-[color:var(--color-muted-foreground)]">
            {hasCachedSnapshot
              ? t('settings.codex.cacheReady')
              : t('settings.codex.cacheEmpty')}
          </div>
          <Button
            variant="outline"
            className="h-10 rounded-full px-4 text-sm"
            onClick={() => void handleSync()}
            loading={syncing}
            disabled={saving}
          >
            <RefreshCw className="h-4 w-4" />
            {t('settings.codex.sync')}
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3">
            <div className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.currentScope')}</div>
            <div className="mt-1 text-sm font-medium text-[color:var(--color-foreground)]">
              {scope ? renderScopeTarget(scope, t) : t('settings.codex.notSynced')}
            </div>
          </div>
          <div className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3">
            <div className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.runtimeMode')}</div>
            <div className="mt-1 text-sm font-medium text-[color:var(--color-foreground)]">
              {scope?.runtimeMode ?? t('settings.codex.notSynced')}
            </div>
          </div>
          <div className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3">
            <div className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.envStorage')}</div>
            <div className="mt-1 text-sm font-medium text-[color:var(--color-foreground)]">
              {scope ? renderEnvStorage(scope, t) : t('settings.codex.notSynced')}
            </div>
          </div>
          <div className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3">
            <div className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.configExists')}</div>
            <div className="mt-1 text-sm font-medium text-[color:var(--color-foreground)]">
              {configExists ? t('settings.codex.configExistsYes') : t('settings.codex.configExistsNo')}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.configPath')}</p>
            <div className="quiet-control rounded-[16px] px-4 py-3 font-mono text-sm text-[color:var(--color-foreground)] break-all">
              {scope?.configPath ?? t('settings.codex.notSynced')}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-[28px] border px-6 py-6 surface-card space-y-5" style={{ borderColor: 'var(--color-border)' }}>
        <div>
          <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">
            {t('settings.codex.providerTitle')}
          </h3>
          <p
            className="mt-2 text-sm leading-6 text-[color:var(--color-muted-foreground)]"
            dangerouslySetInnerHTML={tHtml('settings.codex.providerDescription')}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.providerTitle')}</p>
            <div
              ref={providerDropdownRef}
              className="relative"
            >
              <button
                ref={providerTriggerRef}
                type="button"
                className="quiet-control flex h-11 w-full items-center justify-between rounded-full px-4 text-left text-sm transition-colors hover:border-[color:var(--color-border-hover)] disabled:opacity-50"
                aria-haspopup="listbox"
                aria-expanded={providerDropdownOpen}
                onClick={() => {
                  if (inputDisabled || providers.length === 0) return
                  setProviderDropdownOpen((current) => !current)
                }}
                disabled={inputDisabled || providers.length === 0}
              >
                <span className={currentProviderValue ? 'text-[color:var(--color-foreground)]' : 'text-[color:var(--color-muted-foreground)]'}>
                  {currentProviderValue || t('settings.codex.providerPlaceholder')}
                </span>
                <ChevronDown className={`h-4 w-4 text-[color:var(--color-muted-foreground)] transition-transform ${providerDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.apiKeyTitle')}</p>
            <Input
              type="password"
              value={activeProviderApiKey}
              onChange={(event) => {
                    const nextValue = event.target.value
                if (activeProviderIndex < 0) return
                setProviders((current) => current.map((provider, providerIndex) => (
                  providerIndex === activeProviderIndex
                    ? { ...provider, apiKey: nextValue }
                    : provider
                )))
              }}
              className="h-11"
              placeholder="sk-..."
              disabled={inputDisabled || activeProviderIndex < 0}
            />
          </div>
        </div>

        <div className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3 text-sm text-[color:var(--color-muted-foreground)]">
          <p>{t('settings.codex.apiKeyDescription')}</p>
          {activeProviderKey && (
            <p className="mt-2 text-xs text-[color:var(--color-muted-foreground)]">
              {t('settings.codex.apiKeyBoundProvider', { value: activeProviderKey })}
            </p>
          )}
        </div>
      </div>

      {providerDropdownOpen && createPortal(
        <div
          ref={providerDropdownRef}
          className="surface-card fixed z-[10010] overflow-hidden rounded-[18px]"
          style={{
            top: providerDropdownLayout.top,
            left: providerDropdownLayout.left,
            width: providerDropdownLayout.width,
          }}
          role="listbox"
          aria-label={t('settings.codex.providerTitle')}
        >
          <div className="overflow-auto p-1.5" style={{ maxHeight: providerDropdownLayout.maxHeight }}>
            {providers.map((provider) => {
              const key = normalizeProviderKey(provider.key)
              const active = provider.draftId === activeProvider?.draftId
              return (
                <button
                  key={provider.draftId}
                  type="button"
                  className={`flex w-full items-center justify-between rounded-[12px] px-3 py-2 text-left text-sm transition-colors ${
                    active
                      ? 'bg-[color:var(--color-primary)]/12 text-[color:var(--color-foreground)]'
                      : 'text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]'
                  }`}
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    setSelectedProviderDraftId(provider.draftId)
                    setProviderDropdownOpen(false)
                  }}
                >
                  <span className="truncate font-medium">
                    {provider.key.trim() || provider.name.trim() || t('settings.codex.providerPlaceholder')}
                  </span>
                  {active && <Check className="h-4 w-4 shrink-0 text-[color:var(--color-primary)]" />}
                </button>
              )
            })}
          </div>
        </div>,
        document.body,
      )}

      <div className="rounded-[28px] border px-6 py-6 surface-card space-y-5" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">
              {t('settings.codex.providersTitle')}
            </h3>
            <p
              className="mt-2 text-sm leading-6 text-[color:var(--color-muted-foreground)]"
              dangerouslySetInnerHTML={tHtml('settings.codex.providersDescription')}
            />
          </div>
          <Button
            variant="outline"
            className="h-10 rounded-full px-4 text-sm"
            onClick={handleAddProvider}
            disabled={inputDisabled}
          >
            <Plus className="h-4 w-4" />
            {t('settings.codex.addProvider')}
          </Button>
        </div>

        {activeProvider && (
          <div
            className="rounded-[22px] border px-5 py-5"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.providerKey')}</p>
                <Input
                  value={activeProvider.key}
                  onChange={(event) => handleProviderChange(activeProviderIndex, 'key', event.target.value)}
                  placeholder={t('settings.codex.providerPlaceholder')}
                  disabled={inputDisabled}
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.providerName')}</p>
                <Input
                  value={activeProvider.name}
                  onChange={(event) => handleProviderChange(activeProviderIndex, 'name', event.target.value)}
                  disabled={inputDisabled}
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.providerBaseUrl')}</p>
                <Input
                  value={activeProvider.baseUrl}
                  onChange={(event) => handleProviderChange(activeProviderIndex, 'baseUrl', event.target.value)}
                  disabled={inputDisabled}
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.providerWireApi')}</p>
                <Input
                  value={activeProvider.wireApi}
                  onChange={(event) => handleProviderChange(activeProviderIndex, 'wireApi', event.target.value)}
                  disabled={inputDisabled}
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.providerEnvKey')}</p>
                <Input
                  value={activeProvider.envKey}
                  onChange={(event) => handleProviderChange(activeProviderIndex, 'envKey', event.target.value)}
                  disabled={inputDisabled}
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.providerRequiresOpenaiAuth')}</p>
                <label className="quiet-control flex h-10 items-center gap-2 rounded-full px-4 text-sm text-[color:var(--color-foreground)]">
                  <input
                    type="checkbox"
                    checked={activeProvider.requiresOpenaiAuth}
                    onChange={(event) => handleProviderChange(activeProviderIndex, 'requiresOpenaiAuth', event.target.checked)}
                    disabled={inputDisabled}
                  />
                  {activeProvider.requiresOpenaiAuth ? 'true' : 'false'}
                </label>
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <Button
                variant="outline"
                className="h-10 rounded-full px-4 text-sm text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-background)]"
                onClick={() => handleDeleteProvider(activeProviderIndex)}
                disabled={inputDisabled || providers.length <= 1}
              >
                <Trash2 className="h-4 w-4" />
                {t('common.delete')}
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-[28px] border px-6 py-6 surface-card space-y-5" style={{ borderColor: 'var(--color-border)' }}>
        <div>
          <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">
            {t('settings.codex.modelTitle')}
          </h3>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.model')}</p>
            <Input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              disabled={inputDisabled}
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.modelReasoningEffort')}</p>
            <Input
              value={modelReasoningEffort}
              onChange={(event) => setModelReasoningEffort(event.target.value)}
              disabled={inputDisabled}
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.preferredAuthMethod')}</p>
            <Input
              value={preferredAuthMethod}
              onChange={(event) => setPreferredAuthMethod(event.target.value)}
              disabled={inputDisabled}
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.codex.approvalsReviewer')}</p>
            <Input
              value={approvalsReviewer}
              onChange={(event) => setApprovalsReviewer(event.target.value)}
              disabled={inputDisabled}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            className="h-10 rounded-full px-5 text-sm"
            onClick={() => void handleSave()}
            disabled={inputDisabled || Boolean(validationError) || !hasCachedSnapshot}
            loading={saving}
          >
            <Save className="h-4 w-4" />
            {saving ? t('common.saving') : t('settings.codex.save')}
          </Button>
        </div>

        {savedHint && (
          <p className="text-xs text-[color:var(--color-muted-foreground)]">{savedHint}</p>
        )}
        {(validationError || error) && (
          <p className="text-xs text-[color:var(--color-destructive)]">{validationError || error}</p>
        )}
      </div>

      <div className="rounded-[24px] border px-5 py-4 surface-card" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-start gap-3 text-sm text-[color:var(--color-muted-foreground)]">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="leading-6">
            {scope?.target === 'wsl'
              ? `WSL: ${scope.homePath}`
              : `${scope?.hostPlatform ?? 'native'}: ${scope?.homePath ?? ''}`}
          </div>
        </div>
      </div>
    </div>
  )
}

export { SettingsCodexPanel }
