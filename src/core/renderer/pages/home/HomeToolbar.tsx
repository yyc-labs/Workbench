import { Search, Settings, Plus, Zap, SlidersHorizontal } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
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
  const filterButtonClass = (active: boolean): string =>
    active
      ? 'h-7 px-3 rounded-full text-xs font-medium text-[color:var(--color-foreground)] bg-[color:var(--color-card)] shadow-sm border border-[color:var(--color-border)]'
      : 'h-7 px-3 rounded-full text-xs font-medium text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)] border border-transparent'

  return (
    <header className="app-chrome h-auto min-h-[68px] flex items-center px-8 py-3 gap-5 shrink-0">
      <div className="flex items-center gap-3 mr-5">
        <div className="w-8 h-8 rounded-2xl flex items-center justify-center quiet-control" style={{ color: 'var(--color-primary)' }}>
          <Zap className="w-4 h-4" strokeWidth={1.8} />
        </div>
        <span className="text-[15px] font-medium text-[color:var(--color-foreground)]">Runtime</span>
      </div>

      <div className="w-full max-w-xl relative">
        <Search
          className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[color:var(--color-muted-foreground)] pointer-events-none"
          strokeWidth={1.8}
        />
        <Input
          ref={searchRef}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search projects..."
          className="quiet-control h-10 pl-11 text-sm rounded-full border-0 text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
        />
      </div>

      <div className="quiet-control ml-auto flex items-center rounded-full px-1.5 py-1 gap-2.5">
        <div className="flex items-center gap-1.5">
          <button
            className={filterButtonClass(envFilter === 'all')}
            onClick={() => onEnvFilterChange('all')}
            type="button"
          >
            All
          </button>
          <button
            className={filterButtonClass(envFilter === 'ubuntu')}
            onClick={() => onEnvFilterChange('ubuntu')}
            type="button"
          >
            Ubuntu
          </button>
          <button
            className={filterButtonClass(envFilter === 'windows')}
            onClick={() => onEnvFilterChange('windows')}
            type="button"
          >
            Windows
          </button>
        </div>

        <div className="h-6 w-px" style={{ background: 'var(--color-border)' }} />

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]"
            onClick={onManageWorkspace}
            title="Manage folders and tags"
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
            New Project
          </Button>
        </div>
      </div>
    </header>
  )
}

export { HomeToolbar }
