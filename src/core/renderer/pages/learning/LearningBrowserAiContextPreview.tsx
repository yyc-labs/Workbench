import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { BrowserAiContextPreview } from '../../../shared/types'
import { useI18n } from '../../i18n'

type LearningBrowserAiContextPreviewProps = {
  preview: BrowserAiContextPreview | null
}

export function LearningBrowserAiContextPreview({ preview }: LearningBrowserAiContextPreviewProps) {
  const { t } = useI18n()
  const [isCollapsed, setIsCollapsed] = useState(true)
  if (!preview) return null
  return (
    <section className="space-y-3 rounded-[18px] border p-4" style={{ borderColor: 'var(--color-border)' }}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 rounded-[10px] px-1 py-1 text-left transition-colors hover:bg-[color:var(--color-accent)]"
        onClick={() => setIsCollapsed((collapsed) => !collapsed)}
        aria-expanded={!isCollapsed}
        aria-controls="learning-browser-ai-prompt-preview"
        title={t(isCollapsed ? 'learning.browserAi.expandPreview' : 'learning.browserAi.collapsePreview')}
      >
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-[color:var(--color-foreground)]">
          {isCollapsed ? <ChevronRight className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]" /> : <ChevronDown className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]" />}
          <span className="truncate">{t('learning.browserAi.preview')}</span>
        </span>
        <span className="text-xs text-[color:var(--color-muted-foreground)]">
          {t('learning.browserAi.characterCount', { value: String(preview.characterCount) })}
        </span>
      </button>
      <div id="learning-browser-ai-prompt-preview" className="space-y-3" hidden={isCollapsed}>
        <div className="flex flex-wrap gap-2">
          {preview.sources.filter((source) => source.included).map((source) => (
            <span key={`${source.kind}-${source.label}`} className="rounded-full bg-[color:var(--color-accent)] px-2.5 py-1 text-xs text-[color:var(--color-foreground)]">
              {source.label}{source.sensitive ? ` · ${t('learning.browserAi.sensitive')}` : ''}
            </span>
          ))}
        </div>
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-[14px] bg-[color:var(--color-background)] p-3 font-['JetBrains_Mono','SFMono-Regular',monospace] text-xs leading-5 text-[color:var(--color-foreground)]">
          {preview.prompt}
        </pre>
      </div>
    </section>
  )
}
