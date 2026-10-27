import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Tooltip } from '../../../components/ui/tooltip'
import { useI18n } from '../../../i18n'
import { FileViewerOpenButton, FileViewerShell, FileViewerState } from './fileViewerShared'
import { PdfDocumentSurface } from './PdfDocumentSurface'

type FilePdfViewerProps = {
  src: string
  projectPath: string
  relativePath: string
}

/**
 * PDF 预览：FileViewerShell（工具栏）+ PdfDocumentSurface（iframe 渲染面）。
 * 渲染面已提取为独立组件，DOCX 高保真预览复用同一渲染面（18 号计划 v2④）。
 */
export function FilePdfViewer({ src, projectPath, relativePath }: FilePdfViewerProps) {
  const { t } = useI18n()
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  // src 变化（切换文件）时重置状态，渲染面内部会重发 pdf:open。
  // biome-ignore lint/correctness/useExhaustiveDependencies: src 变化本身即触发信号，effect 体无需引用。
  useEffect(() => {
    setError(null)
    setIsLoading(true)
  }, [src])

  // 新文档或刷新：重置状态，渲染面内部会重发 pdf:open。
  const handleReload = useCallback(() => {
    setError(null)
    setIsLoading(true)
    setRefreshKey((value) => value + 1)
  }, [])

  const handleReady = useCallback(() => setIsLoading(false), [])
  const handleError = useCallback(() => {
    setIsLoading(false)
    setError(t('codeWorkspace.pdfLoadFailed'))
  }, [t])
  const handleEscape = useCallback(() => setIsFullscreen(false), [])

  return (
    <FileViewerShell
      title={relativePath}
      isFullscreen={isFullscreen}
      onFullscreenChange={setIsFullscreen}
      actions={
        <>
          <Tooltip content={t('codeWorkspace.pdfRefresh')} interactive={false}>
            <button type="button" className="code-editor-preview-mode-btn inline-flex items-center gap-1.5" onClick={handleReload}>
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <FileViewerOpenButton projectPath={projectPath} relativePath={relativePath} />
        </>
      }
    >
      <div className="code-file-viewer-pdf-viewport">
        <PdfDocumentSurface src={src} ariaLabel={relativePath} reloadKey={refreshKey} onReady={handleReady} onError={handleError} onEscape={handleEscape} />
        {isLoading || error ? (
          <div className="code-file-viewer-pdf-overlay">
            <FileViewerState loading={isLoading} error={error ?? undefined} />
          </div>
        ) : null}
      </div>
    </FileViewerShell>
  )
}
