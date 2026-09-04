import { useMemo, type RefObject } from 'react'
import { MarkdownPreviewSurface } from '../code/MarkdownPreviewSurface'
import { createMarkdownComponents } from '../code/code.markdown'
import { useEffectiveTheme } from '../../hooks/useEffectiveTheme'
import { useAppStore } from '../../stores/appStore'
import { resolveMarkdownDocumentBase } from './markdownDocumentLinks'

type MarkdownDocumentReadOnlyPreviewProps = {
  content: string
  activePath: string | null
  previewRootRef: RefObject<HTMLDivElement>
  onOpenPath: (path: string) => void
  className?: string
}

function toPosixAbsolutePath(value: string, relativePath: string): string {
  const rootSegments = value.trim().replace(/\\/g, '/').split('/').filter(Boolean)
  const relativeSegments = relativePath.trim().replace(/\\/g, '/').split('/').filter(Boolean)
  return [...rootSegments, ...relativeSegments].join('/')
}

const MARKDOWN_LINK_EXTENSIONS = new Set(['.md', '.markdown'])

export function MarkdownDocumentReadOnlyPreview({ content, activePath, previewRootRef, onOpenPath, className }: MarkdownDocumentReadOnlyPreviewProps) {
  const effectiveTheme = useEffectiveTheme()
  const projects = useAppStore((state) => state.projects)

  const base = useMemo(() => (activePath ? resolveMarkdownDocumentBase(activePath, projects) : { projectPath: '', activeRelativePath: '' }), [activePath, projects])

  const components = useMemo(
    () =>
      createMarkdownComponents({
        projectPath: base.projectPath,
        activeRelativePath: base.activeRelativePath,
        themeMode: effectiveTheme,
        enableMarkdownSyntaxHighlight: true,
        onProjectFileLinkClick: (relativePath) => {
          if (!base.projectPath || !relativePath) return
          const absolute = toPosixAbsolutePath(base.projectPath, relativePath)
          const extension = absolute.slice(absolute.lastIndexOf('.')).toLowerCase()
          if (!MARKDOWN_LINK_EXTENSIONS.has(extension)) return
          onOpenPath(absolute)
        },
      }),
    [base, effectiveTheme, onOpenPath],
  )

  return (
    <div ref={previewRootRef} className={['markdown-document-preview', 'code-markdown-preview-scroll-root', className].filter(Boolean).join(' ')}>
      <article className="code-markdown-content code-markdown-content--viewport-scroll markdown-document-preview-content">
        <MarkdownPreviewSurface content={content} components={components} forceRenderAllBlocks previewRootRef={previewRootRef} />
      </article>
    </div>
  )
}
