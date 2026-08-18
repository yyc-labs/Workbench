import { useMemo, type RefObject } from 'react'
import { MarkdownPreviewSurface } from '../code/MarkdownPreviewSurface'
import { createMarkdownComponents } from '../code/code.markdown'
import { useEffectiveTheme } from '../../hooks/useEffectiveTheme'
import { resolveMarkdownDocumentLink } from './markdownDocumentLinks'

type MarkdownDocumentReadOnlyPreviewProps = {
  content: string
  activePath: string | null
  previewRootRef: RefObject<HTMLDivElement>
  onOpenPath: (path: string) => void
  className?: string
}

export function MarkdownDocumentReadOnlyPreview({ content, activePath, previewRootRef, onOpenPath, className }: MarkdownDocumentReadOnlyPreviewProps) {
  const effectiveTheme = useEffectiveTheme()

  const components = useMemo(
    () =>
      createMarkdownComponents({
        projectPath: activePath ?? '',
        activeRelativePath: '',
        themeMode: effectiveTheme,
        enableMarkdownSyntaxHighlight: true,
        forceRenderAllBlocks: true,
        onProjectFileLinkClick: (relativePath) => {
          const resolved = activePath ? resolveMarkdownDocumentLink(relativePath, activePath) : null
          if (resolved) onOpenPath(resolved)
        },
      }),
    [activePath, effectiveTheme, onOpenPath],
  )

  return (
    <div ref={previewRootRef} className={['markdown-document-preview', 'code-markdown-preview-scroll-root', className].filter(Boolean).join(' ')}>
      <article className="code-markdown-content code-markdown-content--viewport-scroll markdown-document-preview-content">
        <MarkdownPreviewSurface content={content} components={components} forceRenderAllBlocks previewRootRef={previewRootRef} />
      </article>
    </div>
  )
}
