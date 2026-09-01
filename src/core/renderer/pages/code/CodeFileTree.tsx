import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, FileX2, Folder, FolderOpen, FolderX } from 'lucide-react'
import { Tree } from 'react-arborist'
import type { NodeRendererProps, TreeApi } from 'react-arborist'
import type { ProjectFileNode, ProjectFileNodeKind } from '../../../shared/types'
import { Tooltip } from '../../components/ui/tooltip'
import { useI18n } from '../../i18n'
import { CodeTreeContextMenu, type CodeTreeContextMenuPayload } from './CodeTreeContextMenu'

const DIRECTORY_PLACEHOLDER_SUFFIX = '/__codex_placeholder__'
const MAX_LOCATE_SCROLL_ATTEMPTS = 6
const MAX_FOLLOW_SCROLL_ATTEMPTS = 6

interface CodeFileTreeProps {
  nodes: ProjectFileNode[]
  activeRelativePath: string | null
  expandedDirectories: Set<string>
  onToggleDirectory: (relativePath: string) => void
  onSelectFile: (relativePath: string) => void
  onSelectExcluded: (relativePath: string, nodeKind: ProjectFileNodeKind) => void
  onOpenNodeFolder: (relativePath: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onOpenNodeTerminal: (relativePath: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onSearchInFolder: (relativePath: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onCopyNodeName: (nodeName: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onCopyNodeRelativePath: (relativePath: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onCopyNodeRelativePathWithoutSlashes: (relativePath: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  flatFileListMode?: boolean
  locateRequestToken?: number
}

interface FileTreeNodeRendererProps extends NodeRendererProps<ProjectFileNode> {
  activeRelativePath: string | null
  flatFileListMode: boolean
  onToggleDirectory: (relativePath: string) => void
  onSelectFile: (relativePath: string) => void
  onSelectExcluded: (relativePath: string, nodeKind: ProjectFileNodeKind) => void
  onOpenFileContextMenu: (payload: CodeTreeContextMenuPayload) => void
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

function FileTreeNodeRenderer({ node, style, dragHandle, activeRelativePath, flatFileListMode, onToggleDirectory, onSelectFile, onSelectExcluded, onOpenFileContextMenu }: FileTreeNodeRendererProps) {
  const data = node.data
  if (isPlaceholderNode(data)) {
    return <div style={style} aria-hidden="true" />
  }
  const isExcluded = data.isExcluded === true
  const isDirectory = !flatFileListMode && data.kind === 'directory' && !isExcluded
  const isExpanded = isDirectory && node.isOpen
  const isActive = data.kind === 'file' && activeRelativePath === data.relativePath
  const hasChildren = isDirectory && Boolean(data.hasChildren || (data.children?.length ?? 0) > 0)
  const rowLabel = flatFileListMode && isActive ? data.relativePath : data.name

  return (
    <div ref={dragHandle} style={style}>
      <button
        type="button"
        className={`code-tree-row ${isActive ? 'code-tree-row--active' : ''} ${isExcluded ? 'code-tree-row--excluded' : ''}`}
        style={{ paddingLeft: 10 }}
        onClick={(event) => {
          event.stopPropagation()
          if (isExcluded) {
            onSelectExcluded(data.relativePath, data.kind)
            return
          }
          if (isDirectory) {
            onToggleDirectory(data.relativePath)
            return
          }
          onSelectFile(data.relativePath)
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onOpenFileContextMenu({
            x: event.clientX,
            y: event.clientY,
            relativePath: data.relativePath,
            nodeName: data.name,
            nodeKind: data.kind,
          })
        }}
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
        <Tooltip content={data.relativePath} align="start" placementMode="pointer" interactive={false} className="w-0 min-w-0 flex-1" contentClassName="font-mono text-[10.5px] leading-[1.4]">
          <span className="block min-w-0 truncate">{rowLabel}</span>
        </Tooltip>
      </button>
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
  flatFileListMode = false,
  locateRequestToken = 0,
}: CodeFileTreeProps) {
  const { t } = useI18n()
  const hasNodes = useMemo(() => nodes.length > 0, [nodes])
  const treeRef = useRef<TreeApi<ProjectFileNode> | null>(null)
  const handledLocateRequestTokenRef = useRef(0)
  const previousExpandedDirectoriesRef = useRef<Set<string>>(new Set(expandedDirectories))
  const previousActivePathRef = useRef(activeRelativePath)
  const suppressFollowScrollRef = useRef(false)
  const suppressFollowScrollTimerRef = useRef<number | null>(null)
  const { containerRef, size } = useContainerSize()
  const [contextMenu, setContextMenu] = useState<CodeTreeContextMenuPayload | null>(null)
  const directoryPaths = useMemo(() => collectDirectoryPaths(nodes), [nodes])
  const isMeasuring = size.width <= 0 || size.height <= 0
  const initialOpenState = useMemo(() => {
    if (flatFileListMode) return {}
    const state: Record<string, boolean> = {}
    for (const path of expandedDirectories) {
      state[path] = true
    }
    return state
  }, [expandedDirectories, flatFileListMode])

  useEffect(() => {
    if (!locateRequestToken) return
    if (locateRequestToken === handledLocateRequestTokenRef.current) return
    handledLocateRequestTokenRef.current = locateRequestToken
    if (!activeRelativePath) return
    let cancelled = false
    let frameId = 0
    let attempts = 0

    const revealActiveFile = () => {
      if (cancelled) return
      const tree = treeRef.current
      if (!tree) return
      if (centerTreeNodeInViewport(tree, activeRelativePath)) return

      attempts += 1
      void tree.scrollTo(activeRelativePath, 'center')
      if (attempts >= MAX_LOCATE_SCROLL_ATTEMPTS) return
      frameId = window.requestAnimationFrame(revealActiveFile)
    }

    revealActiveFile()
    return () => {
      cancelled = true
      window.cancelAnimationFrame(frameId)
    }
  }, [locateRequestToken, activeRelativePath])

  useEffect(() => {
    if (!activeRelativePath) {
      treeRef.current?.deselectAll()
      return
    }

    // 文件切换时重新定位，清除用户主动展开/折叠目录时的滚动抑制。
    if (activeRelativePath !== previousActivePathRef.current) {
      previousActivePathRef.current = activeRelativePath
      suppressFollowScrollRef.current = false
    }

    // 跟随当前文件：选中并确保高亮行可见（容器测量与 Tree 挂载晚于本 effect，
    // 因此树未就绪时也按帧重试，避免从全局搜索等视图切回文件树时定位失效）。
    let cancelled = false
    let frameId = 0
    let attempts = 0

    const followActiveFile = () => {
      if (cancelled) return
      const currentTree = treeRef.current
      if (!currentTree) {
        attempts += 1
        if (attempts >= MAX_FOLLOW_SCROLL_ATTEMPTS) return
        frameId = window.requestAnimationFrame(followActiveFile)
        return
      }

      currentTree.setSelection({
        ids: [activeRelativePath],
        anchor: activeRelativePath,
        mostRecent: activeRelativePath,
      })
      currentTree.focus(activeRelativePath, { scroll: false })

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
  }, [activeRelativePath, expandedDirectories, flatFileListMode, nodes])

  useEffect(() => {
    if (flatFileListMode) {
      // 搜索模式退化为扁平列表，目录展开状态不会作用到 arborist。
      // 同时保留进入搜索前的展开快照：否则搜索期间定位新增的父目录会在
      // 切回树形模式时被 diff 误判为“已展开”，导致目录保持折叠、无法定位。
      return
    }

    const tree = treeRef.current
    if (!tree) {
      previousExpandedDirectoriesRef.current = new Set(expandedDirectories)
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

    previousExpandedDirectoriesRef.current = new Set(expandedDirectories)
  }, [directoryPaths, expandedDirectories, flatFileListMode])

  const handleOpenFileContextMenu = useCallback((payload: CodeTreeContextMenuPayload) => {
    setContextMenu(payload)
  }, [])

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
      onToggleDirectory(relativePath)
    },
    [onToggleDirectory, renewSuppressFollowScroll],
  )

  useEffect(() => {
    return () => {
      if (suppressFollowScrollTimerRef.current != null) {
        window.clearTimeout(suppressFollowScrollTimerRef.current)
      }
    }
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  if (!hasNodes) {
    return <div className="code-panel-empty text-xs text-[color:var(--color-muted-foreground)]">{t('codeFileTree.noFilesAvailable')}</div>
  }

  return (
    <div ref={containerRef} className="code-tree-virtual-wrap">
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
          openByDefault={false}
          disableDrag
          disableDrop
          disableEdit
          disableMultiSelection
        >
          {(props) => <FileTreeNodeRenderer {...props} activeRelativePath={activeRelativePath} flatFileListMode={flatFileListMode} onToggleDirectory={handleToggleDirectory} onSelectFile={onSelectFile} onSelectExcluded={onSelectExcluded} onOpenFileContextMenu={handleOpenFileContextMenu} />}
        </Tree>
      )}
      {contextMenu && (
        <CodeTreeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          nodeName={contextMenu.nodeName}
          nodeKind={contextMenu.nodeKind}
          onOpenFolder={() => onOpenNodeFolder(contextMenu.relativePath, contextMenu.nodeKind)}
          onOpenTerminal={() => onOpenNodeTerminal(contextMenu.relativePath, contextMenu.nodeKind)}
          onSearchInFolder={() => onSearchInFolder(contextMenu.relativePath, contextMenu.nodeKind)}
          onCopyName={() => onCopyNodeName(contextMenu.nodeName, contextMenu.nodeKind)}
          onCopyRelativePath={() => onCopyNodeRelativePath(contextMenu.relativePath, contextMenu.nodeKind)}
          onCopyRelativePathWithoutSlashes={() => onCopyNodeRelativePathWithoutSlashes(contextMenu.relativePath, contextMenu.nodeKind)}
          onClose={closeContextMenu}
        />
      )}
    </div>
  )
})
