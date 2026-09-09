import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, type NavigateFunction } from 'react-router-dom'
import { translate, useLocale } from '../i18n'
import {
  computeTrajectoryStats,
  detectCircleGesture,
  GESTURE_ACTIVATE_DISTANCE as ACTIVATE_DISTANCE,
  GESTURE_ANGLE_RATIO as ANGLE_RATIO,
  GESTURE_HORIZONTAL_THRESHOLD as HORIZONTAL_THRESHOLD,
  GESTURE_JITTER_LOCK_DISTANCE,
  GESTURE_MAX_POINTS as MAX_POINTS,
  GESTURE_SAMPLE_MIN_DISTANCE as SAMPLE_MIN_DISTANCE,
  GESTURE_VERTICAL_DOWN_THRESHOLD as VERTICAL_DOWN_THRESHOLD,
  GESTURE_VERTICAL_UP_THRESHOLD as VERTICAL_UP_THRESHOLD,
  isScribble,
  isStraightSwipe,
  type GesturePoint,
} from '../lib/mouseGestureRecognition'
import { resolveProjectDetailGestureTarget } from '../lib/projectPaneNavigation'

export type MouseGestureHint = {
  visible: boolean
  label: string
  status: 'pending' | 'ready' | 'invalid'
  action: 'back' | 'forward' | 'home' | 'recent' | 'toggleProjectHeader' | null
  points: GesturePoint[]
  cursor: GesturePoint | null
}

type GesturePreview = {
  status: 'pending' | 'ready' | 'invalid'
  action: 'back' | 'forward' | 'home' | 'recent' | 'toggleProjectHeader' | null
  label: string
}

type GestureLocale = ReturnType<typeof useLocale>

const EMPTY_HINT: MouseGestureHint = {
  visible: false,
  label: '',
  status: 'pending',
  action: null,
  points: [],
  cursor: null,
}

const RECENT_GESTURE_ALLOW_SELECTOR = '[data-allow-recent-gesture="true"]'
const RECENT_GESTURE_IGNORE_SELECTOR = ['button', 'a', 'input', 'textarea', 'select', '[contenteditable="true"]', '.xterm', '[role="dialog"]'].join(', ')
const PROJECT_HEADER_COLLAPSED_STORAGE_KEY = 'app:project-header-collapsed'
const GESTURE_ACTIVE_CLASS_NAME = 'gesture-active'

export function navigateHomeWithStartupDefaultReset(navigate: NavigateFunction): void {
  navigate('/', {
    state: {
      gestureResetToStartupDefault: Date.now(),
    },
  })
}

function shouldSkipRecentGesture(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest(RECENT_GESTURE_ALLOW_SELECTOR)) return false
  return Boolean(target.closest(RECENT_GESTURE_IGNORE_SELECTOR))
}

function isRecentProjectDrawerOpen(): boolean {
  return Boolean(document.querySelector('[data-recent-project-drawer-open="true"]'))
}

function isProjectDetailRoute(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean)
  return segments[0] === 'project' && segments.length >= 2
}

