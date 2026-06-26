import { lazy, Suspense } from 'react'
import { MemoryRouter as Router, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useI18n } from './i18n'
import {
  DEFAULT_SETTINGS_SECTION,
} from './pages/settings/settings.types'
import {
  loadDetailPageModule,
  loadHomePageModule,
  loadLearningCenterPageModule,
  loadSettingsPageModule,
  loadTranscriptPageModule,
  preloadProjectPane,
} from './lib/projectPagePreload'
import { AppGlobalEffects } from './app/AppGlobalEffects'
import { AppWindowTitleBar, WindowTitleSync } from './app/AppWindowTitleBar'

const HomePage = lazy(() => loadHomePageModule().then((module) => ({ default: module.HomePage })))
const DetailPage = lazy(() => loadDetailPageModule().then((module) => ({ default: module.DetailPage })))
const TranscriptPage = lazy(() => loadTranscriptPageModule().then((module) => ({ default: module.TranscriptPage })))
const SettingsPage = lazy(() => loadSettingsPageModule().then((module) => ({ default: module.SettingsPage })))
const LearningCenterPage = lazy(() => loadLearningCenterPageModule().then((module) => ({ default: module.LearningCenterPage })))

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

function LearningCenterRoute() {
  return <LearningCenterPage />
}

export function App() {
  return (
    <Router>
      <WindowTitleSync />
      <AppGlobalEffects />
      <div className="app-shell">
        <AppWindowTitleBar />
        <div className="app-content">
          <Suspense fallback={<AppRouteFallback />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/learning" element={<LearningCenterRoute />} />
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
