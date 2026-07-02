import { AlertTriangle } from 'lucide-react'
import { ModalShell } from '../../../components/ModalShell'
import { Button } from '../../../components/ui/button'
import { useI18n } from '../../../i18n'
import type {
  ProviderDraft,
  ProviderUsage,
} from './settingsAiGatewayShared'

type AiGatewayDeleteProviderModalProps = {
  provider: ProviderDraft | null
  usage: ProviderUsage | null
  saving: boolean
  onClose: () => void
  onConfirm: () => void
}

export function AiGatewayDeleteProviderModal({
  provider,
  usage,
  saving,
  onClose,
  onConfirm,
}: AiGatewayDeleteProviderModalProps) {
  const { t } = useI18n()

  return (
    <ModalShell
      open={Boolean(provider)}
      onClose={() => {
        if (saving) return
        onClose()
      }}
      widthClassName="max-w-[600px]"
      ariaLabel={t('settings.aiGateway.deleteProviderConfirmLabel')}
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
          <div>
            <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">
              {t('settings.aiGateway.deleteProviderConfirmTitle')}
            </h3>
            <p className="mt-1 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
              {t('settings.aiGateway.deleteProviderConfirmHint', {
                provider: provider?.name || provider?.id || '',
              })}
            </p>
          </div>
        </div>

        <div className="grid gap-3">
          {usage?.claudeProfiles.map((name) => (
            <div key={`delete-claude:${name}`} className="rounded-[14px] bg-[color:var(--color-card)] px-3 py-2 text-sm text-[color:var(--color-foreground)]">
              {t('settings.aiGateway.usedByClaude', { value: name })}
            </div>
          ))}
          {usage?.codexScopes.map((scopeKey) => (
            <div key={`delete-codex:${scopeKey}`} className="rounded-[14px] bg-[color:var(--color-card)] px-3 py-2 text-sm text-[color:var(--color-foreground)]">
              {t('settings.aiGateway.usedByCodex', { value: scopeKey })}
            </div>
          ))}
          {usage?.manualRoutes.map((modelName) => (
            <div key={`delete-route:${modelName}`} className="rounded-[14px] bg-[color:var(--color-card)] px-3 py-2 text-sm text-[color:var(--color-foreground)]">
              {t('settings.aiGateway.usedByRoute', { value: modelName })}
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-10 px-4"
            onClick={onClose}
            disabled={saving}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="h-10 px-4"
            onClick={onConfirm}
            disabled={saving || !provider}
          >
            {t('settings.aiGateway.deleteProviderAnyway')}
          </Button>
        </div>
      </div>
    </ModalShell>
  )
}