function readProjectHeaderCollapsed(): boolean {
  try {
    return localStorage.getItem(PROJECT_HEADER_COLLAPSED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function translateGesture(locale: GestureLocale, key: string): string {
  return translate(locale, key as never)
}

function toPreview(locale: GestureLocale, dx: number, dy: number, points: GesturePoint[], allowRecentGesture: boolean, recentDrawerOpen: boolean, allowProjectHeaderGesture: boolean, isDetailRoute: boolean, projectHeaderCollapsed: boolean): GesturePreview {
  if (detectCircleGesture(points)) {
    return {
      status: 'ready',
      action: 'home',
      label: translateGesture(locale, 'common.mouseGesture.releaseHome'),
    }
  }

  const stats = computeTrajectoryStats(points)
  const absX = Math.abs(dx)
  const absY = Math.abs(dy)
  const straight = isStraightSwipe(stats)

  if (allowProjectHeaderGesture && isDetailRoute && straight && dy <= -VERTICAL_UP_THRESHOLD && absY >= absX * ANGLE_RATIO) {
    return {
      status: 'ready',
      action: 'toggleProjectHeader',
      label: projectHeaderCollapsed ? translateGesture(locale, 'common.mouseGesture.releaseExpandProjectHeader') : translateGesture(locale, 'common.mouseGesture.releaseCollapseProjectHeader'),
    }
  }

  if (allowRecentGesture && straight && dy >= VERTICAL_DOWN_THRESHOLD && dy >= absX * ANGLE_RATIO) {
    return {
      status: 'ready',
      action: 'recent',
      label: recentDrawerOpen ? translateGesture(locale, 'common.mouseGesture.releaseCloseRecentProjects') : translateGesture(locale, 'common.mouseGesture.releaseOpenRecentProjects'),
    }
  }

  if (straight && absX >= HORIZONTAL_THRESHOLD && absX >= absY * ANGLE_RATIO) {
    const action = dx < 0 ? 'back' : 'forward'
    return {
      status: 'ready',
      action,
      label: action === 'back' ? translateGesture(locale, 'common.mouseGesture.releaseBack') : translateGesture(locale, 'common.mouseGesture.releaseForward'),
    }
  }

  if (isScribble(stats)) {
    return {
      status: 'invalid',
      action: null,
      label: translateGesture(locale, 'common.mouseGesture.invalidScribble'),
    }
  }

  if (allowRecentGesture && dy > ACTIVATE_DISTANCE && absY > absX * 1.05) {
    return {
      status: 'pending',
      action: 'recent',
      label: recentDrawerOpen ? translateGesture(locale, 'common.mouseGesture.continueDownCloseRecentProjects') : translateGesture(locale, 'common.mouseGesture.continueDownOpenRecentProjects'),
    }
  }

  if (allowProjectHeaderGesture && isDetailRoute && dy < -ACTIVATE_DISTANCE && absY > absX * 1.05) {
    return {
      status: 'pending',
      action: 'toggleProjectHeader',
      label: projectHeaderCollapsed ? translateGesture(locale, 'common.mouseGesture.continueUpExpandProjectHeader') : translateGesture(locale, 'common.mouseGesture.continueUpCollapseProjectHeader'),
    }
  }

  if (absY > absX * 1.05 && absY >= ACTIVATE_DISTANCE * 2) {
    return {
      status: 'invalid',
      action: null,
      label: allowRecentGesture
        ? allowProjectHeaderGesture && isDetailRoute
          ? translateGesture(locale, 'common.mouseGesture.invalidUpDownHorizontalCircle')
          : translateGesture(locale, 'common.mouseGesture.invalidDownHorizontalCircle')
        : allowProjectHeaderGesture && isDetailRoute
          ? translateGesture(locale, 'common.mouseGesture.invalidUpHorizontalCircle')
          : translateGesture(locale, 'common.mouseGesture.invalidHorizontalCircle'),
    }
  }

  if (absX < HORIZONTAL_THRESHOLD * 0.45) {
    return {
      status: 'pending',
      action: dx < 0 ? 'back' : 'forward',
      label: translateGesture(locale, 'common.mouseGesture.continueHorizontalCircle'),
    }
  }

  return {
    status: 'invalid',
    action: dx < 0 ? 'back' : 'forward',
    label: translateGesture(locale, 'common.mouseGesture.invalidTooShort'),
  }
}

export function useMouseGestureNavigator(): MouseGestureHint {
  const location = useLocation()
  const navigate = useNavigate()
  const locale = useLocale()
  const [hint, setHint] = useState<MouseGestureHint>(EMPTY_HINT)
  const stateRef = useRef({
    tracking: false,
    activated: false,
    moved: false,
    startLocked: false,
    ignoreRecentInThisGesture: false,
    isDetailRouteAtStart: false,
    projectHeaderCollapsedAtStart: false,
    recentDrawerOpenAtStart: false,
    rawStartX: 0,
    rawStartY: 0,
    startX: 0,
    startY: 0,
    lastDx: 0,
    lastDy: 0,
    lastSampleX: 0,
    lastSampleY: 0,
    points: [] as GesturePoint[],
  })
  const frameRef = useRef<number | null>(null)
  const nextHintRef = useRef(hint)
  const suppressContextMenuRef = useRef(false)
  const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const setGestureActive = (active: boolean) => {
      document.body.classList.toggle(GESTURE_ACTIVE_CLASS_NAME, active)
    }

    const hideHintImmediately = () => {
      nextHintRef.current = EMPTY_HINT
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
      setHint(EMPTY_HINT)
    }

    const flushHint = () => {
      frameRef.current = null
      setHint(nextHintRef.current)
    }

    const scheduleHint = (next: MouseGestureHint) => {
      nextHintRef.current = next
      if (frameRef.current !== null) return
      frameRef.current = window.requestAnimationFrame(flushHint)
    }

    const clearHint = () => {
      scheduleHint(EMPTY_HINT)
    }

    const clearSuppressTimer = () => {
      if (suppressTimerRef.current) {
        clearTimeout(suppressTimerRef.current)
        suppressTimerRef.current = null
      }
    }

    const armSuppressContextMenu = () => {
      suppressContextMenuRef.current = true
      clearSuppressTimer()
      suppressTimerRef.current = setTimeout(() => {
        suppressContextMenuRef.current = false
      }, 450)
    }

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 2) return
      const detailRoute = isProjectDetailRoute(location.pathname)
      setGestureActive(true)
      stateRef.current.tracking = true
      stateRef.current.activated = false
      stateRef.current.moved = false
      stateRef.current.startLocked = false
      stateRef.current.ignoreRecentInThisGesture = shouldSkipRecentGesture(e.target)
      stateRef.current.isDetailRouteAtStart = detailRoute
      stateRef.current.projectHeaderCollapsedAtStart = detailRoute ? readProjectHeaderCollapsed() : false
      stateRef.current.recentDrawerOpenAtStart = isRecentProjectDrawerOpen()
      stateRef.current.rawStartX = e.clientX
      stateRef.current.rawStartY = e.clientY
      stateRef.current.startX = e.clientX
      stateRef.current.startY = e.clientY
      stateRef.current.lastDx = 0
      stateRef.current.lastDy = 0
      stateRef.current.lastSampleX = e.clientX
      stateRef.current.lastSampleY = e.clientY
      stateRef.current.points = []
    }

    const onMouseMove = (e: MouseEvent) => {
      const state = stateRef.current
      if (!state.tracking) return
      const allowRecentGesture = !state.ignoreRecentInThisGesture
      const allowProjectHeaderGesture = !state.ignoreRecentInThisGesture

      if ((e.buttons & 2) === 0) {
        setGestureActive(false)
        state.tracking = false
        state.activated = false
        state.moved = false
        state.startLocked = false
        state.ignoreRecentInThisGesture = false
        state.isDetailRouteAtStart = false
        state.projectHeaderCollapsedAtStart = false
        state.recentDrawerOpenAtStart = false
        state.points = []
        clearHint()
        return
      }

      if (!state.activated && !state.startLocked) {
        const pressDrift = Math.hypot(e.clientX - state.rawStartX, e.clientY - state.rawStartY)
        if (pressDrift >= GESTURE_JITTER_LOCK_DISTANCE) {
          state.startX = e.clientX
          state.startY = e.clientY
          state.startLocked = true
          state.lastSampleX = e.clientX
          state.lastSampleY = e.clientY
        }
      }

      state.lastDx = e.clientX - state.startX
      state.lastDy = e.clientY - state.startY
      const movedDistance = Math.hypot(state.lastDx, state.lastDy)

      if (!state.activated) {
        if (movedDistance < ACTIVATE_DISTANCE) return
        state.activated = true
        state.moved = true
        state.points = [
          { x: state.startX, y: state.startY },
          { x: e.clientX, y: e.clientY },
        ]
        state.lastSampleX = e.clientX
        state.lastSampleY = e.clientY
      } else {
        const deltaSinceSample = Math.hypot(e.clientX - state.lastSampleX, e.clientY - state.lastSampleY)
        if (deltaSinceSample >= SAMPLE_MIN_DISTANCE) {
          state.points.push({ x: e.clientX, y: e.clientY })
          if (state.points.length > MAX_POINTS) {
            state.points.splice(0, state.points.length - MAX_POINTS)
          }
          state.lastSampleX = e.clientX
          state.lastSampleY = e.clientY
        }
      }

      if (!state.activated) return
      const gesturePoints = [...state.points, { x: e.clientX, y: e.clientY }]
      const preview = toPreview(locale, state.lastDx, state.lastDy, gesturePoints, allowRecentGesture, state.recentDrawerOpenAtStart, allowProjectHeaderGesture, state.isDetailRouteAtStart, state.projectHeaderCollapsedAtStart)
      scheduleHint({
        visible: true,
        label: preview.label,
        status: preview.status,
        action: preview.action,
        points: [...state.points],
        cursor: { x: e.clientX, y: e.clientY },
      })
    }

    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 2) return
      const state = stateRef.current
      if (!state.tracking) return
      setGestureActive(false)
      state.tracking = false
      const hadGestureMovement = state.activated
      state.activated = false
      if (state.moved) {
        armSuppressContextMenu()
      }
      state.moved = false

      const dx = e.clientX - state.startX
      const dy = e.clientY - state.startY
      state.lastDx = dx
      state.lastDy = dy
      const absX = Math.abs(dx)
      const absY = Math.abs(dy)
      const releasedPoint = { x: e.clientX, y: e.clientY }
      const gesturePoints = state.points.length > 0 ? [...state.points, releasedPoint] : [{ x: state.startX, y: state.startY }, releasedPoint]
      const straight = isStraightSwipe(computeTrajectoryStats(gesturePoints))
      const isCircle = detectCircleGesture(gesturePoints)
      const segments = location.pathname.split('/').filter(Boolean)
      const isDetailRoute = segments[0] === 'project' && segments.length >= 2
      const passedUp = !state.ignoreRecentInThisGesture && state.isDetailRouteAtStart && straight && dy <= -VERTICAL_UP_THRESHOLD && absY >= absX * ANGLE_RATIO
      const passedDown = !state.ignoreRecentInThisGesture && straight && dy >= VERTICAL_DOWN_THRESHOLD && dy >= absX * ANGLE_RATIO
      const passedHorizontal = straight && absX >= HORIZONTAL_THRESHOLD && absX >= absY * ANGLE_RATIO

      if (hadGestureMovement && isCircle) {
        hideHintImmediately()
        navigateHomeWithStartupDefaultReset(navigate)
        state.points = []
        return
      }

      if (hadGestureMovement && passedUp) {
        hideHintImmediately()
        window.dispatchEvent(new CustomEvent('app:toggle-project-header'))
        state.points = []
        return
      }

      if (hadGestureMovement && passedDown) {
        hideHintImmediately()
        window.dispatchEvent(new CustomEvent('app:toggle-recent-project-drawer'))
        state.points = []
        return
      }

      if (hadGestureMovement && passedHorizontal) {
        hideHintImmediately()
        const isBack = dx < 0
        const isForward = dx > 0

        const gestureTarget = isDetailRoute ? resolveProjectDetailGestureTarget(location.pathname, isForward ? 'forward' : 'back') : null

        if (gestureTarget) {
          navigate(gestureTarget, { replace: true })
        } else if (isBack) {
          navigate(-1)
        } else {
          navigate(1)
        }
        state.points = []
        return
      }

      state.points = []
      state.ignoreRecentInThisGesture = false
      state.isDetailRouteAtStart = false
      state.projectHeaderCollapsedAtStart = false
      state.recentDrawerOpenAtStart = false
      hideHintImmediately()
    }

    const onContextMenuCapture = (e: MouseEvent) => {
      const state = stateRef.current
      if (!suppressContextMenuRef.current && !(state.tracking && state.activated)) return
      e.preventDefault()
      e.stopPropagation()
      suppressContextMenuRef.current = false
      clearSuppressTimer()
    }

    const onWindowBlur = () => {
      setGestureActive(false)
      stateRef.current.tracking = false
      stateRef.current.activated = false
      stateRef.current.moved = false
      stateRef.current.startLocked = false
      stateRef.current.ignoreRecentInThisGesture = false
      stateRef.current.isDetailRouteAtStart = false
      stateRef.current.projectHeaderCollapsedAtStart = false
      stateRef.current.recentDrawerOpenAtStart = false
      stateRef.current.points = []
      hideHintImmediately()
    }

    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('contextmenu', onContextMenuCapture, true)
    window.addEventListener('blur', onWindowBlur)

    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('contextmenu', onContextMenuCapture, true)
      window.removeEventListener('blur', onWindowBlur)
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
      nextHintRef.current = EMPTY_HINT
      setGestureActive(false)
      clearSuppressTimer()
    }
  }, [locale, location.pathname, navigate])

  return hint
}
