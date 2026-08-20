import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleAlert, Code2, Eye, Monitor, RefreshCw, Smartphone, Square } from 'lucide-react'
import { Tooltip } from '../../../components/ui/tooltip'
import { useI18n } from '../../../i18n'
import { MonacoCodeEditor } from '../MonacoCodeEditor'
import { dispatchPreviewMouseGesture, FileViewerOpenButton, FileViewerShell } from './fileViewerShared'

type FileHtmlViewerProps = {
  previewUrl: string
  sourceHtml: string
  projectPath: string
  relativePath: string
  monacoTheme: 'vs' | 'vs-dark'
  activeLanguage: string | null
}

type HtmlViewMode = 'render' | 'source'
type HtmlViewportMode = 'desktop' | 'mobile'

type PreviewLoadEvent = Event & { errorCode?: number }
type PreviewIpcMessageEvent = Event & { channel?: string; args?: unknown[] }

function HtmlPreviewGuest({ previewUrl, relativePath, refreshKey, onStopped }: { previewUrl: string; relativePath: string; refreshKey: number; onStopped: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const webview = document.createElement('webview')
    webview.className = 'code-file-viewer-iframe code-file-viewer-html-iframe'
    webview.setAttribute('aria-label', relativePath)
    webview.setAttribute('allowpopups', '')
    webview.setAttribute('webpreferences', 'contextIsolation=yes, nodeIntegration=no, sandbox=yes')

    const handleProcessGone = () => onStopped()
    const handleLoadFailure = (event: Event) => {
      // Reloading a guest aborts its previous navigation; it is not a preview failure.
      if ((event as PreviewLoadEvent).errorCode !== -3) onStopped()
    }
    const handleIpcMessage = (event: Event) => {
      const messageEvent = event as PreviewIpcMessageEvent
      if (messageEvent.channel !== 'preview:mouse-gesture') return
      dispatchPreviewMouseGesture((messageEvent.args?.[0] as Parameters<typeof dispatchPreviewMouseGesture>[0]) ?? null, webview.getBoundingClientRect())
    }

    webview.addEventListener('render-process-gone', handleProcessGone)
    webview.addEventListener('did-fail-load', handleLoadFailure)
    webview.addEventListener('ipc-message', handleIpcMessage)
    container.replaceChildren(webview)

    // Electron creates the guest before CSS layout settles. Keep its native
    // viewport synchronized with the flex container so viewport units and
    // nested iframes use the visible preview height rather than 300x150.
    const syncGuestViewport = () => {
      const { width, height } = container.getBoundingClientRect()
      webview.setAttribute('width', `${Math.round(width)}`)
      webview.setAttribute('height', `${Math.round(height)}`)

      // Electron 42 exposes the guest iframe through an open shadow root, but
      // leaves its default 150px height in place. Size the actual guest frame,
      // not only the host <webview> element.
      const guestFrame = webview.shadowRoot?.querySelector('iframe')
      if (guestFrame instanceof HTMLIFrameElement) {
        guestFrame.style.position = 'absolute'
        guestFrame.style.inset = '0'
        guestFrame.style.width = '100%'
        guestFrame.style.height = '100%'
      }
    }
    const resizeObserver = new ResizeObserver(syncGuestViewport)
    resizeObserver.observe(container)
    webview.addEventListener('did-attach', syncGuestViewport)
    syncGuestViewport()
    webview.setAttribute('src', previewUrl)

    return () => {
      resizeObserver.disconnect()
      webview.removeEventListener('did-attach', syncGuestViewport)
      webview.removeEventListener('render-process-gone', handleProcessGone)
      webview.removeEventListener('did-fail-load', handleLoadFailure)
      webview.removeEventListener('ipc-message', handleIpcMessage)
      webview.remove()
    }
  }, [onStopped, previewUrl, refreshKey, relativePath])

  return <div ref={containerRef} className="code-file-viewer-html-guest" />
}

