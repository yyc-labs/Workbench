import { useCallback, useEffect, useId, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { useI18n } from '../../i18n'
import { sanitizeMermaidSvgMarkup } from './code.markdownMermaid.sanitize'
import type { MarkdownStructuredBlockClickPayload, SourceLineDataProps } from './code.markdown'

const MARKDOWN_MERMAID_RENDER_ID_PREFIX = 'code-markdown-mermaid'

type MermaidModule = typeof import('mermaid')

let mermaidModulePromise: Promise<MermaidModule> | null = null

async function loadMermaid(): Promise<MermaidModule> {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('mermaid')
  }
  return mermaidModulePromise
}

export async function renderMermaidDiagram(
  id: string,
  codeText: string,
  themeMode: 'light' | 'dark'
): Promise<string> {
  const mermaidModule = await loadMermaid()
  const mermaid = mermaidModule.default

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: themeMode === 'dark' ? 'dark' : 'default',
    flowchart: {
      htmlLabels: false,
    },
  })

  const { svg } = await mermaid.render(id, codeText)
  return sanitizeMermaidSvgMarkup(svg)
}

type MermaidBlockProps = {
  codeText: string
  onStructuredBlockClick?: (payload: MarkdownStructuredBlockClickPayload) => void
  shouldIgnoreActivation: (target: EventTarget | null, currentTarget: EventTarget | null) => boolean
  sourceLineProps?: SourceLineDataProps
  themeMode: 'light' | 'dark'
}

export function MermaidBlock({
  codeText,
  onStructuredBlockClick,
  shouldIgnoreActivation,
  sourceLineProps,
  themeMode,
}: MermaidBlockProps) {
  const { t } = useI18n()
  const diagramId = useId().replace(/:/g, '-')
  const [svgMarkup, setSvgMarkup] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setErrorMessage(null)

    void renderMermaidDiagram(`${MARKDOWN_MERMAID_RENDER_ID_PREFIX}-${diagramId}`, codeText, themeMode)
      .then((svg) => {
        if (cancelled) return
        setSvgMarkup(svg)
        setErrorMessage(null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : t('codeMarkdown.unknownRenderError')
        setSvgMarkup('')
        setErrorMessage(message)
      })

    return () => {
      cancelled = true
    }
  }, [codeText, diagramId, themeMode, t])

  const canOpenStructuredPreview = Boolean(onStructuredBlockClick && sourceLineProps)
  const activateStructuredPreview = useCallback(() => {
    if (!onStructuredBlockClick || !sourceLineProps) return
    onStructuredBlockClick({
      kind: 'mermaid',
      startLine: sourceLineProps['data-source-start-line'],
      endLine: sourceLineProps['data-source-end-line'],
    })
  }, [onStructuredBlockClick, sourceLineProps])

  const interactiveProps = canOpenStructuredPreview
    ? {
        className: 'code-markdown-mermaid-wrap code-markdown-zoomable-structure',
        tabIndex: 0,
        title: 'Click to enlarge',
        'aria-label': 'Open larger mermaid preview',
        'data-structured-block-kind': 'mermaid',
        role: 'button' as const,
        onClick: (event: ReactMouseEvent<HTMLDivElement>) => {
          if (shouldIgnoreActivation(event.target, event.currentTarget)) {
            return
          }
          activateStructuredPreview()
        },
        onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => {
          if (event.key !== 'Enter' && event.key !== ' ') {
            return
          }
          event.preventDefault()
          activateStructuredPreview()
        },
      }
    : {
        className: 'code-markdown-mermaid-wrap',
      }

  return (
    <div {...interactiveProps} {...sourceLineProps}>
      {svgMarkup ? (
        <div
          className="code-markdown-mermaid-diagram"
          dangerouslySetInnerHTML={{ __html: svgMarkup }}
        />
      ) : (
        <pre className="code-markdown-plain-block">
          <code className="language-mermaid">{codeText}</code>
        </pre>
      )}
      {errorMessage && (
        <div className="code-markdown-mermaid-error" title={errorMessage}>
          {errorMessage}
        </div>
      )}
    </div>
  )
}
