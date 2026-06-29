import { useEffect, useRef, useState, type RefObject } from 'react'

const SIDEBAR_GESTURE_ACTIVATE_DISTANCE = 8
const SIDEBAR_GESTURE_SAMPLE_MIN_DISTANCE = 6
const SIDEBAR_GESTURE_MAX_POINTS = 96
const SIDEBAR_GESTURE_HORIZONTAL_THRESHOLD = 72
const SIDEBAR_GESTURE_ANGLE_RATIO = 1.25
const GESTURE_ACTIVE_CLASS_NAME = 'gesture-active'

export type SidebarGesturePoint = {
  x: number
  y: number
}

export type SidebarGestureOverlayState = {
  visible: boolean
  status: 'pending' | 'ready' | 'invalid'
  action: 'left' | 'right' | null
  points: SidebarGesturePoint[]
  cursor: SidebarGesturePoint | null
}

export const EMPTY_SIDEBAR_GESTURE_OVERLAY: SidebarGestureOverlayState = {
  visible: false,
  status: 'pending',
  action: null,
  points: [],
  cursor: null,
}

type SidebarGestureTracker = {
  tracking: boolean
  activated: boolean
  moved: boolean
  startX: number
  startY: number
  lastDx: number
  lastDy: number
  lastSampleX: number
  lastSampleY: number
  points: SidebarGesturePoint[]
}

type UseSidebarGestureOptions = {
  pageRootRef: RefObject<HTMLElement | null>
  onBeforeToggle?: () => void
  onToggleLeftSidebar?: () => void
  onToggleRightSidebar?: () => void
}

function createEmptyGestureTracker(): SidebarGestureTracker {
  return {
    tracking: false,
    activated: false,
    moved: false,
    startX: 0,
    startY: 0,
    lastDx: 0,
    lastDy: 0,
    lastSampleX: 0,
    lastSampleY: 0,
    points: [],
  }
}

function resolveSidebarGestureOverlay(
  dx: number,
  dy: number,
  canToggleLeftSidebar: boolean,
  canToggleRightSidebar: boolean
): Pick<SidebarGestureOverlayState, 'status' | 'action'> {
  const absX = Math.abs(dx)
  const absY = Math.abs(dy)
  const action = dx < 0 ? 'right' : 'left'
  const canToggleSidebar = action === 'left' ? canToggleLeftSidebar : canToggleRightSidebar

  if (absX >= SIDEBAR_GESTURE_HORIZONTAL_THRESHOLD && absX >= absY * SIDEBAR_GESTURE_ANGLE_RATIO) {
    return {
      status: canToggleSidebar ? 'ready' : 'invalid',
      action,
    }
  }

  if (absY > absX * 1.05 && absY >= SIDEBAR_GESTURE_ACTIVATE_DISTANCE * 2) {
    return {
      status: 'invalid',
      action: null,
    }
  }

  if (absX < SIDEBAR_GESTURE_HORIZONTAL_THRESHOLD * 0.45) {
    return {
      status: 'pending',
      action,
    }
  }

  return {
    status: 'invalid',
    action,
  }
}

