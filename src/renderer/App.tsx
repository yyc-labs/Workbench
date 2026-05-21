import { useEffect, useRef, useState } from 'react'
import { MemoryRouter as Router, Routes, Route, useNavigate } from 'react-router-dom'
import { HomePage } from './pages/Home'
import { DetailPage } from './pages/Detail'
import { RuntimePage } from './pages/RuntimePage'
import { SettingsPage } from './pages/Settings'
import { useAppStore } from './stores/appStore'
import { runtimeManager } from './runtime/RuntimeManager'
import type { AppConfig } from '../shared/types'

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
    direction: 'back' | 'forward' | null
    points: GesturePoint[]
    cursor: GesturePoint | null
  }>({
    visible: false,
    label: '',
    status: 'pending',
    direction: null,
    points: [],
    cursor: null,
  })
  type GesturePreview = {
    status: 'pending' | 'ready' | 'invalid'
    direction: 'back' | 'forward' | null
    label: string
  }
  const stateRef = useRef({
    tracking: false,
    activated: false,
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

  useEffect(() => {
    const EMPTY_HINT: typeof hint = {
      visible: false,
      label: '',
      status: 'pending',
      direction: null,
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

    const toPreview = (dx: number, dy: number): GesturePreview => {
      const absX = Math.abs(dx)
      const absY = Math.abs(dy)

      if (absX >= HORIZONTAL_THRESHOLD && absX >= absY * ANGLE_RATIO) {
        const direction = dx < 0 ? 'back' : 'forward'
        return {
          status: 'ready' as const,
          direction,
          label: direction === 'back' ? '松开后后退' : '松开后前进',
        }
      }

      if (absY > absX * 1.05 && absY >= ACTIVATE_DISTANCE * 2) {
        return {
          status: 'invalid' as const,
          direction: null,
          label: '无效手势：请水平拖动',
        }
      }

      if (absX < HORIZONTAL_THRESHOLD * 0.45) {
        return {
          status: 'pending' as const,
          direction: dx < 0 ? 'back' : 'forward',
          label: '继续水平拖动…',
        }
      }

      return {
        status: 'invalid' as const,
        direction: dx < 0 ? 'back' : 'forward',
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
      const preview = toPreview(state.lastDx, state.lastDy)
      scheduleHint({
        visible: true,
        label: preview.label,
        status: preview.status,
        direction: preview.direction,
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

      const dx = state.lastDx
      const dy = state.lastDy
      const absX = Math.abs(dx)
      const absY = Math.abs(dy)
      const passed = absX >= HORIZONTAL_THRESHOLD && absX >= absY * ANGLE_RATIO

      if (hadGestureMovement && passed) {
        armSuppressContextMenu()
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
      if (!suppressContextMenuRef.current) return
      e.preventDefault()
      e.stopPropagation()
      suppressContextMenuRef.current = false
      clearSuppressTimer()
    }

    const onWindowBlur = () => {
      stateRef.current.tracking = false
      stateRef.current.activated = false
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
      ? hint.direction === 'back'
        ? 'var(--color-warning)'
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

export function App() {
  return (
    <Router>
      <AppInit />
      <ThemeSync />
      <ProcessOutputListener />
      <SessionPoller />
      <MouseGestureNavigator />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/project/:projectId" element={<DetailPage />} />
        <Route path="/runtime/:projectId" element={<RuntimePage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </Router>
  )
}
