import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

type GesturePoint = { x: number; y: number }

export type MouseGestureHint = {
  visible: boolean
  label: string
  status: 'pending' | 'ready' | 'invalid'
  action: 'back' | 'forward' | 'home' | null
  points: GesturePoint[]
  cursor: GesturePoint | null
}

type GesturePreview = {
  status: 'pending' | 'ready' | 'invalid'
  action: 'back' | 'forward' | 'home' | null
  label: string
}

const EMPTY_HINT: MouseGestureHint = {
  visible: false,
  label: '',
  status: 'pending',
  action: null,
  points: [],
  cursor: null,
}

const ACTIVATE_DISTANCE = 8
const SAMPLE_MIN_DISTANCE = 6
const MAX_POINTS = 96
const HORIZONTAL_THRESHOLD = 72
const ANGLE_RATIO = 1.25
const CIRCLE_MIN_POINTS = 18
const CIRCLE_MIN_DIAMETER = 44
const CIRCLE_MAX_ASPECT_RATIO = 1.8
const CIRCLE_MIN_RADIUS = 16
const CIRCLE_MAX_RADIUS_STD_RATIO = 0.42
const CIRCLE_CLOSURE_RATIO = 0.72
const CIRCLE_MIN_SWEEP_RAD = Math.PI * 1.45
const CIRCLE_MIN_PATH_RATIO = 0.65
const CIRCLE_MAX_PATH_RATIO = 2.25

function normalizeDeltaAngle(value: number): number {
  let result = value
  const fullTurn = Math.PI * 2
  while (result > Math.PI) result -= fullTurn
  while (result < -Math.PI) result += fullTurn
  return result
}

function detectCircleGesture(rawPoints: GesturePoint[]): boolean {
  if (rawPoints.length < CIRCLE_MIN_POINTS) return false

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of rawPoints) {
    if (point.x < minX) minX = point.x
    if (point.x > maxX) maxX = point.x
    if (point.y < minY) minY = point.y
    if (point.y > maxY) maxY = point.y
  }

  const width = maxX - minX
  const height = maxY - minY
  if (width < CIRCLE_MIN_DIAMETER || height < CIRCLE_MIN_DIAMETER) return false

  const aspectRatio = width > height ? width / height : height / width
  if (aspectRatio > CIRCLE_MAX_ASPECT_RATIO) return false

  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const radii = rawPoints.map((point) => Math.hypot(point.x - centerX, point.y - centerY))
  const meanRadius = radii.reduce((sum, value) => sum + value, 0) / radii.length
  if (meanRadius < CIRCLE_MIN_RADIUS) return false

  const variance = radii.reduce((sum, value) => {
    const delta = value - meanRadius
    return sum + (delta * delta)
  }, 0) / radii.length
  const radiusStd = Math.sqrt(variance)
  if (radiusStd / meanRadius > CIRCLE_MAX_RADIUS_STD_RATIO) return false

  const first = rawPoints[0]
  const last = rawPoints[rawPoints.length - 1]
  const closureDistance = Math.hypot(last.x - first.x, last.y - first.y)
  if (closureDistance > Math.max(width, height) * CIRCLE_CLOSURE_RATIO) return false

  let sweep = 0
  let previousAngle = Math.atan2(first.y - centerY, first.x - centerX)
  for (let i = 1; i < rawPoints.length; i++) {
    const current = rawPoints[i]
    const angle = Math.atan2(current.y - centerY, current.x - centerX)
    sweep += normalizeDeltaAngle(angle - previousAngle)
    previousAngle = angle
  }
  if (Math.abs(sweep) < CIRCLE_MIN_SWEEP_RAD) return false

  let pathLength = 0
  for (let i = 1; i < rawPoints.length; i++) {
    const prev = rawPoints[i - 1]
    const curr = rawPoints[i]
    pathLength += Math.hypot(curr.x - prev.x, curr.y - prev.y)
  }
  const expectedCircumference = Math.PI * (width + height) * 0.5
  const pathRatio = pathLength / Math.max(expectedCircumference, 1)
  if (pathRatio < CIRCLE_MIN_PATH_RATIO || pathRatio > CIRCLE_MAX_PATH_RATIO) return false

  return true
}

