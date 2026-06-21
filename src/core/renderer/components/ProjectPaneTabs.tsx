import { useRef } from 'react'
import { Bot, Code2, FileText } from 'lucide-react'
import { useI18n } from '../i18n'

export type ProjectPaneTab = 'code' | 'aicommit' | 'transcript'
export type ProjectPanePreloadIntent = 'intent' | 'navigate'
export type ProjectPanePreloadOptions = {
  intent?: ProjectPanePreloadIntent
}
export type ProjectPanePreloadHandle = {
  cancel: () => void
}
export type ProjectPanePreload = (
  pane: ProjectPaneTab,
  options?: ProjectPanePreloadOptions
) => ProjectPanePreloadHandle

type ProjectPaneTabsProps = {
  activePane: ProjectPaneTab
  onPreloadPane?: ProjectPanePreload
  onSelectPane: (pane: ProjectPaneTab) => void
}

export function ProjectPaneTabs({ activePane, onPreloadPane, onSelectPane }: ProjectPaneTabsProps) {
  const { t } = useI18n()
  const preloadHandleRef = useRef<ProjectPanePreloadHandle | null>(null)
  const cancelPreloadIntent = () => {
    preloadHandleRef.current?.cancel()
    preloadHandleRef.current = null
  }
  const preloadIntent = (pane: ProjectPaneTab) => {
    cancelPreloadIntent()
    preloadHandleRef.current = onPreloadPane?.(pane, { intent: 'intent' }) ?? null
  }
  const selectPane = (pane: ProjectPaneTab) => {
    cancelPreloadIntent()
    onPreloadPane?.(pane, { intent: 'navigate' })
    onSelectPane(pane)
  }

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
        onFocus={() => {
          preloadIntent('code')
        }}
        onMouseEnter={() => {
          preloadIntent('code')
        }}
        onMouseLeave={cancelPreloadIntent}
        onBlur={cancelPreloadIntent}
        onClick={() => selectPane('code')}
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
        onFocus={() => {
          preloadIntent('aicommit')
        }}
        onMouseEnter={() => {
          preloadIntent('aicommit')
        }}
        onMouseLeave={cancelPreloadIntent}
        onBlur={cancelPreloadIntent}
        onClick={() => selectPane('aicommit')}
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
        onFocus={() => {
          preloadIntent('transcript')
        }}
        onMouseEnter={() => {
          preloadIntent('transcript')
        }}
        onMouseLeave={cancelPreloadIntent}
        onBlur={cancelPreloadIntent}
        onClick={() => selectPane('transcript')}
      >
        <FileText className="h-3.5 w-3.5" />
        {t('detail.transcript')}
      </button>
    </div>
  )
}
