import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FileSearch } from 'lucide-react'
import { Tree } from 'react-arborist'
import type { NodeRendererProps, TreeApi } from 'react-arborist'
import type { ProjectFileContentSearchResult, ProjectFileNodeKind } from '../../../shared/types'
import { Tooltip } from '../../components/ui/tooltip'
import { CodeTreeContextMenu, type CodeTreeContextMenuPayload } from './CodeTreeContextMenu'
import { fileNameFromRelativePath } from './code.markdownShared'

interface ActiveContentSearchLocation {
  relativePath: string
  lineNumber: number
  column: number
}

interface CodeContentSearchTreeProps {
  files: ProjectFileContentSearchResult[]
  activeLocation: ActiveContentSearchLocation | null
  onOpenMatch: (relativePath: string, lineNumber: number, column: number) => void
  onOpenNodeFolder: (relativePath: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onCopyNodeName: (nodeName: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onCopyNodeRelativePath: (relativePath: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  onCopyNodeRelativePathWithoutSlashes: (relativePath: string, nodeKind: ProjectFileNodeKind) => void | Promise<void>
  autoCollapseMatchThreshold?: number
}

export interface CodeContentSearchTreeHandle {
  expandAll: () => void
  collapseAll: () => void
}

interface TreeSize {
  width: number
  height: number
}

interface ContentSearchFileTreeNode {
  id: string
  kind: 'file'
  relativePath: string
  name: string
  matchCount: number
  children: ContentSearchMatchTreeNode[]
}

interface ContentSearchMatchTreeNode {
  id: string
  kind: 'match'
  relativePath: string
  lineNumber: number
  column: number
  lineText: string
}

type ContentSearchTreeNode = ContentSearchFileTreeNode | ContentSearchMatchTreeNode

interface ContentSearchNodeRendererProps extends NodeRendererProps<ContentSearchTreeNode> {
  activeLocation: ActiveContentSearchLocation | null
  onOpenMatch: (relativePath: string, lineNumber: number, column: number) => void
  onOpenFileContextMenu: (payload: CodeTreeContextMenuPayload) => void
}

function useContainerSize() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState<TreeSize>({ width: 0, height: 0 })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updateSize = () => {
      const rect = container.getBoundingClientRect()
      const nextWidth = Math.max(0, Math.floor(rect.width))
      const nextHeight = Math.max(0, Math.floor(rect.height))
      setSize((prev) => (
        prev.width === nextWidth && prev.height === nextHeight
          ? prev
          : { width: nextWidth, height: nextHeight }
      ))
    }

    updateSize()
    const observer = new ResizeObserver(() => {
      updateSize()
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
    }
  }, [])

  return { containerRef, size }
}

function buildContentSearchTreeData(
  files: ProjectFileContentSearchResult[],
  autoCollapseMatchThreshold: number
): {
    nodes: ContentSearchTreeNode[]
    fileNodeIds: string[]
    defaultCollapsedFileNodeIds: Set<string>
  } {
  const nodes: ContentSearchTreeNode[] = []
  const fileNodeIds: string[] = []
  const defaultCollapsedFileNodeIds = new Set<string>()

  for (const file of files) {
    const fileNodeId = `file:${file.relativePath}`
    fileNodeIds.push(fileNodeId)

    if (file.matches.length >= autoCollapseMatchThreshold) {
      defaultCollapsedFileNodeIds.add(fileNodeId)
    }

    const children: ContentSearchMatchTreeNode[] = file.matches.map((match, index) => ({
      id: `match:${file.relativePath}:${match.lineNumber}:${match.column}:${index}`,
      kind: 'match',
      relativePath: file.relativePath,
      lineNumber: match.lineNumber,
      column: match.column,
      lineText: match.lineText,
    }))

    nodes.push({
      id: fileNodeId,
      kind: 'file',
      relativePath: file.relativePath,
      name: file.name,
      matchCount: file.matchCount,
      children,
    })
  }

  return { nodes, fileNodeIds, defaultCollapsedFileNodeIds }
}

function ContentSearchNodeRenderer({
  node,
  style,
  dragHandle,
  activeLocation,
  onOpenMatch,
  onOpenFileContextMenu,
}: ContentSearchNodeRendererProps) {
  const data = node.data

  if (data.kind === 'file') {
    return (
      <div ref={dragHandle} style={style}>
        <button
          type="button"
          className="code-content-search-file-header"
          style={{ paddingLeft: 10 }}
          onClick={(event) => {
            event.stopPropagation()
            node.toggle()
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onOpenFileContextMenu({
              x: event.clientX,
              y: event.clientY,
              relativePath: data.relativePath,
              nodeName: data.name,
              nodeKind: 'file',
            })
          }}
        >
          {node.isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
          )}
          <FileSearch className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
          <Tooltip
            content={data.relativePath}
            align="start"
            placementMode="pointer"
            interactive={false}
            className="min-w-0 flex-1"
            contentClassName="font-mono text-[10.5px] leading-[1.4]"
          >
            <span className="code-content-search-file-path">{data.name}</span>
          </Tooltip>
          <div className="code-content-search-file-count">{data.matchCount}</div>
        </button>
      </div>
    )
  }

