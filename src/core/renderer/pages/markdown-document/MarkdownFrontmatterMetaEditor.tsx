import { useEffect, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useI18n } from '../../i18n'
import { parseMarkdownDocument } from '../code/code.frontmatterParser'
import { createMarkdownFrontmatterBlock, removeMarkdownFrontmatterEntry, upsertMarkdownFrontmatterEntry } from './markdownDocumentFrontmatter'

type MarkdownFrontmatterMetaEditorProps = {
  frontmatter: string
  onChange: (nextFrontmatter: string) => void
  className?: string
}

// 键名使用草稿态：输入过程中不写回 frontmatter，失焦或回车时提交，避免空键名等中间态无法输入。
function MetaKeyInput({ value, keyLabel, onCommit }: { value: string; keyLabel: string; onCommit: (nextKey: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input
      className="markdown-document-meta-input markdown-document-meta-input--key"
      value={draft}
      spellCheck={false}
      aria-label={keyLabel}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') setDraft(value)
      }}
    />
  )
}

// 富文本模式下的 frontmatter 元信息编辑卡片：随正文一起滚动，逐行编辑并保留其余原始文本。
export function MarkdownFrontmatterMetaEditor({ frontmatter, onChange, className }: MarkdownFrontmatterMetaEditorProps) {
  const { t } = useI18n()
  const entries = useMemo(() => parseMarkdownDocument(frontmatter).frontmatterEntries, [frontmatter])

  if (!frontmatter) return null

  const handleRename = (originalKey: string, nextKey: string) => {
    const originalValue = entries.find((item) => item.key.toLowerCase() === originalKey.toLowerCase())?.value ?? ''
    onChange(upsertMarkdownFrontmatterEntry(frontmatter, originalKey, nextKey, originalValue))
  }

  const handleAdd = () => {
    const existing = new Set(entries.map((item) => item.key.toLowerCase()))
    let key = 'field'
    let counter = 2
    while (existing.has(key)) {
      key = `field-${counter}`
      counter += 1
    }
    onChange(frontmatter ? upsertMarkdownFrontmatterEntry(frontmatter, key, key, '') : createMarkdownFrontmatterBlock(key))
  }

  return (
    <section className={className ? `code-mdc-meta-card ${className}` : 'code-mdc-meta-card'}>
      <h3 className="code-mdc-meta-title">{t('codeWorkspace.documentMetadata')}</h3>
      <div className="code-mdc-meta-grid">
        {entries.map((item) => (
          <div className="code-mdc-meta-row markdown-document-meta-edit-row" key={item.key}>
            <MetaKeyInput value={item.key} keyLabel={t('markdownDocument.metadataKey')} onCommit={(nextKey) => handleRename(item.key, nextKey)} />
            <input className="markdown-document-meta-input markdown-document-meta-input--value" value={item.value} spellCheck={false} aria-label={t('markdownDocument.metadataValue')} onChange={(event) => onChange(upsertMarkdownFrontmatterEntry(frontmatter, item.key, item.key, event.target.value))} />
            <button type="button" className="markdown-document-meta-remove" aria-label={t('markdownDocument.removeMetadata')} title={t('markdownDocument.removeMetadata')} onClick={() => onChange(removeMarkdownFrontmatterEntry(frontmatter, item.key))}>
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="markdown-document-meta-add" onClick={handleAdd}>
        <Plus className="h-3 w-3" />
        {t('markdownDocument.addMetadata')}
      </button>
    </section>
  )
}
