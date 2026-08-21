import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Clock3, Map } from 'lucide-react'
import { RecentProjectsDrawer, RecentProjectsMetaDialogHost } from '../components/RecentProjectsDrawer'
import { GlobalTitleTooltipBridge } from '../components/GlobalTitleTooltipBridge'
import { ToastViewport } from '../components/ui/toast'
import { useI18n } from '../i18n'
import { readEffectiveTheme } from '../hooks/useEffectiveTheme'
import { navigateHomeWithStartupDefaultReset, useMouseGestureNavigator } from '../hooks/useMouseGestureNavigator'
import { preloadProjectPane } from '../lib/projectPagePreload'
import { runtimeManager } from '../runtime/RuntimeManager'
import { useAppStore } from '../stores/appStore'
import { RouteCatalogDialogHost } from './RouteCatalogDialog'
import { GlobalProjectDropListener } from './GlobalProjectDropListener'
import { resolveTheme } from './windowTitle'

function ThemeSync() {
  const theme = useAppStore((s) => s.config.theme)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')

    const applyTheme = () => {
      const nextTheme = resolveTheme(theme)
      if (document.documentElement.getAttribute('data-theme-mode') !== theme) {
        document.documentElement.setAttribute('data-theme-mode', theme)
      }
      if (document.documentElement.getAttribute('data-theme') !== nextTheme) {
        document.documentElement.setAttribute('data-theme', nextTheme)
      }
      document.documentElement.style.colorScheme = nextTheme
      document.documentElement.style.backgroundColor = nextTheme === 'dark' ? '#09090b' : '#f5f7fb'
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

function ProcessOutputListener() {
  const appendOutput = useAppStore((s) => s.appendOutput)
  const updateProcessStatus = useAppStore((s) => s.updateProcessStatus)
  const handleProcessExit = useAppStore((s) => s.handleProcessExit)
  const refreshRuntimeState = useAppStore((s) => s.refreshRuntimeState)

  useEffect(() => {
    const unsubOutput = window.electronAPI.onProcessOutput(({ projectId, data }) => {
      appendOutput(projectId, data)
    })
    const unsubStatus = window.electronAPI.onProcessStatus(({ projectId, status }) => {
      updateProcessStatus(projectId, status)
      void refreshRuntimeState('sessions')
    })
    const unsubExit = window.electronAPI.onProcessExit(({ projectId, code }) => {
      handleProcessExit(projectId, code)
      void refreshRuntimeState('sessions')
    })
    return () => {
      unsubOutput()
      unsubStatus()
      unsubExit()
    }
  }, [appendOutput, updateProcessStatus, handleProcessExit, refreshRuntimeState])

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

function RuntimeStateListener() {
  const projectIds = useAppStore((s) =>
    s.projects
      .map((p) => p.id)
      .sort()
      .join(','),
  )
  const refreshRuntimeState = useAppStore((s) => s.refreshRuntimeState)

  useEffect(() => {
    if (!projectIds) return

    const unsubscribe = window.electronAPI.onRuntimeStateChanged(({ reason }) => {
      switch (reason) {
        case 'runtime-started':
        case 'tmux-killed':
        case 'terminal-stop-all':
        case 'runtime-registry-cleared':
          void refreshRuntimeState('all')
          break
        case 'terminal-opened':
        case 'terminal-focused':
          void refreshRuntimeState('sessions')
          break
        default:
          break
      }
    })

    return () => unsubscribe()
  }, [projectIds, refreshRuntimeState])

  return null
}

function SessionPoller() {
  const projectIds = useAppStore((s) =>
    s.projects
      .map((p) => p.id)
      .sort()
      .join(','),
  )
  const projects = useAppStore((s) => s.projects)
  const runtimeEntriesKey = useAppStore((s) =>
    Object.values(s.runtimeEntries)
      .map((entry) => `${entry.projectId}:${entry.sessionName}:${entry.mode ?? ''}`)
      .sort()
      .join('|'),
  )
  const processStatusesKey = useAppStore((s) =>
    Object.entries(s.processes)
      .map(([projectId, process]) => `${projectId}:${process.status}`)
      .sort()
      .join('|'),
  )
  const refreshRuntimeState = useAppStore((s) => s.refreshRuntimeState)
  const hasRuntimeEntries = runtimeEntriesKey.length > 0
  const hasLiveProcesses = processStatusesKey.includes(':running') || processStatusesKey.includes(':stopping')
  const shouldPollSessions = hasRuntimeEntries || hasLiveProcesses
  const shouldRefreshOnFocus = hasRuntimeEntries || hasLiveProcesses

  useEffect(() => {
    if (projects.length === 0 || !shouldPollSessions) {
      runtimeManager.stopPolling()
      return
    }
    runtimeManager.startPolling(() => {
      void refreshRuntimeState('sessions')
    }, 10000)
    return () => runtimeManager.stopPolling()
  }, [projectIds, projects.length, shouldPollSessions, refreshRuntimeState])

  useEffect(() => {
    if (projects.length === 0 || !shouldRefreshOnFocus) return

    const refreshNow = () => {
      void refreshRuntimeState('all')
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
  }, [projectIds, projects.length, refreshRuntimeState, shouldRefreshOnFocus])

  return null
}

function MouseGestureNavigatorOverlay() {
  const hint = useMouseGestureNavigator()

  if (!hint.visible) return null

  const pathPoints = hint.cursor ? [...hint.points, hint.cursor] : hint.points
  const polylinePoints = pathPoints.map((p) => `${p.x},${p.y}`).join(' ')
  const startPoint = pathPoints[0]
  const endPoint = pathPoints[pathPoints.length - 1]

  const strokeColor = hint.status === 'ready' ? (hint.action === 'back' ? 'var(--color-warning)' : hint.action === 'home' ? 'var(--color-primary)' : 'var(--color-success)') : hint.status === 'invalid' ? 'var(--color-destructive)' : 'var(--color-muted-foreground)'

  return (
    <div className="pointer-events-none fixed inset-0 z-[20050]">
      <svg className="h-full w-full">
        {polylinePoints.length > 0 ? <polyline points={polylinePoints} fill="none" stroke={strokeColor} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.82 }} /> : null}
        {startPoint ? <circle cx={startPoint.x} cy={startPoint.y} r={4} fill={strokeColor} style={{ opacity: 0.75 }} /> : null}
        {endPoint ? <circle cx={endPoint.x} cy={endPoint.y} r={5} fill={strokeColor} /> : null}
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
  const [metaDialogProjectId, setMetaDialogProjectId] = useState<string | null>(null)
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
      <div className="fixed bottom-5 right-5 z-[91] flex items-center gap-2">
        <button
          type="button"
          className="quiet-control inline-flex items-center gap-1.5 rounded-full border-0 px-3 py-1.5 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
          onClick={() => window.dispatchEvent(new CustomEvent('app:open-route-catalog'))}
          title={`${t('common.routeCatalog.title')} (${t('common.routeCatalog.shortcutHint')})`}
        >
          <Map className="h-3.5 w-3.5" />
          {t('common.routeCatalog.title')}
        </button>
        <button
          type="button"
          className="quiet-control inline-flex items-center gap-1.5 rounded-full border-0 px-3 py-1.5 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
          onClick={() => setOpen(true)}
          title={`${t('common.recentProjects')} (${t('common.recentProjectsHint')})`}
        >
          <Clock3 className="h-3.5 w-3.5" />
          {t('common.recentProjects')}
        </button>
      </div>

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
        onEditProjectMetadata={setMetaDialogProjectId}
      />

      {metaDialogProjectId && <RecentProjectsMetaDialogHost projectId={metaDialogProjectId} onClose={() => setMetaDialogProjectId(null)} />}
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

function AppNavigateListener() {
  const navigate = useNavigate()

  useEffect(() => {
    return window.electronAPI.onAppNavigate(({ path }) => {
      if (typeof path !== 'string' || !path.trim()) return
      navigate(path)
    })
  }, [navigate])

  return null
}

function MarkdownDocumentOpenListener() {
  const navigate = useNavigate()
  useEffect(
    () =>
      window.electronAPI.onMarkdownDocumentOpenRequested(({ path }) => {
        if (!path) return
        navigate('/markdown')
      }),
    [navigate],
  )
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
      const currentTheme = readEffectiveTheme()
      void setTheme(currentTheme === 'dark' ? 'light' : 'dark')
    })
  }, [setTheme])

  return null
}

function AppInit() {
  const initApp = useAppStore((s) => s.initApp)

  useEffect(() => {
    initApp()
  }, [initApp])

  return null
}

export function AppGlobalEffects() {
  return (
    <>
      <AppInit />
      <ThemeSync />
      <LocaleSync />
      <ProcessOutputListener />
      <TranscriptImportListener />
      <RuntimeStateListener />
      <SessionPoller />
      <MouseGestureNavigatorOverlay />
      <GlobalHomeShortcutListener />
      <AppNavigateListener />
      <MarkdownDocumentOpenListener />
      <ProjectRoutePreloader />
      <GlobalThemeShortcutListener />
      <GlobalProjectDropListener />
      <GlobalRecentProjectsDrawerHost />
      <RouteCatalogDialogHost />
      <GlobalTitleTooltipBridge />
      <ToastViewport />
    </>
  )
}
