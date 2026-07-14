import type { BrowserAiContextPreview } from '../../../shared/types'
import { useI18n } from '../../i18n'

type LearningBrowserAiContextPreviewProps = {
  preview: BrowserAiContextPreview | null
}

export function LearningBrowserAiContextPreview({ preview }: LearningBrowserAiContextPreviewProps) {
  const { t } = useI18n()
  if (!preview) return null
  return (
    <section className="space-y-3 rounded-[18px] border p-4" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('learning.browserAi.preview')}</div>
        <div className="text-xs text-[color:var(--color-muted-foreground)]">
          {t('learning.browserAi.characterCount', { value: String(preview.characterCount) })}
        </div>
      </div>
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
    </section>
  )
}

