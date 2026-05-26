import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

type TooltipSide = 'top' | 'bottom'

interface TooltipSnapshot {
  text: string
  top: number
  left: number
  side: TooltipSide
  anchorVersion: number
}

const VIEWPORT_PADDING = 8
const TITLE_CACHE_DATASET_KEY = 'globalTooltipOriginalTitle'
const HOVER_OPEN_DELAY_MS = 500

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

function readRenderableTitle(element: HTMLElement): string | null {
  const raw = element.getAttribute('title')
  if (typeof raw !== 'string') return null
  if (!raw.trim()) return null
  return raw
}

function findTitleTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const candidate = target.closest<HTMLElement>('[title]')
  if (!candidate) return null
  if (candidate.dataset.nativeTitleTooltip === 'true') return null
  return readRenderableTitle(candidate) ? candidate : null
}

function restoreElementTitle(element: HTMLElement | null) {
  if (!element) return
  const cached = element.dataset[TITLE_CACHE_DATASET_KEY]
  if (typeof cached !== 'string') return
  if (!element.hasAttribute('title')) {
    element.setAttribute('title', cached)
  }
  delete element.dataset[TITLE_CACHE_DATASET_KEY]
}

function cacheAndRemoveElementTitle(element: HTMLElement): string | null {
  const title = readRenderableTitle(element)
  if (!title) return null
  if (!element.dataset[TITLE_CACHE_DATASET_KEY]) {
    element.dataset[TITLE_CACHE_DATASET_KEY] = title
  }
  if (element.hasAttribute('title')) {
    element.removeAttribute('title')
  }
  return title
}

