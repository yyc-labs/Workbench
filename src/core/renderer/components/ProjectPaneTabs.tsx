import { Bot, Code2, FileText } from 'lucide-react'
import { useI18n } from '../i18n'

export type ProjectPaneTab = 'code' | 'aicommit' | 'transcript'

type ProjectPaneTabsProps = {
  activePane: ProjectPaneTab
  onSelectPane: (pane: ProjectPaneTab) => void
}

export function ProjectPaneTabs({ activePane, onSelectPane }: ProjectPaneTabsProps) {
  const { t } = useI18n()

  return (
    <div
      className="quiet-control flex items-center gap-1 rounded-full border border-[color:var(--color-border)] p-1"
      role="tablist"
      aria-label={t('common.workspace')}
    >
      <button
        type="button"
        role="tab"
        aria-selected={activePane === 'code'}
        className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
          activePane === 'code'
            ? 'bg-primary text-white'
            : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
        }`}
        onClick={() => onSelectPane('code')}
      >
        <Code2 className="h-3.5 w-3.5" />
        {t('codeWorkspace.codeTab')}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activePane === 'aicommit'}
        className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
          activePane === 'aicommit'
            ? 'bg-primary text-white'
            : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
        }`}
        onClick={() => onSelectPane('aicommit')}
      >
        <Bot className="h-3.5 w-3.5" />
        {t('codeWorkspace.aiCommitTab')}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activePane === 'transcript'}
        className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
          activePane === 'transcript'
            ? 'bg-primary text-white'
            : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
        }`}
        onClick={() => onSelectPane('transcript')}
      >
        <FileText className="h-3.5 w-3.5" />
        {t('detail.transcript')}
      </button>
    </div>
  )
}
