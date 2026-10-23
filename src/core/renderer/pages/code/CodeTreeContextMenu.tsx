import { Archive, ClipboardCopy, Copy, FileSearch, FolderOpen, FolderSearch, Play, Search, TerminalSquare } from 'lucide-react'
import { type ComponentType, type ReactNode, useEffect, useRef, useState } from 'react'
import type { ProjectFileNodeKind } from '../../../shared/types'
import { ContextCascader, type ContextCascaderSection } from '../../components/ui/ContextCascader'
import { Input } from '../../components/ui/input'
import { useI18n } from '../../i18n'
import { areAllFileEntries, type SelectedTreeItem } from './code.treeSelection'

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
  /** 13.2/17：导出为 zip（仅 directory 时由调用方传入；zipName 来自二级命名面板，留空用文件夹名）。 */
  onZipFolder?: (zipName?: string) => void | Promise<void>
  /** 13.2：复制 zip 到剪贴板（项目内不落盘，仅 directory 时由调用方传入）。 */
  onCopyZipToClipboard?: ContextMenuAction
  /** 17：定位所在文件夹（仅 file 时由调用方传入；树内跳转并展开该文件所在目录）。 */
  onLocateNodeFolder?: ContextMenuAction
  /** 13.5：按名称查找文件（仅 directory 时由调用方传入）。 */
  onFindFilesByName?: ContextMenuAction
  /** 17：搜索文件夹（仅 directory 时由调用方传入；在右键目录子树内按名称找文件夹）。 */
  onSearchFoldersInFolder?: ContextMenuAction
  /** 13.3：在系统终端中运行脚本（resolveExecutableScript 命中时由调用方传入）。 */
  onRunScriptInSystemTerminal?: ContextMenuAction
  /** 13.3：在内置终端中运行脚本（resolveExecutableScript 命中时由调用方传入）。 */
  onRunScriptInEmbeddedTerminal?: ContextMenuAction
  /** 13.3：按节点判断是否存在可执行脚本（resolveExecutableScript 的适配），非空且提供运行回调时渲染「执行」组。 */
  resolveRunnableScript?: (relativePath: string, nodeKind: ProjectFileNodeKind) => unknown
  /** 16：右键时的不可变选择快照；length > 1 时走批量分支（仅三项复制），单选分支行为不变。 */
  selectedItems?: SelectedTreeItem[]
  /** 16：批量复制所选项相对路径（仅 N > 1 分支由调用方传入）。 */
  onCopySelectedRelativePaths?: ContextMenuAction
  /** 16：批量复制所选项绝对路径（仅 N > 1 分支由调用方传入）。 */
  onCopySelectedAbsolutePaths?: ContextMenuAction
  /** 16：批量复制所选项名称（仅 N > 1 分支由调用方传入）。 */
  onCopySelectedNames?: ContextMenuAction
  /** 17：批量复制所选项文件（全 file 快照；含任一文件夹则菜单不渲染，需求②）。 */
  onCopySelectedFiles?: ContextMenuAction
  /** 17：批量复制所选项 zip 到剪贴板（混合打包；仅 Windows 宿主渲染；zipName 来自二级命名面板，留空走主进程默认名）。 */
  onCopySelectedZipToClipboard?: (zipName?: string) => void | Promise<void>
  /** 17：批量 zip 默认文件名（{项目名}-selected.zip），二级命名面板的预填值。 */
  zipDefaultName?: string
  onClose: () => void
}

function actionIcon(Icon: ComponentType<{ className?: string }>, tone: 'warning' | 'muted'): ReactNode {
  return <Icon className={`h-3.5 w-3.5 ${tone === 'warning' ? 'text-[color:var(--color-warning)]' : ''}`} />
}

/**
 * zip 的二级命名面板（ContextCascader 的自定义 panel，批量与单文件夹导出共用，替代命名弹窗）。
 * 挂载即自动聚焦并全选预填默认名：直接回车 = 用默认名导出，键入 = 覆盖，清空回车 = 调用方默认名；
 * 回车确认导出并关闭菜单；Escape 由 ContextCascader 的 document 监听关闭菜单（即取消），
 * 点击面板外空白处同样触发 overlay 关闭——两条取消路径都无需在此处理。
 */
