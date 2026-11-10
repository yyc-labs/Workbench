import { ChevronRight } from 'lucide-react'
import { type CSSProperties, type ReactNode, type Ref, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Tooltip } from './tooltip'

export type ContextCascaderItem = {
  id: string
  label: string
  description?: string
  icon?: ReactNode
  disabled?: boolean
  count?: string
  /** opt-in：onSelect 后不关闭菜单（「再点一次确认」类两段交互的第一段）。 */
  keepOpenOnSelect?: boolean
  /** opt-in：危险确认态着色（文字/图标转 destructive），配合 keepOpenOnSelect 的第二段展示。 */
  danger?: boolean
  tablePicker?: {
    maxRows: number
    maxColumns: number
    selectionSummary: (rows: number, columns: number) => string
    cellLabel: (rows: number, columns: number) => string
    onSelect: (rows: number, columns: number) => void | Promise<void>
  }
  children?: ContextCascaderItem[]
  /**
   * 自定义二级面板（仅 grouped 布局生效，opt-in）：点击该项时在相邻位置展开调用方提供的内容
   * （如命名输入框），不触发 onSelect、不关闭菜单；item 同时带 children 时以 children 优先。
   * 面板内部需自行处理 pointerdown/click 冒泡（ContextCascader 的外层 overlay 点击即关闭）。
   */
  panel?: ReactNode
  onSelect?: () => void | Promise<void>
}

export type ContextCascaderSection = {
  id: string
  label: string
  description?: string
  items: ContextCascaderItem[]
}

export type ContextCascaderLayout = 'cascader' | 'grouped'

export type ContextCascaderProps = {
  x: number
  y: number
  title?: string
  /** 标题徽标的悬浮卡片内容（如多选场景的所选文件列表）；不传则徽标无悬浮行为。 */
  titleHoverCard?: ReactNode
  sections: ContextCascaderSection[]
  /** cascader：两列级联（默认，既有行为）；grouped：单列分组标题，items 平铺在各自 section 标题下。 */
  layout?: ContextCascaderLayout
  /**
   * opt-in：跳过 360px 保守钳制（小卡片被按 PANEL_MAX_HEIGHT 预留会远离锚点），按面板渲染后的
   * 实际高度排布。y 语义变为「锚点顶边」：面板整体置于 y 上方 PANEL_GAP 处；上方放不下时钳回视口内。
   */
  fitHeight?: boolean
  onClose: () => void
}

const PANEL_WIDTH = 240
const PANEL_GAP = 8
const PANEL_MAX_HEIGHT = 360

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function getRootPanelPosition(x: number, y: number) {
  const left = clamp(x, 8, Math.max(8, window.innerWidth - PANEL_WIDTH - 8))
  const top = clamp(y, 8, Math.max(8, window.innerHeight - PANEL_MAX_HEIGHT - 8))
  return { left, top }
}

function getAdjacentPanelPosition(anchor: { left: number; top: number }, preferredDirection: 'left' | 'right') {
  const rightLeft = anchor.left + PANEL_WIDTH + PANEL_GAP
  const leftLeft = anchor.left - PANEL_WIDTH - PANEL_GAP
  const rightFits = rightLeft + PANEL_WIDTH <= window.innerWidth - 8
  const leftFits = leftLeft >= 8
  const direction: 'left' | 'right' = rightFits || (!leftFits && preferredDirection === 'right') ? 'right' : 'left'
  return {
    left: clamp(direction === 'right' ? rightLeft : leftLeft, 8, Math.max(8, window.innerWidth - PANEL_WIDTH - 8)),
    top: clamp(anchor.top, 8, Math.max(8, window.innerHeight - PANEL_MAX_HEIGHT - 8)),
    direction,
  }
}

const PANEL_SURFACE_CLASS = 'fixed z-[10000] pointer-events-auto overflow-hidden rounded-[16px] border border-[color:var(--color-border)] bg-[color:var(--color-popover)]/98 p-1.5 text-[color:var(--color-popover-foreground)] shadow-[var(--shadow-popover)] backdrop-blur-[18px]'

const PANEL_SURFACE_STYLE: CSSProperties = {
  width: PANEL_WIDTH,
  maxHeight: PANEL_MAX_HEIGHT,
  WebkitBackdropFilter: 'saturate(170%) blur(18px)',
}

