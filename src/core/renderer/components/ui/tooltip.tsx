import * as React from "react"
import { createPortal } from "react-dom"

import { cn } from "@/lib/utils"

type TooltipSide = "top" | "bottom"
type TooltipAlign = "start" | "center" | "end"

const VIEWPORT_PADDING = 8

interface TooltipPosition {
  top: number
  left: number
  side: TooltipSide
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

function resolveAlignedLeft(
  triggerRect: DOMRect,
  tooltipRect: DOMRect,
  align: TooltipAlign
): number {
  if (align === "start") return triggerRect.left
  if (align === "end") return triggerRect.right - tooltipRect.width
  return triggerRect.left + (triggerRect.width - tooltipRect.width) / 2
}

function resolveTooltipPosition(
  triggerRect: DOMRect,
  tooltipRect: DOMRect,
  side: TooltipSide,
  align: TooltipAlign,
  offset: number
): TooltipPosition {
  let resolvedSide = side
  let top = side === "top"
    ? triggerRect.top - tooltipRect.height - offset
    : triggerRect.bottom + offset

  const overTop = top < VIEWPORT_PADDING
  const overBottom = top + tooltipRect.height > window.innerHeight - VIEWPORT_PADDING

  if (resolvedSide === "top" && overTop) {
    resolvedSide = "bottom"
    top = triggerRect.bottom + offset
  } else if (resolvedSide === "bottom" && overBottom) {
    resolvedSide = "top"
    top = triggerRect.top - tooltipRect.height - offset
  }

  const unclampedLeft = resolveAlignedLeft(triggerRect, tooltipRect, align)
  const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - tooltipRect.width - VIEWPORT_PADDING)
  const left = clamp(unclampedLeft, VIEWPORT_PADDING, maxLeft)
  const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - tooltipRect.height - VIEWPORT_PADDING)

  return {
    top: clamp(top, VIEWPORT_PADDING, maxTop),
    left,
    side: resolvedSide,
  }
}

function hasRenderableContent(content: React.ReactNode): boolean {
  if (content === null || content === undefined || content === false) return false
  if (typeof content === "string") return content.trim().length > 0
  return true
}

export interface TooltipProps {
  content: React.ReactNode
  children: React.ReactNode
  disabled?: boolean
  side?: TooltipSide
  align?: TooltipAlign
  offset?: number
  delayMs?: number
  hideDelayMs?: number
  maxWidth?: number
  className?: string
  contentClassName?: string
}

export function Tooltip({
  content,
  children,
  disabled = false,
  side = "top",
  align = "center",
  offset = 8,
  delayMs = 180,
  hideDelayMs = 90,
  maxWidth = 460,
  className,
  contentClassName,
}: TooltipProps) {
  const triggerRef = React.useRef<HTMLSpanElement | null>(null)
  const tooltipRef = React.useRef<HTMLDivElement | null>(null)
  const showTimerRef = React.useRef<number | null>(null)
  const hideTimerRef = React.useRef<number | null>(null)
  const [open, setOpen] = React.useState(false)
  const [position, setPosition] = React.useState<TooltipPosition | null>(null)
  const tooltipId = React.useId()
  const enabled = !disabled && hasRenderableContent(content)

  const clearShowTimer = React.useCallback(() => {
    if (showTimerRef.current == null) return
    window.clearTimeout(showTimerRef.current)
    showTimerRef.current = null
  }, [])

  const clearHideTimer = React.useCallback(() => {
    if (hideTimerRef.current == null) return
    window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = null
  }, [])

  const clearTimers = React.useCallback(() => {
    clearShowTimer()
    clearHideTimer()
  }, [clearHideTimer, clearShowTimer])

  const updatePosition = React.useCallback(() => {
    if (!triggerRef.current || !tooltipRef.current) return
    const triggerRect = triggerRef.current.getBoundingClientRect()
    const tooltipRect = tooltipRef.current.getBoundingClientRect()
    setPosition(resolveTooltipPosition(triggerRect, tooltipRect, side, align, offset))
  }, [align, offset, side])

  const requestOpen = React.useCallback(() => {
    if (!enabled) return
    clearHideTimer()
    if (open) return
    clearShowTimer()
    showTimerRef.current = window.setTimeout(() => {
      setOpen(true)
      showTimerRef.current = null
    }, delayMs)
  }, [clearHideTimer, clearShowTimer, delayMs, enabled, open])

  const requestClose = React.useCallback(() => {
    clearShowTimer()
    clearHideTimer()
    hideTimerRef.current = window.setTimeout(() => {
      setOpen(false)
      setPosition(null)
      hideTimerRef.current = null
    }, hideDelayMs)
  }, [clearHideTimer, clearShowTimer, hideDelayMs])

  React.useEffect(() => {
    if (enabled) return
    clearTimers()
    setOpen(false)
    setPosition(null)
  }, [clearTimers, enabled])

  React.useLayoutEffect(() => {
    if (!open) return
    updatePosition()
  }, [content, open, updatePosition])

  React.useEffect(() => {
    if (!open) return

    const handleLayout = () => {
      updatePosition()
    }

    window.addEventListener("resize", handleLayout)
    window.addEventListener("scroll", handleLayout, true)
    return () => {
      window.removeEventListener("resize", handleLayout)
      window.removeEventListener("scroll", handleLayout, true)
    }
  }, [open, updatePosition])

  React.useEffect(() => {
    if (!open) return
    if (!triggerRef.current) return
    if (!tooltipRef.current) return

    const triggerObserver = new ResizeObserver(() => {
      updatePosition()
    })
    const tooltipObserver = new ResizeObserver(() => {
      updatePosition()
    })

    triggerObserver.observe(triggerRef.current)
    tooltipObserver.observe(tooltipRef.current)
    return () => {
      triggerObserver.disconnect()
      tooltipObserver.disconnect()
    }
  }, [open, updatePosition])

  React.useEffect(() => {
    return () => {
      clearTimers()
    }
  }, [clearTimers])

  React.useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
        setPosition(null)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [open])

  const tooltip = open ? (
    <div
      ref={tooltipRef}
      id={tooltipId}
      role="tooltip"
      data-side={position?.side ?? side}
      className={cn("app-tooltip-content", contentClassName)}
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        maxWidth: `${maxWidth}px`,
      }}
      onMouseEnter={requestOpen}
      onMouseLeave={requestClose}
    >
      {content}
    </div>
  ) : null

  return (
    <span
      ref={triggerRef}
      className={cn("app-tooltip-trigger", className)}
      data-native-title-tooltip="true"
      aria-describedby={open ? tooltipId : undefined}
      onMouseEnter={requestOpen}
      onMouseLeave={requestClose}
      onFocusCapture={requestOpen}
      onBlurCapture={requestClose}
    >
      {children}
      {tooltip ? createPortal(tooltip, document.body) : null}
    </span>
  )
}
