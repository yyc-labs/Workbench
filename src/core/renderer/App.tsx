import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { MemoryRouter as Router, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAppStore } from './stores/appStore'
import { runtimeManager } from './runtime/RuntimeManager'
import type { AppConfig } from '../shared/types'
import { Clock3, Copy, Minus, Square, X } from 'lucide-react'
import { GlobalTitleTooltipBridge } from './components/GlobalTitleTooltipBridge'
import { RecentProjectsDrawer } from './components/RecentProjectsDrawer'
import { useI18n } from './i18n'
import {
  navigateHomeWithStartupDefaultReset,
  useMouseGestureNavigator,
} from './hooks/useMouseGestureNavigator'
import {
  DEFAULT_SETTINGS_SECTION,
  isSettingsSection,
  type Section,
} from './pages/settings/settings.types'
import {
  loadDetailPageModule,
  loadHomePageModule,
  loadSettingsPageModule,
  loadTranscriptPageModule,
  preloadProjectPane,
} from './lib/projectPagePreload'

const HomePage = lazy(() => loadHomePageModule().then((module) => ({ default: module.HomePage })))
const DetailPage = lazy(() => loadDetailPageModule().then((module) => ({ default: module.DetailPage })))
const TranscriptPage = lazy(() => loadTranscriptPageModule().then((module) => ({ default: module.TranscriptPage })))
const SettingsPage = lazy(() => loadSettingsPageModule().then((module) => ({ default: module.SettingsPage })))

const WINDOW_ICON_SRC = new URL('../../../icon/Y.png', import.meta.url).href
const APP_DISPLAY_NAME = 'IDE Electron'

function toTitleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}

function resolveWindowTitle(pathname: string, projects: Array<{
  id: string
  name: string
  customName?: string
}>, getSettingsSectionLabel: (section: Section) => string, appName: string, settingsLabel: string): string {
  const segments = pathname.split('/').filter(Boolean)

  if (segments[0] === 'settings') {
    if (isSettingsSection(segments[1])) {
      return `${settingsLabel} - ${getSettingsSectionLabel(segments[1])} - ${appName}`
    }
    return `${settingsLabel} - ${appName}`
  }

  if (segments[0] === 'project' && segments[1]) {
    const project = projects.find((item) => item.id === segments[1])
    const projectLabel = project?.customName?.trim() || project?.name || 'Project'
    const paneLabel = segments[2] ? toTitleCase(segments[2]) : null
    return paneLabel
      ? `${projectLabel} - ${paneLabel} - ${appName}`
      : `${projectLabel} - ${appName}`
  }

  return appName
}

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

function LocaleSync() {
  const { locale } = useI18n()

  useEffect(() => {
    if (document.documentElement.lang !== locale) {
      document.documentElement.lang = locale
    }
  }, [locale])

  return null
}

function useWindowTitleText(): string {
  const location = useLocation()
  const projects = useAppStore((s) => s.projects)
  const { t, getSettingsSectionLabel } = useI18n()

  return useMemo(
    () => resolveWindowTitle(
      location.pathname,
      projects,
      getSettingsSectionLabel,
      t('appName'),
      t('settings.title')
    ),
    [getSettingsSectionLabel, location.pathname, projects, t]
  )
}

