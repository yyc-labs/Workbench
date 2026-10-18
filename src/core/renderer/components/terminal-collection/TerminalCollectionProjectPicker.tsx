import { Search } from 'lucide-react'
import { type KeyboardEvent as ReactKeyboardEvent, type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { matchProjectQuery, sortProjectsByRecency } from '../../../shared/terminals'
import { useI18n } from '../../i18n'
import { projectDisplayName } from '../../lib/projectDisplay'
import { useAppStore } from '../../stores/appStore'
import { dropdownSurfaceClassName, dropdownSurfaceStyle } from '../ui/dropdown'

type TerminalCollectionProjectPickerProps = {
  /** 加号按钮的视口 rect。 */
  anchor: { top: number; left: number; bottom: number }
  /** 加号按钮本身：其内部的 pointerdown 不由本浮层关闭（交给按钮的开关语义）。 */
  triggerRef?: RefObject<HTMLElement | null>
  onClose: () => void
}

const CARD_WIDTH = 320
const VIEWPORT_PADDING = 8
const CARD_GAP = 6
const PICKER_MAX_HEIGHT = 360

interface PickerLayout {
  top?: number
  bottom?: number
  left: number
  maxHeight: number
}

function resolveLayout(anchor: TerminalCollectionProjectPickerProps['anchor']): PickerLayout {
  const availableBelow = window.innerHeight - anchor.bottom - CARD_GAP - VIEWPORT_PADDING
  const availableAbove = anchor.top - CARD_GAP - VIEWPORT_PADDING
  // 下方放不下最小可用高度且上方更宽裕时上翻。
  const openUpward = availableBelow < 200 && availableAbove > availableBelow
  const maxHeight = Math.max(120, Math.min(PICKER_MAX_HEIGHT, openUpward ? availableAbove : availableBelow))
  const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - CARD_WIDTH - VIEWPORT_PADDING)
  return {
    ...(openUpward ? { bottom: window.innerHeight - anchor.top + CARD_GAP } : { top: anchor.bottom + CARD_GAP }),
    left: Math.min(Math.max(VIEWPORT_PADDING, anchor.left), maxLeft),
    maxHeight,
  }
}

/**
 * 集合面板 header 加号的项目选择卡片：按最近打开排序 + 搜索，
 * 选中即给该项目新建 `::float::` 终端加入跨项目集合（面板自动收录该项目 tab）。
 */
export function TerminalCollectionProjectPicker({ anchor, triggerRef, onClose }: TerminalCollectionProjectPickerProps) {
  const { t } = useI18n()
  const projects = useAppStore((s) => s.projects)
  const processes = useAppStore((s) => s.processes)
  const addCollectionTerminal = useAppStore((s) => s.addCollectionTerminal)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [layout, setLayout] = useState<PickerLayout>(() => resolveLayout(anchor))
  const cardRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const filteredProjects = useMemo(() => sortProjectsByRecency(projects).filter((project) => matchProjectQuery(project, query)), [projects, query])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useLayoutEffect(() => {
    const update = () => setLayout(resolveLayout(anchor))
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [anchor])

  // 外部 pointerdown 关闭；卡片内部与加号按钮的点击不关闭（按钮自身 toggle）。
  // 不监听 scroll：卡片内部滚动与页面滚动都不应关闭浮层。
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (cardRef.current?.contains(target)) return
      if (triggerRef?.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [onClose, triggerRef])

  // 键盘导航时把激活项滚入可视区。
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const active = list.querySelector<HTMLElement>('[data-active="true"]')
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const handleSelect = useCallback(
    (projectId: string, projectPath: string) => {
      void addCollectionTerminal(projectId, projectPath)
      onClose()
    },
    [addCollectionTerminal, onClose],
  )

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (filteredProjects.length === 0) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((current) => (current + 1) % filteredProjects.length)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((current) => (current - 1 + filteredProjects.length) % filteredProjects.length)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        const target = filteredProjects[activeIndex]
        if (target) handleSelect(target.id, target.path)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    },
    [activeIndex, filteredProjects, handleSelect, onClose],
  )

  const safeActiveIndex = filteredProjects.length > 0 ? Math.min(activeIndex, filteredProjects.length - 1) : -1

  return (
    <div
      ref={cardRef}
      className={`${dropdownSurfaceClassName} flex flex-col`}
      style={{ ...dropdownSurfaceStyle, ...layout, width: CARD_WIDTH }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="flex items-center gap-2 px-2 pb-1.5 pt-1">
        <Search className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
        <input
          ref={inputRef}
          className="min-w-0 flex-1 bg-transparent text-xs text-[color:var(--color-foreground)] outline-none placeholder:text-[color:var(--color-muted-foreground)]"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('terminalCollection.searchProjectsPlaceholder')}
          spellCheck={false}
        />
      </div>
      <div className="px-2 pb-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-[color:var(--color-muted-foreground)]">{t('terminalCollection.recentProjects')}</p>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1.5 pb-1.5">
        {filteredProjects.length === 0 ? (
          <p className="px-2 py-4 text-center text-[11px] text-[color:var(--color-muted-foreground)]">{projects.length === 0 ? t('terminalCollection.noProjectsHint') : t('terminalCollection.noProjectMatch')}</p>
        ) : (
          filteredProjects.map((project, index) => {
            const status = processes[project.id]?.status
            const running = status === 'running' || status === 'stopping'
            return (
              <button
                key={project.id}
                type="button"
                data-active={index === safeActiveIndex}
                className={`flex w-full min-w-0 items-start gap-2 rounded-[10px] px-2 py-1.5 text-left transition-colors ${index === safeActiveIndex ? 'bg-[color:var(--color-accent)]' : 'hover:bg-[color:var(--color-accent)]/50'}`}
                onClick={() => handleSelect(project.id, project.path)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${running ? 'bg-[color:var(--color-success)]' : 'bg-transparent'}`} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-xs font-medium text-[color:var(--color-foreground)]">{projectDisplayName(project)}</span>
                  <span className="truncate text-[10px] leading-4 text-[color:var(--color-muted-foreground)]" title={project.path}>
                    {project.path}
                  </span>
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
