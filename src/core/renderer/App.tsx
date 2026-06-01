import { useEffect, useMemo, useRef, useState } from 'react'
import { MemoryRouter as Router, Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { HomePage } from './pages/Home'
import { DetailPage } from './pages/Detail'
import { SettingsPage } from './pages/Settings'
import { useAppStore } from './stores/appStore'
import { runtimeManager } from './runtime/RuntimeManager'
import type { AppConfig } from '../shared/types'
import { Clock3, Copy, Minus, Square, X } from 'lucide-react'
import { GlobalTitleTooltipBridge } from './components/GlobalTitleTooltipBridge'
import { RecentProjectsDrawer } from './components/RecentProjectsDrawer'
import { useMouseGestureNavigator } from './hooks/useMouseGestureNavigator'

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
  const refreshSessions = useAppStore((s) => s.refreshSessions)

  useEffect(() => {
    const unsubOutput = window.electronAPI.onProcessOutput(
      ({ projectId, data }) => { appendOutput(projectId, data) }
    )
    const unsubStatus = window.electronAPI.onProcessStatus(
      ({ projectId, status }) => {
        updateProcessStatus(projectId, status)
        void refreshSessions()
      }
    )
    const unsubExit = window.electronAPI.onProcessExit(
      ({ projectId, code }) => {
        handleProcessExit(projectId, code)
        void refreshSessions()
      }
    )
    return () => { unsubOutput(); unsubStatus(); unsubExit() }
  }, [appendOutput, updateProcessStatus, handleProcessExit, refreshSessions])

  return null
}

/** Event-driven session refresh path — main process pushes runtime/tmux changes.
 *  Debounced to coalesce bursts from related IPC actions. */
function RuntimeStateListener() {
  const projectIds = useAppStore((s) =>
    s.projects.map((p) => p.id).sort().join(',')
  )
  const loadRuntimeEntries = useAppStore((s) => s.loadRuntimeEntries)
  const refreshSessions = useAppStore((s) => s.refreshSessions)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!projectIds) return

    const flush = () => {
      timerRef.current = null
      void (async () => {
        await loadRuntimeEntries()
        await refreshSessions()
      })()
    }

    const scheduleRefresh = () => {
      if (timerRef.current !== null) return
      timerRef.current = setTimeout(flush, 120)
    }

    const unsubscribe = window.electronAPI.onRuntimeStateChanged(() => {
      scheduleRefresh()
    })

    return () => {
      unsubscribe()
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [projectIds, loadRuntimeEntries, refreshSessions])

  return null
}

/** Centralized session polling — RuntimeManager calls onRefresh on each tick,
 *  onRefresh is the store's refreshSessions (single source of truth).
 *  Uses stable project identity string to avoid re-subscribing.
 *  Event-driven updates are primary; polling is low-frequency fallback only. */
function SessionPoller() {
  const projectIds = useAppStore((s) =>
    s.projects.map((p) => p.id).sort().join(',')
  )
  const projects = useAppStore((s) => s.projects)
  const loadRuntimeEntries = useAppStore((s) => s.loadRuntimeEntries)
  const refreshSessions = useAppStore((s) => s.refreshSessions)

  useEffect(() => {
    if (projects.length === 0) return
    runtimeManager.startPolling(() => { refreshSessions() }, 10000)
    return () => runtimeManager.stopPolling()
  }, [projectIds]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (projects.length === 0) return

    const refreshNow = () => {
      void (async () => {
        await loadRuntimeEntries()
        await refreshSessions()
      })()
    }

    const onFocus = () => refreshNow()
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        refreshNow()
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [projectIds, projects.length, loadRuntimeEntries, refreshSessions])

  return null
}

function MouseGestureNavigator() {
  const hint = useMouseGestureNavigator()

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

function GlobalRecentProjectsDrawerHost() {
  const location = useLocation()
  const navigate = useNavigate()
  const projects = useAppStore((s) => s.projects)
  const updateLastOpened = useAppStore((s) => s.updateLastOpened)
  const clearProjectLastOpened = useAppStore((s) => s.clearProjectLastOpened)
  const [open, setOpen] = useState(false)

  const currentProjectId = useMemo(() => {
    const segments = location.pathname.split('/').filter(Boolean)
    return segments[0] === 'project' && segments[1] ? segments[1] : undefined
  }, [location.pathname])

  useEffect(() => {
    const onOpenRecentDrawer = () => setOpen(true)
    window.addEventListener('app:open-recent-project-drawer', onOpenRecentDrawer as EventListener)
    return () => {
      window.removeEventListener('app:open-recent-project-drawer', onOpenRecentDrawer as EventListener)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <>
      <button
        type="button"
        className="fixed bottom-5 right-5 z-[91] quiet-control inline-flex items-center gap-1.5 rounded-full border-0 px-3 py-1.5 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
        onClick={() => setOpen(true)}
        title="最近项目（右键下滑或 Ctrl/Cmd+Shift+P）"
      >
        <Clock3 className="h-3.5 w-3.5" />
        最近项目
      </button>

      <RecentProjectsDrawer
        open={open}
        currentProjectId={currentProjectId}
        projects={projects}
        onClose={() => setOpen(false)}
        onSelectProject={(projectId) => {
          updateLastOpened(projectId)
          setOpen(false)
          navigate(`/project/${projectId}/code`)
        }}
        onRemoveProject={(projectId) => {
          void clearProjectLastOpened(projectId)
        }}
      />
    </>
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
          {isMaximized
            ? <Copy className="h-3.5 w-3.5" strokeWidth={1.7} />
            : <Square className="h-3.5 w-3.5" strokeWidth={1.7} />}
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
      <RuntimeStateListener />
      <SessionPoller />
      <MouseGestureNavigator />
      <GlobalRecentProjectsDrawerHost />
      <GlobalTitleTooltipBridge />
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
