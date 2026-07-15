import { memo, Profiler, useEffect, type RefObject } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { remarkBoxDrawingTables } from './code.markdownBoxTables'
import { transformMarkdownUrl } from './code.markdownUrls'
import { MarkdownPreviewVisibilityProvider } from './code.markdownVisibility'
import { isMarkdownPreviewPerformanceDebugEnabled, markMarkdownPreviewPerformance, observeMarkdownPreviewLongTasks, reportMarkdownPreviewCommit } from './markdownPreviewPerformance'

const MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkBoxDrawingTables]

type MarkdownPreviewSurfaceProps = {
  components: Components
  content: string
  previewRootRef: RefObject<Element | null>
}

export const MarkdownPreviewSurface = memo(function MarkdownPreviewSurface({ components, content, previewRootRef }: MarkdownPreviewSurfaceProps) {
  useEffect(() => {
    markMarkdownPreviewPerformance('preview.first-paint')
  }, [content])

  useEffect(() => {
    if (!isMarkdownPreviewPerformanceDebugEnabled()) return
    return observeMarkdownPreviewLongTasks()
  }, [])

  return (
    <Profiler id="code-markdown-preview" onRender={reportMarkdownPreviewCommit}>
      <MarkdownPreviewVisibilityProvider rootRef={previewRootRef}>
        <ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} components={components} urlTransform={transformMarkdownUrl}>
          {content}
        </ReactMarkdown>
      </MarkdownPreviewVisibilityProvider>
    </Profiler>
  )
})
