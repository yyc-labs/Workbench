import { useEffect, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from 'lucide-react'
import { ScrollArea } from '../../components/ui/scroll-area'
import type { ProjectFileNode } from '../../../shared/types'

interface CodeFileTreeProps {
  nodes: ProjectFileNode[]
  activeRelativePath: string | null
  expandedDirectories: Set<string>
  onToggleDirectory: (relativePath: string) => void
  onSelectFile: (relativePath: string) => void
  flatFileListMode?: boolean
  locateRequestToken?: number
}

interface TreeNodeRowProps {
  node: ProjectFileNode
  depth: number
  activeRelativePath: string | null
  expandedDirectories: Set<string>
  onToggleDirectory: (relativePath: string) => void
  onSelectFile: (relativePath: string) => void
  activePathRowRef: MutableRefObject<HTMLButtonElement | null>
}

function TreeNodeRow({
  node,
  depth,
  activeRelativePath,
  expandedDirectories,
  onToggleDirectory,
  onSelectFile,
  activePathRowRef,
}: TreeNodeRowProps) {
  const isDirectory = node.kind === 'directory'
  const isExpanded = isDirectory && expandedDirectories.has(node.relativePath)
  const isActive = !isDirectory && activeRelativePath === node.relativePath
  const hasChildren = isDirectory && (node.children?.length ?? 0) > 0
  const paddingLeft = 10 + depth * 14

  return (
    <div>
      <button
        type="button"
        className={`code-tree-row ${isActive ? 'code-tree-row--active' : ''}`}
        style={{ paddingLeft }}
        onClick={() => {
          if (isDirectory) {
            onToggleDirectory(node.relativePath)
            return
          }
          onSelectFile(node.relativePath)
        }}
        title={node.relativePath}
        ref={!isDirectory && isActive ? activePathRowRef : undefined}
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
        <span className="block w-0 min-w-0 flex-1 truncate">{node.name}</span>
      </button>

      {isDirectory && isExpanded && hasChildren && (
        <div>
          {node.children?.map((child) => (
            <TreeNodeRow
              key={child.relativePath}
              node={child}
              depth={depth + 1}
              activeRelativePath={activeRelativePath}
              expandedDirectories={expandedDirectories}
              onToggleDirectory={onToggleDirectory}
              onSelectFile={onSelectFile}
              activePathRowRef={activePathRowRef}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function CodeFileTree({
  nodes,
  activeRelativePath,
  expandedDirectories,
  onToggleDirectory,
  onSelectFile,
  flatFileListMode = false,
  locateRequestToken = 0,
}: CodeFileTreeProps) {
  const hasNodes = useMemo(() => nodes.length > 0, [nodes])
  const activePathRowRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!locateRequestToken) return
    const node = activePathRowRef.current
    if (!node) return
    node.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [locateRequestToken, activeRelativePath, expandedDirectories, flatFileListMode, nodes])

  if (!hasNodes) {
    return (
      <div className="code-panel-empty text-xs text-[color:var(--color-muted-foreground)]">
        No files available.
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="py-2">
        {flatFileListMode ? (
          nodes.map((node) => {
            const isActive = activeRelativePath === node.relativePath
            const rowLabel = isActive ? node.relativePath : node.name
            return (
              <button
                key={node.relativePath}
                type="button"
                className={`code-tree-row ${isActive ? 'code-tree-row--active' : ''}`}
                style={{ paddingLeft: 10 }}
                onClick={() => onSelectFile(node.relativePath)}
                title={node.relativePath}
                ref={isActive ? activePathRowRef : undefined}
              >
                <span className="inline-block h-3.5 w-3.5 shrink-0" />
                <FileText className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]" />
                <span className="block w-0 min-w-0 flex-1 truncate">{rowLabel}</span>
              </button>
            )
          })
        ) : (
          nodes.map((node) => (
            <TreeNodeRow
              key={node.relativePath}
              node={node}
              depth={0}
              activeRelativePath={activeRelativePath}
              expandedDirectories={expandedDirectories}
              onToggleDirectory={onToggleDirectory}
              onSelectFile={onSelectFile}
              activePathRowRef={activePathRowRef}
            />
          ))
        )}
      </div>
    </ScrollArea>
  )
}