export function FileHtmlViewer({ previewUrl, sourceHtml, projectPath, relativePath, monacoTheme, activeLanguage }: FileHtmlViewerProps) {
  const { t } = useI18n()
  const [mode, setMode] = useState<HtmlViewMode>('render')
  const [viewportMode, setViewportMode] = useState<HtmlViewportMode>('desktop')
  const [refreshKey, setRefreshKey] = useState(0)
  const [isPreviewStopped, setIsPreviewStopped] = useState(false)

  const isMobile = viewportMode === 'mobile'
  const stopPreview = useCallback(() => setIsPreviewStopped(true), [])
  const refreshPreview = () => {
    setIsPreviewStopped(false)
    setRefreshKey((value) => value + 1)
  }

  return (
    <FileViewerShell
      title={relativePath}
      actions={
        <>
          <div className="code-editor-preview-mode-group">
            <Tooltip content={t('codeWorkspace.htmlViewRender')} interactive={false}>
              <button type="button" className={`code-editor-preview-mode-btn ${mode === 'render' ? 'is-active' : ''}`} onClick={() => setMode('render')}>
                <Eye className="h-3.5 w-3.5" />
                {t('codeWorkspace.htmlViewRender')}
              </button>
            </Tooltip>
            <Tooltip content={t('codeWorkspace.htmlViewSource')} interactive={false}>
              <button type="button" className={`code-editor-preview-mode-btn ${mode === 'source' ? 'is-active' : ''}`} onClick={() => setMode('source')}>
                <Code2 className="h-3.5 w-3.5" />
                {t('codeWorkspace.htmlViewSource')}
              </button>
            </Tooltip>
          </div>
          {mode === 'render' && (
            <>
              <Tooltip content={isMobile ? t('codeWorkspace.htmlViewDesktop') : t('codeWorkspace.htmlViewMobile')} interactive={false}>
                <button type="button" className={`code-editor-preview-mode-btn inline-flex items-center gap-1.5 ${isMobile ? 'is-active' : ''}`} onClick={() => setViewportMode(isMobile ? 'desktop' : 'mobile')}>
                  {isMobile ? <Smartphone className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />}
                </button>
              </Tooltip>
              <Tooltip content={t('codeWorkspace.htmlRefresh')} interactive={false}>
                <button type="button" className="code-editor-preview-mode-btn inline-flex items-center gap-1.5" onClick={refreshPreview}>
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
              <Tooltip content={t('codeWorkspace.htmlStop')} interactive={false}>
                <button type="button" className="code-editor-preview-mode-btn inline-flex items-center gap-1.5" onClick={stopPreview}>
                  <Square className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            </>
          )}
          <FileViewerOpenButton projectPath={projectPath} relativePath={relativePath} />
        </>
      }
    >
      {mode === 'render' ? (
        <div className={`code-file-viewer-html-viewport ${isMobile ? 'is-mobile' : ''}`}>
          <div className="code-file-viewer-html-iframe-shell">
            {isPreviewStopped ? (
              <div className="code-file-viewer-unsupported code-file-viewer--center">
                <CircleAlert className="h-5 w-5" aria-hidden="true" />
                <h2 className="code-file-viewer-unsupported-title">{t('codeWorkspace.htmlPreviewStopped')}</h2>
                <p className="code-file-viewer-unsupported-hint">{t('codeWorkspace.htmlPreviewStoppedHint')}</p>
              </div>
            ) : (
              <HtmlPreviewGuest previewUrl={previewUrl} relativePath={relativePath} refreshKey={refreshKey} onStopped={stopPreview} />
            )}
          </div>
        </div>
      ) : (
        <MonacoCodeEditor filePath={relativePath} value={sourceHtml} language={activeLanguage || 'html'} theme={monacoTheme} isReadOnly onChange={() => {}} onSave={() => {}} />
      )}
    </FileViewerShell>
  )
}
