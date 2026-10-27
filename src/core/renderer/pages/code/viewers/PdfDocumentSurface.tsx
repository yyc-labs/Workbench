import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useEffectiveTheme } from '../../../hooks/useEffectiveTheme'
import { base64ToUint8Array } from '../../../lib/bytes'
import { usePreviewIframeMouseGestureBridge } from './fileViewerShared'

type PdfFrameMessage = { type: 'pdf:ready' } | { type: 'pdf:error' } | { type: 'pdf:escape' }

type PdfDocumentSurfaceProps = {
  /** PDF 二进制的 base64（不带 data: 前缀）。 */
  src: string
  ariaLabel: string
  /** 变化时向 iframe 重发 pdf:open（宿主刷新按钮语义）。 */
  reloadKey?: number
  onReady?: () => void
  onError?: () => void
  onEscape?: () => void
}

/**
 * PDF 文档渲染面（iframe + pdf-viewer.html + postMessage 协议），从 FilePdfViewer
 * 提取的最小组件（18 号计划 v2④）：DOCX 高保真预览复用同一渲染面，宿主自持
 * FileViewerShell 与工具栏，本组件只负责文档加载、主题同步与滚轮缩放手势。
 *
 * 不使用 Chromium 内置 PDF viewer：Electron 42 沙箱 renderer 崩溃（见 FilePdfViewer 注释）。
 */
export function PdfDocumentSurface({ src, ariaLabel, reloadKey = 0, onReady, onError, onEscape }: PdfDocumentSurfaceProps) {
  const theme = useEffectiveTheme()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  usePreviewIframeMouseGestureBridge(iframeRef)

  const viewerSrc = useMemo(() => new URL('pdf-viewer.html', window.location.href).href, [])
  const pdfData = useMemo(() => base64ToUint8Array(src), [src])

  const postToFrame = useCallback((message: unknown) => {
    iframeRef.current?.contentWindow?.postMessage(message, '*')
  }, [])

  // 新文档/刷新：向 frame 重发 pdf:open，由 frame 从头重建。
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey 仅作为刷新触发信号，effect 体无需引用。
  useEffect(() => {
    postToFrame({ type: 'pdf:open', data: pdfData })
  }, [pdfData, postToFrame, reloadKey])

  // frame 主题与工作区保持同步。
  useEffect(() => {
    postToFrame({ type: 'pdf:theme', theme })
  }, [theme, postToFrame])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const message = event.data as PdfFrameMessage | undefined
      if (!message || typeof message.type !== 'string') return
      switch (message.type) {
        case 'pdf:ready':
          onReady?.()
          break
        case 'pdf:error':
          onError?.()
          break
        case 'pdf:escape':
          onEscape?.()
          break
        default:
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onReady, onError, onEscape])

  return (
    <iframe
      ref={iframeRef}
      src={viewerSrc}
      title={ariaLabel}
      aria-label={ariaLabel}
      className="code-file-viewer-iframe"
      sandbox="allow-scripts allow-same-origin"
      onLoad={() => {
        postToFrame({ type: 'pdf:theme', theme })
        postToFrame({ type: 'pdf:open', data: pdfData })
      }}
    />
  )
}
