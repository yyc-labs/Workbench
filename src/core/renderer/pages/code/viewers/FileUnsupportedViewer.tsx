import { useState } from 'react'
import { useI18n } from '../../../i18n'
import { ZoomPanViewport } from '../../../components/ZoomPanViewport'
import { projectIdFromPath } from '../../../../shared/rules'
import { useAppStore } from '../../../stores/appStore'
import { buildYycWorkbenchPreviewUrl, formatFileSize } from '../code.helpers'
import { FileViewerOpenButton, FileViewerShell } from './fileViewerShared'

/** 与主进程 PREVIEW_IMAGE_EXTENSIONS 保持一致：临时查看目前只对流式图片类型开放。 */
const TEMP_PREVIEW_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.tiff', '.tif', '.avif'])

type FileUnsupportedViewerProps = {
  size: number
  mtimeMs: number
  projectPath: string
  relativePath: string
  unsupportedReason?: 'unsupported-kind' | 'size-limit' | null
}

export function FileUnsupportedViewer({ size, mtimeMs, projectPath, relativePath, unsupportedReason = null }: FileUnsupportedViewerProps) {
  const { t } = useI18n()
  const filePreviewLimitMb = useAppStore((s) => s.config.filePreviewLimitMb ?? 50)
  // 临时查看阈值 = 自动预览上限 × 2，避免超大文件占用过多 renderer 内存。
  const tempPreviewMaxBytes = filePreviewLimitMb * 2 * 1024 * 1024
  const [tempSrc, setTempSrc] = useState<string | null>(null)
  const [tempLoadFailed, setTempLoadFailed] = useState(false)

  const dotIndex = relativePath.lastIndexOf('.')
  const extension = dotIndex >= 0 ? relativePath.slice(dotIndex).toLowerCase() : ''
  const canLoadTemporarily = unsupportedReason === 'size-limit' && size <= tempPreviewMaxBytes && TEMP_PREVIEW_IMAGE_EXTENSIONS.has(extension)

  const isSizeLimit = unsupportedReason === 'size-limit'
  const title = isSizeLimit ? t('codeWorkspace.previewTooLargeTitle') : t('codeWorkspace.previewUnsupported')
  const hint = isSizeLimit ? (canLoadTemporarily ? t('codeWorkspace.previewTooLargeHint') : t('codeWorkspace.previewTooLargeOpenHint')) : t('codeWorkspace.previewUnsupportedHint')

  const handleLoadTemporarily = () => {
    setTempLoadFailed(false)
    setTempSrc(buildYycWorkbenchPreviewUrl(projectIdFromPath(projectPath), relativePath, 'light'))
  }

  return (
    <FileViewerShell title={relativePath} canFullscreen={Boolean(tempSrc)} actions={<FileViewerOpenButton projectPath={projectPath} relativePath={relativePath} />}>
      {tempSrc ? (
        <ZoomPanViewport fitContentOnReset resetKey={tempSrc}>
          <div className="code-file-viewer-image-canvas">
            <img
              src={tempSrc}
              alt={relativePath}
              draggable={false}
              className="code-file-viewer-image"
              onError={() => {
                setTempSrc(null)
                setTempLoadFailed(true)
              }}
            />
          </div>
        </ZoomPanViewport>
      ) : (
        <div className="code-file-viewer-unsupported code-file-viewer--center">
          <h2 className="code-file-viewer-unsupported-title">{title}</h2>
          <p className="code-file-viewer-unsupported-hint">{hint}</p>
          {tempLoadFailed && <p className="code-file-viewer-unsupported-hint">{t('codeWorkspace.previewTemporaryLoadFailed')}</p>}
          {canLoadTemporarily && (
            <button type="button" className="code-editor-preview-mode-btn inline-flex items-center gap-1.5" onClick={handleLoadTemporarily}>
              {t('codeWorkspace.previewLoadTemporarily')}
            </button>
          )}
          <p className="code-file-viewer-unsupported-meta">
            <span>{formatFileSize(size)}</span>
            <span aria-hidden="true">·</span>
            <span>{new Date(mtimeMs).toLocaleString()}</span>
          </p>
        </div>
      )}
    </FileViewerShell>
  )
}
