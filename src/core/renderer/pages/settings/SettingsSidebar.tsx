import { Palette, Database, Info, Wrench, Bot, Terminal as TerminalIcon } from 'lucide-react'
import type { Section } from './settings.types'

type SettingsSidebarProps = {
  active: Section
  onSelect: (section: Section) => void
}

function SettingsSidebar({ active, onSelect }: SettingsSidebarProps) {
  const items: {
    id: Section
    label: string
    icon: React.ComponentType<{ className?: string; strokeWidth?: string | number }>
  }[] = [
      { id: 'general', label: 'General', icon: Palette },
      { id: 'runtime', label: 'Runtime', icon: Wrench },
      { id: 'logs', label: 'Startup Logs', icon: TerminalIcon },
      { id: 'ai', label: 'AI Commit', icon: Bot },
      { id: 'rules', label: 'Rules', icon: Database },
      { id: 'about', label: 'About', icon: Info },
    ]

  return (
    <nav className="quiet-control w-56 shrink-0 flex flex-col gap-1 rounded-[26px] p-2">
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onSelect(item.id)}
          className={`flex items-center gap-2.5 px-4 py-3 rounded-[18px] text-sm font-medium transition-colors text-left ${
            active === item.id
              ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm'
              : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]/60'
          }`}
        >
          <item.icon className="w-4 h-4" strokeWidth={1.8} />
          {item.label}
        </button>
      ))}
    </nav>
  )
}

export { SettingsSidebar }