function CascaderPanel({ left, top, items, activeItemId, panelRef, onHoverItem, onSelectItem }: { left: number; top: number; items: ContextCascaderItem[]; activeItemId: string | null; panelRef?: Ref<HTMLDivElement>; onHoverItem: (item: ContextCascaderItem) => void; onSelectItem: (item: ContextCascaderItem) => void }) {
  const tablePickerItem = items.length === 1 ? (items[0] ?? null) : null
  const tablePicker = tablePickerItem?.tablePicker
  const [hoverRows, setHoverRows] = useState(Math.min(3, tablePicker?.maxRows ?? 3))
  const [hoverColumns, setHoverColumns] = useState(Math.min(3, tablePicker?.maxColumns ?? 3))

  return (
    <div
      ref={panelRef}
      className={PANEL_SURFACE_CLASS}
      style={{
        left,
        top,
        ...PANEL_SURFACE_STYLE,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {tablePicker ? (
        <div className="p-2">
          <div className="px-1 pb-2 text-[11px] text-[color:var(--color-muted-foreground)]">{tablePicker.selectionSummary(hoverRows, hoverColumns)}</div>
          <div className="grid grid-cols-6 gap-1.5">
            {Array.from({ length: tablePicker.maxRows * tablePicker.maxColumns }, (_, index) => {
              const rows = Math.floor(index / tablePicker.maxColumns) + 1
              const columns = (index % tablePicker.maxColumns) + 1
              const active = rows <= hoverRows && columns <= hoverColumns
              const label = tablePicker.cellLabel(rows, columns)
              return (
                <button
                  key={`${rows}-${columns}`}
                  type="button"
                  className={['h-8 rounded-[8px] border transition-colors', active ? 'border-[color:var(--color-primary)] bg-[color:var(--color-primary)]/18' : 'border-[color:var(--color-border)] bg-[color:var(--color-card)] hover:bg-[color:var(--color-accent)]'].join(' ')}
                  aria-label={label}
                  title={label}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => {
                    setHoverRows(rows)
                    setHoverColumns(columns)
                  }}
                  onFocus={() => {
                    setHoverRows(rows)
                    setHoverColumns(columns)
                  }}
                  onClick={async () => {
                    await tablePicker.onSelect(rows, columns)
                    if (tablePickerItem) onSelectItem(tablePickerItem)
                  }}
                />
              )
            })}
          </div>
        </div>
      ) : (
        <div className="max-h-[344px] overflow-auto">
          {items.map((item) => {
            const active = activeItemId === item.id
            const hasChildren = Boolean(item.children?.length)
            const className = ['group flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left transition-colors', active ? 'bg-[color:var(--color-primary)]/12' : 'hover:bg-[color:var(--color-accent)]', item.disabled ? 'cursor-not-allowed opacity-45' : ''].filter(Boolean).join(' ')
            return (
              <button key={item.id} type="button" disabled={item.disabled} className={className} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => onHoverItem(item)} onFocus={() => onHoverItem(item)} onClick={() => onSelectItem(item)}>
                {item.icon ? (
                  <span
                    className={
                      active
                        ? 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-primary)]/14 text-[color:var(--color-primary)]'
                        : 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-accent)] text-[color:var(--color-muted-foreground)] group-hover:text-[color:var(--color-foreground)]'
                    }
                  >
                    {item.icon}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-[color:var(--color-foreground)]">{item.label}</span>
                  {item.description ? <span className="block text-[11px] text-[color:var(--color-muted-foreground)]">{item.description}</span> : null}
                </span>
                {item.count ? <span className="text-[10px] text-[color:var(--color-muted-foreground)]">{item.count}</span> : null}
                {hasChildren ? <ChevronRight className={active ? 'h-4 w-4 shrink-0 text-[color:var(--color-primary)]' : 'h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]'} /> : null}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function GroupedItemRow({ item, onHoverItem, onSelectItem }: { item: ContextCascaderItem; onHoverItem: (item: ContextCascaderItem) => void; onSelectItem: (item: ContextCascaderItem) => void }) {
  const hasChildren = Boolean(item.children?.length) || Boolean(item.panel)
  return (
    <button
      type="button"
      disabled={item.disabled}
      className="group flex w-full items-center gap-2.5 rounded-[10px] px-3 py-1.5 text-left transition-colors hover:bg-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-45"
      data-cascader-row-id={item.id}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={() => onHoverItem(item)}
      onFocus={() => onHoverItem(item)}
      onClick={() => onSelectItem(item)}
    >
      {item.icon ? (
        <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[color:var(--color-muted-foreground)] group-hover:text-[color:var(--color-foreground)]" style={item.danger ? { color: 'var(--color-destructive)' } : undefined}>
          {item.icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-[12px] text-[color:var(--color-foreground)]" style={item.danger ? { color: 'var(--color-destructive)', fontWeight: 500 } : undefined}>
        {item.label}
      </span>
      {item.count ? <span className="text-[10px] text-[color:var(--color-muted-foreground)]">{item.count}</span> : null}
      {hasChildren ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" /> : null}
    </button>
  )
}

/** grouped 模式根面板：单列，section 渲染为不可点的分组小标题，组间以分隔线区隔，组内 items 平铺。 */
function GroupedRootPanel({ left, top, sections, containerRef, onHoverItem, onSelectItem }: { left: number; top: number; sections: ContextCascaderSection[]; containerRef?: Ref<HTMLDivElement>; onHoverItem: (item: ContextCascaderItem) => void; onSelectItem: (item: ContextCascaderItem) => void }) {
  return (
    <div
      ref={containerRef}
      className={PANEL_SURFACE_CLASS}
      style={{
        left,
        top,
        ...PANEL_SURFACE_STYLE,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="max-h-[344px] overflow-auto">
        {sections.map((section, sectionIndex) => (
          <div key={section.id} className={sectionIndex > 0 ? 'mt-1.5 border-t border-[color:var(--color-border)] pt-1.5' : undefined}>
            <div className="px-3 pb-1 pt-1 text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">{section.label}</div>
            {section.items.map((item) => (
              <GroupedItemRow key={item.id} item={item} onHoverItem={onHoverItem} onSelectItem={onSelectItem} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/** 菜单标题徽标：fixed 定位于指针上方；传入 hoverCard 时悬浮展开（锚点用徽标自身，绕开零尺寸触发器包裹层）。 */
function TitleBadge({ title, hoverCard, left, top }: { title: string; hoverCard?: ReactNode; left: number; top: number }) {
  const badgeRef = useRef<HTMLDivElement | null>(null)

  return (
    <Tooltip anchorRef={badgeRef} interactive side="top" align="start" maxWidth={360} content={hoverCard}>
      <div
        ref={badgeRef}
        className="fixed z-[10001] pointer-events-auto rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-popover)]/98 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)] shadow-[var(--shadow-popover)]"
        style={{ left, top }}
      >
        {title}
      </div>
    </Tooltip>
  )
}

export function ContextCascader({ x, y, title, titleHoverCard, sections, layout = 'cascader', fitHeight = false, onClose }: ContextCascaderProps) {
  const [activeSectionId, setActiveSectionId] = useState(sections[0]?.id ?? '')
  const [activeBranch, setActiveBranch] = useState<string[]>([])
  const activeSection = useMemo(() => sections.find((section) => section.id === activeSectionId) ?? sections[0] ?? null, [activeSectionId, sections])
  const activeRootItems = activeSection?.items ?? []
  const activeRootItem = activeRootItems.find((item) => item.id === activeBranch[0]) ?? activeRootItems[0] ?? null
  const activeChildItems = activeRootItem?.children ?? []
  const activeChildItem = activeChildItems.find((item) => item.id === activeBranch[1]) ?? activeChildItems[0] ?? null
  const activeGrandChildItems = activeChildItem?.children ?? []

  // grouped 模式下 branch 链路跨 section 查找（根面板 items 平铺，不属于某个激活 section）。
  const groupedRootItems = useMemo(() => sections.flatMap((section) => section.items), [sections])
  const groupedRootItem = activeBranch[0] ? (groupedRootItems.find((item) => item.id === activeBranch[0]) ?? null) : null
  const groupedChildItems = groupedRootItem?.children ?? []
  const groupedChildItem = activeBranch[1] ? (groupedChildItems.find((item) => item.id === activeBranch[1]) ?? null) : null
  const groupedGrandChildItems = groupedChildItem?.children ?? []

  const rootPosition = useMemo(() => getRootPanelPosition(x, y), [x, y])
  const branchPosition = useMemo(() => getAdjacentPanelPosition(rootPosition, 'right'), [rootPosition])

  // grouped 布局二级面板定位：面板中心对齐触发行中心（用户 2026-10-22 反馈）——
  // useLayoutEffect 在绘制前同步（首帧即正确，无闪跳）：量取根面板内对应行的中心，
  // 与已渲染二级面板的高度求差；钳制保证面板完整落在视口内；量取失败回退根面板顶。
  const groupedRootPanelRef = useRef<HTMLDivElement>(null)
  const branchPanelRef = useRef<HTMLDivElement>(null)
  const [branchPanelTop, setBranchPanelTop] = useState<number | null>(null)
  // fitHeight：量取渲染后的实际高度，把面板贴到锚点（y）上方 PANEL_GAP 处；首帧沿用保守钳制，
  // layout effect 在绘制前校正（无闪跳）。上方放不下整卡时钳回视口顶部。
  const [fittedTop, setFittedTop] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (!fitHeight) {
      setFittedTop(null)
      return
    }
    const height = groupedRootPanelRef.current?.offsetHeight
    if (!height) return
    setFittedTop(clamp(y - height - PANEL_GAP, 8, Math.max(8, window.innerHeight - height - 8)))
  }, [fitHeight, y, sections])
  useLayoutEffect(() => {
    if (layout !== 'grouped' || !activeBranch[0]) {
      setBranchPanelTop(null)
      return
    }
    const container = groupedRootPanelRef.current
    const row = container?.querySelector<HTMLElement>(`[data-cascader-row-id="${CSS.escape(activeBranch[0])}"]`)
    if (!row) return
    const rowRect = row.getBoundingClientRect()
    const panelHeight = branchPanelRef.current?.offsetHeight || PANEL_MAX_HEIGHT
    const centeredTop = rowRect.top + rowRect.height / 2 - panelHeight / 2
    setBranchPanelTop(clamp(centeredTop, 8, Math.max(8, window.innerHeight - panelHeight - 8)))
  }, [activeBranch, layout, sections])
  const grandChildPosition = useMemo(() => getAdjacentPanelPosition(branchPosition, branchPosition.direction), [branchPosition])
  const greatGrandChildPosition = useMemo(() => getAdjacentPanelPosition(grandChildPosition, grandChildPosition.direction), [grandChildPosition])

  useLayoutEffect(() => {
    if (layout !== 'cascader') return
    if (!activeSection) return
    if (!activeBranch[0]) setActiveBranch([activeSection.items[0]?.id ?? ''])
  }, [activeBranch, activeSection, layout])

  // Escape 关闭：与 CodeTreeContextMenu 原有关闭语义一致。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // grouped：外部 pointerdown 关闭卡片但不拦截该次点击——overlay 已 pointer-events-none，
  // 事件自然落到下层元素（左键触发按钮 / 右键先关卡片再开新菜单）。面板内部 pointerdown
  // 已 stopPropagation，不会冒泡到 document，不会误关。不监听 scroll（见上）。
  const groupedOverlayActive = layout === 'grouped'
  useEffect(() => {
    if (!groupedOverlayActive) return
    const onDocPointerDown = () => onClose()
    document.addEventListener('pointerdown', onDocPointerDown)
    return () => document.removeEventListener('pointerdown', onDocPointerDown)
  }, [groupedOverlayActive, onClose])

  // 注意：不监听滚动关闭。菜单为 fixed 定位、不随内容移动（与主流编辑器一致）；
  // 且分组菜单条目多时面板内部可滚动（max-h 344 + overflow-auto），
  // 若监听 scroll（即使排除内部滚动）会与用户浏览菜单的滚动冲突导致误关。

  const selectBranchItem = async (item: ContextCascaderItem, branch: string[]) => {
    if (item.disabled) return
    if (item.children?.length || item.panel) {
      setActiveBranch(branch)
      return
    }
    await item.onSelect?.()
    if (!item.keepOpenOnSelect) onClose()
  }

  if (layout === 'grouped') {
    // 卡片不拦截外部操作：overlay 只做 DOM 标记（pointer-events-none），外部点击直接落到下层元素；
    // 关闭由下方 document 级 pointerdown 监听负责，面板内部 pointerdown 已 stopPropagation 不会误关。
    return createPortal(
      <div className="fixed inset-0 z-[9999] pointer-events-none" data-context-cascader-overlay="">
        {title ? <TitleBadge title={title} hoverCard={titleHoverCard} left={rootPosition.left} top={Math.max(8, rootPosition.top - 28)} /> : null}
        <GroupedRootPanel
          left={rootPosition.left}
          top={fittedTop ?? rootPosition.top}
          sections={sections}
          containerRef={groupedRootPanelRef}
          onHoverItem={(item) => {
            setActiveBranch(item.children?.length || item.panel ? [item.id] : [])
          }}
          onSelectItem={(item) => {
            void selectBranchItem(item, [item.id])
          }}
        />
        {groupedRootItem?.children?.length ? (
          <CascaderPanel
            left={branchPosition.left}
            top={branchPanelTop ?? branchPosition.top}
            items={groupedChildItems}
            activeItemId={groupedChildItem?.id ?? null}
            panelRef={branchPanelRef}
            onHoverItem={(item) => setActiveBranch([groupedRootItem.id, item.id])}
            onSelectItem={(item) => {
              void selectBranchItem(item, [groupedRootItem.id, item.id])
            }}
          />
        ) : groupedRootItem?.panel ? (
          <div
            ref={branchPanelRef}
            className={PANEL_SURFACE_CLASS}
            style={{
              left: branchPosition.left,
              top: branchPanelTop ?? branchPosition.top,
              ...PANEL_SURFACE_STYLE,
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            {groupedRootItem.panel}
          </div>
        ) : null}
        {groupedChildItem?.children?.length ? (
          <CascaderPanel
            left={grandChildPosition.left}
            top={grandChildPosition.top}
            items={groupedGrandChildItems}
            activeItemId={null}
            onHoverItem={() => undefined}
            onSelectItem={(item) => {
              void selectBranchItem(item, [])
            }}
          />
        ) : null}
      </div>,
      document.body,
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999]" data-context-cascader-overlay="" onPointerDown={onClose} onContextMenu={onClose}>
      {title ? <TitleBadge title={title} hoverCard={titleHoverCard} left={rootPosition.left} top={Math.max(8, rootPosition.top - 28)} /> : null}
      <CascaderPanel
        left={rootPosition.left}
        top={rootPosition.top}
        items={sections.map((section) => ({
          id: section.id,
          label: section.label,
          description: section.description,
          children: section.items,
        }))}
        activeItemId={activeSection?.id ?? null}
        onHoverItem={(item) => {
          setActiveSectionId(item.id)
          setActiveBranch([])
        }}
        onSelectItem={(item) => {
          setActiveSectionId(item.id)
          setActiveBranch([])
        }}
      />
      {activeSection ? (
        <CascaderPanel
          left={branchPosition.left}
          top={branchPosition.top}
          items={activeRootItems}
          activeItemId={activeRootItem?.id ?? null}
          onHoverItem={(item) => setActiveBranch([item.id])}
          onSelectItem={async (item) => {
            if (item.disabled) return
            if (item.children?.length) {
              setActiveBranch([item.id])
              return
            }
            await item.onSelect?.()
            onClose()
          }}
        />
      ) : null}
      {activeRootItem?.children?.length ? (
        <CascaderPanel
          left={grandChildPosition.left}
          top={grandChildPosition.top}
          items={activeChildItems}
          activeItemId={activeChildItem?.id ?? null}
          onHoverItem={(item) => setActiveBranch([activeRootItem.id, item.id])}
          onSelectItem={async (item) => {
            if (item.disabled) return
            if (item.children?.length) {
              setActiveBranch([activeRootItem.id, item.id])
              return
            }
            await item.onSelect?.()
            onClose()
          }}
        />
      ) : null}
      {activeChildItem?.children?.length ? (
        <CascaderPanel
          left={greatGrandChildPosition.left}
          top={greatGrandChildPosition.top}
          items={activeGrandChildItems}
          activeItemId={null}
          onHoverItem={() => undefined}
          onSelectItem={async (item) => {
            if (item.disabled) return
            await item.onSelect?.()
            onClose()
          }}
        />
      ) : null}
    </div>,
    document.body,
  )
}
