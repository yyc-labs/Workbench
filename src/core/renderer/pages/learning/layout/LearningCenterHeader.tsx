import { ArrowLeft, BookOpenText, History, Plus, Settings2, Sparkles } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Select } from '../../../components/ui/select'
import { useI18n } from '../../../i18n'

type LearningCenterHeaderProps = {
  onBack: () => void
  onCreateNote: () => void
  onCreateSkill: () => void
  view: 'notes' | 'skills' | 'browser-tasks'
  onViewChange: (view: 'notes' | 'skills' | 'browser-tasks') => void
  onOpenBrowserAi: () => void
  onOpenBrowserAiPreferences: () => void
}

export function LearningCenterHeader({ onBack, onCreateNote, onCreateSkill, view, onViewChange, onOpenBrowserAi, onOpenBrowserAiPreferences }: LearningCenterHeaderProps) {
  const { t } = useI18n()

  return (
    <header className="app-chrome grid items-center gap-3 rounded-[20px] px-4 py-3 sm:px-5 sm:py-4 lg:grid-cols-[minmax(280px,1fr)_auto_minmax(380px,1fr)]">
      <div className="flex min-w-0 items-center gap-3 lg:col-start-1">
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-full" onClick={onBack} title={t('common.projects')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[color:var(--color-primary)]/12 text-[color:var(--color-primary)]">
          <BookOpenText className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-base font-semibold text-[color:var(--color-foreground)]">{t('common.learningCenter')}</div>
          <div className="hidden text-xs text-[color:var(--color-muted-foreground)] sm:block">{t('learning.header.subtitle')}</div>
        </div>
      </div>
      <div className="hidden items-center gap-1 rounded-full bg-[color:var(--color-accent)] p-1 lg:col-start-2 lg:flex">
        <Button size="sm" variant={view === 'notes' ? 'default' : 'ghost'} className="h-8 px-3" onClick={() => onViewChange('notes')}>
          <BookOpenText />
          {t('learning.skills.viewNotes')}
        </Button>
        <Button size="sm" variant={view === 'skills' ? 'default' : 'ghost'} className="h-8 px-3" onClick={() => onViewChange('skills')}>
          <Sparkles />
          {t('learning.skills.viewSkills')}
        </Button>
        <Button size="sm" variant={view === 'browser-tasks' ? 'default' : 'ghost'} className="h-8 px-3" onClick={() => onViewChange('browser-tasks')}>
          <History />
          {t('learning.skills.viewBrowserTasks')}
        </Button>
      </div>
      <div className="order-3 col-span-full w-full lg:hidden">
        <Select
          ariaLabel={t('learning.toolbar.viewLabel')}
          value={view}
          options={[
            { value: 'notes', label: t('learning.skills.viewNotes') },
            { value: 'skills', label: t('learning.skills.viewSkills') },
            { value: 'browser-tasks', label: t('learning.skills.viewBrowserTasks') },
          ]}
          onChange={(value) => onViewChange(value as LearningCenterHeaderProps['view'])}
          triggerClassName="h-9"
        />
      </div>
      <div className="ml-auto flex min-w-0 items-center justify-end gap-2 lg:col-start-3 lg:min-w-[380px]">
        <Button size="sm" className="min-w-[132px] gap-1.5" onClick={view === 'skills' ? onCreateSkill : view === 'browser-tasks' ? onOpenBrowserAi : onCreateNote}>
          <Plus className="h-4 w-4" />
          {view === 'skills' ? t('learning.skills.create') : view === 'browser-tasks' ? t('learning.browserAi.historyNewTask') : t('learning.header.createNote')}
        </Button>
        <Button variant="outline" size="sm" className="hidden h-9 w-[164px] shrink-0 gap-1.5 lg:inline-flex" onClick={onOpenBrowserAi}>
          <History className="h-4 w-4" />
          {t('learning.browserAi.open')}
        </Button>
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" title={t('learning.toolbar.browserAiPreferences')} aria-label={t('learning.toolbar.browserAiPreferences')} onClick={onOpenBrowserAiPreferences}>
          <Settings2 className="h-4 w-4" />
        </Button>
      </div>
    </header>
  )
}
