import { useEffect, useMemo, useState } from 'react'
import { Code2, Eye } from 'lucide-react'
import { useI18n } from '../../../i18n'
import { ZoomPanViewport } from '../../../components/ZoomPanViewport'
import { MonacoCodeEditor } from '../MonacoCodeEditor'
import { FileViewerOpenButton, FileViewerShell } from './fileViewerShared'

type FileImageViewerProps = {
  src: string
  projectPath: string
  relativePath: string
  monacoTheme: 'vs' | 'vs-dark'
}

type ImageViewMode = 'image' | 'source'

export function FileImageViewer({ src, projectPath, relativePath, monacoTheme }: FileImageViewerProps) {
  const { t } = useI18n()
  const [error, setError] = useState<string | null>(null)
  const [loadedAt, setLoadedAt] = useState(0)
  const isSvg = relativePath.toLowerCase().endsWith('.svg')
  const [mode, setMode] = useState<ImageViewMode>('image')

  useEffect(() => {
    setMode('image')
  }, [src])

  // data URL 的 base64 部分就是文件原文，直接在 renderer 侧解码为文本即可得到 SVG 源码。
  const sourceText = useMemo(() => {
    if (!isSvg) return null
    try {
      const base64 = src.slice(src.indexOf(',') + 1)
      const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0))
      return new TextDecoder('utf-8').decode(bytes)
    } catch {
      return ''
    }
  }, [isSvg, src])

  return (
    <FileViewerShell
      title={relativePath}
      actions={
        <>
          {isSvg && (
            <div className="code-editor-preview-mode-group">
              <button type="button" className={`code-editor-preview-mode-btn ${mode === 'image' ? 'is-active' : ''}`} onClick={() => setMode('image')} title={t('codeWorkspace.svgViewImage')}>
                <Eye className="h-3.5 w-3.5" />
                {t('codeWorkspace.svgViewImage')}
              </button>
              <button type="button" className={`code-editor-preview-mode-btn ${mode === 'source' ? 'is-active' : ''}`} onClick={() => setMode('source')} title={t('codeWorkspace.svgViewSource')}>
                <Code2 className="h-3.5 w-3.5" />
                {t('codeWorkspace.svgViewSource')}
              </button>
            </div>
          )}
          <FileViewerOpenButton projectPath={projectPath} relativePath={relativePath} />
        </>
      }
    >
      {error ? (
        <div className="code-file-viewer-error">{error}</div>
      ) : isSvg && mode === 'source' ? (
        <MonacoCodeEditor filePath={relativePath} value={sourceText ?? ''} language="xml" theme={monacoTheme} isReadOnly onChange={() => {}} onSave={() => {}} />
      ) : (
        <ZoomPanViewport resetKey={`${src}:${loadedAt}`}>
          <div className="code-file-viewer-image-canvas">
            <img src={src} alt={relativePath} draggable={false} className="code-file-viewer-image" onLoad={() => setLoadedAt((value) => value + 1)} onError={() => setError(t('codeWorkspace.imageLoadFailed'))} />
          </div>
        </ZoomPanViewport>
      )}
    </FileViewerShell>
  )
}