export function useSidebarGesture({
  pageRootRef,
  onBeforeToggle,
  onToggleLeftSidebar,
  onToggleRightSidebar,
}: UseSidebarGestureOptions): SidebarGestureOverlayState {
  const [sidebarGestureOverlay, setSidebarGestureOverlay] = useState<SidebarGestureOverlayState>(
    EMPTY_SIDEBAR_GESTURE_OVERLAY
  )
  const sidebarGestureRef = useRef<SidebarGestureTracker>(createEmptyGestureTracker())
  const suppressSidebarGestureContextMenuRef = useRef(false)
  const suppressSidebarGestureTimerRef = useRef<number | null>(null)
  const sidebarGestureFrameRef = useRef<number | null>(null)
  const nextSidebarGestureOverlayRef = useRef<SidebarGestureOverlayState>(EMPTY_SIDEBAR_GESTURE_OVERLAY)
  const callbacksRef = useRef({
    onBeforeToggle,
    onToggleLeftSidebar,
    onToggleRightSidebar,
  })

  useEffect(() => {
    callbacksRef.current = {
      onBeforeToggle,
      onToggleLeftSidebar,
      onToggleRightSidebar,
    }
  }, [onBeforeToggle, onToggleLeftSidebar, onToggleRightSidebar])

  useEffect(() => {
    const isEventInsidePage = (target: EventTarget | null) => (
      target instanceof Node
      && pageRootRef.current?.contains(target)
    )

    const setGestureActive = (active: boolean) => {
      document.body.classList.toggle(GESTURE_ACTIVE_CLASS_NAME, active)
    }

    const hideOverlayImmediately = () => {
      nextSidebarGestureOverlayRef.current = EMPTY_SIDEBAR_GESTURE_OVERLAY
      if (sidebarGestureFrameRef.current !== null) {
        window.cancelAnimationFrame(sidebarGestureFrameRef.current)
        sidebarGestureFrameRef.current = null
      }
      setSidebarGestureOverlay(EMPTY_SIDEBAR_GESTURE_OVERLAY)
    }

    const flushOverlay = () => {
      sidebarGestureFrameRef.current = null
      setSidebarGestureOverlay(nextSidebarGestureOverlayRef.current)
    }

    const scheduleOverlay = (next: SidebarGestureOverlayState) => {
      nextSidebarGestureOverlayRef.current = next
      if (sidebarGestureFrameRef.current !== null) return
      sidebarGestureFrameRef.current = window.requestAnimationFrame(flushOverlay)
    }

    const clearSuppressTimer = () => {
      if (suppressSidebarGestureTimerRef.current !== null) {
        window.clearTimeout(suppressSidebarGestureTimerRef.current)
        suppressSidebarGestureTimerRef.current = null
      }
    }

    const armSuppressContextMenu = () => {
      suppressSidebarGestureContextMenuRef.current = true
      clearSuppressTimer()
      suppressSidebarGestureTimerRef.current = window.setTimeout(() => {
        suppressSidebarGestureContextMenuRef.current = false
      }, 450)
    }

    const resetGesture = () => {
      sidebarGestureRef.current = createEmptyGestureTracker()
    }

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 2) return
      if (!(event.ctrlKey || event.metaKey) || !isEventInsidePage(event.target)) return

      setGestureActive(true)
      sidebarGestureRef.current = {
        tracking: true,
        activated: false,
        moved: false,
        startX: event.clientX,
        startY: event.clientY,
        lastDx: 0,
        lastDy: 0,
        lastSampleX: event.clientX,
        lastSampleY: event.clientY,
        points: [],
      }

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }

    const handleMouseMove = (event: MouseEvent) => {
      const gesture = sidebarGestureRef.current
      if (!gesture.tracking) return

      if ((event.buttons & 2) === 0) {
        setGestureActive(false)
        resetGesture()
        hideOverlayImmediately()
        return
      }

      gesture.lastDx = event.clientX - gesture.startX
      gesture.lastDy = event.clientY - gesture.startY

      if (!gesture.activated) {
        const movedDistance = Math.hypot(gesture.lastDx, gesture.lastDy)
        if (movedDistance < SIDEBAR_GESTURE_ACTIVATE_DISTANCE) return
        gesture.activated = true
        gesture.moved = true
        gesture.points = [
          { x: gesture.startX, y: gesture.startY },
          { x: event.clientX, y: event.clientY },
        ]
        gesture.lastSampleX = event.clientX
        gesture.lastSampleY = event.clientY
      } else {
        const deltaSinceSample = Math.hypot(
          event.clientX - gesture.lastSampleX,
          event.clientY - gesture.lastSampleY
        )
        if (deltaSinceSample >= SIDEBAR_GESTURE_SAMPLE_MIN_DISTANCE) {
          gesture.points.push({ x: event.clientX, y: event.clientY })
          if (gesture.points.length > SIDEBAR_GESTURE_MAX_POINTS) {
            gesture.points.splice(0, gesture.points.length - SIDEBAR_GESTURE_MAX_POINTS)
          }
          gesture.lastSampleX = event.clientX
          gesture.lastSampleY = event.clientY
        }
      }

      if (gesture.activated) {
        const preview = resolveSidebarGestureOverlay(
          gesture.lastDx,
          gesture.lastDy,
          Boolean(callbacksRef.current.onToggleLeftSidebar),
          Boolean(callbacksRef.current.onToggleRightSidebar),
        )
        scheduleOverlay({
          visible: true,
          status: preview.status,
          action: preview.action,
          points: [...gesture.points],
          cursor: { x: event.clientX, y: event.clientY },
        })
      }

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }

    const handleMouseUp = (event: MouseEvent) => {
      if (event.button !== 2) return
      const gesture = sidebarGestureRef.current
      if (!gesture.tracking) return

      const dx = gesture.lastDx
      const dy = gesture.lastDy
      const absX = Math.abs(dx)
      const absY = Math.abs(dy)
      const passedHorizontal = absX >= SIDEBAR_GESTURE_HORIZONTAL_THRESHOLD
        && absX >= absY * SIDEBAR_GESTURE_ANGLE_RATIO
      const targetAction = dx < 0 ? 'right' : 'left'
      const toggleSidebar = targetAction === 'left'
        ? callbacksRef.current.onToggleLeftSidebar
        : callbacksRef.current.onToggleRightSidebar

      setGestureActive(false)
      if (gesture.moved) {
        armSuppressContextMenu()
      }

      resetGesture()
      hideOverlayImmediately()

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()

      if (!passedHorizontal || !toggleSidebar) return

      callbacksRef.current.onBeforeToggle?.()
      toggleSidebar()
    }

    const handleContextMenu = (event: MouseEvent) => {
      if (
        !isEventInsidePage(event.target)
        || (!suppressSidebarGestureContextMenuRef.current && !sidebarGestureRef.current.tracking)
      ) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      suppressSidebarGestureContextMenuRef.current = false
      clearSuppressTimer()
    }

    const handleWindowBlur = () => {
      setGestureActive(false)
      resetGesture()
      hideOverlayImmediately()
      suppressSidebarGestureContextMenuRef.current = false
      clearSuppressTimer()
    }

    document.addEventListener('mousedown', handleMouseDown, true)
    document.addEventListener('mousemove', handleMouseMove, true)
    document.addEventListener('mouseup', handleMouseUp, true)
    document.addEventListener('contextmenu', handleContextMenu, true)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true)
      document.removeEventListener('mousemove', handleMouseMove, true)
      document.removeEventListener('mouseup', handleMouseUp, true)
      document.removeEventListener('contextmenu', handleContextMenu, true)
      window.removeEventListener('blur', handleWindowBlur)
      if (sidebarGestureFrameRef.current !== null) {
        window.cancelAnimationFrame(sidebarGestureFrameRef.current)
        sidebarGestureFrameRef.current = null
      }
      clearSuppressTimer()
      suppressSidebarGestureContextMenuRef.current = false
      nextSidebarGestureOverlayRef.current = EMPTY_SIDEBAR_GESTURE_OVERLAY
      setGestureActive(false)
      resetGesture()
    }
  }, [pageRootRef])

  return sidebarGestureOverlay
}