export function GlobalTitleTooltipBridge() {
  const activeTargetRef = useRef<HTMLElement | null>(null)
  const pendingTargetRef = useRef<HTMLElement | null>(null)
  const openTimerRef = useRef<number | null>(null)
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const [tooltip, setTooltip] = useState<TooltipSnapshot | null>(null)

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current == null) return
    window.clearTimeout(openTimerRef.current)
    openTimerRef.current = null
  }, [])

  const hideTooltip = useCallback(() => {
    clearOpenTimer()
    pendingTargetRef.current = null
    restoreElementTitle(activeTargetRef.current)
    activeTargetRef.current = null
    setTooltip(null)
  }, [clearOpenTimer])

  const updateTooltipPosition = useCallback(() => {
    const target = activeTargetRef.current
    const tooltipElement = tooltipRef.current
    if (!target || !tooltipElement) return

    const targetRect = target.getBoundingClientRect()
    const tooltipRect = tooltipElement.getBoundingClientRect()
    const preferredTop = targetRect.top - tooltipRect.height - 8
    const preferredBottom = targetRect.bottom + 8
    const shouldUseBottom = preferredTop < VIEWPORT_PADDING
      && preferredBottom + tooltipRect.height <= window.innerHeight - VIEWPORT_PADDING
    const side: TooltipSide = shouldUseBottom ? 'bottom' : 'top'
    const rawTop = side === 'bottom' ? preferredBottom : preferredTop
    const rawLeft = targetRect.left + (targetRect.width - tooltipRect.width) / 2

    const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - tooltipRect.width - VIEWPORT_PADDING)
    const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - tooltipRect.height - VIEWPORT_PADDING)
    const nextLeft = Math.round(clamp(rawLeft, VIEWPORT_PADDING, maxLeft))
    const nextTop = Math.round(clamp(rawTop, VIEWPORT_PADDING, maxTop))

    setTooltip((prev) => {
      if (!prev) return prev
      if (prev.top === nextTop && prev.left === nextLeft && prev.side === side) return prev
      return {
        ...prev,
        top: nextTop,
        left: nextLeft,
        side,
      }
    })
  }, [])

  const showTooltipForTarget = useCallback((target: HTMLElement) => {
    const title = cacheAndRemoveElementTitle(target) ?? target.dataset[TITLE_CACHE_DATASET_KEY] ?? null
    if (!title) return

    const previousTarget = activeTargetRef.current
    const targetChanged = previousTarget !== target
    if (previousTarget && targetChanged) restoreElementTitle(previousTarget)

    activeTargetRef.current = target
    setTooltip((prev) => {
      if (prev && !targetChanged && prev.text === title) return prev
      return {
        text: title,
        top: prev?.top ?? 0,
        left: prev?.left ?? 0,
        side: prev?.side ?? 'top',
        anchorVersion: (prev?.anchorVersion ?? 0) + 1,
      }
    })
  }, [])

  const scheduleShowTooltipForTarget = useCallback((target: HTMLElement, delayMs: number) => {
    if (activeTargetRef.current === target) return
    if (pendingTargetRef.current === target && openTimerRef.current !== null) return

    cacheAndRemoveElementTitle(target)
    clearOpenTimer()
    pendingTargetRef.current = target

    if (delayMs <= 0) {
      pendingTargetRef.current = null
      showTooltipForTarget(target)
      return
    }

    openTimerRef.current = window.setTimeout(() => {
      const pending = pendingTargetRef.current
      openTimerRef.current = null
      pendingTargetRef.current = null
      if (!pending) return
      showTooltipForTarget(pending)
    }, delayMs)
  }, [clearOpenTimer, showTooltipForTarget])

  useLayoutEffect(() => {
    if (!tooltip) return
    updateTooltipPosition()
  }, [tooltip?.anchorVersion, tooltip?.text, updateTooltipPosition])

  useEffect(() => {
    if (!tooltip) return

    const handleLayout = () => {
      updateTooltipPosition()
    }
    const handlePointerDown = () => {
      hideTooltip()
    }
    const handleBlur = () => {
      hideTooltip()
    }

    window.addEventListener('resize', handleLayout)
    window.addEventListener('scroll', handleLayout, true)
    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('resize', handleLayout)
      window.removeEventListener('scroll', handleLayout, true)
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('blur', handleBlur)
    }
  }, [hideTooltip, tooltip, updateTooltipPosition])

  useEffect(() => {
    const handlePointerOver = (event: MouseEvent) => {
      const target = findTitleTarget(event.target)
      if (!target) return
      scheduleShowTooltipForTarget(target, HOVER_OPEN_DELAY_MS)
    }

    const handlePointerOut = (event: MouseEvent) => {
      const pendingTarget = pendingTargetRef.current
      if (pendingTarget && event.target instanceof Node && pendingTarget.contains(event.target)) {
        const related = event.relatedTarget
        if (!(related instanceof Node && pendingTarget.contains(related))) {
          clearOpenTimer()
          pendingTargetRef.current = null
        }
      }

      const activeTarget = activeTargetRef.current
      if (!activeTarget) return
      if (!(event.target instanceof Node) || !activeTarget.contains(event.target)) return
      const related = event.relatedTarget
      if (related instanceof Node && activeTarget.contains(related)) return
      hideTooltip()
    }

    const handleFocusIn = (event: FocusEvent) => {
      const target = findTitleTarget(event.target)
      if (!target) return
      scheduleShowTooltipForTarget(target, 0)
    }

    const handleFocusOut = (event: FocusEvent) => {
      const activeTarget = activeTargetRef.current
      if (!activeTarget) return
      if (!(event.target instanceof Node) || !activeTarget.contains(event.target)) return
      const related = event.relatedTarget
      if (related instanceof Node && activeTarget.contains(related)) return
      hideTooltip()
    }

    document.addEventListener('mouseover', handlePointerOver, true)
    document.addEventListener('mouseout', handlePointerOut, true)
    document.addEventListener('focusin', handleFocusIn, true)
    document.addEventListener('focusout', handleFocusOut, true)

    return () => {
      document.removeEventListener('mouseover', handlePointerOver, true)
      document.removeEventListener('mouseout', handlePointerOut, true)
      document.removeEventListener('focusin', handleFocusIn, true)
      document.removeEventListener('focusout', handleFocusOut, true)
    }
  }, [clearOpenTimer, hideTooltip, scheduleShowTooltipForTarget])

  useEffect(() => {
    return () => {
      hideTooltip()
    }
  }, [hideTooltip])

  if (!tooltip) return null

  return createPortal(
    <div
      ref={tooltipRef}
      role="tooltip"
      data-side={tooltip.side}
      className={cn('app-tooltip-content app-title-tooltip-content')}
      style={{
        top: tooltip.top,
        left: tooltip.left,
        maxWidth: 460,
      }}
    >
      {tooltip.text}
    </div>,
    document.body
  )
}
