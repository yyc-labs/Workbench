import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { MemoryRouter as Router, Navigate, Route, Routes } from 'react-router-dom'
import { FileType2 } from 'lucide-react'
import { AppWindowTitleBar, WindowTitleSync } from './app/AppWindowTitleBar'
import { resolveTheme } from './app/windowTitle'
import { useI18n } from './i18n'
import { loadLearningCenterPageModule, loadMarkdownDocumentPageModule } from './lib/projectPagePreload'
import { useAppStore } from './stores/appStore'

const LearningCenterPage = lazy(() => loadLearningCenterPageModule().then((module) => ({ default: module.LearningCenterPage })))
const MarkdownDocumentPage = lazy(() => loadMarkdownDocumentPageModule().then((module) => ({ default: module.MarkdownDocumentPage })))

function AppViewWindowFallback() {
  const { t } = useI18n()
  return <div className="flex h-full items-center justify-center text-xs text-[color:var(--color-muted-foreground)]">{t('common.loading')}</div>
}

/**
 * 独立窗口专用引导：拉取配置(主题/语言)进 store 并同步到 document。
 * 不包含主 App 的全局导航、手势、最近项目抽屉等能力，保证窗口被锁定在当前视图。
 */
function AppViewWindowBootstrap() {
  const theme = useAppStore((state) => state.config.theme)
  const { locale } = useI18n()

  useEffect(() => {
    let alive = true
    void window.electronAPI
      .getConfig()
      .then((config) => {
        if (!alive) return
        useAppStore.setState((state) => ({ config: { ...state.config, ...config } }))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const applyTheme = () => {
      const nextTheme = resolveTheme(theme)
      document.documentElement.setAttribute('data-theme-mode', theme)
      document.documentElement.setAttribute('data-theme', nextTheme)
      document.documentElement.style.colorScheme = nextTheme
      document.documentElement.style.backgroundColor = nextTheme === 'dark' ? '#09090b' : '#f5f7fb'
    }
    applyTheme()

    if (theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onSystemThemeChange = () => applyTheme()
    media.addEventListener('change', onSystemThemeChange)
    return () => media.removeEventListener('change', onSystemThemeChange)
  }, [theme])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  return null
}

function AppViewWindowApp({ viewPath }: { viewPath: '/markdown' | '/learning' }) {
  return (
    <Router initialEntries={[viewPath]}>
      <AppViewWindowBootstrap />
      {viewPath === '/markdown' ? <MarkdownWindowDropListener /> : null}
      <WindowTitleSync />
      <div className="app-shell">
        <AppWindowTitleBar />
        <div className="app-content">
          <Suspense fallback={<AppViewWindowFallback />}>
            <Routes>
              {viewPath === '/markdown' ? <Route path="/markdown" element={<MarkdownDocumentPage />} /> : null}
              {viewPath === '/learning' ? <Route path="/learning" element={<LearningCenterPage />} /> : null}
              <Route path="*" element={<Navigate to={viewPath} replace />} />
            </Routes>
          </Suspense>
        </div>
      </div>
    </Router>
  )
}

/**
 * Markdown 独立窗口的文件拖拽接收:拖入 .md/.markdown 文件时直接打开。
 */
function MarkdownWindowDropListener() {
  const { t } = useI18n()
  const openMarkdownDocument = useAppStore((state) => state.openMarkdownDocument)
  const [isDragOver, setIsDragOver] = useState(false)
  const isDragOverRef = useRef(false)
  const dragHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastDragOverAtRef = useRef(0)

  const setDragOverlay = useCallback((next: boolean) => {
    if (isDragOverRef.current === next) return
    isDragOverRef.current = next
    setIsDragOver(next)
  }, [])

  const stopDragTracking = useCallback(() => {
    if (dragHeartbeatRef.current) {
      clearInterval(dragHeartbeatRef.current)
      dragHeartbeatRef.current = null
    }
    setDragOverlay(false)
  }, [setDragOverlay])

  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      const types = event.dataTransfer?.types
      const hasFiles = Boolean(types && (types.includes('Files') || (types as unknown as { contains?: (value: string) => boolean }).contains?.('Files')))
      if (!hasFiles) return

      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      setDragOverlay(true)
      lastDragOverAtRef.current = performance.now()

      if (!dragHeartbeatRef.current) {
        dragHeartbeatRef.current = setInterval(() => {
          if (performance.now() - lastDragOverAtRef.current > 180) {
            stopDragTracking()
          }
        }, 120)
      }
    }

    const onDrop = async (event: DragEvent) => {
      event.preventDefault()
      stopDragTracking()
      const files = event.dataTransfer?.files
      if (!files || files.length === 0) return

      const api = window.electronAPI
      const getPathForFile = typeof api.getPathForFile === 'function' ? api.getPathForFile : undefined
      for (const file of files) {
        const fileWithPath = file as File & { path?: string }
        const path = (getPathForFile?.(fileWithPath) || fileWithPath.path || '').trim()
        if (path && /\.(md|markdown)$/i.test(path)) {
          void openMarkdownDocument(path)
        }
      }
    }

    document.addEventListener('dragover', onDragOver)
    document.addEventListener('drop', onDrop)
    window.addEventListener('blur', stopDragTracking)
    return () => {
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('drop', onDrop)
      window.removeEventListener('blur', stopDragTracking)
      stopDragTracking()
    }
  }, [openMarkdownDocument, setDragOverlay, stopDragTracking])

  if (!isDragOver) return null

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[10001] flex items-center justify-center drag-overlay-border border-4 border-dashed"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
        borderColor: 'color-mix(in srgb, var(--color-primary) 28%, transparent)',
      }}
    >
      <div className="text-center">
        <div className="quiet-control mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-[28px]" style={{ color: 'var(--color-primary)' }}>
          <FileType2 className="h-9 w-9" strokeWidth={1.5} />
        </div>
        <p className="text-xl font-medium text-[color:var(--color-foreground)]">{t('markdownDocument.dropToOpen')}</p>
        <p className="mt-2 text-sm text-[color:var(--color-muted-foreground)]">{t('markdownDocument.dropDescription')}</p>
      </div>
    </div>
  )
}

export function MarkdownDocumentWindowApp() {
  return <AppViewWindowApp viewPath="/markdown" />
}

export function LearningCenterWindowApp() {
  return <AppViewWindowApp viewPath="/learning" />
}
