import { Copy, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DocxPreviewErrorReason } from '../../../../../shared/types'
import { toast } from '../../../../components/ui/toast'
import { Tooltip } from '../../../../components/ui/tooltip'
import { useI18n } from '../../../../i18n'
import { FileViewerOpenButton, FileViewerShell, FileViewerState } from '../fileViewerShared'
import { PdfDocumentSurface } from '../PdfDocumentSurface'
import { DocxPreviewFallbackView } from './DocxPreviewFallbackView'

type FileDocxViewerProps = {
  projectPath: string
  relativePath: string
}

type DocxPhase = { kind: 'loading' } | { kind: 'pdf'; pdfBase64: string } | { kind: 'engine-missing' } | { kind: 'error'; reason: DocxPreviewErrorReason } | { kind: 'fallback'; base64: string | null }

const WINGET_INSTALL_COMMAND = 'winget install -e --id TheDocumentFoundation.LibreOffice --source winget'
const LIBREOFFICE_DOWNLOAD_URL = 'https://www.libreoffice.org/download/'
const LIBREOFFICE_MIRROR_URL = 'https://mirrors.tuna.tsinghua.edu.cn/libreoffice/'

const ERROR_REASON_KEYS: Record<DocxPreviewErrorReason, string> = {
  timeout: 'codeWorkspace.docxErrorTimeout',
  'conversion-failed': 'codeWorkspace.docxErrorConversionFailed',
  'output-missing': 'codeWorkspace.docxErrorConversionFailed',
  'source-changed': 'codeWorkspace.docxErrorSourceChanged',
  'source-too-large': 'codeWorkspace.docxErrorSourceTooLarge',
  'output-too-large': 'codeWorkspace.docxErrorOutputTooLarge',
  'queue-full': 'codeWorkspace.docxErrorQueueFull',
  cancelled: 'codeWorkspace.docxErrorConversionFailed',
}

// 「改用基础预览」的本会话记忆（D1）：切换文件再回来不再重复询问。
const fallbackSessionKeys = new Set<string>()

/**
 * Word（.docx）高保真预览（18 号计划）：主进程 LibreOffice 转 PDF，
 * 复用 PdfDocumentSurface 渲染；本组件自持 FileViewerShell 与工具栏，
 * 不嵌套 FilePdfViewer（双 Shell）。引擎缺失给安装引导，转换失败给
 * 明确错误 + 重试，基础预览只能手动触发（禁止静默 fallback）。
 */
