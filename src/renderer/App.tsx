import { useEffect } from 'react'
import { MemoryRouter as Router, Routes, Route } from 'react-router-dom'
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
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/project/:projectId" element={<DetailPage />} />
        <Route path="/runtime/:projectId" element={<RuntimePage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </Router>
  )
}
