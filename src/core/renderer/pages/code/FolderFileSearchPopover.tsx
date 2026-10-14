import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { FileText, Search } from 'lucide-react'
import type { ProjectFileNode } from '../../../shared/types'
import { DebouncedSearchInput } from './DebouncedSearchInput'
import type { CodeTreeContextMenuPayload } from './CodeTreeContextMenu'
import { useI18n } from '../../i18n'

const SEARCH_DEBOUNCE_MS = 250
const POPOVER_WIDTH = 320
const POPOVER_MAX_HEIGHT = 380
const POPOVER_PADDING = 8

interface FolderFileSearchPopoverProps {
  x: number
  y: number
  folderRelativePath: string
  folderName: string
  projectPath: string
  onOpenFile: (relativePath: string) => void
  onContextMenu: (payload: CodeTreeContextMenuPayload) => void
  onClose: () => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** 文件夹内按名称搜索弹层（13.5）。z-index 9997：右键结果项时 CodeTreeContextMenu(9998) 浮于其上。 */
function FolderFileSearchPopoverInner({ x, y, folderRelativePath, folderName, projectPath, onOpenFile, onContextMenu, onClose }: FolderFileSearchPopoverProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProjectFileNode[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const requestSeqRef = useRef(0)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  // 打开即聚焦搜索框。
  useEffect(() => {
    searchInputRef.current?.focus()
  }, [])

  const left = clamp(x, POPOVER_PADDING, Math.max(POPOVER_PADDING, window.innerWidth - POPOVER_WIDTH - POPOVER_PADDING))
  const top = clamp(y, POPOVER_PADDING, Math.max(POPOVER_PADDING, window.innerHeight - POPOVER_MAX_HEIGHT - POPOVER_PADDING))

  // 右键菜单（ContextCascader，z-9999/9998）打开期间忽略 Escape 与外部点击，菜单自身关闭时不连带关闭本弹层。
  const isContextMenuActive = useCallback(() => Boolean(document.querySelector('[data-context-cascader-overlay]')), [])

  // Escape / 外部 pointerdown / 滚动三类关闭，与 ContextCascader 关闭语义一致；延迟注册防「打开即关」。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isContextMenuActive()) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isContextMenuActive, onClose])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-context-cascader-overlay]')) return
      onClose()
    }
    const timer = window.setTimeout(() => {
      document.addEventListener('pointerdown', onPointerDown)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [onClose])

  // 外部滚动关闭；但弹层内部结果列表的滚动不关闭（否则浏览结果时弹层会自杀）。
  useEffect(() => {
    const onScroll = (event: Event) => {
      const target = event.target
      if (target instanceof Node && panelRef.current?.contains(target)) return
      onClose()
    }
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [onClose])

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      requestSeqRef.current += 1
      setResults([])
      setIsSearching(false)
      return
    }

    const seq = requestSeqRef.current + 1
    requestSeqRef.current = seq
    setIsSearching(true)

    let cancelled = false
    void window.electronAPI
      .searchProjectFiles(projectPath, trimmed, folderRelativePath)
      .then((matches) => {
        if (cancelled || requestSeqRef.current !== seq) return
        setResults(matches)
        setIsSearching(false)
      })
      .catch(() => {
        if (cancelled || requestSeqRef.current !== seq) return
        setResults([])
        setIsSearching(false)
      })

    return () => {
      cancelled = true
    }
  }, [folderRelativePath, projectPath, query])

  const handleSelectFile = useCallback(
    (relativePath: string) => {
      onOpenFile(relativePath)
      onClose()
    },
    [onClose, onOpenFile],
  )

  const handleResultContextMenu = useCallback(
    (event: MouseEvent, node: ProjectFileNode) => {
      event.preventDefault()
      event.stopPropagation()
      onContextMenu({
        x: event.clientX,
        y: event.clientY,
        relativePath: node.relativePath,
        nodeName: node.name,
        nodeKind: node.kind,
      })
    },
    [onContextMenu],
  )

  const isEmpty = !isSearching && query.trim().length > 0 && results.length === 0
  const listHeight = useMemo(() => Math.min(POPOVER_MAX_HEIGHT, results.length * 34 + 96), [results.length])

  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-[9997] flex flex-col overflow-hidden rounded-[16px] border border-[color:var(--color-border)] bg-[color:var(--color-popover)] p-1.5 shadow-[var(--shadow-popover)]"
      style={{ top, left, width: POPOVER_WIDTH, maxHeight: POPOVER_MAX_HEIGHT }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
        <DebouncedSearchInput
          inputRef={searchInputRef}
          leadingIcon={null}
          placeholder={t('codeFileTree.searchFilesPlaceholder', { folder: folderName })}
          debounceMs={SEARCH_DEBOUNCE_MS}
          onQueryChange={setQuery}
          inputClassName="w-full bg-transparent text-[12px] text-[color:var(--color-foreground)] outline-none placeholder:text-[color:var(--color-muted-foreground)]"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" style={{ height: listHeight }}>
        {isEmpty ? (
          <div className="px-3 py-4 text-[11px] text-[color:var(--color-muted-foreground)]">{t('codeFileTree.searchFilesEmpty')}</div>
        ) : (
          results.map((node) => {
            const subPath = node.relativePath.slice(0, Math.max(0, node.relativePath.length - node.name.length - 1))
            return (
              <button
                key={node.relativePath}
                type="button"
                className="flex w-full items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-left transition-colors hover:bg-[color:var(--color-accent)]"
                onClick={() => handleSelectFile(node.relativePath)}
                onContextMenu={(event) => handleResultContextMenu(event, node)}
                title={node.relativePath}
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] text-[color:var(--color-foreground)]">{node.name}</span>
                  {subPath ? <span className="block truncate text-[10px] text-[color:var(--color-muted-foreground)]">{subPath}</span> : null}
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>,
    document.body,
  )
}

export const FolderFileSearchPopover = memo(FolderFileSearchPopoverInner)