export function FileDocxViewer({ projectPath, relativePath }: FileDocxViewerProps) {
  const { t } = useI18n()
  const sessionKey = useMemo(() => `${projectPath}\u0000${relativePath}`, [projectPath, relativePath])
  const requestSeqRef = useRef(0)
  const activeRequestIdRef = useRef<string | null>(null)
  const fallbackBase64Ref = useRef<string | null>(null)
  const [phase, setPhase] = useState<DocxPhase>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [surfaceLoading, setSurfaceLoading] = useState(false)
  const [surfaceError, setSurfaceError] = useState(false)

  const enterFallback = useCallback(async () => {
    fallbackSessionKeys.add(sessionKey)
    const seq = ++requestSeqRef.current
    activeRequestIdRef.current = null
    setSurfaceLoading(false)
    setSurfaceError(false)
    if (fallbackBase64Ref.current) {
      setPhase({ kind: 'fallback', base64: fallbackBase64Ref.current })
      return
    }
    setPhase({ kind: 'fallback', base64: null })
    try {
      const source = await window.electronAPI.readDocxSource(projectPath, relativePath)
      if (requestSeqRef.current !== seq) return
      fallbackBase64Ref.current = source.base64
      setPhase({ kind: 'fallback', base64: source.base64 })
    } catch {
      if (requestSeqRef.current !== seq) return
      setPhase({ kind: 'error', reason: 'conversion-failed' })
    }
  }, [projectPath, relativePath, sessionKey])

  // 请求转换（v2⑤）：切换文件/刷新时取消上一次排队中任务，过期响应丢弃。
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey 仅作为重试触发信号，sessionKey 与路径参数等价。
  useEffect(() => {
    if (fallbackSessionKeys.has(sessionKey)) {
      void enterFallback()
      return undefined
    }
    let disposed = false
    const seq = ++requestSeqRef.current
    const requestId = crypto.randomUUID()
    activeRequestIdRef.current = requestId
    setSurfaceLoading(false)
    setSurfaceError(false)
    setPhase({ kind: 'loading' })
    void (async () => {
      try {
        const result = await window.electronAPI.docxPreview(projectPath, relativePath, requestId)
        if (disposed || requestSeqRef.current !== seq) return
        if (result.status === 'ok') {
          setSurfaceLoading(true)
          setPhase({ kind: 'pdf', pdfBase64: result.pdfBase64 })
        } else if (result.status === 'engine-missing') {
          setPhase({ kind: 'engine-missing' })
        } else {
          setPhase({ kind: 'error', reason: result.reason })
        }
      } catch {
        if (!disposed && requestSeqRef.current === seq) setPhase({ kind: 'error', reason: 'conversion-failed' })
      }
    })()
    return () => {
      disposed = true
      if (activeRequestIdRef.current) void window.electronAPI.cancelDocxPreview(activeRequestIdRef.current)
    }
  }, [projectPath, relativePath, sessionKey, reloadKey, enterFallback])

  const handleRetry = useCallback(() => setReloadKey((value) => value + 1), [])
  const handleSurfaceReady = useCallback(() => setSurfaceLoading(false), [])
  const handleSurfaceError = useCallback(() => {
    setSurfaceLoading(false)
    setSurfaceError(true)
  }, [])
  const handleSurfaceEscape = useCallback(() => setIsFullscreen(false), [])

  const handleCopyWinget = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(WINGET_INSTALL_COMMAND)
      toast.success(t('codeWorkspace.docxCommandCopied'))
    } catch {
      toast.error(t('codeWorkspace.docxCopyCommandFailed'))
    }
  }, [t])

  return (
    <FileViewerShell
      title={relativePath}
      isFullscreen={phase.kind === 'pdf' ? isFullscreen : undefined}
      onFullscreenChange={phase.kind === 'pdf' ? setIsFullscreen : undefined}
      actions={
        <>
          {phase.kind === 'pdf' ? (
            <Tooltip content={t('codeWorkspace.pdfRefresh')} interactive={false}>
              <button type="button" className="code-editor-preview-mode-btn inline-flex items-center gap-1.5" onClick={handleRetry}>
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          ) : null}
          <FileViewerOpenButton projectPath={projectPath} relativePath={relativePath} />
        </>
      }
    >
      {phase.kind === 'pdf' ? (
        <div className="code-file-viewer-pdf-viewport">
          <PdfDocumentSurface src={phase.pdfBase64} ariaLabel={relativePath} reloadKey={reloadKey} onReady={handleSurfaceReady} onError={handleSurfaceError} onEscape={handleSurfaceEscape} />
          {surfaceLoading || surfaceError ? (
            <div className="code-file-viewer-pdf-overlay">
              <FileViewerState loading={surfaceLoading} error={surfaceError ? t('codeWorkspace.pdfLoadFailed') : undefined} />
            </div>
          ) : null}
        </div>
      ) : phase.kind === 'fallback' ? (
        phase.base64 ? (
          <DocxPreviewFallbackView data={phase.base64} relativePath={relativePath} />
        ) : (
          <div className="code-file-viewer-unsupported code-file-viewer--center">
            <FileViewerState loading />
          </div>
        )
      ) : phase.kind === 'engine-missing' ? (
        <div className="code-file-viewer-unsupported code-file-viewer--center max-w-xl">
          <h2 className="code-file-viewer-unsupported-title">{t('codeWorkspace.docxEngineMissingTitle')}</h2>
          <p className="code-file-viewer-unsupported-hint">{t('codeWorkspace.docxEngineMissingDescription')}</p>
          <div className="mt-5 w-full max-w-lg rounded-md border border-[color:var(--color-border)] p-4 text-left">
            <p className="text-sm font-medium text-[color:var(--color-foreground)]">{t('codeWorkspace.docxInstallWingetLabel')}</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-[color:var(--color-muted)] px-2 py-1 text-xs text-[color:var(--color-foreground)]">{WINGET_INSTALL_COMMAND}</code>
              <button type="button" className="code-editor-preview-mode-btn inline-flex shrink-0 items-center gap-1.5" onClick={() => void handleCopyWinget()}>
                <Copy className="h-3.5 w-3.5" />
                {t('codeWorkspace.docxCopyCommand')}
              </button>
            </div>
            <p className="mt-2 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('codeWorkspace.docxInstallWingetHint')}</p>
            <p className="mt-3 text-sm text-[color:var(--color-foreground)]">
              <a className="underline underline-offset-2" href={LIBREOFFICE_DOWNLOAD_URL} target="_blank" rel="noreferrer">
                {t('codeWorkspace.docxInstallSiteLabel')}
              </a>
            </p>
            <p className="mt-1 text-sm text-[color:var(--color-foreground)]">
              <a className="underline underline-offset-2" href={LIBREOFFICE_MIRROR_URL} target="_blank" rel="noreferrer">
                {t('codeWorkspace.docxInstallMirrorLabel')}
              </a>
            </p>
            <p className="mt-3 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('codeWorkspace.docxEngineMissingHint')}</p>
          </div>
          <div className="mt-5 flex items-center gap-3">
            <button type="button" className="code-editor-preview-mode-btn inline-flex items-center gap-1.5" onClick={handleRetry}>
              {t('codeWorkspace.docxRecheck')}
            </button>
            <button type="button" className="code-editor-preview-mode-btn inline-flex items-center gap-1.5" onClick={() => void enterFallback()}>
              {t('codeWorkspace.docxUseBasicPreview')}
            </button>
          </div>
        </div>
      ) : phase.kind === 'error' ? (
        <div className="code-file-viewer-unsupported code-file-viewer--center">
          <h2 className="code-file-viewer-unsupported-title">{t('codeWorkspace.docxErrorTitle')}</h2>
          <p className="code-file-viewer-unsupported-hint">{t(ERROR_REASON_KEYS[phase.reason])}</p>
          <div className="mt-5 flex items-center gap-3">
            <button type="button" className="code-editor-preview-mode-btn inline-flex items-center gap-1.5" onClick={handleRetry}>
              {t('codeWorkspace.docxRetry')}
            </button>
            <button type="button" className="code-editor-preview-mode-btn inline-flex items-center gap-1.5" onClick={() => void enterFallback()}>
              {t('codeWorkspace.docxUseBasicPreview')}
            </button>
          </div>
        </div>
      ) : (
        <div className="code-file-viewer-unsupported code-file-viewer--center">
          <p className="code-file-viewer-unsupported-hint">{t('codeWorkspace.docxConverting')}</p>
        </div>
      )}
    </FileViewerShell>
  )
}
