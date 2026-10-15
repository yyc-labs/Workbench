import { Archive, ClipboardCopy, Copy, FileSearch, FolderOpen, Play, Search, TerminalSquare } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import type { ProjectFileNodeKind } from '../../../shared/types'
import { ContextCascader, type ContextCascaderSection } from '../../components/ui/ContextCascader'
import { useI18n } from '../../i18n'

export interface CodeTreeContextMenuPayload {
  x: number
  y: number
  relativePath: string
  nodeName: string
  nodeKind: ProjectFileNodeKind
  /** 仅搜索结果 match 行附加；文件树与 file 行不附加。 */
  lineNumber?: number
}

type ContextMenuAction = () => void | Promise<void>

interface CodeTreeContextMenuProps {
  x: number
  y: number
  relativePath: string
  nodeName: string
  nodeKind: ProjectFileNodeKind
  onOpenFolder: ContextMenuAction
  onOpenTerminal: ContextMenuAction
  onSearchInFolder: ContextMenuAction
  onCopyName: ContextMenuAction
  onCopyRelativePath: ContextMenuAction
  onCopyRelativePathWithoutSlashes: ContextMenuAction
  /** #11-1：复制带行号的路径（仅搜索结果 match 行由调用方传入）。 */
  onCopyPathWithLineNumber?: ContextMenuAction
  /** 13.2：复制文件内容（仅 file 时由调用方传入）。 */
  onCopyFileToClipboard?: ContextMenuAction
  /** 13.2：导出为 zip（仅 directory 时由调用方传入）。 */
  onZipFolder?: ContextMenuAction
  /** 13.2：导出为 zip…（命名弹窗，仅 directory 时由调用方传入）。 */
  onZipFolderAs?: ContextMenuAction
  /** 13.2：复制 zip 到剪贴板（项目内不落盘，仅 directory 时由调用方传入）。 */
  onCopyZipToClipboard?: ContextMenuAction
  /** 13.5：按名称查找文件（仅 directory 时由调用方传入）。 */
  onFindFilesByName?: ContextMenuAction
  /** 13.3：在系统终端中运行脚本（resolveExecutableScript 命中时由调用方传入）。 */
  onRunScriptInSystemTerminal?: ContextMenuAction
  /** 13.3：在内置终端中运行脚本（resolveExecutableScript 命中时由调用方传入）。 */
  onRunScriptInEmbeddedTerminal?: ContextMenuAction
  /** 13.3：按节点判断是否存在可执行脚本（resolveExecutableScript 的适配），非空且提供运行回调时渲染「执行」组。 */
  resolveRunnableScript?: (relativePath: string, nodeKind: ProjectFileNodeKind) => unknown
  onClose: () => void
}

function actionIcon(Icon: ComponentType<{ className?: string }>, tone: 'warning' | 'muted'): ReactNode {
  return <Icon className={`h-3.5 w-3.5 ${tone === 'warning' ? 'text-[color:var(--color-warning)]' : ''}`} />
}

