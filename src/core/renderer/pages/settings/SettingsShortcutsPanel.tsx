import { useEffect, useState } from 'react'
import { Keyboard, MousePointer2 } from 'lucide-react'
import type { ShortcutPreferencesConfig } from '../../../shared/types'
import { useI18n } from '../../i18n'

type SettingsShortcutsPanelProps = {
  shortcutPreferences?: ShortcutPreferencesConfig
  onSave: (shortcutPreferences: ShortcutPreferencesConfig) => Promise<void> | void
}

type ShortcutGuideItem = {
  id: string
  trigger: string
  titleKey: string
  descriptionKey: string
}

type ShortcutGuideCard = {
  id: string
  titleKey: string
  descriptionKey: string
  items: ShortcutGuideItem[]
}

function ShortcutTriggerBadge({ trigger }: { trigger: string }) {
  return (
    <span className="inline-flex rounded-full border px-2.5 py-1 font-mono text-[11px] text-[color:var(--color-foreground)]" style={{ borderColor: 'var(--color-border)' }}>
      {trigger}
    </span>
  )
}

function ShortcutGuideCardView({ card, t }: { card: ShortcutGuideCard; t: (key: string) => string }) {
  return (
    <section className="quiet-control rounded-[22px] p-5">
      <div>
        <h3 className="text-sm font-semibold text-[color:var(--color-foreground)]">{t(card.titleKey)}</h3>
        <p className="mt-2 text-sm leading-6 text-[color:var(--color-muted-foreground)]">{t(card.descriptionKey)}</p>
      </div>

      <div className="mt-4 space-y-3">
        {card.items.map((item) => (
          <div key={item.id} className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <ShortcutTriggerBadge trigger={item.trigger} />
              <span className="text-sm font-medium text-[color:var(--color-foreground)]">{t(item.titleKey)}</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t(item.descriptionKey)}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function SettingsShortcutsPanel({ shortcutPreferences, onSave }: SettingsShortcutsPanelProps) {
  const { t } = useI18n()
  const [openViewer, setOpenViewer] = useState(Boolean(shortcutPreferences?.quickTranscriptCaptureOpenViewer))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const keyboardCards: ShortcutGuideCard[] = [
    {
      id: 'global',
      titleKey: 'settings.shortcuts.groups.global.title',
      descriptionKey: 'settings.shortcuts.groups.global.description',
      items: [
        {
          id: 'global-home',
          trigger: 'Ctrl/Cmd+Alt+H',
          titleKey: 'settings.shortcuts.items.globalHome.title',
          descriptionKey: 'settings.shortcuts.items.globalHome.description',
        },
        {
          id: 'global-theme',
          trigger: 'Ctrl/Cmd+Alt+L',
          titleKey: 'settings.shortcuts.items.globalTheme.title',
          descriptionKey: 'settings.shortcuts.items.globalTheme.description',
        },
        {
          id: 'global-capture',
          trigger: 'Ctrl/Cmd+Shift+K',
          titleKey: 'settings.shortcuts.items.globalCapture.title',
          descriptionKey: 'settings.shortcuts.items.globalCapture.description',
        },
        {
          id: 'global-browser-screenshot',
          trigger: 'Ctrl/Cmd+Shift+S',
          titleKey: 'settings.shortcuts.items.globalBrowserScreenshot.title',
          descriptionKey: 'settings.shortcuts.items.globalBrowserScreenshot.description',
        },
        {
          id: 'global-recent',
          trigger: 'Ctrl/Cmd+Shift+P',
          titleKey: 'settings.shortcuts.items.globalRecent.title',
          descriptionKey: 'settings.shortcuts.items.globalRecent.description',
        },
        {
          id: 'global-routes',
          trigger: 'Ctrl/Cmd+Shift+H',
          titleKey: 'settings.shortcuts.items.globalRoutes.title',
          descriptionKey: 'settings.shortcuts.items.globalRoutes.description',
        },
        {
          id: 'home-search',
          trigger: 'Ctrl/Cmd+K',
          titleKey: 'settings.shortcuts.items.homeSearch.title',
          descriptionKey: 'settings.shortcuts.items.homeSearch.description',
        },
      ],
    },
    {
      id: 'code',
      titleKey: 'settings.shortcuts.groups.code.title',
      descriptionKey: 'settings.shortcuts.groups.code.description',
      items: [
        {
          id: 'code-view-mode',
          trigger: 'Ctrl/Cmd+Tab',
          titleKey: 'settings.shortcuts.items.codeViewMode.title',
          descriptionKey: 'settings.shortcuts.items.codeViewMode.description',
        },
        {
          id: 'code-global-search',
          trigger: 'Ctrl/Cmd+Shift+F / Ctrl/Cmd+Alt+F',
          titleKey: 'settings.shortcuts.items.codeGlobalSearch.title',
          descriptionKey: 'settings.shortcuts.items.codeGlobalSearch.description',
        },
        {
          id: 'code-find',
          trigger: 'Ctrl/Cmd+F',
          titleKey: 'settings.shortcuts.items.codeFind.title',
          descriptionKey: 'settings.shortcuts.items.codeFind.description',
        },
        {
          id: 'code-replace',
          trigger: 'Ctrl/Cmd+H',
          titleKey: 'settings.shortcuts.items.codeReplace.title',
          descriptionKey: 'settings.shortcuts.items.codeReplace.description',
        },
        {
          id: 'code-save',
          trigger: 'Ctrl/Cmd+S',
          titleKey: 'settings.shortcuts.items.codeSave.title',
          descriptionKey: 'settings.shortcuts.items.codeSave.description',
        },
        {
          id: 'code-copy-line-down',
          trigger: 'Ctrl/Cmd+D',
          titleKey: 'settings.shortcuts.items.codeCopyLineDown.title',
          descriptionKey: 'settings.shortcuts.items.codeCopyLineDown.description',
        },
        {
          id: 'code-delete-line',
          trigger: 'Ctrl/Cmd+Y',
          titleKey: 'settings.shortcuts.items.codeDeleteLine.title',
          descriptionKey: 'settings.shortcuts.items.codeDeleteLine.description',
        },
      ],
    },
    {
      id: 'learning',
      titleKey: 'settings.shortcuts.groups.learning.title',
      descriptionKey: 'settings.shortcuts.groups.learning.description',
      items: [
        {
          id: 'learning-save',
          trigger: 'Ctrl/Cmd+S',
          titleKey: 'settings.shortcuts.items.learningSave.title',
          descriptionKey: 'settings.shortcuts.items.learningSave.description',
        },
        {
          id: 'learning-left-sidebar',
          trigger: 'Ctrl/Cmd+ArrowLeft',
          titleKey: 'settings.shortcuts.items.learningLeftSidebar.title',
          descriptionKey: 'settings.shortcuts.items.learningLeftSidebar.description',
        },
        {
          id: 'learning-right-sidebar',
          trigger: 'Ctrl/Cmd+ArrowRight',
          titleKey: 'settings.shortcuts.items.learningRightSidebar.title',
          descriptionKey: 'settings.shortcuts.items.learningRightSidebar.description',
        },
        {
          id: 'learning-undo-redo',
          trigger: 'Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z / Ctrl/Cmd+Y',
          titleKey: 'settings.shortcuts.items.learningUndoRedo.title',
          descriptionKey: 'settings.shortcuts.items.learningUndoRedo.description',
        },
        {
          id: 'learning-indent',
          trigger: 'Tab / Shift+Tab',
          titleKey: 'settings.shortcuts.items.learningIndent.title',
          descriptionKey: 'settings.shortcuts.items.learningIndent.description',
        },
        {
          id: 'learning-list',
          trigger: 'Enter',
          titleKey: 'settings.shortcuts.items.learningContinueList.title',
          descriptionKey: 'settings.shortcuts.items.learningContinueList.description',
        },
      ],
    },
    {
      id: 'terminal',
      titleKey: 'settings.shortcuts.groups.terminal.title',
      descriptionKey: 'settings.shortcuts.groups.terminal.description',
      items: [
        {
          id: 'terminal-copy',
          trigger: 'Ctrl+Shift+C',
          titleKey: 'settings.shortcuts.items.terminalCopy.title',
          descriptionKey: 'settings.shortcuts.items.terminalCopy.description',
        },
        {
          id: 'terminal-paste',
          trigger: 'Ctrl+Shift+V',
          titleKey: 'settings.shortcuts.items.terminalPaste.title',
          descriptionKey: 'settings.shortcuts.items.terminalPaste.description',
        },
        {
          id: 'terminal-select-all',
          trigger: 'Ctrl+Shift+A',
          titleKey: 'settings.shortcuts.items.terminalSelectAll.title',
          descriptionKey: 'settings.shortcuts.items.terminalSelectAll.description',
        },
        {
          id: 'capture-submit',
          trigger: 'Enter / Ctrl/Cmd+Enter',
          titleKey: 'settings.shortcuts.items.captureSubmit.title',
          descriptionKey: 'settings.shortcuts.items.captureSubmit.description',
        },
        {
          id: 'capture-line-break',
          trigger: 'Shift+Enter',
          titleKey: 'settings.shortcuts.items.captureLineBreak.title',
          descriptionKey: 'settings.shortcuts.items.captureLineBreak.description',
        },
        {
          id: 'capture-close',
          trigger: 'Esc',
          titleKey: 'settings.shortcuts.items.captureClose.title',
          descriptionKey: 'settings.shortcuts.items.captureClose.description',
        },
      ],
    },
  ]

  const gestureCards: ShortcutGuideCard[] = [
    {
      id: 'gesture-global',
      titleKey: 'settings.shortcuts.groups.gestureGlobal.title',
      descriptionKey: 'settings.shortcuts.groups.gestureGlobal.description',
      items: [
        {
          id: 'gesture-back-forward',
          trigger: t('settings.shortcuts.gestureTriggers.backForward'),
          titleKey: 'settings.shortcuts.items.gestureBackForward.title',
          descriptionKey: 'settings.shortcuts.items.gestureBackForward.description',
        },
        {
          id: 'gesture-recent',
          trigger: t('settings.shortcuts.gestureTriggers.recent'),
          titleKey: 'settings.shortcuts.items.gestureRecent.title',
          descriptionKey: 'settings.shortcuts.items.gestureRecent.description',
        },
        {
          id: 'gesture-home',
          trigger: t('settings.shortcuts.gestureTriggers.home'),
          titleKey: 'settings.shortcuts.items.gestureHome.title',
          descriptionKey: 'settings.shortcuts.items.gestureHome.description',
        },
        {
          id: 'gesture-project-header',
          trigger: t('settings.shortcuts.gestureTriggers.projectHeader'),
          titleKey: 'settings.shortcuts.items.gestureProjectHeader.title',
          descriptionKey: 'settings.shortcuts.items.gestureProjectHeader.description',
        },
      ],
    },
    {
      id: 'gesture-sidebar',
      titleKey: 'settings.shortcuts.groups.gestureSidebar.title',
      descriptionKey: 'settings.shortcuts.groups.gestureSidebar.description',
      items: [
        {
          id: 'gesture-code-sidebar',
          trigger: t('settings.shortcuts.gestureTriggers.codeSidebar'),
          titleKey: 'settings.shortcuts.items.gestureCodeSidebar.title',
          descriptionKey: 'settings.shortcuts.items.gestureCodeSidebar.description',
        },
        {
          id: 'gesture-learning-left-sidebar',
          trigger: t('settings.shortcuts.gestureTriggers.learningLeftSidebar'),
          titleKey: 'settings.shortcuts.items.gestureLearningLeftSidebar.title',
          descriptionKey: 'settings.shortcuts.items.gestureLearningLeftSidebar.description',
        },
        {
          id: 'gesture-learning-right-sidebar',
          trigger: t('settings.shortcuts.gestureTriggers.learningRightSidebar'),
          titleKey: 'settings.shortcuts.items.gestureLearningRightSidebar.title',
          descriptionKey: 'settings.shortcuts.items.gestureLearningRightSidebar.description',
        },
      ],
    },
  ]

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
        <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">{t('settings.shortcuts.title')}</h2>
        <p className="mt-2 text-sm leading-6 text-[color:var(--color-muted-foreground)]">{t('settings.shortcuts.description')}</p>
      </div>

      <section className="quiet-control rounded-[22px] p-5">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--color-foreground)]">
              <Keyboard className="h-4 w-4" strokeWidth={1.8} />
              {t('settings.shortcuts.quickCaptureTitle')}
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--color-muted-foreground)]">{t('settings.shortcuts.quickCaptureDescription')}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[color:var(--color-muted-foreground)]">
              <span>{t('settings.shortcuts.quickCaptureShortcut')}</span>
              <kbd className="rounded-full border px-2.5 py-1 font-mono text-[11px] text-[color:var(--color-foreground)]" style={{ borderColor: 'var(--color-border)' }}>
                Ctrl/Cmd+Shift+K
              </kbd>
            </div>
          </div>

          <label className="flex max-w-sm items-start gap-3 rounded-[18px] bg-[color:var(--color-card)] px-4 py-3 text-sm text-[color:var(--color-foreground)] shadow-sm">
            <input type="checkbox" checked={openViewer} disabled={saving} onChange={(event) => void handleOpenViewerChange(event.target.checked)} />
            <span>
              <span className="block font-medium">{t('settings.shortcuts.openViewerLabel')}</span>
              <span className="mt-1 block text-xs leading-5 text-[color:var(--color-muted-foreground)]">{openViewer ? t('settings.shortcuts.openViewerHint') : t('settings.shortcuts.disabledHint')}</span>
            </span>
          </label>
        </div>

        {saveError && <p className="mt-4 text-sm text-rose-600">{saveError}</p>}
      </section>

      <section className="space-y-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--color-foreground)]">
            <Keyboard className="h-4 w-4" strokeWidth={1.8} />
            {t('settings.shortcuts.keyboardGuideTitle')}
          </div>
          <p className="mt-2 text-sm leading-6 text-[color:var(--color-muted-foreground)]">{t('settings.shortcuts.keyboardGuideDescription')}</p>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          {keyboardCards.map((card) => (
            <ShortcutGuideCardView key={card.id} card={card} t={t} />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--color-foreground)]">
            <MousePointer2 className="h-4 w-4" strokeWidth={1.8} />
            {t('settings.shortcuts.gestureGuideTitle')}
          </div>
          <p className="mt-2 text-sm leading-6 text-[color:var(--color-muted-foreground)]">{t('settings.shortcuts.gestureGuideDescription')}</p>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          {gestureCards.map((card) => (
            <ShortcutGuideCardView key={card.id} card={card} t={t} />
          ))}
        </div>
      </section>
    </div>
  )
}

export { SettingsShortcutsPanel }
