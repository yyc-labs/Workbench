import { ThemeSegmentedControl } from './ThemeSegmentedControl'
import type { AppLocale } from '../../../shared/types'
import { useI18n } from '../../i18n'
import type { ThemeMode } from './settings.types'

type GeneralPanelProps = {
  theme: ThemeMode
  locale: AppLocale
  onThemeChange: (next: ThemeMode) => void
  onLocaleChange: (next: NonNullable<AppLocale>) => void
}

function SettingsGeneralPanel({ theme, locale, onThemeChange, onLocaleChange }: GeneralPanelProps) {
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
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all ${
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
    </div>
  )
}

export { SettingsGeneralPanel }
