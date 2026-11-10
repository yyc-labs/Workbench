import { useMemo, type RefObject } from 'react'
import { MarkdownPreviewSurface } from '../code/MarkdownPreviewSurface'
import { createMarkdownComponents } from '../code/code.markdown'
import { parseMarkdownDocument } from '../code/code.frontmatterParser'
import { useEffectiveTheme } from '../../hooks/useEffectiveTheme'
import { useAppStore } from '../../stores/appStore'
import { MarkdownFrontmatterMetaCard } from './MarkdownFrontmatterMetaCard'
import { resolveMarkdownDocumentBase } from './markdownDocumentLinks'
import { resolveMarkdownLinkTargetWithRootFallback } from '../code/code.markdownLinkTarget'

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

export function MarkdownDocumentReadOnlyPreview({ content, activePath, previewRootRef, onOpenPath, className }: MarkdownDocumentReadOnlyPreviewProps) {
  const effectiveTheme = useEffectiveTheme()
  const projects = useAppStore((state) => state.projects)

  const base = useMemo(() => (activePath ? resolveMarkdownDocumentBase(activePath, projects) : { projectPath: '', activeRelativePath: '' }), [activePath, projects])

  const parsedDoc = useMemo(() => parseMarkdownDocument(content), [content])
  const previewContent = parsedDoc.hasFrontmatter ? parsedDoc.markdownBody : content

  const components = useMemo(
    () =>
      createMarkdownComponents({
        projectPath: base.projectPath,
        activeRelativePath: base.activeRelativePath,
        themeMode: effectiveTheme,
        enableMarkdownSyntaxHighlight: true,
        onProjectFileLinkClick: (relativePath, rootRelativeFallback) => {
          if (!base.projectPath || !relativePath) return
          void resolveMarkdownLinkTargetWithRootFallback(base.projectPath, relativePath, rootRelativeFallback).then((target) => {
            // 该页面没有文件树，目录/缺失目标不处理（目录入口文件已在 resolve 内尝试命中）
            if (target.kind !== 'file') return
            onOpenPath(toPosixAbsolutePath(base.projectPath, target.relativePath))
          })
        },
      }),
    [base, effectiveTheme, onOpenPath],
  )

  return (
    <div ref={previewRootRef} className={['markdown-document-preview', 'code-markdown-preview-scroll-root', className].filter(Boolean).join(' ')}>
      <article className="code-markdown-content code-markdown-content--viewport-scroll markdown-document-preview-content">
        <MarkdownFrontmatterMetaCard entries={parsedDoc.frontmatterEntries} />
        <MarkdownPreviewSurface content={previewContent} components={components} forceRenderAllBlocks previewRootRef={previewRootRef} />
      </article>
    </div>
  )
}
