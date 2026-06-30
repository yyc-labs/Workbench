import { useEffect, useState } from 'react'
import { Keyboard } from 'lucide-react'
import type { ShortcutPreferencesConfig } from '../../../shared/types'
import { useI18n } from '../../i18n'

type SettingsShortcutsPanelProps = {
  shortcutPreferences?: ShortcutPreferencesConfig
  onSave: (shortcutPreferences: ShortcutPreferencesConfig) => Promise<void> | void
}

function SettingsShortcutsPanel({
  shortcutPreferences,
  onSave,
}: SettingsShortcutsPanelProps) {
  const { t } = useI18n()
  const [openViewer, setOpenViewer] = useState(Boolean(shortcutPreferences?.quickTranscriptCaptureOpenViewer))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    setOpenViewer(Boolean(shortcutPreferences?.quickTranscriptCaptureOpenViewer))
  }, [shortcutPreferences?.quickTranscriptCaptureOpenViewer])

  const handleOpenViewerChange = async (enabled: boolean) => {
    const previous = openViewer
    setOpenViewer(enabled)
    setSaving(true)
    setSaveError(null)
    try {
      await onSave({
        ...shortcutPreferences,
        quickTranscriptCaptureOpenViewer: enabled,
      })
    } catch (error) {
      setOpenViewer(previous)
      setSaveError(error instanceof Error ? error.message : t('settings.shortcuts.saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="section-label mb-3">{t('settings.shortcuts.kicker')}</p>
        <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">
          {t('settings.shortcuts.title')}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
          {t('settings.shortcuts.description')}
        </p>
      </div>

      <section className="quiet-control rounded-[22px] p-5">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--color-foreground)]">
              <Keyboard className="h-4 w-4" strokeWidth={1.8} />
              {t('settings.shortcuts.quickCaptureTitle')}
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--color-muted-foreground)]">
              {t('settings.shortcuts.quickCaptureDescription')}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[color:var(--color-muted-foreground)]">
              <span>{t('settings.shortcuts.quickCaptureShortcut')}</span>
              <kbd className="rounded-full border px-2.5 py-1 font-mono text-[11px] text-[color:var(--color-foreground)]" style={{ borderColor: 'var(--color-border)' }}>
                Ctrl/Cmd+Shift+K
              </kbd>
            </div>
          </div>

          <label className="flex max-w-sm items-start gap-3 rounded-[18px] bg-[color:var(--color-card)] px-4 py-3 text-sm text-[color:var(--color-foreground)] shadow-sm">
            <input
              type="checkbox"
              checked={openViewer}
              disabled={saving}
              onChange={(event) => void handleOpenViewerChange(event.target.checked)}
            />
            <span>
              <span className="block font-medium">{t('settings.shortcuts.openViewerLabel')}</span>
              <span className="mt-1 block text-xs leading-5 text-[color:var(--color-muted-foreground)]">
                {openViewer
                  ? t('settings.shortcuts.openViewerHint')
                  : t('settings.shortcuts.disabledHint')}
              </span>
            </span>
          </label>
        </div>

        {saveError && (
          <p className="mt-4 text-sm text-rose-600">
            {saveError}
          </p>
        )}
      </section>
    </div>
  )
}

export { SettingsShortcutsPanel }
