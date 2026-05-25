import { useEffect, useRef, useState } from 'react'
import { MemoryRouter as Router, Routes, Route, useNavigate } from 'react-router-dom'
import { HomePage } from './pages/Home'
import { DetailPage } from './pages/Detail'
import { SettingsPage } from './pages/Settings'
import { useAppStore } from './stores/appStore'
import { runtimeManager } from './runtime/RuntimeManager'
import type { AppConfig } from '../shared/types'
import { Minus, Square, X } from 'lucide-react'

const WINDOW_ICON_SRC = new URL('../../../icon/Y.png', import.meta.url).href

function resolveTheme(theme: AppConfig['theme']): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

function ThemeSync() {
  const theme = useAppStore((s) => s.config.theme)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')

    const applyTheme = () => {
      const nextTheme = resolveTheme(theme)
      if (document.documentElement.getAttribute('data-theme') !== nextTheme) {
        document.documentElement.setAttribute('data-theme', nextTheme)
      }
      document.documentElement.style.colorScheme = nextTheme
    }

    applyTheme()

    if (theme !== 'system') return

    const onSystemThemeChange = () => applyTheme()
    media.addEventListener('change', onSystemThemeChange)
    return () => media.removeEventListener('change', onSystemThemeChange)
  }, [theme])

  return null
}

function ProcessOutputListener() {
  const appendOutput = useAppStore((s) => s.appendOutput)
  const updateProcessStatus = useAppStore((s) => s.updateProcessStatus)
  const handleProcessExit = useAppStore((s) => s.handleProcessExit)

  useEffect(() => {
    const unsubOutput = window.electronAPI.onProcessOutput(
      ({ projectId, data }) => { appendOutput(projectId, data) }
    )
    const unsubStatus = window.electronAPI.onProcessStatus(
      ({ projectId, status }) => { updateProcessStatus(projectId, status) }
    )
    const unsubExit = window.electronAPI.onProcessExit(
      ({ projectId, code }) => { handleProcessExit(projectId, code) }
    )
    return () => { unsubOutput(); unsubStatus(); unsubExit() }
  }, [appendOutput, updateProcessStatus, handleProcessExit])

  return null
}

/** Centralized session polling — RuntimeManager calls onRefresh on each tick,
 *  onRefresh is the store's refreshSessions (single source of truth).
 *  Uses stable project identity string to avoid re-subscribing. */
