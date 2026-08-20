import { useI18n } from '../../../i18n'
import { formatFileSize } from '../code.helpers'
import { FileViewerOpenButton, FileViewerShell } from './fileViewerShared'

type FileUnsupportedViewerProps = {
  size: number
  mtimeMs: number
  projectPath: string
  relativePath: string
}

export function FileUnsupportedViewer({ size, mtimeMs, projectPath, relativePath }: FileUnsupportedViewerProps) {
  const { t } = useI18n()

  return (
    <FileViewerShell title={relativePath} canFullscreen={false} actions={<FileViewerOpenButton projectPath={projectPath} relativePath={relativePath} />}>
      <div className="code-file-viewer-unsupported code-file-viewer--center">
        <h2 className="code-file-viewer-unsupported-title">{t('codeWorkspace.previewUnsupported')}</h2>
        <p className="code-file-viewer-unsupported-hint">{t('codeWorkspace.previewUnsupportedHint')}</p>
        <p className="code-file-viewer-unsupported-meta">
          <span>{formatFileSize(size)}</span>
          <span aria-hidden="true">·</span>
          <span>{new Date(mtimeMs).toLocaleString()}</span>
        </p>
      </div>
    </FileViewerShell>
  )
}
