import { FolderSearch } from 'lucide-react'
import type { ProjectFileNodeKind } from '../../../../shared/types'
import { useI18n } from '../../../i18n'
import { joinProjectPath, resolveTreeNodeFolderPath } from '../code.pathActions'
import { FileViewerOpenButton, FileViewerShell } from './fileViewerShared'

type FileExcludedViewerProps = {
  nodeKind: ProjectFileNodeKind
  projectPath: string
  relativePath: string
}

export function FileExcludedViewer({ nodeKind, projectPath, relativePath }: FileExcludedViewerProps) {
  const { t } = useI18n()

  const handleRevealInExplorer = async () => {
    const folderPath = resolveTreeNodeFolderPath(projectPath, relativePath, nodeKind)
    const revealPath = joinProjectPath(projectPath, relativePath)
    await window.electronAPI.openFolder(folderPath, revealPath)
  }

  return (
    <FileViewerShell title={relativePath} canFullscreen={false}>
      <div className="code-file-viewer-unsupported code-file-viewer--center">
        <h2 className="code-file-viewer-unsupported-title">{t('codeWorkspace.excludedEntryTitle')}</h2>
        <p className="code-file-viewer-unsupported-hint">{nodeKind === 'directory' ? t('codeWorkspace.excludedEntryDirectoryHint') : t('codeWorkspace.excludedEntryFileHint')}</p>
        <p className="code-file-viewer-unsupported-meta">
          <span className="code-file-viewer-unsupported-path">{relativePath}</span>
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          {nodeKind === 'directory' ? (
            <button
              type="button"
              className="code-editor-preview-mode-btn inline-flex items-center gap-1.5"
              onClick={() => {
                void handleRevealInExplorer()
              }}
            >
              <FolderSearch className="h-3.5 w-3.5" />
              <span>{t('codeWorkspace.excludedRevealInExplorer')}</span>
            </button>
          ) : (
            <FileViewerOpenButton projectPath={projectPath} relativePath={relativePath} />
          )}
        </div>
      </div>
    </FileViewerShell>
  )
}