function SessionPoller() {
  const projectIds = useAppStore((s) =>
    s.projects.map((p) => p.id).sort().join(',')
  )
  const projects = useAppStore((s) => s.projects)
  const refreshSessions = useAppStore((s) => s.refreshSessions)

  useEffect(() => {
    if (projects.length === 0) return
    runtimeManager.startPolling(() => { refreshSessions() }, 10000)
    return () => runtimeManager.stopPolling()
  }, [projectIds]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

function MouseGestureNavigator() {
  const navigate = useNavigate()
  type GesturePoint = { x: number; y: number }
  const [hint, setHint] = useState<{
    visible: boolean
    label: string
    status: 'pending' | 'ready' | 'invalid'
    action: 'back' | 'forward' | 'home' | null
    points: GesturePoint[]
    cursor: GesturePoint | null
  }>({
    visible: false,
    label: '',
    status: 'pending',
    action: null,
    points: [],
    cursor: null,
  })
  type GesturePreview = {
    status: 'pending' | 'ready' | 'invalid'
    action: 'back' | 'forward' | 'home' | null
    label: string
  }
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

  useEffect(() => {
    const EMPTY_HINT: typeof hint = {
      visible: false,
      label: '',
      status: 'pending',
      action: null,
      points: [],
      cursor: null,
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

    const scheduleHint = (next: typeof hint) => {
      nextHintRef.current = next
      if (frameRef.current !== null) return
      frameRef.current = window.requestAnimationFrame(flushHint)
    }

    const clearHint = () => {
      scheduleHint(EMPTY_HINT)
    }

    const normalizeDeltaAngle = (value: number): number => {
      let result = value
      const fullTurn = Math.PI * 2
      while (result > Math.PI) result -= fullTurn
      while (result < -Math.PI) result += fullTurn
      return result
    }

    const detectCircleGesture = (rawPoints: GesturePoint[]): boolean => {
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

    const toPreview = (dx: number, dy: number, points: GesturePoint[]): GesturePreview => {
      if (detectCircleGesture(points)) {
        return {
          status: 'ready' as const,
          action: 'home' as const,
          label: '松开后回到首页',
        }
      }

      const absX = Math.abs(dx)
      const absY = Math.abs(dy)

      if (absX >= HORIZONTAL_THRESHOLD && absX >= absY * ANGLE_RATIO) {
        const action = dx < 0 ? 'back' : 'forward'
        return {
          status: 'ready' as const,
          action,
          label: action === 'back' ? '松开后后退' : '松开后前进',
        }
      }

      if (absY > absX * 1.05 && absY >= ACTIVATE_DISTANCE * 2) {
        return {
          status: 'invalid' as const,
          action: null,
          label: '无效手势：请水平拖动或画圆',
        }
      }

      if (absX < HORIZONTAL_THRESHOLD * 0.45) {
        return {
          status: 'pending' as const,
          action: dx < 0 ? 'back' : 'forward',
          label: '继续拖动（水平或圆圈）…',
        }
      }

      return {
        status: 'invalid' as const,
        action: dx < 0 ? 'back' : 'forward',
        label: '无效手势：距离不足',
      }
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
        if (dx < 0) {
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
  }, [navigate])

  if (!hint.visible) return null

  const pathPoints = hint.cursor ? [...hint.points, hint.cursor] : hint.points
  const polylinePoints = pathPoints.map((p) => `${p.x},${p.y}`).join(' ')
  const startPoint = pathPoints[0]
  const endPoint = pathPoints[pathPoints.length - 1]

  const strokeColor =
    hint.status === 'ready'
      ? hint.action === 'back'
        ? 'var(--color-warning)'
        : hint.action === 'home'
          ? 'var(--color-primary)'
          : 'var(--color-success)'
      : hint.status === 'invalid'
        ? 'var(--color-destructive)'
        : 'var(--color-muted-foreground)'

  return (
    <div className="pointer-events-none fixed inset-0 z-[10000]">
      <svg className="h-full w-full">
        {polylinePoints.length > 0 ? (
          <polyline
            points={polylinePoints}
            fill="none"
            stroke={strokeColor}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ opacity: 0.82 }}
          />
        ) : null}
        {startPoint ? (
          <circle cx={startPoint.x} cy={startPoint.y} r={4} fill={strokeColor} style={{ opacity: 0.75 }} />
        ) : null}
        {endPoint ? (
          <circle cx={endPoint.x} cy={endPoint.y} r={5} fill={strokeColor} />
        ) : null}
      </svg>
      <div className="fixed left-1/2 top-4 -translate-x-1/2">
        <div
          className="rounded-[14px] px-3 py-2 text-xs text-[color:var(--color-foreground)]"
          style={{
            background: 'var(--color-popover)',
            border: '1px solid var(--color-border)',
            backdropFilter: 'saturate(165%) blur(18px)',
            WebkitBackdropFilter: 'saturate(165%) blur(18px)',
            boxShadow: 'var(--shadow-popover)',
          }}
        >
          <div className="whitespace-nowrap">{hint.label}</div>
        </div>
      </div>
    </div>
  )
}

function AppInit() {
  const initApp = useAppStore((s) => s.initApp)
  useEffect(() => { initApp() }, [initApp])
  return null
}

function WindowTitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    let alive = true

    const sync = async () => {
      try {
        const next = await window.electronAPI.isWindowMaximized()
        if (alive) setIsMaximized(Boolean(next))
      } catch {
        // ignore and keep current state
      }
    }

    void sync()
    const unsubscribe = window.electronAPI.onWindowState(({ isMaximized: next }) => {
      setIsMaximized(Boolean(next))
    })

    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  return (
    <div className="window-titlebar">
      <div className="window-titlebar__drag drag flex h-full min-w-0 items-center px-3">
        <img
          src={WINDOW_ICON_SRC}
          alt="Runtime icon"
          className="mr-2 h-4 w-4 shrink-0 rounded-[4px]"
          draggable={false}
        />
        <span className="truncate text-[12px] font-medium text-[color:var(--color-muted-foreground)]">Runtime</span>
      </div>
      <div className="window-titlebar__controls nodrag">
        <button
          className="window-titlebar__button window-titlebar__button--neutral"
          aria-label="Minimize window"
          title="Minimize"
          onClick={() => {
            void window.electronAPI.minimizeWindow()
          }}
        >
          <Minus className="h-3.5 w-3.5" strokeWidth={1.7} />
        </button>
        <button
          className="window-titlebar__button window-titlebar__button--neutral"
          aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
          title={isMaximized ? 'Restore' : 'Maximize'}
          onClick={() => {
            void window.electronAPI.toggleMaximizeWindow()
          }}
        >
          <Square className="h-3.5 w-3.5" strokeWidth={1.7} />
        </button>
        <button
          className="window-titlebar__button window-titlebar__button--danger"
          aria-label="Close window"
          title="Close"
          onClick={() => {
            void window.electronAPI.closeWindow()
          }}
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.7} />
        </button>
      </div>
    </div>
  )
}

export function App() {
  return (
    <Router>
      <AppInit />
      <ThemeSync />
      <ProcessOutputListener />
      <SessionPoller />
      <MouseGestureNavigator />
      <div className="app-shell">
        <WindowTitleBar />
        <div className="app-content">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/project/:projectId" element={<DetailPage />} />
            <Route path="/project/:projectId/:pane" element={<DetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </div>
      </div>
    </Router>
  )
}