function toPreview(dx: number, dy: number, points: GesturePoint[]): GesturePreview {
  if (detectCircleGesture(points)) {
    return {
      status: 'ready',
      action: 'home',
      label: '松开后回到首页',
    }
  }

  const absX = Math.abs(dx)
  const absY = Math.abs(dy)

  if (absX >= HORIZONTAL_THRESHOLD && absX >= absY * ANGLE_RATIO) {
    const action = dx < 0 ? 'back' : 'forward'
    return {
      status: 'ready',
      action,
      label: action === 'back' ? '松开后后退' : '松开后前进',
    }
  }

  if (absY > absX * 1.05 && absY >= ACTIVATE_DISTANCE * 2) {
    return {
      status: 'invalid',
      action: null,
      label: '无效手势：请水平拖动或画圆',
    }
  }

  if (absX < HORIZONTAL_THRESHOLD * 0.45) {
    return {
      status: 'pending',
      action: dx < 0 ? 'back' : 'forward',
      label: '继续拖动（水平或圆圈）…',
    }
  }

  return {
    status: 'invalid',
    action: dx < 0 ? 'back' : 'forward',
    label: '无效手势：距离不足',
  }
}

export function useMouseGestureNavigator(): MouseGestureHint {
  const location = useLocation()
  const navigate = useNavigate()
  const [hint, setHint] = useState<MouseGestureHint>(EMPTY_HINT)
  const stateRef = useRef({
    tracking: false,
    activated: false,
    moved: false,
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
      stateRef.current.tracking = true
      stateRef.current.activated = false
      stateRef.current.moved = false
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

      if ((e.buttons & 2) === 0) {
        state.tracking = false
        state.activated = false
        state.moved = false
        state.points = []
        clearHint()
        return
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
        const deltaSinceSample = Math.hypot(
          e.clientX - state.lastSampleX,
          e.clientY - state.lastSampleY
        )
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
      const preview = toPreview(state.lastDx, state.lastDy, gesturePoints)
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
      state.tracking = false
      const hadGestureMovement = state.activated
      state.activated = false
      if (state.moved) {
        armSuppressContextMenu()
      }
      state.moved = false

      const dx = state.lastDx
      const dy = state.lastDy
      const absX = Math.abs(dx)
      const absY = Math.abs(dy)
      const passed = absX >= HORIZONTAL_THRESHOLD && absX >= absY * ANGLE_RATIO
      const releasedPoint = { x: e.clientX, y: e.clientY }
      const gesturePoints = state.points.length > 0
        ? [...state.points, releasedPoint]
        : [{ x: state.startX, y: state.startY }, releasedPoint]
      const isCircle = detectCircleGesture(gesturePoints)

      if (hadGestureMovement && isCircle) {
        hideHintImmediately()
        navigate('/', {
          state: {
            gestureResetToStartupDefault: Date.now(),
          },
        })
        state.points = []
        return
      }

      if (hadGestureMovement && passed) {
        hideHintImmediately()
        const segments = location.pathname.split('/').filter(Boolean)
        const isDetailRoute = segments[0] === 'project' && segments.length >= 2
        const currentPane = isDetailRoute ? (segments[2] ?? 'code') : null
        const projectId = isDetailRoute ? segments[1] : null
        const isBack = dx < 0
        const isForward = dx > 0

        if (projectId && isForward && currentPane === 'code') {
          navigate(`/project/${projectId}/aicommit`, { replace: true })
        } else if (projectId && isBack && currentPane === 'aicommit') {
          navigate(`/project/${projectId}/code`, { replace: true })
        } else if (isBack) {
          navigate(-1)
        } else {
          navigate(1)
        }
        state.points = []
        return
      }

      state.points = []
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
      stateRef.current.tracking = false
      stateRef.current.activated = false
      stateRef.current.moved = false
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
      clearSuppressTimer()
    }
  }, [location.pathname, navigate])

  return hint
}
