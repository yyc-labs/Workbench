import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import type {
  AiGatewayProviderCapabilities,
  AiGatewayUpstreamProtocol,
} from '../../../../shared/types'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Select, type SelectOption } from '../../../components/ui/select'
import { useI18n } from '../../../i18n'
import {
  EMPTY_PROVIDER_USAGE,
  isProviderUsageEmpty,
  type ProviderDraft,
  type ProviderUsage,
} from './settingsAiGatewayShared'

const PROTOCOL_OPTIONS: SelectOption[] = [
  { value: 'openai_chat', label: 'openai_chat' },
  { value: 'openai_responses', label: 'openai_responses' },
  { value: 'anthropic_messages', label: 'anthropic_messages' },
]

const CAPABILITY_OPTIONS: Array<{
  key: keyof AiGatewayProviderCapabilities
  labelKey: string
  descriptionKey: string
  group: 'common' | 'advanced'
}> = [
  {
    key: 'supportsStreaming',
    labelKey: 'settings.aiGateway.capabilityStreaming',
    descriptionKey: 'settings.aiGateway.capabilityStreamingHint',
    group: 'common',
  },
  {
    key: 'supportsTools',
    labelKey: 'settings.aiGateway.capabilityTools',
    descriptionKey: 'settings.aiGateway.capabilityToolsHint',
    group: 'common',
  },
  {
    key: 'supportsParallelToolCalls',
    labelKey: 'settings.aiGateway.capabilityParallelTools',
    descriptionKey: 'settings.aiGateway.capabilityParallelToolsHint',
    group: 'common',
  },
  {
    key: 'supportsStrictTools',
    labelKey: 'settings.aiGateway.capabilityStrictTools',
    descriptionKey: 'settings.aiGateway.capabilityStrictToolsHint',
    group: 'advanced',
  },
  {
    key: 'supportsDeveloperMessages',
    labelKey: 'settings.aiGateway.capabilityDeveloperMessages',
    descriptionKey: 'settings.aiGateway.capabilityDeveloperMessagesHint',
    group: 'advanced',
  },
  {
    key: 'supportsReasoning',
    labelKey: 'settings.aiGateway.capabilityReasoning',
    descriptionKey: 'settings.aiGateway.capabilityReasoningHint',
    group: 'advanced',
  },
  {
    key: 'supportsResponsesInputItems',
    labelKey: 'settings.aiGateway.capabilityResponsesItems',
    descriptionKey: 'settings.aiGateway.capabilityResponsesItemsHint',
    group: 'advanced',
  },
  {
    key: 'supportsAnthropicContentBlocks',
    labelKey: 'settings.aiGateway.capabilityAnthropicBlocks',
    descriptionKey: 'settings.aiGateway.capabilityAnthropicBlocksHint',
    group: 'advanced',
  },
  {
    key: 'supportsImages',
    labelKey: 'settings.aiGateway.capabilityImages',
    descriptionKey: 'settings.aiGateway.capabilityImagesHint',
    group: 'advanced',
  },
  {
    key: 'supportsDocuments',
    labelKey: 'settings.aiGateway.capabilityDocuments',
    descriptionKey: 'settings.aiGateway.capabilityDocumentsHint',
    group: 'advanced',
  },
]

const CAPABILITY_GROUPS: Array<{
  key: 'common' | 'advanced'
  titleKey: string
  descriptionKey: string
}> = [
  {
    key: 'common',
    titleKey: 'settings.aiGateway.capabilitiesCommonTitle',
    descriptionKey: 'settings.aiGateway.capabilitiesCommonDescription',
  },
  {
    key: 'advanced',
    titleKey: 'settings.aiGateway.capabilitiesAdvancedTitle',
    descriptionKey: 'settings.aiGateway.capabilitiesAdvancedDescription',
  },
]

type ProviderChangeHandler = <K extends keyof ProviderDraft>(field: K, value: ProviderDraft[K]) => void

type AiGatewayProviderEditorProps = {
  activeProvider: ProviderDraft | null
  activeProviderUsage: ProviderUsage | null
  inputDisabled: boolean
  providerAdvancedOpen: boolean
  providerOptions: SelectOption[]
  providersCount: number
  selectedProviderDraftId: string
  onAddProvider: () => void
  onDeleteProvider: () => void
  onProviderAdvancedToggle: () => void
  onProviderChange: ProviderChangeHandler
  onProviderCapabilityChange: (key: keyof AiGatewayProviderCapabilities, value: boolean) => void
  onSelectedProviderDraftIdChange: (value: string) => void
}