function WindowTitleSync() {
  const title = useWindowTitleText()

  useEffect(() => {
    if (document.title !== title) {
      document.title = title
    }
  }, [title])

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

function TranscriptImportListener() {
  const navigate = useNavigate()
  const upsertTranscriptSession = useAppStore((s) => s.upsertTranscriptSession)

  useEffect(() => {
    return window.electronAPI.onTranscriptImported(({ session, openViewer }) => {
      upsertTranscriptSession(session, { activate: true, initialMode: 'preview' })
      if (openViewer) {
        navigate(`/project/${session.projectId}/transcript`)
      }
    })
  }, [navigate, upsertTranscriptSession])

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
  const pendingModeRef = useRef<'sessions' | 'all'>('sessions')

  useEffect(() => {
    if (!projectIds) return

    const flush = (mode: 'sessions' | 'all') => {
      timerRef.current = null
      void (async () => {
        if (mode === 'all') {
          await loadRuntimeEntries()
        }
        await refreshSessions()
      })()
    }

    const scheduleRefresh = (mode: 'sessions' | 'all') => {
      if (mode === 'all') {
        pendingModeRef.current = 'all'
      }
      if (timerRef.current !== null) return
      pendingModeRef.current = mode
      timerRef.current = setTimeout(() => { flush(pendingModeRef.current) }, 120)
    }

    const unsubscribe = window.electronAPI.onRuntimeStateChanged(({ reason }) => {
      switch (reason) {
        case 'runtime-started':
        case 'tmux-killed':
        case 'terminal-stop-all':
        case 'runtime-registry-cleared':
          scheduleRefresh('all')
          break
        case 'terminal-opened':
        case 'terminal-focused':
          scheduleRefresh('sessions')
          break
        default:
          break
      }
    })

    return () => {
      unsubscribe()
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      pendingModeRef.current = 'sessions'
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
  const runtimeEntriesKey = useAppStore((s) =>
    Object.values(s.runtimeEntries)
      .map((entry) => `${entry.projectId}:${entry.sessionName}:${entry.mode ?? ''}`)
      .sort()
      .join('|')
  )
  const processStatusesKey = useAppStore((s) =>
    Object.entries(s.processes)
      .map(([projectId, process]) => `${projectId}:${process.status}`)
      .sort()
      .join('|')
  )
  const loadRuntimeEntries = useAppStore((s) => s.loadRuntimeEntries)
  const refreshSessions = useAppStore((s) => s.refreshSessions)
  const hasRuntimeEntries = runtimeEntriesKey.length > 0
  const hasLiveProcesses = processStatusesKey.includes(':running') || processStatusesKey.includes(':stopping')
  const shouldPollSessions = hasRuntimeEntries || hasLiveProcesses

  useEffect(() => {
    if (projects.length === 0 || !shouldPollSessions) {
      runtimeManager.stopPolling()
      return
    }
    runtimeManager.startPolling(() => { refreshSessions() }, 10000)
    return () => runtimeManager.stopPolling()
  }, [projectIds, shouldPollSessions]) // eslint-disable-line react-hooks/exhaustive-deps

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
          className="mouse-gesture-hint rounded-[14px] px-3 py-2 text-xs text-[color:var(--color-foreground)]"
          style={{
            background: 'var(--color-popover)',
            border: '1px solid var(--color-border)',
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
  const updateLastOpened = useAppStore((s) => s.updateLastOpened)
  const clearProjectLastOpened = useAppStore((s) => s.clearProjectLastOpened)
  const [open, setOpen] = useState(false)
  const { t } = useI18n()

  const currentProjectId = useMemo(() => {
    const segments = location.pathname.split('/').filter(Boolean)
    return segments[0] === 'project' && segments[1] ? segments[1] : undefined
  }, [location.pathname])

  useEffect(() => {
    const onOpenRecentDrawer = () => setOpen(true)
    const onToggleRecentDrawer = () => setOpen((prev) => !prev)
    window.addEventListener('app:open-recent-project-drawer', onOpenRecentDrawer as EventListener)
    window.addEventListener('app:toggle-recent-project-drawer', onToggleRecentDrawer as EventListener)
    return () => {
      window.removeEventListener('app:open-recent-project-drawer', onOpenRecentDrawer as EventListener)
      window.removeEventListener('app:toggle-recent-project-drawer', onToggleRecentDrawer as EventListener)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        if (event.repeat) return
        setOpen((prev) => !prev)
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
        title={`${t('common.recentProjects')} (${t('common.recentProjectsHint')})`}
      >
        <Clock3 className="h-3.5 w-3.5" />
        {t('common.recentProjects')}
      </button>

      <RecentProjectsDrawer
        open={open}
        currentProjectId={currentProjectId}
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

function GlobalHomeShortcutListener() {
  const navigate = useNavigate()

  useEffect(() => {
    return window.electronAPI.onGlobalHomeShortcut(() => {
      navigateHomeWithStartupDefaultReset(navigate)
    })
  }, [navigate])

  return null
}

function ProjectRoutePreloader() {
  const location = useLocation()

  useEffect(() => {
    const segments = location.pathname.split('/').filter(Boolean)
    if (segments[0] !== 'project' || !segments[1]) return
    preloadProjectPane(segments[2])
  }, [location.pathname])

  return null
}

function GlobalThemeShortcutListener() {
  const setTheme = useAppStore((s) => s.setTheme)

  useEffect(() => {
    return window.electronAPI.onGlobalThemeShortcut(() => {
      const currentTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
      void setTheme(currentTheme === 'dark' ? 'light' : 'dark')
    })
  }, [setTheme])

  return null
}

function AppInit() {
  const initApp = useAppStore((s) => s.initApp)
  useEffect(() => { initApp() }, [initApp])
  return null
}

function WindowTitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)
  const title = useWindowTitleText()
  const { t } = useI18n()

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
          alt={`${t('appName')} icon`}
          className="mr-2 h-4 w-4 shrink-0 rounded-[4px]"
          draggable={false}
        />
        <span className="truncate text-[12px] font-medium text-[color:var(--color-muted-foreground)]">{title}</span>
      </div>
      <div className="window-titlebar__controls nodrag">
        <button
          className="window-titlebar__button window-titlebar__button--neutral"
          aria-label={t('common.minimize')}
          title={t('common.minimize')}
          onClick={() => {
            void window.electronAPI.minimizeWindow()
          }}
        >
          <Minus className="h-3.5 w-3.5" strokeWidth={1.7} />
        </button>
        <button
          className="window-titlebar__button window-titlebar__button--neutral"
          aria-label={isMaximized ? t('common.restore') : t('common.maximize')}
          title={isMaximized ? t('common.restore') : t('common.maximize')}
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
          aria-label={t('common.closeWindow')}
          title={t('common.closeWindow')}
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

function AppRouteFallback() {
  const { t } = useI18n()
  const location = useLocation()
  const isProjectRoute = location.pathname.startsWith('/project/')

  if (isProjectRoute) {
    return (
      <div className="flex h-full min-h-0 flex-col px-6 pb-6 pt-5 sm:px-8">
        <div className="mx-auto flex h-full min-h-0 w-full max-w-[1360px]">
          <div className="flex h-full min-h-0 flex-1 items-center justify-center rounded-[20px] border border-[color:var(--color-border)] bg-[color:var(--color-card)]/50 text-xs text-[color:var(--color-muted-foreground)]">
            {t('common.loading')}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center text-xs text-[color:var(--color-muted-foreground)]">
      {t('common.loading')}
    </div>
  )
}

function ProjectDetailRoute() {
  const { projectId } = useParams<{ projectId: string }>()
  return <DetailPage key={projectId ?? 'unknown-project'} />
}

function ProjectTranscriptRoute() {
  const { projectId } = useParams<{ projectId: string }>()
  return <TranscriptPage key={projectId ?? 'unknown-project'} />
}

export function App() {
  return (
    <Router>
      <AppInit />
      <ThemeSync />
      <LocaleSync />
      <WindowTitleSync />
      <ProcessOutputListener />
      <TranscriptImportListener />
      <RuntimeStateListener />
      <SessionPoller />
      <MouseGestureNavigator />
      <GlobalHomeShortcutListener />
      <ProjectRoutePreloader />
      <GlobalThemeShortcutListener />
      <GlobalRecentProjectsDrawerHost />
      <GlobalTitleTooltipBridge />
      <div className="app-shell">
        <WindowTitleBar />
        <div className="app-content">
          <Suspense fallback={<AppRouteFallback />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/project/:projectId" element={<Navigate to="code" replace />} />
              <Route path="/project/:projectId/transcript" element={<ProjectTranscriptRoute />} />
              <Route path="/project/:projectId/:pane" element={<ProjectDetailRoute />} />
              <Route
                path="/settings"
                element={<Navigate to={`/settings/${DEFAULT_SETTINGS_SECTION}`} replace />}
              />
              <Route path="/settings/:section" element={<SettingsPage />} />
            </Routes>
          </Suspense>
        </div>
      </div>
    </Router>
  )
}