function ZipNamePanel({ defaultName, onConfirm, onClose }: { defaultName: string; onConfirm: (zipName: string) => void; onClose: () => void }) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(defaultName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [])

  return (
    <div className="flex w-full flex-col gap-2 p-2">
      <span className="px-1 text-[11px] font-medium text-[color:var(--color-muted-foreground)]">{t('codeFileTree.zipNamePrompt')}</span>
      <Input
        ref={inputRef}
        type="text"
        value={draft}
        textSize="xs"
        spellCheck={false}
        autoComplete="off"
        aria-label={t('codeFileTree.zipNamePrompt')}
        className="h-8 rounded-[10px] px-2.5"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          onConfirm(draft.trim())
          onClose()
        }}
      />
      <span className="px-1 text-[10px] text-[color:var(--color-muted-foreground)]">{t('codeFileTree.zipNameHint')}</span>
    </div>
  )
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
  onCopyZipToClipboard,
  onFindFilesByName,
  onSearchFoldersInFolder,
  onLocateNodeFolder,
  onRunScriptInSystemTerminal,
  onRunScriptInEmbeddedTerminal,
  resolveRunnableScript,
  selectedItems,
  onCopySelectedRelativePaths,
  onCopySelectedAbsolutePaths,
  onCopySelectedNames,
  onCopySelectedFiles,
  onCopySelectedZipToClipboard,
  zipDefaultName = '',
  onClose,
}: CodeTreeContextMenuProps) {
  const { t } = useI18n()
  // 剪贴板文件类动作仅 Windows 宿主可用：非 Windows 隐藏而非置灰（与主进程 win32 约束一致）。
  const isWindowsHost = navigator.userAgent.includes('Windows')

  // 批量分支（N > 1 且提供复制回调）：只展示三项批量复制 + 「已选择 N 项」标题；单选分支零改动。
  if (selectedItems && selectedItems.length > 1 && onCopySelectedRelativePaths && onCopySelectedAbsolutePaths && onCopySelectedNames) {
    const count = selectedItems.length
    const batchCopyItems: ContextCascaderSection['items'] = [
      { id: 'copy-selected-relative-paths', label: t('codeFileTree.copySelectedPaths'), icon: actionIcon(Copy, 'muted'), onSelect: onCopySelectedRelativePaths },
      { id: 'copy-selected-absolute-paths', label: t('codeFileTree.copySelectedAbsolutePaths'), icon: actionIcon(Copy, 'muted'), onSelect: onCopySelectedAbsolutePaths },
      { id: 'copy-selected-names', label: t('codeFileTree.copySelectedNames'), icon: actionIcon(Copy, 'muted'), onSelect: onCopySelectedNames },
    ]
    // 17：「复制文件（N 个）」——所选条目全为 file 才渲染（含任一文件夹即隐藏，与单选「目录不显示复制文件」同语义）。
    if (onCopySelectedFiles && areAllFileEntries(selectedItems)) {
      batchCopyItems.push({ id: 'copy-selected-files', label: t('codeFileTree.copySelectedFiles', { count }), icon: actionIcon(Copy, 'muted'), onSelect: onCopySelectedFiles })
    }
    // 17：「复制 zip 到剪贴板」——N 项混合打包，仅 Windows 宿主渲染；点击展开二级命名面板（不弹窗）。
    if (onCopySelectedZipToClipboard && isWindowsHost) {
      batchCopyItems.push({
        id: 'copy-selected-zip-to-clipboard',
        label: t('codeFileTree.copySelectedZipToClipboard'),
        icon: actionIcon(ClipboardCopy, 'muted'),
        panel: <ZipNamePanel defaultName={zipDefaultName} onConfirm={(name) => void onCopySelectedZipToClipboard(name)} onClose={onClose} />,
      })
    }
    const batchSections: ContextCascaderSection[] = [{ id: 'copy-selected', label: t('codeFileTree.sectionCopy'), items: batchCopyItems }]
    // 徽标悬浮卡片：批量复制前可核对所选项的相对路径（文件树与全局搜索共用同一菜单，行为一致）。
    const selectedFilesHoverCard = (
      <div className="code-tree-selection-hover-card">
        <div className="code-tree-selection-hover-card-header">{t('codeFileTree.selectedCount', { count })}</div>
        <div className="code-tree-selection-hover-card-list">
          {selectedItems.map((item) => (
            <div key={item.id} className="code-tree-selection-hover-item">
              {item.relativePath}
            </div>
          ))}
        </div>
      </div>
    )
    return <ContextCascader x={x} y={y} title={t('codeFileTree.selectedCount', { count })} titleHoverCard={selectedFilesHoverCard} sections={batchSections} layout="grouped" onClose={onClose} />
  }

  const title = `${nodeKind === 'directory' ? t('codeFileTree.directory') : t('codeFileTree.file')}: ${nodeName}`
  const openFolderLabel = nodeKind === 'directory' ? t('codeFileTree.openDirectory') : t('codeFileTree.openCurrentFolder')

  const sections: ContextCascaderSection[] = []

  const openItems: ContextCascaderSection['items'] = [
    { id: 'open-folder', label: openFolderLabel, icon: actionIcon(FolderOpen, 'warning'), onSelect: onOpenFolder },
    { id: 'open-terminal', label: t('codeFileTree.openCurrentTerminal'), icon: actionIcon(TerminalSquare, 'muted'), onSelect: onOpenTerminal },
  ]
  // 17：定位所在/父文件夹——file 与 directory 共用同一回调（都是跳转到节点所在父目录并展开），标签按节点类型区分。
  if (onLocateNodeFolder) {
    openItems.push({
      id: 'locate-node-folder',
      label: nodeKind === 'file' ? t('codeFileTree.locateNodeFolder') : t('codeFileTree.locateParentFolder'),
      icon: actionIcon(FolderSearch, 'muted'),
      onSelect: onLocateNodeFolder,
    })
  }
  sections.push({ id: 'open', label: t('codeFileTree.sectionOpen'), items: openItems })

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
  // 17：搜索文件夹——与「按名称查找文件」同范围（右键目录子树），结果点击在树内跳转并展开。
  if (nodeKind === 'directory' && onSearchFoldersInFolder) {
    searchItems.push({ id: 'search-folders-in-folder', label: t('codeFileTree.searchFoldersInFolder'), icon: actionIcon(FolderSearch, 'muted'), onSelect: onSearchFoldersInFolder })
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
  if (nodeKind === 'directory' && onZipFolder) {
    if (onCopyZipToClipboard) {
      copyItems.push({ id: 'zip-folder-to-clipboard', label: t('codeFileTree.zipToClipboard'), icon: actionIcon(ClipboardCopy, 'muted'), onSelect: onCopyZipToClipboard })
    }
    // 17：与批量 zip 对齐——「导出为 zip」点击展开二级命名面板（预填文件夹名），不再弹模态窗；
    // 原「导出为 zip…」（模态命名）随之移除，命名能力由该面板承接。
    copyItems.push({
      id: 'zip-folder',
      label: t('codeFileTree.zipFolder'),
      icon: actionIcon(Archive, 'muted'),
      panel: <ZipNamePanel defaultName={nodeName} onConfirm={(name) => void onZipFolder(name)} onClose={onClose} />,
    })
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
