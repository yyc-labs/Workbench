import { useI18n } from '../../i18n'
import type { MarkdownFrontmatterEntry } from '../code/code.frontmatterParser'

type MarkdownFrontmatterMetaCardProps = {
  entries: MarkdownFrontmatterEntry[]
  className?: string
}

// 与 code 路由 Markdown 预览的 frontmatter 元信息卡片保持同一结构与样式。
export function MarkdownFrontmatterMetaCard({ entries, className }: MarkdownFrontmatterMetaCardProps) {
  const { t } = useI18n()
  if (entries.length === 0) return null
  return (
    <section className={className ? `code-mdc-meta-card ${className}` : 'code-mdc-meta-card'}>
      <h3 className="code-mdc-meta-title">{t('codeWorkspace.documentMetadata')}</h3>
      <div className="code-mdc-meta-grid">
        {entries.map((item) => (
          <div className="code-mdc-meta-row" key={item.key}>
            <span className="code-mdc-meta-key">{item.key}</span>
            <span className="code-mdc-meta-value code-mdc-meta-value--mono">{item.value || t('codeWorkspace.metadataNotAvailable')}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