function ProviderUsageBadges({ usage }: { usage: ProviderUsage }) {
  const { t } = useI18n()

  if (isProviderUsageEmpty(usage)) return null

  return (
    <div className="md:col-span-2 flex flex-wrap gap-2">
      {usage.claudeProfiles.map((name) => (
        <span key={`claude:${name}`} className="rounded-full bg-[color:var(--color-primary)]/10 px-3 py-1 text-xs text-[color:var(--color-primary)]">
          {t('settings.aiGateway.usedByClaude', { value: name })}
        </span>
      ))}
      {usage.codexScopes.map((scopeKey) => (
        <span key={`codex:${scopeKey}`} className="rounded-full bg-[color:var(--color-primary)]/10 px-3 py-1 text-xs text-[color:var(--color-primary)]">
          {t('settings.aiGateway.usedByCodex', { value: scopeKey })}
        </span>
      ))}
      {usage.manualRoutes.map((modelName) => (
        <span key={`manual:${modelName}`} className="rounded-full bg-[color:var(--color-card)] px-3 py-1 text-xs text-[color:var(--color-muted-foreground)]">
          {t('settings.aiGateway.usedByRoute', { value: modelName })}
        </span>
      ))}
    </div>
  )
}

export function AiGatewayProviderEditor({
  activeProvider,
  activeProviderUsage,
  inputDisabled,
  providerAdvancedOpen,
  providerOptions,
  providersCount,
  selectedProviderDraftId,
  onAddProvider,
  onDeleteProvider,
  onProviderAdvancedToggle,
  onProviderChange,
  onProviderCapabilityChange,
  onSelectedProviderDraftIdChange,
}: AiGatewayProviderEditorProps) {
  const { t } = useI18n()

  return (
    <div className="rounded-[28px] border px-6 py-6 surface-card space-y-5" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">{t('settings.aiGateway.providerTitle')}</h3>
          <p className="mt-1 text-sm text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.providerDescription')}</p>
        </div>
        <Button
          variant="outline"
          className="h-10 rounded-full px-4 text-sm"
          onClick={onAddProvider}
          disabled={inputDisabled}
        >
          <Plus className="h-4 w-4" />
          {t('settings.aiGateway.addProvider')}
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {[
          t('settings.aiGateway.providerBaseUrlHelp'),
          t('settings.aiGateway.providerProtocolHelp'),
          t('settings.aiGateway.providerModelMapHelp'),
          t('settings.aiGateway.providerApiKeyHelp'),
        ].map((hint) => (
          <div key={hint} className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3 text-xs leading-5 text-[color:var(--color-muted-foreground)]">
            {hint}
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5 md:col-span-2">
          <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.activeProvider')}</p>
          <Select
            ariaLabel={t('settings.aiGateway.activeProvider')}
            value={selectedProviderDraftId}
            options={providerOptions}
            onChange={onSelectedProviderDraftIdChange}
            disabled={inputDisabled || providerOptions.length === 0}
            triggerClassName="h-11"
          />
        </div>

        {activeProvider && (
          <>
            <div className="md:col-span-2 rounded-[18px] bg-[color:var(--color-background-sunken)]/55 px-4 py-3 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
              {t('settings.aiGateway.providerRoutingHint')}
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.providerName')}</p>
              <Input value={activeProvider.name} onChange={(event) => onProviderChange('name', event.target.value)} disabled={inputDisabled} />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.providerBaseUrl')}</p>
              <Input value={activeProvider.baseUrl} onChange={(event) => onProviderChange('baseUrl', event.target.value)} disabled={inputDisabled} />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.protocol')}</p>
              <Select
                ariaLabel={t('settings.aiGateway.protocol')}
                value={activeProvider.protocol}
                options={PROTOCOL_OPTIONS}
                onChange={(value) => onProviderChange('protocol', value as AiGatewayUpstreamProtocol)}
                disabled={inputDisabled}
                triggerClassName="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.apiKeyEnv')}</p>
              <Input value={activeProvider.apiKeyEnv ?? ''} onChange={(event) => onProviderChange('apiKeyEnv', event.target.value)} disabled={inputDisabled} />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.apiKey')}</p>
              <Input
                type="password"
                value={activeProvider.apiKey ?? ''}
                onChange={(event) => onProviderChange('apiKey', event.target.value)}
                disabled={inputDisabled}
                placeholder="sk-..."
              />
            </div>
            <div className="md:col-span-2 rounded-[20px] border px-4 py-4" style={{ borderColor: 'var(--color-border)' }}>
              <button
                type="button"
                className="flex w-full items-start justify-between gap-4 text-left"
                onClick={onProviderAdvancedToggle}
                aria-expanded={providerAdvancedOpen}
              >
                <div>
                  <h4 className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('settings.aiGateway.providerAdvancedTitle')}</h4>
                  <p className="mt-1 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.providerAdvancedDescription')}</p>
                </div>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-card)] text-[color:var(--color-muted-foreground)]">
                  <ChevronDown className={`h-4 w-4 transition-transform ${providerAdvancedOpen ? 'rotate-180' : ''}`} strokeWidth={1.8} />
                </span>
              </button>

              {providerAdvancedOpen && (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <ProviderUsageBadges usage={activeProviderUsage ?? EMPTY_PROVIDER_USAGE} />
                  <div className="space-y-1.5">
                    <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.providerId')}</p>
                    <Input value={activeProvider.id} onChange={(event) => onProviderChange('id', event.target.value)} disabled={inputDisabled} />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.timeoutMs')}</p>
                    <Input
                      type="number"
                      value={activeProvider.timeoutMs ?? ''}
                      onChange={(event) => onProviderChange('timeoutMs', Number(event.target.value))}
                      disabled={inputDisabled}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.streamRetryCount')}</p>
                    <Input
                      type="number"
                      min={0}
                      max={10}
                      value={activeProvider.streamRetryCount ?? ''}
                      onChange={(event) => onProviderChange('streamRetryCount', Number(event.target.value))}
                      disabled={inputDisabled}
                    />
                    <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.streamRetryCountHint')}</p>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.streamRetryDelayMs')}</p>
                    <Input
                      type="number"
                      min={0}
                      max={10000}
                      value={activeProvider.streamRetryDelayMs ?? ''}
                      onChange={(event) => onProviderChange('streamRetryDelayMs', Number(event.target.value))}
                      disabled={inputDisabled}
                    />
                    <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.streamRetryDelayMsHint')}</p>
                  </div>
                  <div className="space-y-3 rounded-[20px] border px-4 py-4 md:col-span-2" style={{ borderColor: 'var(--color-border)' }}>
                    <div>
                      <h4 className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('settings.aiGateway.capabilitiesTitle')}</h4>
                      <p className="mt-1 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.capabilitiesDescription')}</p>
                    </div>
                    <div className="rounded-[16px] bg-[color:var(--color-card)] px-4 py-3 text-xs leading-5 text-[color:var(--color-muted-foreground)]">
                      {t('settings.aiGateway.capabilitiesDefaultsHint')}
                    </div>
                    <div className="space-y-4">
                      {CAPABILITY_GROUPS.map((group) => (
                        <div key={group.key} className="space-y-2">
                          <div>
                            <h5 className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--color-muted-foreground)]">
                              {t(group.titleKey)}
                            </h5>
                            <p className="mt-1 text-xs leading-5 text-[color:var(--color-muted-foreground)]">
                              {t(group.descriptionKey)}
                            </p>
                          </div>
                          <div className="grid gap-2 lg:grid-cols-2">
                            {CAPABILITY_OPTIONS.filter((option) => option.group === group.key).map((option) => (
                              <label
                                key={option.key}
                                className="quiet-control flex min-h-[74px] items-start gap-3 rounded-[16px] px-4 py-3 text-[color:var(--color-foreground)]"
                              >
                                <input
                                  className="mt-0.5"
                                  type="checkbox"
                                  checked={activeProvider.capabilities?.[option.key] === true}
                                  onChange={(event) => onProviderCapabilityChange(option.key, event.target.checked)}
                                  disabled={inputDisabled}
                                />
                                <span className="min-w-0">
                                  <span className="block text-sm font-medium">
                                    {t(option.labelKey)}
                                  </span>
                                  <span className="mt-1 block text-xs leading-5 text-[color:var(--color-muted-foreground)]">
                                    {t(option.descriptionKey)}
                                  </span>
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.modelMap')}</p>
                    <textarea
                      value={activeProvider.modelMapText}
                      onChange={(event) => onProviderChange('modelMapText', event.target.value)}
                      disabled={inputDisabled}
                      placeholder={t('settings.aiGateway.modelMapPlaceholder')}
                      className="quiet-control min-h-[96px] w-full rounded-[18px] px-4 py-3 font-mono text-sm text-[color:var(--color-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.modelMapHint')}</p>
                  </div>
                  <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3">
                    <label className="quiet-control flex h-10 items-center gap-2 rounded-full px-4 text-sm text-[color:var(--color-foreground)]">
                      <input
                        type="checkbox"
                        checked={activeProvider.enabled}
                        onChange={(event) => onProviderChange('enabled', event.target.checked)}
                        disabled={inputDisabled}
                      />
                      {t('settings.aiGateway.providerEnabled')}
                    </label>
                    <Button
                      variant="outline"
                      className="h-10 rounded-full px-4 text-sm text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-background)]"
                      onClick={onDeleteProvider}
                      disabled={inputDisabled || providersCount <= 1}
                    >
                      <Trash2 className="h-4 w-4" />
                      {t('common.delete')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
