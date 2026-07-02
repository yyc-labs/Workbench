import { Play, RefreshCw, Router, Save, Square } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ClaudeRuntimeProfile } from '../../../shared/types'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { useI18n } from '../../i18n'
import { getCodexGatewayBindingIssue } from '../../lib/codexGatewaySummary'
import {
  BindingCard,
  ExpandableCard,
  GatewayAdvancedMeaningCard,
  GatewayGuideContent,
  GatewayQuickStartCard,
} from './aiGateway/AiGatewayCards'
import { AiGatewayDeleteProviderModal } from './aiGateway/AiGatewayDeleteProviderModal'
import { AiGatewayProviderEditor } from './aiGateway/AiGatewayProviderEditor'
import { useAiGatewaySettingsDraft } from './aiGateway/useAiGatewaySettingsDraft'

type SettingsAiGatewayPanelProps = {
  profiles?: ClaudeRuntimeProfile[]
  activeProfileId?: string
  onProfilesSave?: (profiles: ClaudeRuntimeProfile[], activeProfileId: string) => Promise<void>
}

export function SettingsAiGatewayPanel({
  profiles = [],
  activeProfileId,
  onProfilesSave,
}: SettingsAiGatewayPanelProps) {
  const { t } = useI18n()
  const {
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
    dismissDeleteProviderConfirm,
  } = useAiGatewaySettingsDraft({
    profiles,
    activeProfileId,
    onProfilesSave,
  })
  const [guideOpen, setGuideOpen] = useState(false)
  const [relationshipsOpen, setRelationshipsOpen] = useState(false)
  const [serverOpen, setServerOpen] = useState(false)
  const [providerAdvancedOpen, setProviderAdvancedOpen] = useState(false)
  const [advancedMeaningOpen, setAdvancedMeaningOpen] = useState(false)
  const [bindingsOpen, setBindingsOpen] = useState(false)

  const statusCards = useMemo(() => ([
    {
      label: t('settings.aiGateway.status'),
      value: status?.running ? t('settings.aiGateway.running') : t('settings.aiGateway.stopped'),
    },
    {
      label: t('settings.aiGateway.endpoint'),
      value: status?.url ?? t('settings.aiGateway.notAvailable'),
    },
    {
      label: t('settings.aiGateway.activeProvider'),
      value: status?.activeProvider?.name ?? t('settings.aiGateway.notAvailable'),
    },
    {
      label: t('settings.aiGateway.protocol'),
      value: status?.activeProvider?.protocol ?? t('settings.aiGateway.notAvailable'),
    },
  ]), [status, t])

  return (
    <div className="space-y-8">
      <div className="rounded-[28px] border px-6 py-6 surface-card" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="section-label mb-3">{t('settings.aiGateway.kicker')}</p>
            <h3 className="text-xl font-semibold tracking-[-0.03em] text-[color:var(--color-foreground)]">
              {t('settings.aiGateway.title')}
            </h3>
            <p className="mt-2 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
              {t('settings.aiGateway.description')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="h-10 rounded-full px-4 text-sm"
              onClick={() => void loadGateway()}
              loading={loading}
              disabled={saving}
            >
              <RefreshCw className="h-4 w-4" />
              {t('settings.aiGateway.refresh')}
            </Button>
            <Button
              className="h-10 rounded-full px-4 text-sm"
              onClick={() => void handleStartStop(!status?.running)}
              disabled={inputDisabled}
            >
              {status?.running ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {status?.running ? t('settings.aiGateway.stop') : t('settings.aiGateway.start')}
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {statusCards.map((card) => (
            <div key={card.label} className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3">
              <div className="text-xs text-[color:var(--color-muted-foreground)]">{card.label}</div>
              <div className="mt-1 truncate text-sm font-medium text-[color:var(--color-foreground)]">{card.value}</div>
            </div>
          ))}
        </div>

        {status?.error && (
          <p className="mt-4 text-xs text-[color:var(--color-destructive)]">{status.error}</p>
        )}
      </div>

      <GatewayQuickStartCard />

      <ExpandableCard
        title={t('settings.aiGateway.relationshipTitle')}
        description={t('settings.aiGateway.relationshipDescription')}
        open={relationshipsOpen}
        onToggle={() => setRelationshipsOpen((current) => !current)}
      >
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3">
              <div className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.relationshipClaudeProfiles')}</div>
              <div className="mt-1 text-sm font-medium text-[color:var(--color-foreground)]">
                {t('settings.aiGateway.relationshipCount', { count: String(claudeGatewayProfiles.length) })}
              </div>
            </div>
            <div className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3">
              <div className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.relationshipCodexScopes')}</div>
              <div className="mt-1 text-sm font-medium text-[color:var(--color-foreground)]">
                {t('settings.aiGateway.relationshipCount', { count: String(codexGatewayScopes.length) })}
              </div>
            </div>
            <div className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3">
              <div className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.relationshipWarnings')}</div>
              <div className={`mt-1 text-sm font-medium ${invalidCodexBindingCount > 0 ? 'text-[color:var(--color-destructive)]' : 'text-[color:var(--color-foreground)]'}`}>
                {t('settings.aiGateway.relationshipCount', { count: String(invalidCodexBindingCount) })}
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-[20px] border px-4 py-4" style={{ borderColor: 'var(--color-border)' }}>
              <h4 className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('settings.aiGateway.relationshipClaudeProfiles')}</h4>
              <div className="mt-3 space-y-2">
                {claudeGatewayProfiles.length > 0 ? claudeGatewayProfiles.map((profile) => (
                  <div key={profile.id} className="flex items-center justify-between gap-3 rounded-[14px] bg-[color:var(--color-card)] px-3 py-2 text-xs">
                    <span className="min-w-0 truncate text-[color:var(--color-foreground)]">{profile.name || profile.id}</span>
                    <span className="shrink-0 text-[color:var(--color-muted-foreground)]">{profile.gateway?.providerId}</span>
                  </div>
                )) : (
                  <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.relationshipNoClaudeProfiles')}</p>
                )}
              </div>
            </div>

            <div className="rounded-[20px] border px-4 py-4" style={{ borderColor: 'var(--color-border)' }}>
              <h4 className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('settings.aiGateway.relationshipCodexScopes')}</h4>
              <div className="mt-3 space-y-2">
                {codexGatewayScopes.length > 0 ? codexGatewayScopes.map((binding) => {
                  const issue = getCodexGatewayBindingIssue(binding, config)
                  return (
                    <div key={binding.scopeKey} className="flex items-center justify-between gap-3 rounded-[14px] bg-[color:var(--color-card)] px-3 py-2 text-xs">
                      <span className="min-w-0 truncate text-[color:var(--color-foreground)]">{binding.scopeKey}</span>
                      <span className={issue ? 'shrink-0 text-[color:var(--color-destructive)]' : 'shrink-0 text-[color:var(--color-muted-foreground)]'}>
                        {issue ? t('settings.aiGateway.relationshipInvalid') : binding.providerId}
                      </span>
                    </div>
                  )
                }) : (
                  <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.relationshipNoCodexScopes')}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </ExpandableCard>

      <ExpandableCard
        title={t('settings.aiGateway.guideTitle')}
        description={t('settings.aiGateway.guideDescription')}
        open={guideOpen}
        onToggle={() => setGuideOpen((current) => !current)}
      >
        <GatewayGuideContent />
      </ExpandableCard>

      <ExpandableCard
        title={t('settings.aiGateway.serverTitle')}
        description={t('settings.aiGateway.serverDefaultsHint')}
        open={serverOpen}
        onToggle={() => setServerOpen((current) => !current)}
      >
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <Router className="h-5 w-5 text-[color:var(--color-muted-foreground)]" strokeWidth={1.8} />
            <div>
              <h4 className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('settings.aiGateway.serverTitle')}</h4>
              <p className="mt-1 text-sm text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.serverDescription')}</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.host')}</p>
              <Input
                value={config?.host ?? ''}
                onChange={(event) => updateConfigDraft({ host: event.target.value })}
                disabled={inputDisabled}
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.port')}</p>
              <Input
                type="number"
                value={config?.port ?? ''}
                onChange={(event) => updateConfigDraft({ port: Number(event.target.value) })}
                disabled={inputDisabled}
              />
            </div>
          </div>
        </div>
      </ExpandableCard>

      <AiGatewayProviderEditor
        activeProvider={activeProvider}
        activeProviderUsage={activeProviderUsage}
        inputDisabled={inputDisabled}
        providerAdvancedOpen={providerAdvancedOpen}
        providerOptions={providerOptions}
        providersCount={providers.length}
        selectedProviderDraftId={selectedProviderDraftId}
        onAddProvider={handleAddProvider}
        onDeleteProvider={handleDeleteProvider}
        onProviderAdvancedToggle={() => setProviderAdvancedOpen((current) => !current)}
        onProviderChange={updateProvider}
        onProviderCapabilityChange={updateProviderCapability}
        onSelectedProviderDraftIdChange={setSelectedProviderDraftId}
      />

      <ExpandableCard
        title={t('settings.aiGateway.advancedMeaningTitle')}
        description={t('settings.aiGateway.advancedMeaningDescription')}
        open={advancedMeaningOpen}
        onToggle={() => setAdvancedMeaningOpen((current) => !current)}
      >
        <GatewayAdvancedMeaningCard />
      </ExpandableCard>

      <ExpandableCard
        title={t('settings.aiGateway.bindingsTitle')}
        description={t('settings.aiGateway.bindingsDescription')}
        open={bindingsOpen}
        onToggle={() => setBindingsOpen((current) => !current)}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <BindingCard
            cli="claude"
            status={status}
            busy={inputDisabled}
            onApply={(cli) => void handleBindingAction(cli, 'apply')}
            onRestore={(cli) => void handleBindingAction(cli, 'restore')}
          />
          <BindingCard
            cli="codex"
            status={status}
            busy={inputDisabled}
            onApply={(cli) => void handleBindingAction(cli, 'apply')}
            onRestore={(cli) => void handleBindingAction(cli, 'restore')}
          />
        </div>
      </ExpandableCard>

      <AiGatewayDeleteProviderModal
        provider={deleteConfirmProvider}
        usage={deleteConfirmProviderUsage}
        saving={saving}
        onClose={dismissDeleteProviderConfirm}
        onConfirm={() => {
          if (!deleteConfirmProvider) return
          deleteProviderDraft(deleteConfirmProvider.draftId)
        }}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button
          className="h-10 rounded-full px-5 text-sm"
          onClick={() => void handleSave()}
          loading={saving}
          disabled={inputDisabled || !config}
        >
          <Save className="h-4 w-4" />
          {saving ? t('common.saving') : t('settings.aiGateway.save')}
        </Button>
        {savedHint && <p className="text-sm text-[color:var(--color-muted-foreground)]">{savedHint}</p>}
        {error && <p className="text-sm text-[color:var(--color-destructive)]">{error}</p>}
      </div>
    </div>
  )
}
