import { Bot, ChevronRight } from 'lucide-react'
import type { AgentHistorySessionView } from '../../../shared/types/agentHistory'
import { useI18n } from '../../i18n'

interface SessionRowProps {
  session: AgentHistorySessionView
  selected: boolean
  onSelect: () => void
}

export function SessionRow({ session, selected, onSelect }: SessionRowProps) {
  const { t, formatDateTime } = useI18n()
  const title = session.title ?? session.sessionId ?? t('agentHistory.untitled')

  return (
    <li>
      <button
        type="button"
        aria-current={selected}
        className={`group relative mx-2 my-1.5 flex w-[calc(100%-1rem)] items-center gap-3 rounded-[15px] px-3 py-3 text-left transition-all ${selected ? 'bg-[color:var(--color-card)] shadow-[0_4px_18px_rgb(15_23_42/0.08)] ring-1 ring-[color:var(--color-border)]' : 'hover:bg-[color:var(--color-card)]/70'}`}
        onClick={onSelect}
      >
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] ${selected ? 'bg-primary text-white' : 'bg-[color:var(--color-accent)] text-[color:var(--color-muted-foreground)]'}`}>
          <Bot className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-[color:var(--color-foreground)]" title={title}>
            {title}
          </span>
          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-[color:var(--color-muted-foreground)]">
            <span className="shrink-0 font-medium">{session.agent}</span>
            <span aria-hidden>·</span>
            <span className="truncate">{formatDateTime(session.updatedAt)}</span>
            <span aria-hidden>·</span>
            <span className="shrink-0">{t('agentHistory.messageCount', { count: session.messageCount })}</span>
          </span>
        </span>
        <ChevronRight className={`h-4 w-4 shrink-0 transition-transform ${selected ? 'text-[color:var(--color-foreground)]' : 'text-[color:var(--color-muted-foreground)]/50 group-hover:translate-x-0.5'}`} />
      </button>
    </li>
  )
}
