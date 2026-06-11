import { Search, Settings, Plus, Zap, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { useI18n } from '../../i18n'
import type { EnvFilter } from './home.types'

type HomeToolbarProps = {
  searchQuery: string
  onSearchChange: (value: string) => void
  envFilter: EnvFilter
  onEnvFilterChange: (value: EnvFilter) => void
  onAddFolder: () => void
  onSettingsClick: () => void
  onManageWorkspace: () => void
  searchRef: React.RefObject<HTMLInputElement>
}

function HomeToolbar({
  searchQuery,
  onSearchChange,
  envFilter,
  onEnvFilterChange,
  onAddFolder,
  onSettingsClick,
  onManageWorkspace,
  searchRef,
}: HomeToolbarProps) {
  const { t } = useI18n()
  const filterButtonClass = (active: boolean): string =>
    active
      ? 'h-7 px-3 rounded-full text-xs font-medium text-[color:var(--color-foreground)] bg-[color:var(--color-card)] shadow-sm border border-[color:var(--color-border)]'
      : 'h-7 px-3 rounded-full text-xs font-medium text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)] border border-transparent'

  return (
    <header className="app-chrome h-auto min-h-[68px] flex items-center px-8 py-3 gap-5 shrink-0">
      <div className="mr-5 flex shrink-0 items-center gap-3">
        <div className="w-8 h-8 rounded-2xl flex items-center justify-center quiet-control" style={{ color: 'var(--color-primary)' }}>
          <Zap className="w-4 h-4" strokeWidth={1.8} />
        </div>
        <span className="whitespace-nowrap text-[15px] font-medium text-[color:var(--color-foreground)]">
          {t('common.runtime')}
        </span>
      </div>

      <div className="relative min-w-[220px] flex-1 max-w-[360px] xl:max-w-[420px]">
        <Search
          className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[color:var(--color-muted-foreground)] pointer-events-none"
          strokeWidth={1.8}
        />
        <Input
          ref={searchRef}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('common.searchProjects')}
          className="quiet-control h-10 pl-11 pr-10 text-sm rounded-full border-0 text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
        />
        <button
          type="button"
          className={`absolute right-3 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-opacity ${
            searchQuery
              ? 'hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
              : 'pointer-events-none opacity-0'
          }`}
          onClick={() => {
            onSearchChange('')
            searchRef.current?.focus()
          }}
          aria-label={t('common.clearSearch')}
          title={t('common.clearSearch')}
          tabIndex={searchQuery ? 0 : -1}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="quiet-control ml-auto flex items-center rounded-full px-1.5 py-1 gap-2.5">
        <div className="flex items-center gap-1.5">
          <button
            className={filterButtonClass(envFilter === 'all')}
            onClick={() => onEnvFilterChange('all')}
            type="button"
          >
            {t('common.allProjects')}
          </button>
          <button
            className={filterButtonClass(envFilter === 'ubuntu')}
            onClick={() => onEnvFilterChange('ubuntu')}
            type="button"
          >
            {t('common.ubuntu')}
          </button>
          <button
            className={filterButtonClass(envFilter === 'windows')}
            onClick={() => onEnvFilterChange('windows')}
            type="button"
          >
            {t('common.windows')}
          </button>
        </div>

        <div className="h-6 w-px" style={{ background: 'var(--color-border)' }} />

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]"
            onClick={onManageWorkspace}
            title={t('common.manageFoldersAndTags')}
          >
            <SlidersHorizontal className="w-4 h-4" strokeWidth={1.8} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]"
            onClick={onSettingsClick}
          >
            <Settings className="w-4 h-4" strokeWidth={1.8} />
          </Button>
          <Button size="sm" className="h-9 gap-1.5 text-sm rounded-full bg-primary hover:bg-primary-hover text-white shadow-sm" onClick={onAddFolder}>
            <Plus className="w-4 h-4" strokeWidth={1.8} />
            {t('common.newProject')}
          </Button>
        </div>
      </div>
    </header>
  )
}

export { HomeToolbar }
