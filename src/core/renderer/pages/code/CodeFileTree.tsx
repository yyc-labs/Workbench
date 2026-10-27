import { ChevronDown, ChevronRight, FileText, FileX2, Folder, FolderOpen, FolderX } from 'lucide-react'
import { memo, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { NodeRendererProps, TreeApi } from 'react-arborist'
import { Tree } from 'react-arborist'
import type { ProjectFileContentMatch, ProjectFileNode, ProjectFileNodeKind } from '../../../shared/types'
import { Tooltip } from '../../components/ui/tooltip'
import { useI18n } from '../../i18n'
import { CodeTreeContextMenu, type CodeTreeContextMenuPayload } from './CodeTreeContextMenu'
import { defaultSelectedZipName } from './code.pathActions'
import { buildContextMenuSnapshot, buildNodeLookup, buildValidIdSet, type CodeTreeContextMenuSnapshot, collectFlatResultIds, collectNodeIdsInTreeOrder, getVisibleRangeIds, planActiveSync, toggleSelectionId } from './code.treeSelection'
import type { FileSearchLineTarget } from './code.types'

const DIRECTORY_PLACEHOLDER_SUFFIX = '/__codex_placeholder__'
const MAX_LOCATE_SCROLL_ATTEMPTS = 6
/** 17 定位所在文件夹：闪烁高亮时长（与 code-tree-row-locate-flash 动画同源）。 */
const LOCATE_HIGHLIGHT_DURATION_MS = 1800
const MAX_FOLLOW_SCROLL_ATTEMPTS = 6

/** 命中文件在 ProjectFileNode 上的附加字段：供 fileHoverCard 消费方渲染悬浮命中卡片。 */
interface ContentSearchNodeExtras {
  matchCount: number
  matches: readonly ProjectFileContentMatch[]
}

interface CodeFileTreeProps {
  nodes: ProjectFileNode[]
  activeRelativePath: string | null
  /** 外部展开状态（文件视图）；省略 = 内部展开模式：供全局搜索等虚拟树复用，默认全部展开、目录点击切换 arborist 内部展开态。 */
  expandedDirectories?: Set<string>
  onToggleDirectory?: (relativePath: string) => void
  onSelectFile: (relativePath: string, lineTarget?: FileSearchLineTarget) => void
  onSelectExcluded?: (relativePath: string, nodeKind: ProjectFileNodeKind) => void
  onOpenNodeFolder: (relativePath: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onOpenNodeTerminal: (relativePath: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onSearchInFolder: (relativePath: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onCopyNodeName: (nodeName: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onCopyNodeRelativePath: (relativePath: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onCopyNodeRelativePathWithoutSlashes: (relativePath: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  /** 复制带行号的路径：仅命中行右键（payload 携带 lineNumber）时由菜单条件渲染。 */
  onCopyNodePathWithLineNumber?: (relativePath: string, lineNumber: number) => void | Promise<void>
  onCopyNodeToClipboard?: (relativePath: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onZipNodeFolder?: (relativePath: string, nodeName: string, zipName?: string) => void | Promise<void>
  onCopyNodeZipToClipboard?: (relativePath: string, nodeName: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onRunNodeScriptInSystemTerminal?: (relativePath: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onRunNodeScriptInEmbeddedTerminal?: (relativePath: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onResolveNodeRunnableScript?: (relativePath: string, nodeKind: ProjectFileNodeKind) => unknown
  onFindNodeFilesByName?: (payload: CodeTreeContextMenuPayload) => void
  /** 命中文件悬浮卡片（全局搜索）：传入后文件行整行挂交互式悬浮卡片，替代 label 的路径 tooltip；第二个参数为文件树统一的右键菜单入口，命中行右键由此走同款菜单。 */
  fileHoverCard?: (node: ProjectFileNode & ContentSearchNodeExtras, openMatchContextMenu: (payload: CodeTreeContextMenuPayload) => void) => ReactNode
  flatFileListMode?: boolean
  /** 扁平搜索模式下查询携带的行区间目标（`path:N` / `path:N-M`），点击结果时透传给 onSelectFile。 */
  flatListLineTarget?: FileSearchLineTarget | null
  locateRequestToken?: number
  /** 17：右键「定位所在文件夹」请求（token 单调递增；relativePath 为空 = 项目根，滚到顶部）。 */
  locateFolderRequest?: { relativePath: string; token: number } | null
  /** 17：右键「定位所在文件夹」（file 节点菜单项；在树内跳转并展开所在目录）。 */
  onLocateNodeFolder?: (relativePath: string) => void | Promise<void>
  /** 17：右键「搜索文件夹」（directory 节点菜单项；透传右键 payload 供弹层定位）。 */
  onSearchFoldersInFolder?: (payload: CodeTreeContextMenuPayload) => void | Promise<void>
  /** 选择上下文标识（项目 + 模式 + 解析后查询）：变化时清空选择、锚点与右键快照（16 号计划 §8）。 */
  selectionScopeKey?: string
  /** 项目根路径，供批量复制绝对路径与快照校验使用。 */
  projectPath?: string
  /** 只读选择数量通知（onSelect 驱动，不回写树；§4.2）。 */
  onSelectedCountChange?: (count: number) => void
  /** 批量复制三项（接收已按当前 nodes 复核的快照；§4.4）。 */
  onCopySelectedRelativePaths?: (snapshot: CodeTreeContextMenuSnapshot) => void | Promise<void>
  onCopySelectedAbsolutePaths?: (snapshot: CodeTreeContextMenuSnapshot) => void | Promise<void>
  onCopySelectedNames?: (snapshot: CodeTreeContextMenuSnapshot) => void | Promise<void>
  /** 17：批量复制所选项文件（全 file 快照；菜单条件渲染）。 */
  onCopySelectedFiles?: (snapshot: CodeTreeContextMenuSnapshot) => void | Promise<void>
  /** 17：批量复制所选项 zip 到剪贴板（混合打包；仅 Windows 宿主渲染；zipName 来自二级命名面板，留空走主进程默认名）。 */
  onCopySelectedZipToClipboard?: (snapshot: CodeTreeContextMenuSnapshot, zipName?: string) => void | Promise<void>
}

interface FileTreeNodeRendererProps extends NodeRendererProps<ProjectFileNode> {
  activeRelativePath: string | null
  flatFileListMode: boolean
  /** 行点击统一分发（修饰键矩阵 §6.1），展开/折叠与打开逻辑由 CodeFileTree 持有。 */
  onRowClick: (event: ReactMouseEvent<HTMLElement>, node: ProjectFileNode) => void
  onOpenFileContextMenu: (payload: CodeTreeContextMenuPayload) => void
  /** 命中文件悬浮卡片（全局搜索传入）：文件行整行挂交互式卡片。 */
  fileHoverCard?: CodeFileTreeProps['fileHoverCard']
  /** 17 定位闪烁高亮的目录路径（动画自动淡出，null = 无）。 */
  locatedFolderPath?: string | null
}

interface TreeSize {
  width: number
  height: number
}

function useContainerSize() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState<TreeSize>({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    let frameId = 0
    let cancelled = false

    const updateSize = (): { width: number; height: number } => {
      const rect = container.getBoundingClientRect()
      const nextWidth = Math.max(0, Math.floor(rect.width))
      const nextHeight = Math.max(0, Math.floor(rect.height))
      setSize((prev) => (prev.width === nextWidth && prev.height === nextHeight ? prev : { width: nextWidth, height: nextHeight }))
      return { width: nextWidth, height: nextHeight }
    }

    const measureUntilReady = () => {
      if (cancelled) return
      const next = updateSize()
      if (next.width > 0 && next.height > 0) return
      frameId = window.requestAnimationFrame(measureUntilReady)
    }

    measureUntilReady()
    const observer = new ResizeObserver(() => {
      updateSize()
    })
    observer.observe(container)
    window.addEventListener('resize', updateSize)

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', updateSize)
      observer.disconnect()
    }
  }, [])

  return { containerRef, size }
}

function collectDirectoryPaths(nodes: ProjectFileNode[]): string[] {
  const result: string[] = []
  const walk = (items: ProjectFileNode[]) => {
    for (const item of items) {
      if (item.kind !== 'directory') continue
      result.push(item.relativePath)
      if (item.children && item.children.length > 0) {
        walk(item.children)
      }
    }
  }
  walk(nodes)
  return result
}

function createPlaceholderNode(parent: ProjectFileNode): ProjectFileNode {
  return {
    name: '__loading__',
    relativePath: `${parent.relativePath}${DIRECTORY_PLACEHOLDER_SUFFIX}`,
    kind: 'file',
  }
}

function isPlaceholderNode(node: ProjectFileNode): boolean {
  return node.relativePath.endsWith(DIRECTORY_PLACEHOLDER_SUFFIX)
}

function getTreeChildren(item: ProjectFileNode): ProjectFileNode[] | null {
  if (item.kind !== 'directory') return null
  if (item.children && item.children.length > 0) return item.children
  if (item.hasChildren) return [createPlaceholderNode(item)]
  return []
}

function centerTreeNodeInViewport(tree: TreeApi<ProjectFileNode>, relativePath: string): boolean {
  const index = tree.indexOf(relativePath)
  const scrollElement = tree.listEl.current
  if (index == null || !scrollElement) return false

  const viewportHeight = scrollElement.clientHeight
  if (viewportHeight <= 0) return false

  const rowHeight = tree.rowHeight
  const rowTop = index * rowHeight
  const rowBottom = rowTop + rowHeight
  const currentScrollTop = scrollElement.scrollTop
  const isVisible = rowBottom > currentScrollTop && rowTop < currentScrollTop + viewportHeight
  const centeredScrollTop = rowTop - (viewportHeight - rowHeight) / 2
  const maxScrollTop = Math.max(0, scrollElement.scrollHeight - viewportHeight)

  let nextScrollTop = centeredScrollTop
  if (centeredScrollTop < 0) {
    nextScrollTop = isVisible ? currentScrollTop : 0
  } else if (centeredScrollTop > maxScrollTop) {
    nextScrollTop = maxScrollTop
  }

  const roundedScrollTop = Math.round(Math.max(0, nextScrollTop))
  if (Math.abs(currentScrollTop - roundedScrollTop) > 1) {
    scrollElement.scrollTop = roundedScrollTop
  }
  return true
}

function ensureTreeNodeVisibleInViewport(tree: TreeApi<ProjectFileNode>, relativePath: string): boolean {
  const index = tree.indexOf(relativePath)
  const scrollElement = tree.listEl.current
  if (index == null || !scrollElement) return false

  const viewportHeight = scrollElement.clientHeight
  if (viewportHeight <= 0) return false

  const rowHeight = tree.rowHeight
  const rowTop = index * rowHeight
  const rowBottom = rowTop + rowHeight
  const currentScrollTop = scrollElement.scrollTop

  // 已在视口内则不做任何滚动，避免点击树节点时被无谓移动。
  if (rowTop >= currentScrollTop && rowBottom <= currentScrollTop + viewportHeight) return true

  // 不可见时滚动到居中位置，越界则钳制到滚动范围。
  const centeredScrollTop = Math.round(rowTop - (viewportHeight - rowHeight) / 2)
  const maxScrollTop = Math.max(0, scrollElement.scrollHeight - viewportHeight)
  scrollElement.scrollTop = Math.min(maxScrollTop, Math.max(0, centeredScrollTop))
  return true
}

function FileTreeNodeRenderer({ node, style, dragHandle, activeRelativePath, flatFileListMode, onRowClick, onOpenFileContextMenu, fileHoverCard, locatedFolderPath }: FileTreeNodeRendererProps) {
  const data = node.data
  if (isPlaceholderNode(data)) {
    // 占位行不是真实节点：吞掉点击，防止漏到 arborist 行层 handleClick 把占位节点选上。
    return (
      <div
        style={style}
        aria-hidden="true"
        onClick={(event) => {
          event.stopPropagation()
        }}
      />
    )
  }
  const isExcluded = data.isExcluded === true
  const isDirectory = !flatFileListMode && data.kind === 'directory' && !isExcluded
  const isExpanded = isDirectory && node.isOpen
  const isActive = data.kind === 'file' && activeRelativePath === data.relativePath
  const isSelected = node.isSelected
  const hasChildren = isDirectory && Boolean(data.hasChildren || (data.children?.length ?? 0) > 0)
  const rowLabel = flatFileListMode && isActive ? data.relativePath : data.name
  // 命中文件行整行挂交互式悬浮卡片（全局搜索）：此时不再挂 label 的路径 tooltip，避免嵌套悬浮层互相抢触发。
  const useHoverCard = !isExcluded && data.kind === 'file' && Boolean(fileHoverCard)

  // 整行统一分发（按钮与根 div 共用）：
  // 根 div 承载 arborist 的缩进 padding（nodeStyle.paddingLeft），该区域不在按钮内——
  // 而 arborist 行包裹层自带 onClick=node.handleClick，无修饰分支直接 select() 整换选中集合，
  // 会把行渲染成「Ctrl 选中」样式并绕过我们的多选模型（2026-10-22 用户报告的 bug）。
  // 因此根 div 必须先 stopPropagation 再走同一分发；按钮自身已 stopPropagation，不会重复触发。
  const handleRowAreaClick = (event: ReactMouseEvent<HTMLElement>) => {
    event.stopPropagation()
    onRowClick(event, data)
  }
  const handleRowAreaContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onOpenFileContextMenu({
      x: event.clientX,
      y: event.clientY,
      relativePath: data.relativePath,
      nodeName: data.name,
      nodeKind: data.kind,
    })
  }
  const rowButton = (
    <button
      type="button"
      className={`code-tree-row ${isActive ? 'code-tree-row--active' : ''} ${isSelected ? 'code-tree-row--selected' : ''} ${isExcluded ? 'code-tree-row--excluded' : ''} ${locatedFolderPath === data.relativePath ? 'code-tree-row--located' : ''}`}
      style={{ paddingLeft: 10 }}
      onClick={handleRowAreaClick}
      onContextMenu={handleRowAreaContextMenu}
    >
      {isDirectory ? (
        hasChildren ? (
          isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
          )
        ) : (
          <span className="inline-block h-3.5 w-3.5 shrink-0" />
        )
      ) : (
        <span className="inline-block h-3.5 w-3.5 shrink-0" />
      )}

      {isExcluded ? (
        data.kind === 'directory' ? (
          <FolderX className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]" />
        ) : (
          <FileX2 className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]" />
        )
      ) : isDirectory ? (
        isExpanded ? (
          <FolderOpen className="h-4 w-4 shrink-0 text-[color:var(--color-warning)]" />
        ) : (
          <Folder className="h-4 w-4 shrink-0 text-[color:var(--color-warning)]" />
        )
      ) : (
        <FileText className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]" />
      )}
      {useHoverCard ? (
        <span className="block min-w-0 truncate">{rowLabel}</span>
      ) : (
        <Tooltip content={data.relativePath} align="start" placementMode="pointer" interactive={false} className="w-0 min-w-0 flex-1" contentClassName="font-mono text-[12px] leading-[1.4]">
          <span className="block min-w-0 truncate">{rowLabel}</span>
        </Tooltip>
      )}
    </button>
  )

  if (fileHoverCard && useHoverCard) {
    return (
      <div ref={dragHandle} style={style} onClick={handleRowAreaClick} onContextMenu={handleRowAreaContextMenu}>
        <Tooltip content={fileHoverCard(data as ProjectFileNode & ContentSearchNodeExtras, onOpenFileContextMenu)} interactive side="right" align="start" maxWidth={520} className="w-full">
          {rowButton}
        </Tooltip>
      </div>
    )
  }

  return (
    <div ref={dragHandle} style={style} onClick={handleRowAreaClick} onContextMenu={handleRowAreaContextMenu}>
      {rowButton}
    </div>
  )
}

export const CodeFileTree = memo(function CodeFileTree({
  nodes,
  activeRelativePath,
  expandedDirectories,
  onToggleDirectory,
  onSelectFile,
  onSelectExcluded,
  onOpenNodeFolder,
  onOpenNodeTerminal,
  onSearchInFolder,
  onCopyNodeName,
  onCopyNodeRelativePath,
  onCopyNodeRelativePathWithoutSlashes,
  onCopyNodePathWithLineNumber,
  onCopyNodeToClipboard,
  onZipNodeFolder,
  onCopyNodeZipToClipboard,
  onRunNodeScriptInSystemTerminal,
  onRunNodeScriptInEmbeddedTerminal,
  onResolveNodeRunnableScript,
  onFindNodeFilesByName,
  fileHoverCard,
  flatFileListMode = false,
  flatListLineTarget = null,
  locateRequestToken = 0,
  locateFolderRequest = null,
  onLocateNodeFolder,
  onSearchFoldersInFolder,
  selectionScopeKey = '',
  projectPath = '',
  onSelectedCountChange,
  onCopySelectedRelativePaths,
  onCopySelectedAbsolutePaths,
  onCopySelectedNames,
  onCopySelectedFiles,
  onCopySelectedZipToClipboard,
}: CodeFileTreeProps) {
  const { t } = useI18n()
  const hasNodes = useMemo(() => nodes.length > 0, [nodes])
  const treeRef = useRef<TreeApi<ProjectFileNode> | null>(null)
  const handledLocateRequestTokenRef = useRef(0)
  // Shift 区间锚点（arborist 未暴露 anchor getter，自行维护；§6.2）。
  const anchorIdRef = useRef<string | null>(null)
  // scope 变化清理优先于 active 同步（C1）：记录已处理的 selectionScopeKey。
  const lastScopeKeyRef = useRef(selectionScopeKey)
  // 本 effect 实例是否已完成一次 selection 同步（帧重试期间不重复写树，避免覆盖用户多选）。
  const selectionSyncedRef = useRef(false)
  // 展开快照只记录「目录节点已存在于 nodes 且在 expandedDirectories 中」的路径：
  // markFilePathKnown/expandTreePath 可能在目录节点就绪前提前写入 expandedDirectories，
  // 若快照照抄 expandedDirectories，节点到达时 diff 会误判“已展开”而不调用 tree.open()。
  const previousExpandedDirectoriesRef = useRef<Set<string>>(new Set<string>())
  const previousActivePathRef = useRef(activeRelativePath)
  const suppressFollowScrollRef = useRef(false)
  const suppressFollowScrollTimerRef = useRef<number | null>(null)
  const { containerRef, size } = useContainerSize()
  const [contextMenu, setContextMenu] = useState<CodeTreeContextMenuPayload | null>(null)
  // 右键菜单打开时生成的不可变快照（§5.2）：菜单存续期间不受树选择变化影响。
  const [contextMenuSnapshot, setContextMenuSnapshot] = useState<CodeTreeContextMenuSnapshot | null>(null)
  const directoryPaths = useMemo(() => collectDirectoryPaths(nodes), [nodes])
  // 当前上下文有效 id 集合（C2：只有存在于当前 nodes 的 active 才允许成为选中项）。
  const validIdSet = useMemo(() => buildValidIdSet(nodes), [nodes])
  // 批量输出序：树模式 DFS preorder（含折叠目录后代）；扁平模式 = 展示序。
  const orderedNodeIds = useMemo(() => (flatFileListMode ? collectFlatResultIds(nodes) : collectNodeIdsInTreeOrder(nodes)), [flatFileListMode, nodes])
  const nodeLookup = useMemo(() => buildNodeLookup(nodes), [nodes])
  // 批量 zip 默认名（二级命名面板预填值）：与主进程 defaultSelectedZipName 同语义。
  const zipDefaultName = useMemo(() => (projectPath ? defaultSelectedZipName(projectPath) : ''), [projectPath])

  const renewSuppressFollowScroll = useCallback(() => {
    if (suppressFollowScrollTimerRef.current != null) {
      window.clearTimeout(suppressFollowScrollTimerRef.current)
    }
    suppressFollowScrollRef.current = true
    suppressFollowScrollTimerRef.current = window.setTimeout(() => {
      suppressFollowScrollRef.current = false
      suppressFollowScrollTimerRef.current = null
    }, 200)
  }, [])

  const handleToggleDirectory = useCallback(
    (relativePath: string) => {
      // 用户主动展开/折叠目录时，短暂抑制“跟随当前文件”的自动滚动，
      // 避免查看目录内容时视图被拉回当前文件位置。
      renewSuppressFollowScroll()
      // 内部展开模式（未传 expandedDirectories，如全局搜索虚拟树）：直接切换 arborist 内部展开态。
      if (onToggleDirectory) {
        onToggleDirectory(relativePath)
        return
      }
      treeRef.current?.toggle(relativePath)
    },
    [onToggleDirectory, renewSuppressFollowScroll],
  )

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
    setContextMenuSnapshot(null)
  }, [])

  // 无修饰键点击的统一语义：取消全部选中并清 Shift 锚点（用户 2026-10-22 修订）。
  // 与 Escape 退出多选同效；空集合时跳过，避免无谓的树状态写入。
  const clearSelectionOnPlainClick = useCallback(() => {
    anchorIdRef.current = null
    const tree = treeRef.current
    if (tree && tree.selectedIds.size > 0) {
      tree.deselectAll()
    }
  }, [])

  // 行点击统一分发（§6.1 修饰键矩阵；2026-10-22 二次修订：普通点击取消全部选中）。
  const handleRowClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>, data: ProjectFileNode) => {
      if (data.isExcluded === true) {
        // 排除行普通点击同样取消全部选中（无修饰键点击的统一语义）。
        clearSelectionOnPlainClick()
        onSelectExcluded?.(data.relativePath, data.kind)
        return
      }
      const tree = treeRef.current
      const id = data.relativePath
      const isDirectory = !flatFileListMode && data.kind === 'directory'
      const modifier = event.ctrlKey || event.metaKey

      if (modifier) {
        // Ctrl/Cmd：toggle 选中，anchor = 目标；不打开文件、不展开/折叠目录。
        const currentIds = tree ? tree.selectedIds : new Set<string>()
        const nextIds = toggleSelectionId(currentIds, id)
        tree?.setSelection({ ids: [...nextIds], anchor: id, mostRecent: id })
        anchorIdRef.current = id
        return
      }

      if (event.shiftKey) {
        // Shift：锚点到目标的可见区间整体替换（H6）；不动锚点；锚点失效回退单选并重置。
        const visibleIds = tree ? tree.visibleNodes.map((item) => item.id) : []
        const anchor = anchorIdRef.current
        const anchorValid = anchor != null && visibleIds.includes(anchor)
        const rangeIds = getVisibleRangeIds(visibleIds, anchorValid ? anchor : null, id)
        tree?.setSelection({ ids: rangeIds, anchor: anchorValid ? anchor : id, mostRecent: id })
        if (!anchorValid) anchorIdRef.current = id
        return
      }

      // 普通点击（无 Ctrl/Shift 修饰键）取消全部选中并清锚点（用户 2026-10-22 修订，覆盖原「不改变选择集合」决策）：
      // 右键走 contextmenu 事件、右键菜单卡片为 portal 自行消费，均不触发本链路，多选不会被误清。
      clearSelectionOnPlainClick()

      if (isDirectory) {
        // 目录普通单击：取消选中后保留展开/折叠现状。
        handleToggleDirectory(id)
        return
      }

      // 普通单击文件：先取消全部选中，再走原打开流。
      onSelectFile(id, flatFileListMode ? (flatListLineTarget ?? undefined) : undefined)
    },
    [clearSelectionOnPlainClick, flatFileListMode, flatListLineTarget, handleToggleDirectory, onSelectExcluded, onSelectFile],
  )

  const handleContainerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Escape') return
      // 菜单打开中：交给 ContextCascader 的 document 级监听，只关菜单（F6 / A10）。
      if (contextMenu) return
      // 仅当交互焦点属于文件树时退出多选（currentTarget 即容器 div，无需 ref）。
      if (!(document.activeElement instanceof Node) || !event.currentTarget.contains(document.activeElement)) return
      event.stopPropagation()
      anchorIdRef.current = null
      treeRef.current?.deselectAll()
    },
    [contextMenu],
  )

  // 文件树外部的无修饰点击同样取消全部选中（用户 2026-10-22 追加「点击文件树外部的位置也取消」），
  // 与行内普通点击同一语义（clearSelectionOnPlainClick）。排除三类目标：
  // 1. 树容器内部——行点击 / arborist 空白点击自理；
  // 2. 右键菜单 overlay（ContextCascader 的 portal，含二级命名面板与空白 scrim）——右键流程不被打扰；
  // 3. 非主按钮（右键/中键）——与「右键不清除」一致。
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      const target = event.target
      if (!(target instanceof Node)) return
      const container = containerRef.current
      if (container?.contains(target)) return
      if (target instanceof Element && target.closest('[data-context-cascader-overlay]')) return
      clearSelectionOnPlainClick()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [clearSelectionOnPlainClick])

  // 右键快照生成（§5.2）：目标已在选中集合且集合非空 → 用集合（按输出序排列、过滤失效项）；
  // 否则用目标节点数据构建单项快照。快照不可变，菜单存续期间不受树选择变化影响。
  const handleOpenFileContextMenu = useCallback(
    (payload: CodeTreeContextMenuPayload) => {
      const tree = treeRef.current
      const snapshot = buildContextMenuSnapshot({
        target: { relativePath: payload.relativePath, name: payload.nodeName, kind: payload.nodeKind },
        selectedIds: tree ? tree.selectedIds : new Set<string>(),
        orderedNodeIds,
        nodeLookup,
        projectPath,
        scopeKey: selectionScopeKey,
      })
      setContextMenu(payload)
      setContextMenuSnapshot(snapshot)
    },
    [nodeLookup, orderedNodeIds, projectPath, selectionScopeKey],
  )

  // 批量复制：先用当前 nodes 复核快照条目（过滤已失效 id），再交给复制 handler。
  const handleBatchCopy = useCallback(
    (mode: 'relative' | 'absolute' | 'name' | 'files' | 'zip', zipName?: string) => {
      const snapshot = contextMenuSnapshot
      if (!snapshot) return
      const reviewed: CodeTreeContextMenuSnapshot = {
        ...snapshot,
        selectedItems: snapshot.selectedItems.filter((item) => validIdSet.has(item.id)),
      }
      if (mode === 'relative') {
        void onCopySelectedRelativePaths?.(reviewed)
      } else if (mode === 'absolute') {
        void onCopySelectedAbsolutePaths?.(reviewed)
      } else if (mode === 'name') {
        void onCopySelectedNames?.(reviewed)
      } else if (mode === 'files') {
        void onCopySelectedFiles?.(reviewed)
      } else {
        void onCopySelectedZipToClipboard?.(reviewed, zipName)
      }
    },
    [contextMenuSnapshot, onCopySelectedAbsolutePaths, onCopySelectedFiles, onCopySelectedNames, onCopySelectedRelativePaths, onCopySelectedZipToClipboard, validIdSet],
  )
  const isMeasuring = size.width <= 0 || size.height <= 0
  const initialOpenState = useMemo(() => {
    if (flatFileListMode || !expandedDirectories) return {}
    const state: Record<string, boolean> = {}
    for (const path of expandedDirectories) {
      state[path] = true
    }
    return state
  }, [expandedDirectories, flatFileListMode])

  // 树内定位滚动（tab 定位文件与右键「定位所在文件夹」共用）：目标行不存在时按帧重试
  // （刚 expand 的目录行可能还未布局），超过尝试上限放弃；返回取消函数供 effect cleanup。
  const revealTreeNodePath = useCallback((relativePath: string): (() => void) => {
    let cancelled = false
    let frameId = 0
    let attempts = 0

    const reveal = () => {
      if (cancelled) return
      const tree = treeRef.current
      if (!tree) return
      if (centerTreeNodeInViewport(tree, relativePath)) return

      attempts += 1
      void tree.scrollTo(relativePath, 'center')
      if (attempts >= MAX_LOCATE_SCROLL_ATTEMPTS) return
      frameId = window.requestAnimationFrame(reveal)
    }

    reveal()
    return () => {
      cancelled = true
      window.cancelAnimationFrame(frameId)
    }
  }, [])

  useEffect(() => {
    if (!locateRequestToken) return
    if (locateRequestToken === handledLocateRequestTokenRef.current) return
    handledLocateRequestTokenRef.current = locateRequestToken
    if (!activeRelativePath) return
    return revealTreeNodePath(activeRelativePath)
  }, [locateRequestToken, activeRelativePath, revealTreeNodePath])

  // 17：右键「定位所在文件夹」——与 tab 定位同一套 reveal，目标为文件夹路径；
  // 空路径 = 项目根下的文件（所在目录即根），滚到顶部即可。
  const handledLocateFolderTokenRef = useRef(0)
  // 定位闪烁高亮：目标目录行短暂挂 code-tree-row--located（动画自动淡出），独立于多选选中态。
  const [locatedFolderPath, setLocatedFolderPath] = useState<string | null>(null)
  const locatedHighlightTimerRef = useRef<number | null>(null)
  useEffect(() => {
    if (!locateFolderRequest) return
    if (locateFolderRequest.token === handledLocateFolderTokenRef.current) return
    handledLocateFolderTokenRef.current = locateFolderRequest.token
    const folderPath = locateFolderRequest.relativePath
    // 定位期间抑制「跟随当前文件」自动滚动：reveal 链路（搜索文件夹结果点击/定位所在文件夹）
    // 会连续变更 nodes/expandedDirectories，跟随 effect 在本 effect 之后声明，同一 commit 内
    // 会把视图拉回激活文件，覆盖掉定位滚动（未展开文件夹搜索点击后跳错位置的根因）。
    renewSuppressFollowScroll()
    if (!folderPath) {
      const listElement = treeRef.current?.listEl.current
      if (listElement) listElement.scrollTop = 0
      return
    }
    // 定位反馈：目标目录闪烁高亮约 1.8s 后自动淡出（独立于多选选中态）。
    // 先清再设（rAF 隔帧），同一目录重复定位时动画能重新起播。
    setLocatedFolderPath(null)
    const flashFrame = window.requestAnimationFrame(() => setLocatedFolderPath(folderPath))
    if (locatedHighlightTimerRef.current != null) window.clearTimeout(locatedHighlightTimerRef.current)
    locatedHighlightTimerRef.current = window.setTimeout(() => setLocatedFolderPath(null), LOCATE_HIGHLIGHT_DURATION_MS)
    if (!folderPath) {
      const listElement = treeRef.current?.listEl.current
      if (listElement) listElement.scrollTop = 0
      return () => {
        window.cancelAnimationFrame(flashFrame)
      }
    }
    const cancelReveal = revealTreeNodePath(folderPath)
    return () => {
      window.cancelAnimationFrame(flashFrame)
      cancelReveal()
    }
  }, [locateFolderRequest, renewSuppressFollowScroll, revealTreeNodePath])

  useEffect(() => {
    // 统一时序（§2.3）：scope 清理优先于 active 同步（C1）。
    const scopeChanged = selectionScopeKey !== lastScopeKeyRef.current
    if (scopeChanged) {
      lastScopeKeyRef.current = selectionScopeKey
      anchorIdRef.current = null
      selectionSyncedRef.current = false
      setContextMenu(null)
      setContextMenuSnapshot(null)
      treeRef.current?.deselectAll()
      // 内部展开模式（全局搜索）：新查询 = 新 scope，全部重新展开，保证命中全部可见。
      if (!expandedDirectories) treeRef.current?.openAll()
    } else {
      selectionSyncedRef.current = false
    }

    // 文件切换时重新定位，清除用户主动展开/折叠目录时的滚动抑制。
    if (activeRelativePath !== previousActivePathRef.current) {
      previousActivePathRef.current = activeRelativePath
      suppressFollowScrollRef.current = false
    }

    // 跟随当前文件：按 planActiveSync 决策同步选中集合并确保高亮行可见
    // （容器测量与 Tree 挂载晚于本 effect，因此树未就绪时也按帧重试）。
    let cancelled = false
    let frameId = 0
    let attempts = 0

    const syncSelectionForActiveFile = (currentTree: TreeApi<ProjectFileNode>) => {
      // 每个 effect 实例只同步一次：帧重试期间不重复写树，避免覆盖用户多选。
      if (selectionSyncedRef.current) return
      selectionSyncedRef.current = true
      if (!activeRelativePath) return
      const plan = planActiveSync({
        activeId: activeRelativePath,
        validIds: validIdSet,
        selectedIds: currentTree.selectedIds,
        scopeChanged,
      })
      if (plan === 'reset') {
        // scope 变化：清理已在本 effect 主体执行（关菜单 / 丢快照 / 清锚点）；
        // 这里兜底再清一次树内 selection（幂等；覆盖树就绪晚于主体清理的情况）。
        // active 不进入 selection：选中只由 Ctrl/Shift 显式产生。
        currentTree.deselectAll()
        return
      }
      // 'keep'：active 已被用户显式选中，保留整个集合；'noop'：不写树。
    }

    const followActiveFile = () => {
      if (cancelled) return
      const currentTree = treeRef.current
      if (!currentTree) {
        attempts += 1
        if (attempts >= MAX_FOLLOW_SCROLL_ATTEMPTS) return
        frameId = window.requestAnimationFrame(followActiveFile)
        return
      }

      syncSelectionForActiveFile(currentTree)
      if (!activeRelativePath) return
      // react-arborist 的行组件在 isFocused 时会抢占 DOM 焦点；搜索结果返回等
      // nodes 变化会触发本逻辑，若无条件 focus 会把搜索输入框的焦点抢走。
      // 仅当树已持有 DOM 焦点时才同步 arborist 内部 focus，保证键盘导航可用。
      const listElement = currentTree.listEl.current
      const treeHasDomFocus = Boolean(listElement && document.activeElement instanceof Node && listElement.contains(document.activeElement))
      if (treeHasDomFocus) {
        currentTree.focus(activeRelativePath, { scroll: false })
      }

      // 用户主动展开/折叠目录时抑制自动滚动，避免查看目录内容时视图被拉回当前文件位置。
      // 目录懒加载期间 nodes/expandedDirectories 持续变化，通过续期抑制窗口保证加载完成前不跳回。
      if (suppressFollowScrollRef.current) {
        renewSuppressFollowScroll()
        return
      }

      if (ensureTreeNodeVisibleInViewport(currentTree, activeRelativePath)) return

      attempts += 1
      if (attempts >= MAX_FOLLOW_SCROLL_ATTEMPTS) return
      frameId = window.requestAnimationFrame(followActiveFile)
    }

    followActiveFile()
    return () => {
      cancelled = true
      window.cancelAnimationFrame(frameId)
    }
  }, [activeRelativePath, expandedDirectories, flatFileListMode, nodes, selectionScopeKey, validIdSet, renewSuppressFollowScroll])

  useEffect(() => {
    if (flatFileListMode) {
      // 搜索模式退化为扁平列表，目录展开状态不会作用到 arborist。
      // 同时保留进入搜索前的展开快照：否则搜索期间定位新增的父目录会在
      // 切回树形模式时被 diff 误判为“已展开”，导致目录保持折叠、无法定位。
      return
    }

    if (!expandedDirectories) {
      // 内部展开模式（未传 expandedDirectories，如全局搜索虚拟树）：不同步外部状态；
      // 把 arborist 实际展开态记录为基线，切回外部模式时 diff 才能向两侧正确收敛。
      const currentTree = treeRef.current
      previousExpandedDirectoriesRef.current = currentTree ? new Set(directoryPaths.filter((path) => currentTree.isOpen(path))) : new Set<string>()
      return
    }

    const tree = treeRef.current
    if (!tree) {
      previousExpandedDirectoriesRef.current = new Set<string>()
      return
    }

    const previous = previousExpandedDirectoriesRef.current
    for (const path of directoryPaths) {
      const shouldOpen = expandedDirectories.has(path)
      const wasOpen = previous.has(path)
      if (shouldOpen === wasOpen) continue
      if (shouldOpen) tree.open(path)
      else tree.close(path)
    }

    const nextSnapshot = new Set<string>()
    for (const path of directoryPaths) {
      if (expandedDirectories.has(path)) nextSnapshot.add(path)
    }
    previousExpandedDirectoriesRef.current = nextSnapshot
  }, [directoryPaths, expandedDirectories, flatFileListMode])

  useEffect(() => {
    return () => {
      if (suppressFollowScrollTimerRef.current != null) {
        window.clearTimeout(suppressFollowScrollTimerRef.current)
      }
    }
  }, [])

  // 实例卸载时通知选择清空：文件视图与全局搜索两棵树都随视图切换 / 查询变化重挂，
  // arborist 重挂不会补发 onSelect，不通知会导致消费方的计数残留上一次选择。
  useEffect(
    () => () => {
      onSelectedCountChange?.(0)
    },
    [],
  )

  if (!hasNodes) {
    return <div className="code-panel-empty text-xs text-[color:var(--color-muted-foreground)]">{t('codeFileTree.noFilesAvailable')}</div>
  }

  return (
    // 空白点击的清空由 arborist 内置 deselectAll 完成（F5：outer 上 currentTarget === target），
    // 容器层不再恢复 active 单选——选中与 active 彻底分离（用户 2026-10-22 决策）。
    <div ref={containerRef} className="code-tree-virtual-wrap" onKeyDown={handleContainerKeyDown}>
      {isMeasuring ? (
        <div className="code-panel-empty text-xs text-[color:var(--color-muted-foreground)]">{t('codeFileTree.preparingFileTree')}</div>
      ) : (
        <Tree<ProjectFileNode>
          key={flatFileListMode ? 'code-file-tree-flat' : 'code-file-tree-nested'}
          ref={treeRef}
          data={nodes}
          idAccessor={(item) => item.relativePath}
          childrenAccessor={flatFileListMode ? () => null : getTreeChildren}
          width={size.width}
          height={size.height}
          rowHeight={28}
          indent={14}
          overscanCount={10}
          className="code-tree-virtual-list"
          initialOpenState={initialOpenState}
          openByDefault={expandedDirectories === undefined}
          disableDrag
          disableDrop
          disableEdit
          disableMultiSelection
          onSelect={(selectedNodes) => {
            // 只读数量通知（§4.2）：只消费 length，不回写树、不存 NodeApi。
            onSelectedCountChange?.(selectedNodes.length)
          }}
        >
          {(props) => <FileTreeNodeRenderer {...props} activeRelativePath={activeRelativePath} flatFileListMode={flatFileListMode} onRowClick={handleRowClick} onOpenFileContextMenu={handleOpenFileContextMenu} fileHoverCard={fileHoverCard} locatedFolderPath={locatedFolderPath} />}
        </Tree>
      )}
      {contextMenu && contextMenuSnapshot && (
        <CodeTreeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          relativePath={contextMenu.relativePath}
          nodeName={contextMenu.nodeName}
          nodeKind={contextMenu.nodeKind}
          onOpenFolder={() => onOpenNodeFolder(contextMenu.relativePath, contextMenu.nodeKind)}
          onOpenTerminal={() => onOpenNodeTerminal(contextMenu.relativePath, contextMenu.nodeKind)}
          onSearchInFolder={() => onSearchInFolder(contextMenu.relativePath, contextMenu.nodeKind)}
          onFindFilesByName={onFindNodeFilesByName ? () => onFindNodeFilesByName(contextMenu) : undefined}
          onLocateNodeFolder={onLocateNodeFolder ? () => onLocateNodeFolder(contextMenu.relativePath) : undefined}
          onSearchFoldersInFolder={onSearchFoldersInFolder ? () => onSearchFoldersInFolder(contextMenu) : undefined}
          onCopyName={() => onCopyNodeName(contextMenu.nodeName, contextMenu.nodeKind)}
          onCopyRelativePath={() => onCopyNodeRelativePath(contextMenu.relativePath, contextMenu.nodeKind)}
          onCopyRelativePathWithoutSlashes={() => onCopyNodeRelativePathWithoutSlashes(contextMenu.relativePath, contextMenu.nodeKind)}
          onCopyPathWithLineNumber={onCopyNodePathWithLineNumber && contextMenu.lineNumber != null ? () => onCopyNodePathWithLineNumber(contextMenu.relativePath, contextMenu.lineNumber!) : undefined}
          onCopyFileToClipboard={onCopyNodeToClipboard ? () => onCopyNodeToClipboard(contextMenu.relativePath, contextMenu.nodeKind) : undefined}
          onZipFolder={onZipNodeFolder ? (zipName) => onZipNodeFolder(contextMenu.relativePath, contextMenu.nodeName, zipName) : undefined}
          onCopyZipToClipboard={onCopyNodeZipToClipboard ? () => onCopyNodeZipToClipboard(contextMenu.relativePath, contextMenu.nodeName, contextMenu.nodeKind) : undefined}
          onRunScriptInSystemTerminal={onRunNodeScriptInSystemTerminal ? () => onRunNodeScriptInSystemTerminal(contextMenu.relativePath, contextMenu.nodeKind) : undefined}
          onRunScriptInEmbeddedTerminal={onRunNodeScriptInEmbeddedTerminal ? () => onRunNodeScriptInEmbeddedTerminal(contextMenu.relativePath, contextMenu.nodeKind) : undefined}
          resolveRunnableScript={onResolveNodeRunnableScript}
          selectedItems={contextMenuSnapshot.selectedItems}
          onCopySelectedRelativePaths={() => handleBatchCopy('relative')}
          onCopySelectedAbsolutePaths={() => handleBatchCopy('absolute')}
          onCopySelectedNames={() => handleBatchCopy('name')}
          onCopySelectedFiles={onCopySelectedFiles ? () => handleBatchCopy('files') : undefined}
          onCopySelectedZipToClipboard={onCopySelectedZipToClipboard ? (zipName) => handleBatchCopy('zip', zipName) : undefined}
          zipDefaultName={zipDefaultName}
          onClose={closeContextMenu}
        />
      )}
    </div>
  )
})
