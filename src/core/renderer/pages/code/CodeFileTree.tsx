import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronRight, Copy, FileText, Folder, FolderOpen } from 'lucide-react'
import { Tree } from 'react-arborist'
import type { NodeRendererProps, TreeApi } from 'react-arborist'
import type { ProjectFileNode, ProjectFileNodeKind } from '../../../shared/types'
import { Tooltip } from '../../components/ui/tooltip'
import { useI18n } from '../../i18n'

const DIRECTORY_PLACEHOLDER_SUFFIX = '/__codex_placeholder__'

interface FileTreeContextMenuPayload {
  x: number
  y: number
  relativePath: string
  nodeName: string
  nodeKind: ProjectFileNodeKind
}

interface CodeFileTreeProps {
  nodes: ProjectFileNode[]
  activeRelativePath: string | null
  expandedDirectories: Set<string>
  onToggleDirectory: (relativePath: string) => void
  onSelectFile: (relativePath: string) => void
  onOpenNodeFolder: (relativePath: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onCopyNodeName: (nodeName: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  flatFileListMode?: boolean
  locateRequestToken?: number
}

interface FileTreeNodeRendererProps extends NodeRendererProps<ProjectFileNode> {
  activeRelativePath: string | null
  flatFileListMode: boolean
  onToggleDirectory: (relativePath: string) => void
  onSelectFile: (relativePath: string) => void
  onOpenFileContextMenu: (payload: FileTreeContextMenuPayload) => void
}

interface TreeSize {
  width: number
  height: number
}

interface FileTreeContextMenuProps {
  x: number
  y: number
  nodeName: string
  nodeKind: ProjectFileNodeKind
  onOpenFolder: () => void | Promise<void>
  onCopyName: () => void | Promise<void>
  onClose: () => void
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
      setSize((prev) => (
        prev.width === nextWidth && prev.height === nextHeight
          ? prev
          : { width: nextWidth, height: nextHeight }
      ))
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

function FileTreeContextMenu({
  x,
  y,
  nodeName,
  nodeKind,
  onOpenFolder,
  onCopyName,
  onClose,
}: FileTreeContextMenuProps) {
  const { t } = useI18n()
  const width = 210
  const height = 108
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
    </div>,
    document.body
  )
}

function FileTreeNodeRenderer({
  node,
  style,
  dragHandle,
  activeRelativePath,
  flatFileListMode,
  onToggleDirectory,
  onSelectFile,
  onOpenFileContextMenu,
}: FileTreeNodeRendererProps) {
  const data = node.data
  if (isPlaceholderNode(data)) {
    return <div style={style} aria-hidden="true" />
  }
  const isDirectory = !flatFileListMode && data.kind === 'directory'
  const isExpanded = isDirectory && node.isOpen
  const isActive = data.kind === 'file' && activeRelativePath === data.relativePath
  const hasChildren = isDirectory && Boolean(data.hasChildren || (data.children?.length ?? 0) > 0)
  const rowLabel = flatFileListMode && isActive ? data.relativePath : data.name

  return (
    <div ref={dragHandle} style={style}>
      <button
        type="button"
        className={`code-tree-row ${isActive ? 'code-tree-row--active' : ''}`}
        style={{ paddingLeft: 10 }}
        onClick={(event) => {
          event.stopPropagation()
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

        {isDirectory ? (
          isExpanded ? (
            <FolderOpen className="h-4 w-4 shrink-0 text-[color:var(--color-warning)]" />
          ) : (
            <Folder className="h-4 w-4 shrink-0 text-[color:var(--color-warning)]" />
          )
        ) : (
          <FileText className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]" />
        )}
        <Tooltip
          content={data.relativePath}
          align="start"
          className="w-0 min-w-0 flex-1"
          contentClassName="font-mono text-[10.5px] leading-[1.4]"
        >
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
  onOpenNodeFolder,
  onCopyNodeName,
  flatFileListMode = false,
  locateRequestToken = 0,
}: CodeFileTreeProps) {
  const { t } = useI18n()
  const hasNodes = useMemo(() => nodes.length > 0, [nodes])
  const treeRef = useRef<TreeApi<ProjectFileNode> | null>(null)
  const handledLocateRequestTokenRef = useRef(0)
  const previousExpandedDirectoriesRef = useRef<Set<string>>(new Set(expandedDirectories))
  const { containerRef, size } = useContainerSize()
  const [contextMenu, setContextMenu] = useState<FileTreeContextMenuPayload | null>(null)
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
    const tree = treeRef.current
    if (!tree) return

    const activeIndex = tree.indexOf(activeRelativePath)
    if (
      activeIndex != null
      && activeIndex >= tree.visibleStartIndex
      && activeIndex <= tree.visibleStopIndex
    ) {
      return
    }

    void tree.scrollTo(activeRelativePath, 'smart')
  }, [locateRequestToken, activeRelativePath])

  useEffect(() => {
    const tree = treeRef.current
    if (!tree) return

    if (!activeRelativePath) {
      tree.deselectAll()
      return
    }

    tree.setSelection({
      ids: [activeRelativePath],
      anchor: activeRelativePath,
      mostRecent: activeRelativePath,
    })
    tree.focus(activeRelativePath, { scroll: false })
  }, [activeRelativePath, flatFileListMode, nodes])

  useEffect(() => {
    if (flatFileListMode) {
      previousExpandedDirectoriesRef.current = new Set(expandedDirectories)
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

  const handleOpenFileContextMenu = useCallback((payload: FileTreeContextMenuPayload) => {
    setContextMenu(payload)
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  if (!hasNodes) {
    return (
      <div className="code-panel-empty text-xs text-[color:var(--color-muted-foreground)]">
        {t('codeFileTree.noFilesAvailable')}
      </div>
    )
  }

  return (
    <div ref={containerRef} className="code-tree-virtual-wrap">
      {isMeasuring ? (
        <div className="code-panel-empty text-xs text-[color:var(--color-muted-foreground)]">
          {t('codeFileTree.preparingFileTree')}
        </div>
      ) : (
        <Tree<ProjectFileNode>
          ref={treeRef}
          data={nodes}
          idAccessor={(item) => item.relativePath}
          childrenAccessor={flatFileListMode ? (() => null) : getTreeChildren}
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
          {(props) => (
            <FileTreeNodeRenderer
              {...props}
              activeRelativePath={activeRelativePath}
              flatFileListMode={flatFileListMode}
              onToggleDirectory={onToggleDirectory}
              onSelectFile={onSelectFile}
              onOpenFileContextMenu={handleOpenFileContextMenu}
            />
          )}
        </Tree>
      )}
      {contextMenu && (
        <FileTreeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          nodeName={contextMenu.nodeName}
          nodeKind={contextMenu.nodeKind}
          onOpenFolder={() => onOpenNodeFolder(contextMenu.relativePath, contextMenu.nodeKind)}
          onCopyName={() => onCopyNodeName(contextMenu.nodeName, contextMenu.nodeKind)}
          onClose={closeContextMenu}
        />
      )}
    </div>
  )
})
