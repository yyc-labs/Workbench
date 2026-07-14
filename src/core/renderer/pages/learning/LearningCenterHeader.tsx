import { ArrowLeft, BookOpenText, History, Plus } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { useI18n } from '../../i18n'

type LearningCenterHeaderProps = {
  onBack: () => void
  onCreateNote: () => void
  onOpenBrowserAi: () => void
  onOpenBrowserAiPreferences: () => void
  onOpenBrowserAiHistory: () => void
}

export function LearningCenterHeader({ onBack, onCreateNote, onOpenBrowserAi, onOpenBrowserAiPreferences, onOpenBrowserAiHistory }: LearningCenterHeaderProps) {
  const { t } = useI18n()

  return (
    <header className="quiet-control flex items-center gap-3 rounded-[24px] px-5 py-4">
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 rounded-full"
        onClick={onBack}
        title={t('common.projects')}
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[color:var(--color-primary)]/12 text-[color:var(--color-primary)]">
        <BookOpenText className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-base font-semibold text-[color:var(--color-foreground)]">{t('common.learningCenter')}</div>
        <div className="text-xs text-[color:var(--color-muted-foreground)]">
          {t('learning.header.subtitle')}
        </div>
      </div>
      <Button size="sm" className="gap-1.5" onClick={onCreateNote}>
        <Plus className="h-4 w-4" />
        {t('learning.header.createNote')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={onOpenBrowserAi}
        onContextMenu={(event) => {
          event.preventDefault()
          onOpenBrowserAiPreferences()
        }}
      >
        {t('learning.browserAi.open')}
      </Button>
      <Button variant="ghost" size="icon" title={t('learning.browserAi.historyOpen')} onClick={onOpenBrowserAiHistory}>
        <History className="h-4 w-4" />
      </Button>
    </header>
  )
}
