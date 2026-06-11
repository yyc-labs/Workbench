import { Monitor, Sun, Moon } from 'lucide-react'
import type { ThemeMode } from './settings.types'
import { useI18n } from '../../i18n'

const THEME_OPTIONS = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const

type ThemeSegmentedControlProps = {
  value: ThemeMode
  onChange: (next: ThemeMode) => void
}

function ThemeSegmentedControl({ value, onChange }: ThemeSegmentedControlProps) {
  const { t } = useI18n()

  return (
    <div className="quiet-control inline-flex rounded-full p-1 gap-0.5">
      {THEME_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all ${
            value === opt.value
              ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm'
              : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
          }`}
        >
          <opt.icon className="w-3.5 h-3.5" strokeWidth={1.8} />
          {opt.value === 'system'
            ? t('settings.theme.system')
            : opt.value === 'light'
              ? t('settings.theme.light')
              : t('settings.theme.dark')}
        </button>
      ))}
    </div>
  )
}

export { ThemeSegmentedControl }
