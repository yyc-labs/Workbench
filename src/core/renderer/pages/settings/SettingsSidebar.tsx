import { Palette, Database, FileText, Info, Wrench, Bot, Terminal as TerminalIcon, RadioTower } from 'lucide-react'
import { getSettingsSectionLabel, SETTINGS_SECTIONS, type Section } from './settings.types'

type SettingsSidebarProps = {
  active: Section
  onSelect: (section: Section) => void
}

function SettingsSidebar({ active, onSelect }: SettingsSidebarProps) {
  const icons: Record<Section, React.ComponentType<{ className?: string; strokeWidth?: string | number }>> = {
    general: Palette,
    runtime: Wrench,
    transcripts: FileText,
    hooks: RadioTower,
    logs: TerminalIcon,
    ai: Bot,
    rules: Database,
    about: Info,
  }

  return (
    <nav className="quiet-control w-56 shrink-0 flex flex-col gap-1 rounded-[26px] p-2">
      {SETTINGS_SECTIONS.map((section) => {
        const Icon = icons[section]

        return (
        <button
          key={section}
          onClick={() => onSelect(section)}
          className={`settings-sidebar-item flex items-center gap-2.5 px-4 py-3 rounded-[18px] text-sm font-medium text-left ${
            active === section
              ? 'is-active bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm'
              : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]/60'
          }`}
        >
          <Icon className="w-4 h-4" strokeWidth={1.8} />
          {getSettingsSectionLabel(section)}
        </button>
        )
      })}
    </nav>
  )
}

export { SettingsSidebar }
