import { useRef, useState } from 'react'
import { Code2, Eye, Monitor, RefreshCw, Smartphone } from 'lucide-react'
import { useI18n } from '../../../i18n'
import { MonacoCodeEditor } from '../MonacoCodeEditor'
import { FileViewerOpenButton, FileViewerShell, usePreviewIframeMouseGestureBridge } from './fileViewerShared'

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

export function FileHtmlViewer({ previewUrl, sourceHtml, projectPath, relativePath, monacoTheme, activeLanguage }: FileHtmlViewerProps) {
  const { t } = useI18n()
  const [mode, setMode] = useState<HtmlViewMode>('render')
  const [viewportMode, setViewportMode] = useState<HtmlViewportMode>('desktop')
  const [refreshKey, setRefreshKey] = useState(0)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  usePreviewIframeMouseGestureBridge(iframeRef)

  const isMobile = viewportMode === 'mobile'

  return (
    <FileViewerShell
      title={relativePath}
      actions={
        <>
          <div className="code-editor-preview-mode-group">
            <button type="button" className={`code-editor-preview-mode-btn ${mode === 'render' ? 'is-active' : ''}`} onClick={() => setMode('render')} title={t('codeWorkspace.htmlViewRender')}>
              <Eye className="h-3.5 w-3.5" />
              {t('codeWorkspace.htmlViewRender')}
            </button>
            <button type="button" className={`code-editor-preview-mode-btn ${mode === 'source' ? 'is-active' : ''}`} onClick={() => setMode('source')} title={t('codeWorkspace.htmlViewSource')}>
              <Code2 className="h-3.5 w-3.5" />
              {t('codeWorkspace.htmlViewSource')}
            </button>
          </div>
          {mode === 'render' && (
            <>
              <button type="button" className={`code-editor-preview-mode-btn inline-flex items-center gap-1.5 ${isMobile ? 'is-active' : ''}`} onClick={() => setViewportMode(isMobile ? 'desktop' : 'mobile')} title={isMobile ? t('codeWorkspace.htmlViewDesktop') : t('codeWorkspace.htmlViewMobile')}>
                {isMobile ? <Smartphone className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />}
              </button>
              <button type="button" className="code-editor-preview-mode-btn inline-flex items-center gap-1.5" onClick={() => setRefreshKey((value) => value + 1)} title={t('codeWorkspace.htmlRefresh')}>
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          <FileViewerOpenButton projectPath={projectPath} relativePath={relativePath} />
        </>
      }
    >
      {mode === 'render' ? (
        <div className={`code-file-viewer-html-viewport ${isMobile ? 'is-mobile' : ''}`}>
          <div className="code-file-viewer-html-iframe-shell">
            <iframe ref={iframeRef} key={refreshKey} src={previewUrl} aria-label={relativePath} className="code-file-viewer-iframe code-file-viewer-html-iframe" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads" />
          </div>
        </div>
      ) : (
        <MonacoCodeEditor filePath={relativePath} value={sourceHtml} language={activeLanguage || 'html'} theme={monacoTheme} isReadOnly onChange={() => {}} onSave={() => {}} />
      )}
    </FileViewerShell>
  )
}
