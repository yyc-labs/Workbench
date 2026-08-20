import { useState } from 'react'
import { useI18n } from '../../../i18n'
import { ZoomPanViewport } from '../../../components/ZoomPanViewport'
import { FileViewerOpenButton, FileViewerShell } from './fileViewerShared'

type FileImageViewerProps = {
  src: string
  projectPath: string
  relativePath: string
}

export function FileImageViewer({ src, projectPath, relativePath }: FileImageViewerProps) {
  const { t } = useI18n()
  const [error, setError] = useState<string | null>(null)
  const [loadedAt, setLoadedAt] = useState(0)

  return (
    <FileViewerShell title={relativePath} actions={<FileViewerOpenButton projectPath={projectPath} relativePath={relativePath} />}>
      {error ? (
        <div className="code-file-viewer-error">{error}</div>
      ) : (
        <ZoomPanViewport fitContentOnReset resetKey={`${src}:${loadedAt}`}>
          <div className="code-file-viewer-image-canvas">
            <img src={src} alt={relativePath} draggable={false} className="code-file-viewer-image" onLoad={() => setLoadedAt((value) => value + 1)} onError={() => setError(t('codeWorkspace.imageLoadFailed'))} />
          </div>
        </ZoomPanViewport>
      )}
    </FileViewerShell>
  )
}
