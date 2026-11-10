import { Clock3, Search, Star, Trash2 } from 'lucide-react'
import { type MouseEvent as ReactMouseEvent, type ReactNode, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../../i18n'
import { fileNameFromRelativePath } from '../../lib/projectPaths'
import { fuzzyPathMatch, parentDirectory } from './code.helpers'
import { DebouncedSearchInput } from './DebouncedSearchInput'

type CodeFileQuickCardProps = {
  activeRelativePath: string | null
  filePaths: string[]
  favorites: string[]
  recents: string[]
  onOpenFile: (relativePath: string) => void
  onToggleFavorite: (relativePath: string) => void
  onRemovePath: (relativePath: string) => void
  children: ReactNode
}

const VIEWPORT_PADDING = 12
const TRIGGER_GAP = 6
const HIDE_DELAY_MS = 160
const CARD_WIDTH = 340
const CARD_MAX_HEIGHT = 420

type QuickCardSectionProps = {
  title: string
  icon: ReactNode
  emptyText: string
  paths: string[]
  activeRelativePath: string | null
  favoriteSet: Set<string>
  onOpenFile: (relativePath: string) => void
  onToggleFavorite: (relativePath: string) => void
  onRemovePath: (relativePath: string) => void
}

function QuickCardSection({ title, icon, emptyText, paths, activeRelativePath, favoriteSet, onOpenFile, onToggleFavorite, onRemovePath }: QuickCardSectionProps) {
  const { t } = useI18n()
  return (
    <section className="min-w-0 pb-1">
      <div className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">
        {icon}
        {title}
      </div>
      {paths.length === 0 ? (
        <p className="px-2.5 py-1 text-[11px] text-[color:var(--color-muted-foreground)]">{emptyText}</p>
      ) : (
        <div className="grid min-w-0 gap-0.5">
          {paths.map((relativePath) => {
            const isFavorite = favoriteSet.has(relativePath)
            const name = fileNameFromRelativePath(relativePath)
            const directory = parentDirectory(relativePath)
            const isActive = activeRelativePath === relativePath
            return (
              <div key={relativePath} className={`flex min-w-0 items-center gap-1 rounded-[13px] pl-2.5 pr-1.5 transition-colors ${isActive ? 'bg-[color:var(--color-primary)]/12' : 'hover:bg-[color:var(--color-accent)]'}`}>
                <button type="button" className="min-w-0 flex-1 py-1.5 text-left" onClick={() => onOpenFile(relativePath)} title={relativePath}>
                  <span className="block truncate text-[12px] text-[color:var(--color-foreground)]">{name}</span>
                  {directory ? <span className="code-quick-card-path block truncate text-[10.5px] text-[color:var(--color-muted-foreground)]">{directory}</span> : null}
                </button>
                <div className="flex shrink-0 items-center">
                  <button
                    type="button"
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-[10px] transition-colors ${isFavorite ? 'text-[color:var(--color-warning)]' : 'text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-popover)]/70 hover:text-[color:var(--color-foreground)]'}`}
                    onClick={() => onToggleFavorite(relativePath)}
                    title={isFavorite ? t('codeWorkspace.removeFavorite') : t('codeWorkspace.addFavorite')}
                  >
                    <Star className={`h-3.5 w-3.5 ${isFavorite ? 'fill-current' : ''}`} />
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-[10px] text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-destructive-background)] hover:text-[color:var(--color-destructive)]"
                    onClick={() => onRemovePath(relativePath)}
                    title={t('codeWorkspace.deleteFromDrawer')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

/** 工具条「文件」悬浮快取卡片：hover 展开，承载原快取抽屉的搜索 / 收藏 / 最近内容（抽屉已移除）。 */
function CodeFileQuickCardInner({ activeRelativePath, filePaths, favorites, recents, onOpenFile, onToggleFavorite, onRemovePath, children }: CodeFileQuickCardProps) {
  const { t } = useI18n()
  const [show, setShow] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [layout, setLayout] = useState({ top: 0, left: 0, width: CARD_WIDTH, maxHeight: CARD_MAX_HEIGHT })
  const triggerRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverStateRef = useRef({ trigger: false, card: false })

  const favoriteSet = useMemo(() => new Set(favorites), [favorites])
  const matchingFilePaths = useMemo(() => filePaths.filter((relativePath) => fuzzyPathMatch(searchQuery, relativePath)), [filePaths, searchQuery])
  const hasContent = filePaths.length > 0 || favorites.length > 0 || recents.length > 0

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  const isWithinCardArea = useCallback((target: EventTarget | null) => {
    return target instanceof Node && Boolean(triggerRef.current?.contains(target) || cardRef.current?.contains(target))
  }, [])

  // 焦点在卡片内（如正在输入搜索）时不自动收起，避免打字途中卡片消失。
  const scheduleHide = useCallback(() => {
    clearHideTimer()
    hideTimerRef.current = setTimeout(() => {
      if (hoverStateRef.current.trigger || hoverStateRef.current.card) return
      if (cardRef.current?.contains(document.activeElement)) return
      setShow(false)
    }, HIDE_DELAY_MS)
  }, [clearHideTimer])

  const updateLayout = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.min(CARD_WIDTH, window.innerWidth - VIEWPORT_PADDING * 2)
    const top = Math.max(VIEWPORT_PADDING, Math.min(rect.bottom + TRIGGER_GAP, window.innerHeight - VIEWPORT_PADDING - 120))
    const maxHeight = Math.max(96, Math.min(CARD_MAX_HEIGHT, window.innerHeight - top - VIEWPORT_PADDING))
    const left = Math.max(VIEWPORT_PADDING, Math.min(rect.left, window.innerWidth - VIEWPORT_PADDING - width))
    setLayout((prev) => (prev.top === top && prev.left === left && prev.width === width && prev.maxHeight === maxHeight ? prev : { top, left, width, maxHeight }))
  }, [])

  const handleTriggerEnter = useCallback(() => {
    hoverStateRef.current.trigger = true
    clearHideTimer()
    if (!hasContent) return
    updateLayout()
    setShow(true)
  }, [clearHideTimer, hasContent, updateLayout])

  const handleTriggerClick = useCallback(() => {
    if (!hasContent) return
    clearHideTimer()
    updateLayout()
    setShow(true)
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus()
    })
  }, [clearHideTimer, hasContent, updateLayout])

  const handleTriggerLeave = (event: ReactMouseEvent<HTMLDivElement>) => {
    hoverStateRef.current.trigger = false
    if (event.relatedTarget instanceof Node && isWithinCardArea(event.relatedTarget)) return
    scheduleHide()
  }

  const handleCardEnter = () => {
    hoverStateRef.current.card = true
    clearHideTimer()
  }

  const handleCardLeave = (event: ReactMouseEvent<HTMLDivElement>) => {
    hoverStateRef.current.card = false
    if (event.relatedTarget instanceof Node && isWithinCardArea(event.relatedTarget)) return
    scheduleHide()
  }

  const openFile = useCallback(
    (relativePath: string) => {
      setShow(false)
      onOpenFile(relativePath)
    },
    [onOpenFile],
  )

  useEffect(() => {
    if (!show) {
      hoverStateRef.current = { trigger: false, card: false }
      return
    }
    if (!hasContent) {
      setShow(false)
    }
  }, [hasContent, show])

  // 关闭即清空搜索，下次展开回到收藏/最近视图。
  useEffect(() => {
    if (!show && searchQuery) setSearchQuery('')
  }, [searchQuery, show])

  useEffect(() => {
    if (!show) return

    const handleReposition = () => {
      updateLayout()
    }

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (isWithinCardArea(event.target)) return
      setShow(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShow(false)
    }

    window.addEventListener('resize', handleReposition)
    window.addEventListener('scroll', handleReposition, true)
    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('resize', handleReposition)
      window.removeEventListener('scroll', handleReposition, true)
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isWithinCardArea, show, updateLayout])

  useEffect(() => {
    return () => {
      clearHideTimer()
    }
  }, [clearHideTimer])

  return (
    <div ref={triggerRef} className="relative inline-flex" onMouseEnter={handleTriggerEnter} onMouseLeave={handleTriggerLeave} onClick={handleTriggerClick}>
      {children}
      {show
        ? createPortal(
            <div
              ref={cardRef}
              className="fixed flex flex-col overflow-hidden rounded-[16px]"
              style={{
                top: layout.top,
                left: layout.left,
                width: layout.width,
                maxHeight: layout.maxHeight,
                zIndex: 9999,
                background: 'var(--color-popover)',
                border: '1px solid var(--color-border)',
                boxShadow: 'var(--shadow-popover)',
                backdropFilter: 'saturate(145%) blur(14px)',
                WebkitBackdropFilter: 'saturate(145%) blur(14px)',
              }}
              aria-label={t('codeWorkspace.quickFileDrawer')}
              onMouseEnter={handleCardEnter}
              onMouseLeave={handleCardLeave}
              onPointerDown={(event) => {
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
              }}
            >
              <div className="flex shrink-0 items-center gap-2 px-3 py-2">
                <Search className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
                <DebouncedSearchInput
                  inputRef={searchInputRef}
                  leadingIcon={null}
                  placeholder={t('codeWorkspace.fileDrawerSearchPlaceholder')}
                  inputClassName="w-full bg-transparent text-[12px] text-[color:var(--color-foreground)] outline-none placeholder:text-[color:var(--color-muted-foreground)]"
                  debounceMs={80}
                  onQueryChange={setSearchQuery}
                />
              </div>
              <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-1.5 pb-1.5" style={{ overscrollBehavior: 'contain' }}>
                {searchQuery.trim() ? (
                  <QuickCardSection
                    title={t('codeWorkspace.searchResults')}
                    icon={<Search className="h-3.5 w-3.5" />}
                    emptyText={t('codeWorkspace.noMatchingDrawerFiles')}
                    paths={matchingFilePaths}
                    activeRelativePath={activeRelativePath}
                    favoriteSet={favoriteSet}
                    onOpenFile={openFile}
                    onToggleFavorite={onToggleFavorite}
                    onRemovePath={onRemovePath}
                  />
                ) : (
                  <div className="grid min-w-0 gap-1.5">
                    <QuickCardSection
                      title={t('codeWorkspace.favorites')}
                      icon={<Star className="h-3.5 w-3.5" />}
                      emptyText={t('codeWorkspace.noFavoritesYet')}
                      paths={favorites}
                      activeRelativePath={activeRelativePath}
                      favoriteSet={favoriteSet}
                      onOpenFile={openFile}
                      onToggleFavorite={onToggleFavorite}
                      onRemovePath={onRemovePath}
                    />
                    <QuickCardSection
                      title={t('codeWorkspace.recent')}
                      icon={<Clock3 className="h-3.5 w-3.5" />}
                      emptyText={t('codeWorkspace.noRecentFilesYet')}
                      paths={recents}
                      activeRelativePath={activeRelativePath}
                      favoriteSet={favoriteSet}
                      onOpenFile={openFile}
                      onToggleFavorite={onToggleFavorite}
                      onRemovePath={onRemovePath}
                    />
                  </div>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

export const CodeFileQuickCard = memo(CodeFileQuickCardInner)
