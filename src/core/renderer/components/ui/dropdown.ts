import * as React from 'react'

export type DropdownAlign = 'start' | 'end'

export interface DropdownLayout {
  top: number
  left: number
  width: number
  maxHeight: number
}

interface UseDropdownLayerOptions {
  open: boolean
  onClose: () => void
  triggerRef: React.RefObject<HTMLElement | null>
  contentRef: React.RefObject<HTMLElement | null>
  preferredMaxHeight?: number
  minWidth?: number
  gap?: number
  align?: DropdownAlign
  matchTriggerWidth?: boolean
}

const VIEWPORT_PADDING = 12
const MIN_DROPDOWN_HEIGHT = 48

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

function isWithinLayer(target: EventTarget | null, triggerRef: React.RefObject<HTMLElement | null>, contentRef: React.RefObject<HTMLElement | null>): boolean {
  return target instanceof Node && Boolean(triggerRef.current?.contains(target) || contentRef.current?.contains(target))
}

export function resolveDropdownFallbackRect(triggerRef: React.RefObject<HTMLElement | null>, gap = 8): DropdownLayout {
  const rect = triggerRef.current?.getBoundingClientRect()
  return {
    top: rect ? rect.bottom + gap : 0,
    left: rect?.left ?? 0,
    width: rect?.width ?? 0,
    maxHeight: 240,
  }
}

export const dropdownSurfaceClassName = 'app-no-drag fixed z-[10010] overflow-hidden rounded-[18px] border border-[color:var(--color-border)] bg-[color:var(--color-popover)]/96 p-1.5 text-[color:var(--color-popover-foreground)] shadow-[var(--shadow-popover)] backdrop-blur-[22px]'

export const dropdownSurfaceStyle = {
  WebkitBackdropFilter: 'saturate(170%) blur(22px)',
} satisfies React.CSSProperties

export function useDropdownLayer({ open, onClose, triggerRef, contentRef, preferredMaxHeight = 240, minWidth = 0, gap = 8, align = 'start', matchTriggerWidth = true }: UseDropdownLayerOptions) {
  const [layout, setLayout] = React.useState<DropdownLayout | null>(null)

  const updateLayout = React.useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return

    const triggerRect = trigger.getBoundingClientRect()
    const contentRect = contentRef.current?.getBoundingClientRect()
    const contentHeight = contentRect?.height ?? preferredMaxHeight
    const contentWidth = contentRect?.width ?? triggerRect.width
    const width = Math.max(minWidth, matchTriggerWidth ? triggerRect.width : Math.max(triggerRect.width, contentWidth))

    const availableBelow = window.innerHeight - triggerRect.bottom - gap - VIEWPORT_PADDING
    const availableAbove = triggerRect.top - gap - VIEWPORT_PADDING
    const shouldOpenUpward = availableBelow < Math.min(140, contentHeight) && availableAbove > availableBelow
    const availableHeight = shouldOpenUpward ? availableAbove : availableBelow
    const maxHeight = Math.max(MIN_DROPDOWN_HEIGHT, Math.min(preferredMaxHeight, Math.max(availableHeight, MIN_DROPDOWN_HEIGHT)))
    const renderedHeight = Math.min(contentHeight, maxHeight)
    const unclampedLeft = align === 'end' ? triggerRect.right - width : triggerRect.left
    const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - VIEWPORT_PADDING - width)
    const left = clamp(unclampedLeft, VIEWPORT_PADDING, maxLeft)
    const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - VIEWPORT_PADDING - renderedHeight)
    const top = clamp(shouldOpenUpward ? triggerRect.top - gap - renderedHeight : triggerRect.bottom + gap, VIEWPORT_PADDING, maxTop)

    setLayout((previous) => {
      if (previous && previous.top === top && previous.left === left && previous.width === width && previous.maxHeight === maxHeight) {
        return previous
      }

      return { top, left, width, maxHeight }
    })
  }, [align, contentRef, gap, matchTriggerWidth, minWidth, preferredMaxHeight, triggerRef])

  React.useLayoutEffect(() => {
    if (!open) {
      setLayout(null)
      return
    }

    updateLayout()
    const frame = window.requestAnimationFrame(() => {
      updateLayout()
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [open, updateLayout])

  React.useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!isWithinLayer(event.target, triggerRef, contentRef)) onClose()
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    const handleFocusIn = (event: FocusEvent) => {
      if (!isWithinLayer(event.target, triggerRef, contentRef)) onClose()
    }

    const handleLayout = () => {
      updateLayout()
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    window.addEventListener('focusin', handleFocusIn)
    window.addEventListener('resize', handleLayout)
    window.addEventListener('scroll', handleLayout, true)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
      window.removeEventListener('focusin', handleFocusIn)
      window.removeEventListener('resize', handleLayout)
      window.removeEventListener('scroll', handleLayout, true)
    }
  }, [contentRef, onClose, open, triggerRef, updateLayout])

  React.useEffect(() => {
    if (!open) return
    if (!triggerRef.current) return
    if (!contentRef.current) return
    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      updateLayout()
    })

    observer.observe(triggerRef.current)
    observer.observe(contentRef.current)
    return () => {
      observer.disconnect()
    }
  }, [contentRef, open, triggerRef, updateLayout])

  return {
    layout,
    updateLayout,
  }
}
