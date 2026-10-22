import { FileSearch } from 'lucide-react'
import type { ProjectFileContentMatch, ProjectFileNodeKind } from '../../../shared/types'
import { useI18n } from '../../i18n'
import type { CodeTreeContextMenuPayload } from './CodeTreeContextMenu'
import { fileNameFromRelativePath } from './code.markdownShared'

interface ActiveContentSearchLocation {
  relativePath: string
  lineNumber: number
  column: number
}

/** 卡片只依赖命中文件的结构字段（由 CodeFileTree 的 fileHoverCard 回调注入）。 */
interface HoverCardFileNode {
  relativePath: string
  matchCount: number
  matches: readonly ProjectFileContentMatch[]
}

interface ContentSearchHoverCardProps {
  node: HoverCardFileNode
  activeLocation: ActiveContentSearchLocation | null
  onOpenMatch: (relativePath: string, lineNumber: number, column: number) => void
  /** 命中行右键：交由文件树统一的右键菜单（快照 / 批量逻辑同源）处理。 */
  onMatchContextMenu: (payload: CodeTreeContextMenuPayload) => void
}

/** 全局搜索悬浮卡片：展示单个命中文件的全部命中行，点击跳转、右键走文件树同款菜单。 */
export function ContentSearchHoverCard({ node, activeLocation, onOpenMatch, onMatchContextMenu }: ContentSearchHoverCardProps) {
  const { t } = useI18n()
  const isActiveFile = activeLocation?.relativePath === node.relativePath

  const openMatchContextMenu = (event: React.MouseEvent, lineNumber: number) => {
    event.preventDefault()
    event.stopPropagation()
    const nodeKind: ProjectFileNodeKind = 'file'
    onMatchContextMenu({
      x: event.clientX,
      y: event.clientY,
      relativePath: node.relativePath,
      nodeName: fileNameFromRelativePath(node.relativePath),
      nodeKind,
      lineNumber,
    })
  }

  return (
    <div className="code-content-search-hover-card">
      <div className="code-content-search-hover-card-header">
        <FileSearch className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-primary)]" />
        <span className="code-content-search-hover-card-path">{node.relativePath}</span>
        <span className="code-content-search-hover-card-count">{t('codeWorkspace.matchesStat', { count: node.matchCount })}</span>
      </div>
      {node.matchCount > node.matches.length && <div className="code-content-search-hover-card-truncated">{t('codeWorkspace.contentSearchHoverTruncated', { shown: node.matches.length, total: node.matchCount })}</div>}
      <div className="code-content-search-hover-card-list">
        {node.matches.map((match, index) => {
          const isActiveMatch = isActiveFile && activeLocation?.lineNumber === match.lineNumber && activeLocation?.column === match.column
          return (
            <button
              key={`${match.lineNumber}:${match.column}:${index}`}
              type="button"
              className={`code-content-search-hover-match${isActiveMatch ? ' is-active' : ''}`}
              onClick={(event) => {
                event.stopPropagation()
                onOpenMatch(node.relativePath, match.lineNumber, match.column)
              }}
              onContextMenu={(event) => openMatchContextMenu(event, match.lineNumber)}
            >
              <span className="code-content-search-hover-position">
                {match.lineNumber}:{match.column}
              </span>
              <span className="code-content-search-hover-line">{match.lineText}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
