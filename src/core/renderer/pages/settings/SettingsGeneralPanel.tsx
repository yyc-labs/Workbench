import { ThemeSegmentedControl } from './ThemeSegmentedControl'
import type { ThemeMode } from './settings.types'

type GeneralPanelProps = {
  theme: ThemeMode
  onThemeChange: (next: ThemeMode) => void
}

function SettingsGeneralPanel({ theme, onThemeChange }: GeneralPanelProps) {
  return (
    <div className="space-y-8">
      <div>
        <p className="section-label mb-3">Appearance</p>
        <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">Interface</h2>
        <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2 mb-6">
          Customize how the application looks and feels.
        </p>
        <ThemeSegmentedControl value={theme} onChange={onThemeChange} />
      </div>
    </div>
  )
}

export { SettingsGeneralPanel }
