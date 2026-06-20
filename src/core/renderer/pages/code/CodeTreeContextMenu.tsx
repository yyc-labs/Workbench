import { Copy, FileText, Folder, FolderOpen } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useCallback, useEffect } from 'react'
import type { ProjectFileNodeKind } from '../../../shared/types'
import { useI18n } from '../../i18n'

export interface CodeTreeContextMenuPayload {
  x: number
  y: number
  relativePath: string
  nodeName: string
  nodeKind: ProjectFileNodeKind
}

interface CodeTreeContextMenuProps {
  x: number
  y: number
  nodeName: string
  nodeKind: ProjectFileNodeKind
  onOpenFolder: () => void | Promise<void>
  onCopyName: () => void | Promise<void>
  onCopyRelativePath: () => void | Promise<void>
  onCopyRelativePathWithoutSlashes: () => void | Promise<void>
  onClose: () => void
}

export function CodeTreeContextMenu({
  x,
  y,
  nodeName,
  nodeKind,
  onOpenFolder,
  onCopyName,
  onCopyRelativePath,
  onCopyRelativePathWithoutSlashes,
  onClose,
}: CodeTreeContextMenuProps) {
  const { t } = useI18n()
  const width = 210
  const height = 188
  const padding = 8
  const left = Math.min(Math.max(padding, x), window.innerWidth - width - padding)
  const top = Math.min(Math.max(padding, y), window.innerHeight - height - padding)

  const handleAction = useCallback(
    async (action: () => void | Promise<void>) => {
      await action()
      onClose()
    },
    [onClose]
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    const onPointerDown = () => onClose()
    const timer = window.setTimeout(() => {
      document.addEventListener('pointerdown', onPointerDown)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [onClose])

  const itemTypeLabel = nodeKind === 'directory' ? t('codeFileTree.directory') : t('codeFileTree.file')
  const openFolderLabel = nodeKind === 'directory' ? t('codeFileTree.openDirectory') : t('codeFileTree.openCurrentFolder')
  const copyNameLabel = nodeKind === 'directory' ? t('codeFileTree.copyDirectoryName') : t('codeFileTree.copyFileName')
  const copyRelativePathLabel = t('codeFileTree.copyRelativePath')
  const copyRelativePathWithoutSlashesLabel = t('codeFileTree.copyRelativePathWithoutSlashes')

  return createPortal(
    <div
      className="fixed z-[9998] min-w-[210px] rounded-[16px] border border-[color:var(--color-border)] bg-[color:var(--color-popover)] p-1.5 shadow-[var(--shadow-popover)]"
      style={{ top, left }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="px-2.5 py-1.5 text-[10px] text-[color:var(--color-muted-foreground)]">
        <span className="inline-flex items-center gap-1">
          {nodeKind === 'directory'
            ? <Folder className="h-3.5 w-3.5 text-[color:var(--color-warning)]" />
            : <FileText className="h-3.5 w-3.5 text-[color:var(--color-muted-foreground)]" />}
          <span>{itemTypeLabel}:</span>
        </span>{' '}
        <span className="font-medium text-[color:var(--color-foreground)]">{nodeName}</span>
      </div>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[12px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
        onClick={() => { void handleAction(onOpenFolder) }}
      >
        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-warning)]" />
        {openFolderLabel}
      </button>
      <button
        type="button"
        className="mt-0.5 flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[12px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
        onClick={() => { void handleAction(onCopyName) }}
      >
        <Copy className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
        {copyNameLabel}
      </button>
      <button
        type="button"
        className="mt-0.5 flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[12px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
        onClick={() => { void handleAction(onCopyRelativePath) }}
      >
        <Copy className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
        {copyRelativePathLabel}
      </button>
      <button
        type="button"
        className="mt-0.5 flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[12px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
        onClick={() => { void handleAction(onCopyRelativePathWithoutSlashes) }}
      >
        <Copy className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
        {copyRelativePathWithoutSlashesLabel}
      </button>
    </div>,
    document.body
  )
}
