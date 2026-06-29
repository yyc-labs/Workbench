import { ThemeSegmentedControl } from './ThemeSegmentedControl'
import type {
  AppLocale,
  CloseWindowBehavior,
} from '../../../shared/types'
import { useI18n } from '../../i18n'
import type { ThemeMode } from './settings.types'

type GeneralPanelProps = {
  theme: ThemeMode
  locale: AppLocale
  launchOnLogin: boolean
  closeWindowBehavior: CloseWindowBehavior
  supportsLaunchOnLogin: boolean
  supportsCloseWindowBehavior: boolean
  onThemeChange: (next: ThemeMode) => void
  onLocaleChange: (next: NonNullable<AppLocale>) => void
  onLaunchOnLoginChange: (enabled: boolean) => void | Promise<void>
  onCloseWindowBehaviorChange: (behavior: CloseWindowBehavior) => void | Promise<void>
}

function SettingsGeneralPanel({
  theme,
  locale,
  launchOnLogin,
  closeWindowBehavior,
  supportsLaunchOnLogin,
  supportsCloseWindowBehavior,
  onThemeChange,
  onLocaleChange,
  onLaunchOnLoginChange,
  onCloseWindowBehaviorChange,
}: GeneralPanelProps) {
  const { t } = useI18n()

  return (
    <div className="space-y-8">
      <div>
        <p className="section-label mb-3">{t('settings.general.appearance')}</p>
        <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">{t('settings.general.interface')}</h2>
        <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2 mb-6">
          {t('settings.general.description')}
        </p>
        <ThemeSegmentedControl value={theme} onChange={onThemeChange} />
      </div>

      <div>
        <p className="section-label mb-3">{t('settings.general.language')}</p>
        <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">{t('settings.general.language')}</h2>
        <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2 mb-6">
          {t('settings.general.languageDescription')}
        </p>
        <div className="quiet-control inline-flex rounded-full p-1 gap-0.5">
          {[
            { value: 'system', label: t('settings.general.followSystem') },
            { value: 'en-US', label: t('settings.general.english') },
            { value: 'zh-CN', label: t('settings.general.simplifiedChinese') },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => onLocaleChange(opt.value as NonNullable<AppLocale>)}
              className={`button-interactive flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                locale === opt.value
                  ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm'
                  : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {supportsLaunchOnLogin && (
        <div>
          <p className="section-label mb-3">{t('settings.general.startup')}</p>
          <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">{t('settings.general.launchOnLogin')}</h2>
          <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2 mb-6">
            {t('settings.general.launchOnLoginDescription')}
          </p>
          <label className="inline-flex items-start gap-2 text-sm text-[color:var(--color-foreground)]">
            <input
              type="checkbox"
              checked={launchOnLogin}
              onChange={(e) => void onLaunchOnLoginChange(e.target.checked)}
            />
            <span>
              <span className="block">{t('settings.general.launchOnLoginLabel')}</span>
              <span className="mt-1 block text-xs leading-5 text-[color:var(--color-muted-foreground)]">
                {t('settings.general.launchOnLoginHint')}
              </span>
            </span>
          </label>
        </div>
      )}

      {supportsCloseWindowBehavior && (
        <div>
          <p className="section-label mb-3">{t('settings.general.window')}</p>
          <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">{t('settings.general.closeBehavior')}</h2>
          <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2 mb-6">
            {t('settings.general.closeBehaviorDescription')}
          </p>
          <div className="quiet-control inline-flex rounded-full p-1 gap-0.5">
            {[
              { value: 'quit', label: t('settings.general.closeBehaviorQuit') },
              { value: 'tray', label: t('settings.general.closeBehaviorTray') },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => void onCloseWindowBehaviorChange(opt.value as CloseWindowBehavior)}
                className={`button-interactive flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                  closeWindowBehavior === opt.value
                    ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm'
                    : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-[color:var(--color-muted-foreground)]">
            {t('settings.general.closeBehaviorHint')}
          </p>
        </div>
      )}
    </div>
  )
}

export { SettingsGeneralPanel }
