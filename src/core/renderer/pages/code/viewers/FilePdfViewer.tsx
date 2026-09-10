import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Tooltip } from '../../../components/ui/tooltip'
import { useI18n } from '../../../i18n'
import { useEffectiveTheme } from '../../../hooks/useEffectiveTheme'
import { base64ToUint8Array } from '../../../lib/bytes'
import { FileViewerOpenButton, FileViewerShell, FileViewerState, usePreviewIframeMouseGestureBridge } from './fileViewerShared'

type FilePdfViewerProps = {
  src: string
  projectPath: string
  relativePath: string
}

type PdfFrameMessage = { type: 'pdf:ready' } | { type: 'pdf:error' } | { type: 'pdf:escape' }

/**
 * Renders a PDF inside a dedicated iframe page (`pdf-viewer.html`) powered by
 * pdf.js. Chromium's built-in PDF viewer cannot be used here: on Electron 42
 * its sandboxed renderer crashes with "object null is not iterable" while
 * requesting preload data over a sync IPC that the main process never answers.
 *
 * Navigation is handled inside the frame like a browser PDF reader: all pages
 * are stacked and rendered progressively (first page appears immediately),
 * plain wheel scrolls through them, Ctrl/Cmd + wheel zooms.
 */
export function FilePdfViewer({ src, projectPath, relativePath }: FilePdfViewerProps) {
  const { t } = useI18n()
  const theme = useEffectiveTheme()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  usePreviewIframeMouseGestureBridge(iframeRef)

  const viewerSrc = useMemo(() => new URL('pdf-viewer.html', window.location.href).href, [])
  const pdfData = useMemo(() => base64ToUint8Array(src), [src])

  const postToFrame = useCallback((message: unknown) => {
    iframeRef.current?.contentWindow?.postMessage(message, '*')
  }, [])

  // New document: reset state and (re)open it in the frame once loaded.
  // Bumping refreshKey re-posts `pdf:open` so the frame rebuilds from scratch.
  useEffect(() => {
    setError(null)
    setIsLoading(true)
    postToFrame({ type: 'pdf:open', data: pdfData })
  }, [pdfData, postToFrame, refreshKey])

  // Keep the frame's theme in sync with the workbench.
  useEffect(() => {
    postToFrame({ type: 'pdf:theme', theme })
  }, [theme, postToFrame])

  // Frame → host messages (document loaded, load errors).
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const message = event.data as PdfFrameMessage | undefined
      if (!message || typeof message.type !== 'string') return
      switch (message.type) {
        case 'pdf:ready':
          setIsLoading(false)
          break
        case 'pdf:error':
          setIsLoading(false)
          setError(t('codeWorkspace.pdfLoadFailed'))
          break
        case 'pdf:escape':
          setIsFullscreen(false)
          break
        default:
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [t])

  return (
    <FileViewerShell
      title={relativePath}
      isFullscreen={isFullscreen}
      onFullscreenChange={setIsFullscreen}
      actions={
        <>
          <Tooltip content={t('codeWorkspace.pdfRefresh')} interactive={false}>
            <button type="button" className="code-editor-preview-mode-btn inline-flex items-center gap-1.5" onClick={() => setRefreshKey((value) => value + 1)}>
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <FileViewerOpenButton projectPath={projectPath} relativePath={relativePath} />
        </>
      }
    >
      <div className="code-file-viewer-pdf-viewport">
        <iframe
          ref={iframeRef}
          src={viewerSrc}
          aria-label={relativePath}
          className="code-file-viewer-iframe"
          sandbox="allow-scripts allow-same-origin"
          onLoad={() => {
            postToFrame({ type: 'pdf:theme', theme })
            postToFrame({ type: 'pdf:open', data: pdfData })
          }}
        />
        {isLoading || error ? (
          <div className="code-file-viewer-pdf-overlay">
            <FileViewerState loading={isLoading} error={error ?? undefined} />
          </div>
        ) : null}
      </div>
    </FileViewerShell>
  )
}
