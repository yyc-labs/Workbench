import { FolderPlus, Plus, Settings, Zap } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { useI18n } from '../../i18n'
import { HomeDragOverlay } from './HomeDragOverlay'

type HomeEmptyStateProps = {
  isDragOver: boolean
  onAddFolder: () => void
  onOpenSettings: () => void
}

function HomeEmptyState({ isDragOver, onAddFolder, onOpenSettings }: HomeEmptyStateProps) {
  const { t } = useI18n()

  return (
    <div className="h-full flex flex-col">
      {isDragOver && <HomeDragOverlay />}
      <header className="app-chrome min-h-[76px] flex items-center px-8 shrink-0">
        <div className="flex items-center gap-3">
          <div
            className="quiet-control w-8 h-8 rounded-2xl flex items-center justify-center"
            style={{
              color: 'var(--color-primary)',
            }}
          >
            <Zap className="w-4 h-4" strokeWidth={1.8} />
          </div>
          <span className="text-[15px] font-medium text-[color:var(--color-foreground)]">{t('common.runtime')}</span>
        </div>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]"
          onClick={onOpenSettings}
        >
          <Settings className="w-4 h-4" strokeWidth={1.8} />
        </Button>
      </header>
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="flex flex-col items-center gap-8 max-w-md text-center px-8">
          <div
            className="w-24 h-24 rounded-[32px] border flex items-center justify-center surface-card"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <FolderPlus className="w-11 h-11 text-[color:var(--color-muted-foreground)]" strokeWidth={1.35} />
          </div>
          <div>
            <h1 className="text-[28px] font-semibold tracking-[-0.03em] text-[color:var(--color-foreground)] mb-3">{t('home.emptyTitle')}</h1>
            <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)]">{t('home.emptyDescription')}</p>
          </div>
          <Button onClick={onAddFolder} className="gap-2 rounded-full h-11 px-6 bg-primary hover:bg-primary-hover text-white shadow-sm" size="lg">
            <Plus className="w-4 h-4" strokeWidth={1.8} />
            {t('common.addProjectFolder')}
          </Button>
          <p className="text-xs leading-5 text-[color:var(--color-muted-foreground)]">
            {t('home.supportedStacks')}
          </p>
        </div>
      </div>
    </div>
  )
}

export { HomeEmptyState }
