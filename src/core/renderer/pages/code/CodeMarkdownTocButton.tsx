import { useEffect, useMemo, useState, type RefObject } from 'react'
import { ListTree } from 'lucide-react'
import { Tooltip } from '../../components/ui/tooltip'
import { useI18n } from '../../i18n'
import type { ParsedMarkdownDocument } from './code.frontmatterParser'
import type { MonacoCodeEditorHandle } from './MonacoCodeEditor'
import type { MarkdownPreviewMode } from './code.workspace.types'
import { extractMarkdownHeadings, revealMarkdownPreviewSourceLine } from './code.markdownShared'

type CodeMarkdownTocButtonProps = {
  parsedMarkdownDoc: ParsedMarkdownDocument | null
  previewMode: MarkdownPreviewMode
  editorRef: RefObject<MonacoCodeEditorHandle>
  previewScrollRef: RefObject<HTMLDivElement>
}

export function CodeMarkdownTocButton({ parsedMarkdownDoc, previewMode, editorRef, previewScrollRef }: CodeMarkdownTocButtonProps) {
  const { t } = useI18n()
  const [suppressPopover, setSuppressPopover] = useState(false)

  const headings = useMemo(() => (parsedMarkdownDoc ? extractMarkdownHeadings(parsedMarkdownDoc.markdownBody, parsedMarkdownDoc.markdownBodyLineOffset) : []), [parsedMarkdownDoc])

  useEffect(() => {
    if (!suppressPopover) return
    const timerId = window.setTimeout(() => setSuppressPopover(false), 80)
    return () => window.clearTimeout(timerId)
  }, [suppressPopover])

  if (headings.length === 0) return null

  const jumpToHeading = (lineNumber: number) => {
    const previewContainer = previewMode === 'edit' ? null : previewScrollRef.current
    const revealed = previewContainer ? revealMarkdownPreviewSourceLine(previewContainer, lineNumber) : false
    if (!revealed) editorRef.current?.revealPosition(lineNumber)
    setSuppressPopover(true)
  }

  return (
    <Tooltip
      content={
        <div className="code-markdown-toc">
          <div className="code-markdown-toc-list">
            {headings.map((heading, index) => (
              <Tooltip key={`${heading.slug}-${index}`} content={heading.text} side="left" align="center" interactive={false} delayMs={300} maxWidth={360}>
                <button type="button" className="code-markdown-toc-item" style={{ paddingLeft: `${10 + (heading.depth - 1) * 14}px` }} onClick={() => jumpToHeading(heading.lineNumber)}>
                  <span className="code-markdown-toc-item-text">{heading.text}</span>
                </button>
              </Tooltip>
            ))}
          </div>
        </div>
      }
      contentClassName="code-markdown-toc-popover"
      side="bottom"
      align="end"
      delayMs={160}
      hideDelayMs={120}
      maxWidth={340}
      disabled={suppressPopover}
    >
      <button type="button" className="code-editor-preview-mode-btn" title={t('codeWorkspace.toc')}>
        <ListTree className="h-3.5 w-3.5" />
        {t('codeWorkspace.toc')}
      </button>
    </Tooltip>
  )
}
