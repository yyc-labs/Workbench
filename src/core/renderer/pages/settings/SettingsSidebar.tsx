import { Palette, Database, FileText, Info, Wrench, Bot, Terminal as TerminalIcon, RadioTower, HardDrive, Keyboard, Router, ScrollText, Globe2, PlugZap } from 'lucide-react'
import { useI18n } from '../../i18n'
import { SETTINGS_SECTIONS, type Section } from './settings.types'

type SettingsSidebarProps = {
  active: Section
  onSelect: (section: Section) => void
}

function SettingsSidebar({ active, onSelect }: SettingsSidebarProps) {
  const { getSettingsSectionLabel } = useI18n()
  const icons: Record<Section, React.ComponentType<{ className?: string; strokeWidth?: string | number }>> = {
    general: Palette,
    shortcuts: Keyboard,
    data: HardDrive,
    runtime: Wrench,
    agents: Bot,
    gateway: Router,
    'browser-ai': Globe2,
    'ai-connection': PlugZap,
    transcripts: FileText,
    hooks: RadioTower,
    'agent-logs': ScrollText,
    logs: TerminalIcon,
    ai: Bot,
    rules: Database,
    about: Info,
  }
  const renderItem = (section: Section) => {
    const Icon = icons[section]
    const selected = active === section

    return (
      <button
        key={section}
        onClick={() => onSelect(section)}
        aria-current={selected ? 'page' : undefined}
        className={`button-interactive settings-sidebar-item flex min-h-[42px] w-full items-center gap-2.5 rounded-[16px] px-4 py-2.5 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          selected ? 'is-active bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm' : 'text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)]/60 hover:text-[color:var(--color-foreground)]'
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
        <span className="truncate">{getSettingsSectionLabel(section)}</span>
      </button>
    )
  }

  return (
    <nav className="quiet-control flex max-h-full min-h-0 w-56 shrink-0 flex-col overflow-y-auto rounded-[26px] p-2">
      <div className="flex flex-col gap-1">{SETTINGS_SECTIONS.map(renderItem)}</div>
    </nav>
  )
}

export { SettingsSidebar }
