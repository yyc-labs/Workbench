import { Button } from '../../../components/ui/button'
import { useI18n } from '../../../i18n'
import type { RuntimeDiagnosticsState } from './settingsRuntimeShared'

function renderDiagStatus(value: boolean | undefined, t: ReturnType<typeof useI18n>['t']): string {
  if (typeof value !== 'boolean') return t('settingsRuntime.notAvailable')
  return value ? t('settingsRuntime.yes') : t('settingsRuntime.no')
}

export function RuntimeDiagnosticsCard({
  diag,
  loading,
  onRunCheck,
}: {
  diag: RuntimeDiagnosticsState | null
  loading: boolean
  onRunCheck: () => void
}) {
  const { t } = useI18n()

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-medium text-[color:var(--color-foreground)]">{t('settingsRuntime.diagnostics')}</h3>
        <Button
          variant="outline"
          className="quiet-control h-8 rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]"
          onClick={onRunCheck}
          loading={loading}
        >
          {loading ? t('settingsRuntime.checking') : t('settingsRuntime.runCheck')}
        </Button>
      </div>
      {diag && (
        <div className="rounded-[22px] border px-5 py-4 surface-card space-y-1 text-xs" style={{ borderColor: 'var(--color-border)' }}>
          <p>{t('settingsRuntime.diagMode')}: {diag.mode}</p>
          <p>{t('settingsRuntime.diagProvider')}: {diag.providerLabel}</p>
          <p>{t('settingsRuntime.diagSupported')}: {diag.supported ? t('settingsRuntime.yes') : t('settingsRuntime.no')}</p>
          <p>{t('settingsRuntime.diagWsl')}: {diag.hasWsl ? 'OK' : t('settingsRuntime.missing')}</p>
          <p>{t('settingsRuntime.diagTmux')}: {diag.hasTmux ? 'OK' : t('settingsRuntime.missing')}</p>
          <p>{t('settingsRuntime.diagScriptExists')}: {renderDiagStatus(diag.launcherScriptExists, t)}</p>
          <p>{t('settingsRuntime.diagScriptExecutable')}: {renderDiagStatus(diag.launcherScriptExecutable, t)}</p>
          {diag.issues.length > 0 && (
            <div className="mt-2 whitespace-pre-line text-[color:var(--color-destructive)]">
              {diag.issues.map((issue) => `- ${issue}`).join('\n')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