// 菜单渲染依赖 ContextCascader 的关闭语义（Escape / 外部 pointerdown / 滚动捕获），组件本身不再手写关闭 effect。
export function CodeTreeContextMenu({
  x,
  y,
  relativePath,
  nodeName,
  nodeKind,
  onOpenFolder,
  onOpenTerminal,
  onSearchInFolder,
  onCopyName,
  onCopyRelativePath,
  onCopyRelativePathWithoutSlashes,
  onCopyPathWithLineNumber,
  onCopyFileToClipboard,
  onZipFolder,
  onZipFolderAs,
  onCopyZipToClipboard,
  onFindFilesByName,
  onRunScriptInSystemTerminal,
  onRunScriptInEmbeddedTerminal,
  resolveRunnableScript,
  onClose,
}: CodeTreeContextMenuProps) {
  const { t } = useI18n()

  const title = `${nodeKind === 'directory' ? t('codeFileTree.directory') : t('codeFileTree.file')}: ${nodeName}`
  const openFolderLabel = nodeKind === 'directory' ? t('codeFileTree.openDirectory') : t('codeFileTree.openCurrentFolder')

  const sections: ContextCascaderSection[] = []

  sections.push({
    id: 'open',
    label: t('codeFileTree.sectionOpen'),
    items: [
      { id: 'open-folder', label: openFolderLabel, icon: actionIcon(FolderOpen, 'warning'), onSelect: onOpenFolder },
      { id: 'open-terminal', label: t('codeFileTree.openCurrentTerminal'), icon: actionIcon(TerminalSquare, 'muted'), onSelect: onOpenTerminal },
    ],
  })

  const searchItems: ContextCascaderSection['items'] = [
    {
      id: 'search-in-folder',
      label: nodeKind === 'directory' ? t('codeFileTree.searchDirectory') : t('codeFileTree.searchCurrentFolder'),
      icon: actionIcon(Search, 'muted'),
      onSelect: onSearchInFolder,
    },
  ]
  if (nodeKind === 'directory' && onFindFilesByName) {
    searchItems.push({ id: 'find-files-by-name', label: t('codeFileTree.searchFilesByName'), icon: actionIcon(FileSearch, 'muted'), onSelect: onFindFilesByName })
  }
  sections.push({ id: 'search', label: t('codeFileTree.sectionSearch'), items: searchItems })

  const copyItems: ContextCascaderSection['items'] = [
    { id: 'copy-name', label: nodeKind === 'directory' ? t('codeFileTree.copyDirectoryName') : t('codeFileTree.copyFileName'), icon: actionIcon(Copy, 'muted'), onSelect: onCopyName },
    { id: 'copy-relative-path', label: t('codeFileTree.copyRelativePath'), icon: actionIcon(Copy, 'muted'), onSelect: onCopyRelativePath },
    { id: 'copy-relative-path-without-slashes', label: t('codeFileTree.copyRelativePathWithoutSlashes'), icon: actionIcon(Copy, 'muted'), onSelect: onCopyRelativePathWithoutSlashes },
  ]
  if (onCopyPathWithLineNumber) {
    copyItems.push({ id: 'copy-path-with-line-number', label: t('codeFileTree.copyPathWithLineNumber'), icon: actionIcon(Copy, 'muted'), onSelect: onCopyPathWithLineNumber })
  }
  if (nodeKind === 'file' && onCopyFileToClipboard) {
    copyItems.push({ id: 'copy-file-to-clipboard', label: t('codeFileTree.copyFile'), icon: actionIcon(Copy, 'muted'), onSelect: onCopyFileToClipboard })
  }
  if (nodeKind === 'directory' && onZipFolder && onZipFolderAs) {
    if (onCopyZipToClipboard) {
      copyItems.push({ id: 'zip-folder-to-clipboard', label: t('codeFileTree.zipToClipboard'), icon: actionIcon(ClipboardCopy, 'muted'), onSelect: onCopyZipToClipboard })
    }
    copyItems.push({ id: 'zip-folder', label: t('codeFileTree.zipFolder'), icon: actionIcon(Archive, 'muted'), onSelect: onZipFolder })
    copyItems.push({ id: 'zip-folder-as', label: t('codeFileTree.zipFolderAs'), icon: actionIcon(Archive, 'muted'), onSelect: onZipFolderAs })
  }
  sections.push({ id: 'copy', label: t('codeFileTree.sectionCopy'), items: copyItems })

  if (onRunScriptInSystemTerminal && onRunScriptInEmbeddedTerminal && resolveRunnableScript?.(relativePath, nodeKind)) {
    sections.push({
      id: 'run',
      label: t('codeFileTree.sectionRun'),
      items: [
        { id: 'run-in-system-terminal', label: t('codeFileTree.runInSystemTerminal'), icon: actionIcon(Play, 'muted'), onSelect: onRunScriptInSystemTerminal },
        { id: 'run-in-embedded-terminal', label: t('codeFileTree.runInEmbeddedTerminal'), icon: actionIcon(TerminalSquare, 'muted'), onSelect: onRunScriptInEmbeddedTerminal },
      ],
    })
  }

  return <ContextCascader x={x} y={y} title={title} sections={sections} layout="grouped" onClose={onClose} />
}
