import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Tooltip } from '../../../../components/ui/tooltip'
import { useI18n } from '../../../../i18n'
import { base64ToUint8Array } from '../../../../lib/bytes'
import { FileViewerOpenButton, FileViewerShell, FileViewerState } from '../fileViewerShared'
import { renderDocxIntoElement } from './docxRenderer'

type FileDocxViewerProps = {
  /** binaryDataUrl（data:<mime>;base64,...），由 useCodeFileState 对二进制类型统一构造。 */
  data: string
  projectPath: string
  relativePath: string
}

const DOCX_ZOOM_MIN = 0.4
const DOCX_ZOOM_MAX = 3
const DOCX_ZOOM_STEP = 0.1

/**
 * Word（.docx）预览：docx-preview 直接在工作区 DOM 中渲染 OOXML，
 * 不经过 iframe。渲染逻辑被隔离在 docxRenderer.ts，本组件只负责
 * 状态（loading/error）与工具栏，不感知 docx-preview 的存在。
 */
export function FileDocxViewer({ data, projectPath, relativePath }: FileDocxViewerProps) {
  const { t } = useI18n()
  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [zoom, setZoom] = useState(1)
  const docxData = useMemo(() => base64ToUint8Array(data), [data])

  // Ctrl/Cmd + 滚轮缩放视口。React 的 onWheel 是 passive 监听，无法
  // preventDefault 阻止浏览器级缩放，这里用非 passive 原生监听。
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      setZoom((prev) => Math.min(DOCX_ZOOM_MAX, Math.max(DOCX_ZOOM_MIN, prev + (event.deltaY < 0 ? DOCX_ZOOM_STEP : -DOCX_ZOOM_STEP))))
    }
    scroller.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      scroller.removeEventListener('wheel', onWheel)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    setError(null)
    setIsLoading(true)

    void renderDocxIntoElement(docxData, canvas)
      .then(() => {
        if (cancelled) return
        setIsLoading(false)
      })
      .catch((renderError) => {
        if (cancelled) return
        console.warn(`[file-preview] failed to render "${relativePath}" with docx-preview`, renderError)
        setIsLoading(false)
        setError(t('codeWorkspace.docxLoadFailed'))
      })

    return () => {
      cancelled = true
    }
  }, [docxData, refreshKey, relativePath, t])

  return (
    <FileViewerShell
      title={relativePath}
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
      <div ref={scrollRef} className="code-docx-viewer-scroll">
        <div ref={canvasRef} className="code-docx-viewer-canvas" style={{ zoom }} />
      </div>
      {isLoading || error ? (
        <div className="code-docx-viewer-overlay">
          <FileViewerState loading={isLoading} error={error ?? undefined} />
        </div>
      ) : null}
    </FileViewerShell>
  )
}
