import { type ComponentProps, type ComponentType, memo, Profiler, type RefObject, useDeferredValue, useEffect, useMemo } from 'react'
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { remarkBoxDrawingTables } from './code.markdownBoxTables'
import { transformMarkdownUrl } from './code.markdownUrls'
import { MarkdownPreviewVisibilityProvider } from './code.markdownVisibility'
import { isMarkdownPreviewPerformanceDebugEnabled, markMarkdownPreviewPerformance, observeMarkdownPreviewLongTasks, reportMarkdownPreviewCommit } from './markdownPreviewPerformance'
import 'katex/dist/katex.min.css'

const MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkBoxDrawingTables, remarkMath]
const MARKDOWN_REHYPE_PLUGINS = [rehypeKatex]

type MarkdownPreviewSurfaceProps = {
  components: Components
  content: string
  forceRenderAllBlocks?: boolean
  previewRootRef: RefObject<Element | null>
}

export const MarkdownPreviewSurface = memo(function MarkdownPreviewSurface({ components, content, forceRenderAllBlocks = false, previewRootRef }: MarkdownPreviewSurfaceProps) {
  const deferredContent = useDeferredValue(content)
  const previewComponents = useMemo<Components>(() => {
    const TableComponent = components.table as ComponentType<ComponentProps<'table'> & ExtraProps> | undefined
    return {
      ...components,
      table({ node, ...props }: ComponentProps<'table'> & ExtraProps) {
        return <div className="code-markdown-table-scroll">{TableComponent ? <TableComponent node={node} {...props} /> : <table {...props} />}</div>
      },
    }
  }, [components])

  useEffect(() => {
    markMarkdownPreviewPerformance('preview.first-paint')
  }, [deferredContent])

  useEffect(() => {
    if (!isMarkdownPreviewPerformanceDebugEnabled()) return
    return observeMarkdownPreviewLongTasks()
  }, [])

  return (
    <Profiler id="code-markdown-preview" onRender={reportMarkdownPreviewCommit}>
      <MarkdownPreviewVisibilityProvider forceRenderAllBlocks={forceRenderAllBlocks} rootRef={previewRootRef}>
        <ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} rehypePlugins={MARKDOWN_REHYPE_PLUGINS} components={previewComponents} urlTransform={transformMarkdownUrl}>
          {deferredContent}
        </ReactMarkdown>
      </MarkdownPreviewVisibilityProvider>
    </Profiler>
  )
})
