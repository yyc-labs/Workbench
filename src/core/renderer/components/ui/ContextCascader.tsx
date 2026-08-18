import { useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight } from 'lucide-react'

export type ContextCascaderItem = {
  id: string
  label: string
  description?: string
  icon?: ReactNode
  disabled?: boolean
  count?: string
  tablePicker?: {
    maxRows: number
    maxColumns: number
    selectionSummary: (rows: number, columns: number) => string
    cellLabel: (rows: number, columns: number) => string
    onSelect: (rows: number, columns: number) => void | Promise<void>
  }
  children?: ContextCascaderItem[]
  onSelect?: () => void | Promise<void>
}

export type ContextCascaderSection = {
  id: string
  label: string
  description?: string
  items: ContextCascaderItem[]
}

export type ContextCascaderProps = {
  x: number
  y: number
  title?: string
  sections: ContextCascaderSection[]
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

function CascaderPanel({ left, top, items, activeItemId, onHoverItem, onSelectItem }: { left: number; top: number; items: ContextCascaderItem[]; activeItemId: string | null; onHoverItem: (item: ContextCascaderItem) => void; onSelectItem: (item: ContextCascaderItem) => void }) {
  const tablePickerItem = items.length === 1 ? (items[0] ?? null) : null
  const tablePicker = tablePickerItem?.tablePicker
  const [hoverRows, setHoverRows] = useState(Math.min(3, tablePicker?.maxRows ?? 3))
  const [hoverColumns, setHoverColumns] = useState(Math.min(3, tablePicker?.maxColumns ?? 3))

  return (
    <div
      className="fixed z-[10000] overflow-hidden rounded-[16px] border border-[color:var(--color-border)] bg-[color:var(--color-popover)]/98 p-1.5 text-[color:var(--color-popover-foreground)] shadow-[var(--shadow-popover)] backdrop-blur-[18px]"
      style={{
        left,
        top,
        width: PANEL_WIDTH,
        maxHeight: PANEL_MAX_HEIGHT,
        WebkitBackdropFilter: 'saturate(170%) blur(18px)',
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

export function ContextCascader({ x, y, title, sections, onClose }: ContextCascaderProps) {
  const [activeSectionId, setActiveSectionId] = useState(sections[0]?.id ?? '')
  const [activeBranch, setActiveBranch] = useState<string[]>([])
  const activeSection = useMemo(() => sections.find((section) => section.id === activeSectionId) ?? sections[0] ?? null, [activeSectionId, sections])
  const activeRootItems = activeSection?.items ?? []
  const activeRootItem = activeRootItems.find((item) => item.id === activeBranch[0]) ?? activeRootItems[0] ?? null
  const activeChildItems = activeRootItem?.children ?? []
  const activeChildItem = activeChildItems.find((item) => item.id === activeBranch[1]) ?? activeChildItems[0] ?? null
  const activeGrandChildItems = activeChildItem?.children ?? []

  const rootPosition = useMemo(() => getRootPanelPosition(x, y), [x, y])
  const branchPosition = useMemo(() => getAdjacentPanelPosition(rootPosition, 'right'), [rootPosition])
  const grandChildPosition = useMemo(() => getAdjacentPanelPosition(branchPosition, branchPosition.direction), [branchPosition])
  const greatGrandChildPosition = useMemo(() => getAdjacentPanelPosition(grandChildPosition, grandChildPosition.direction), [grandChildPosition])

  useLayoutEffect(() => {
    if (!activeSection) return
    if (!activeBranch[0]) setActiveBranch([activeSection.items[0]?.id ?? ''])
  }, [activeBranch, activeSection])

  return createPortal(
    <div className="fixed inset-0 z-[9999]" onPointerDown={onClose} onContextMenu={onClose}>
      {title ? (
        <div
          className="fixed z-[10001] rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-popover)]/98 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)] shadow-[var(--shadow-popover)]"
          style={{ left: rootPosition.left, top: Math.max(8, rootPosition.top - 28) }}
        >
          {title}
        </div>
      ) : null}
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