  const isActive = activeLocation?.relativePath === data.relativePath
    && activeLocation.lineNumber === data.lineNumber
    && activeLocation.column === data.column

  return (
    <div ref={dragHandle} style={style}>
      <button
        type="button"
        className={`code-content-search-match ${isActive ? 'is-active' : ''}`}
        style={{ paddingLeft: 10 }}
        onClick={(event) => {
          event.stopPropagation()
          onOpenMatch(data.relativePath, data.lineNumber, data.column)
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onOpenFileContextMenu({
            x: event.clientX,
            y: event.clientY,
            relativePath: data.relativePath,
            nodeName: fileNameFromRelativePath(data.relativePath),
            nodeKind: 'file',
          })
        }}
        title={`${data.relativePath}:${data.lineNumber}:${data.column}`}
      >
        <div className="code-content-search-position">
          {data.lineNumber}:{data.column}
        </div>
        <div className="code-content-search-line">{data.lineText}</div>
      </button>
    </div>
  )
}

const CodeContentSearchTreeInner = forwardRef<CodeContentSearchTreeHandle, CodeContentSearchTreeProps>(
  function CodeContentSearchTreeInner({
    files,
    activeLocation,
    onOpenMatch,
    onOpenNodeFolder,
    onCopyNodeName,
    onCopyNodeRelativePath,
    onCopyNodeRelativePathWithoutSlashes,
    autoCollapseMatchThreshold = 10,
  }, ref) {
    const treeRef = useRef<TreeApi<ContentSearchTreeNode> | null>(null)
    const { containerRef, size } = useContainerSize()
    const [contextMenu, setContextMenu] = useState<CodeTreeContextMenuPayload | null>(null)
    const {
      nodes,
      fileNodeIds,
      defaultCollapsedFileNodeIds,
    } = useMemo(
      () => buildContentSearchTreeData(files, autoCollapseMatchThreshold),
      [autoCollapseMatchThreshold, files]
    )

    useImperativeHandle(ref, () => ({
      expandAll: () => {
        treeRef.current?.openAll()
      },
      collapseAll: () => {
        treeRef.current?.closeAll()
      },
    }), [])

    useEffect(() => {
      const tree = treeRef.current
      if (!tree) return

      tree.closeAll()
      for (const fileNodeId of fileNodeIds) {
        if (defaultCollapsedFileNodeIds.has(fileNodeId)) continue
        tree.open(fileNodeId)
      }
    }, [defaultCollapsedFileNodeIds, fileNodeIds])

    const handleOpenFileContextMenu = useCallback((payload: CodeTreeContextMenuPayload) => {
      setContextMenu(payload)
    }, [])

    const closeContextMenu = useCallback(() => {
      setContextMenu(null)
    }, [])

    return (
      <div ref={containerRef} className="code-content-search-virtual-wrap">
        {size.width > 0 && size.height > 0 && (
          <Tree<ContentSearchTreeNode>
            ref={treeRef}
            data={nodes}
            idAccessor={(item) => item.id}
            childrenAccessor={(item) => (item.kind === 'file' ? item.children : null)}
            width={size.width}
            height={size.height}
            rowHeight={34}
            indent={14}
            overscanCount={10}
            className="code-content-search-virtual-list"
            disableDrag
            disableDrop
            disableEdit
            disableMultiSelection
          >
            {(props) => (
              <ContentSearchNodeRenderer
                {...props}
                activeLocation={activeLocation}
                onOpenMatch={onOpenMatch}
                onOpenFileContextMenu={handleOpenFileContextMenu}
              />
            )}
          </Tree>
        )}
        {contextMenu && (
          <CodeTreeContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            nodeName={contextMenu.nodeName}
            nodeKind={contextMenu.nodeKind}
            onOpenFolder={() => onOpenNodeFolder(contextMenu.relativePath, contextMenu.nodeKind)}
            onCopyName={() => onCopyNodeName(contextMenu.nodeName, contextMenu.nodeKind)}
            onCopyRelativePath={() => onCopyNodeRelativePath(contextMenu.relativePath, contextMenu.nodeKind)}
            onCopyRelativePathWithoutSlashes={() => (
              onCopyNodeRelativePathWithoutSlashes(contextMenu.relativePath, contextMenu.nodeKind)
            )}
            onClose={closeContextMenu}
          />
        )}
      </div>
    )
  }
)

export const CodeContentSearchTree = memo(CodeContentSearchTreeInner)
