import { AlertTriangle } from 'lucide-react'
import type { BrowserAiConfig } from '../../../shared/types'
import { ModalShell } from '../../components/ModalShell'
import { Button } from '../../components/ui/button'
import { useI18n } from '../../i18n'

type BrowserAiSiteConfig = BrowserAiConfig['sites'][number]

type SettingsBrowserAiDeleteSiteModalProps = {
  site: BrowserAiSiteConfig | null
  onClose: () => void
  onConfirm: () => void
}

export function SettingsBrowserAiDeleteSiteModal({ site, onClose, onConfirm }: SettingsBrowserAiDeleteSiteModalProps) {
  const { t } = useI18n()

  return (
    <ModalShell
      open={Boolean(site)}
      onClose={onClose}
      widthClassName="max-w-[420px]"
      ariaLabel={t('settings.browserAi.deleteSite')}
    >
      <div className="space-y-5">
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
              {t('settings.browserAi.deleteSite')}
            </h3>
            <p className="mt-1 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
              {t('settings.browserAi.deleteSiteConfirm', { value: site?.name ?? '' })}
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={!site}>
            {t('common.delete')}
          </Button>
        </div>
      </div>
    </ModalShell>
  )
}
