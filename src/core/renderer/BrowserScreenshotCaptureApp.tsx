import { Camera, Check, Clipboard, Download, Eye, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BrowserScreenshotCaptureMode, BrowserScreenshotFixedElementPolicy, BrowserScreenshotProgress, BrowserScreenshotResult, BrowserScreenshotTarget } from '../shared/types'
import { resolveTheme } from './app/windowTitle'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { Select } from './components/ui/select'
import { useI18n } from './i18n'
import { useAppStore } from './stores/appStore'

export function BrowserScreenshotCaptureApp() {
  const { t, locale } = useI18n()
  const theme = useAppStore((state) => state.config.theme)
  const [targets, setTargets] = useState<BrowserScreenshotTarget[]>([])
  const [targetId, setTargetId] = useState('')
  const [url, setUrl] = useState('')
  const [policy, setPolicy] = useState<BrowserScreenshotFixedElementPolicy>('keep')
  const [captureMode, setCaptureMode] = useState<BrowserScreenshotCaptureMode>('standard')
  const [progress, setProgress] = useState<BrowserScreenshotProgress | null>(null)
  const [result, setResult] = useState<BrowserScreenshotResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copying, setCopying] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<'copied' | 'saved' | null>(null)
  const [refreshingTargets, setRefreshingTargets] = useState(false)
  const [isDocked, setIsDocked] = useState(() => window.innerWidth <= 100)
  const feedbackTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const updateDockedState = () => setIsDocked(window.innerWidth <= 100)
    window.addEventListener('resize', updateDockedState)
    return () => window.removeEventListener('resize', updateDockedState)
  }, [])

  const applyTargets = useCallback((nextTargets: BrowserScreenshotTarget[]) => {
    setTargets(nextTargets)
    setTargetId((currentTargetId) => {
      if (nextTargets.some((target) => target.id === currentTargetId)) return currentTargetId
      return nextTargets.find((target) => target.isActiveCandidate)?.id ?? nextTargets[0]?.id ?? ''
    })
  }, [])

  const refreshTargets = useCallback(
    async (showAnimation = false) => {
      const startedAt = Date.now()
      if (showAnimation) setRefreshingTargets(true)
      try {
        const nextTargets = await window.electronAPI.listBrowserScreenshotTargets()
        applyTargets(nextTargets)
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : t('learning.browserScreenshot.loadFailed'))
      } finally {
        if (showAnimation) {
          const remaining = Math.max(0, 350 - (Date.now() - startedAt))
          if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining))
          setRefreshingTargets(false)
        }
      }
    },
    [applyTargets, t],
  )

  useEffect(() => {
    void window.electronAPI
      .getConfig()
      .then((config) => {
        useAppStore.setState((state) => ({ config: { ...state.config, theme: config.theme, locale: config.locale } }))
      })
      .catch(() => undefined)
    void refreshTargets()
    const refreshTimer = window.setInterval(() => void refreshTargets(), 3000)
    const unsubscribeTargets = window.electronAPI.onBrowserScreenshotTargetsChanged(applyTargets)
    const unsubscribe = window.electronAPI.onBrowserScreenshotProgress((nextProgress) => setProgress(nextProgress))
    return () => {
      window.clearInterval(refreshTimer)
      unsubscribeTargets()
      unsubscribe()
      if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current)
    }
  }, [applyTargets, refreshTargets])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      void window.electronAPI.closeWindow()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const effectiveTheme = resolveTheme(theme)
    document.documentElement.setAttribute('data-theme-mode', theme)
    document.documentElement.setAttribute('data-theme', effectiveTheme)
    document.documentElement.style.colorScheme = effectiveTheme
    document.documentElement.lang = locale
  }, [locale, theme])

  const isRunning = Boolean(progress?.taskId && !['completed', 'failed', 'cancelled'].includes(progress.stage))
  const targetOptions = useMemo(
    () =>
      targets.map((target) => {
        const title = target.title.length > 30 ? `${target.title.slice(0, 30)}…` : target.title
        const url = target.url.length > 30 ? `${target.url.slice(0, 30)}…` : target.url
        return { value: target.id, label: target.title === target.url ? url : `${title} · ${url}` }
      }),
    [targets],
  )

  const showFeedback = (kind: 'copied' | 'saved') => {
    setFeedback(kind)
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current)
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(null), 2200)
  }

  const start = async () => {
    if (!targetId || loading || isRunning) return
    setLoading(true)
    setError(null)
    setResult(null)
    setFeedback(null)
    try {
      const nextResult = await window.electronAPI.startBrowserScreenshot({ targetId: targetId || undefined, url: url.trim() || undefined, captureMode, fixedElementPolicy: policy })
      setResult(nextResult)
      if (nextResult.status === 'completed') {
        const opened = await window.electronAPI.openBrowserScreenshotViewer({ pngBase64: nextResult.pngBase64 ?? '', title: nextResult.title ?? 'browser-page', width: nextResult.width, height: nextResult.height })
        if (!opened) setError(t('learning.browserScreenshot.openViewerFailed'))
      }
      if (nextResult.status !== 'completed') setError(nextResult.errorMessage ?? t('learning.browserScreenshot.failed'))
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : t('learning.browserScreenshot.failed'))
    } finally {
      setLoading(false)
    }
  }

  const openViewer = async () => {
    if (!result?.pngBase64) return
    setError(null)
    try {
      if (!(await window.electronAPI.openBrowserScreenshotViewer({ pngBase64: result.pngBase64, title: result.title ?? 'browser-page', width: result.width, height: result.height }))) setError(t('learning.browserScreenshot.openViewerFailed'))
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : t('learning.browserScreenshot.openViewerFailed'))
    }
  }

  const copy = async () => {
    if (!result?.pngBase64) return
    setCopying(true)
    setError(null)
    try {
      if (await window.electronAPI.writeClipboardImagePngBase64(result.pngBase64)) showFeedback('copied')
      else setError(t('learning.browserScreenshot.copyFailed'))
    } finally {
      setCopying(false)
    }
  }

  const save = async () => {
    if (!result?.pngBase64) return
    setSaving(true)
    setError(null)
    try {
      const name = `${(result.title || 'browser-page').replace(/[\\/:*?"<>|]+/g, '_')}-screenshot.png`
      if (await window.electronAPI.saveBrowserScreenshot(result.pngBase64, name)) showFeedback('saved')
    } finally {
      setSaving(false)
    }
  }

  if (isDocked) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[color:var(--color-background)]">
        <Button variant="ghost" size="icon" className="h-12 w-12 rounded-[16px]" onClick={() => void window.electronAPI.toggleBrowserScreenshotWindow()} title={t('learning.browserScreenshot.title')} aria-label={t('learning.browserScreenshot.title')}>
          <Camera className="h-6 w-6" />
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-stretch justify-center bg-[color:var(--color-background)] p-2.5">
      <div className="surface-card app-drag-region relative grid min-h-0 w-full grid-rows-[auto_1fr_auto] overflow-hidden rounded-[24px]">
        <header className="relative flex items-start justify-between gap-3 px-4 pb-2.5 pt-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[15px] bg-[color:var(--color-primary)] text-white shadow-sm">
              <Camera className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2">
                <span className="section-label">{t('learning.browserScreenshot.kicker')}</span>
                <span className="rounded-full bg-[color:var(--color-accent)] px-2 py-0.5 font-mono text-[10px]">Ctrl Shift S</span>
              </div>
              <h1 className="truncate text-[18px] font-semibold text-[color:var(--color-foreground)]">{t('learning.browserScreenshot.title')}</h1>
            </div>
          </div>
          <div className="app-no-drag flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8 transition-transform duration-200 active:scale-90" onClick={() => void refreshTargets(true)} disabled={refreshingTargets} title={t('learning.browserScreenshot.refreshTargets')}>
              <RefreshCw className={refreshingTargets ? 'animate-spin' : ''} />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void window.electronAPI.closeWindow()} title={t('common.close')}>
              <X />
            </Button>
          </div>
        </header>
        <main className="min-h-0 space-y-3 overflow-y-auto px-4 pb-3">
          <div className="grid gap-2">
            <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder={t('learning.browserScreenshot.urlPlaceholder')} aria-label={t('learning.browserScreenshot.url')} className="app-no-drag h-9 text-sm md:text-sm" />
            <div className="flex items-center gap-2">
              <Select ariaLabel={t('learning.browserScreenshot.target')} value={targetId} options={targetOptions} onChange={setTargetId} emptyText={t('learning.browserScreenshot.noTargets')} className="min-w-0 flex-1" triggerClassName="app-no-drag h-9" />
            </div>
            <Select
              ariaLabel={t('learning.browserScreenshot.fixedPolicy')}
              value={policy}
              options={[
                { value: 'keep', label: t('learning.browserScreenshot.keepFixed') },
                { value: 'hide', label: t('learning.browserScreenshot.hideFixed') },
              ]}
              onChange={(value) => setPolicy(value as BrowserScreenshotFixedElementPolicy)}
              triggerClassName="app-no-drag h-9"
            />
            <Select
              ariaLabel={t('learning.browserScreenshot.captureMode')}
              value={captureMode}
              options={[
                { value: 'standard', label: t('learning.browserScreenshot.standardMode') },
                { value: 'precise', label: t('learning.browserScreenshot.preciseMode') },
              ]}
              onChange={(value) => setCaptureMode(value as BrowserScreenshotCaptureMode)}
              triggerClassName="app-no-drag h-9"
            />
          </div>
          {progress ? (
            <div className={`rounded-[10px] bg-[color:var(--color-accent)] px-3 py-2 text-xs ${isRunning ? 'animate-pulse' : ''}`}>
              {progress.message ?? t('learning.browserScreenshot.running')}
              {typeof progress.percent === 'number' ? ` · ${progress.percent}%` : ''}
            </div>
          ) : null}
          {feedback ? (
            <div className="flex items-center gap-2 rounded-[10px] bg-[color:var(--color-primary)]/10 px-3 py-2 text-xs animate-pulse">
              <Check className="h-4 w-4 text-[color:var(--color-primary)]" />
              {feedback === 'copied' ? t('learning.browserScreenshot.copySuccess') : t('learning.browserScreenshot.saveSuccess')}
            </div>
          ) : null}
          {error ? <p className="text-xs text-[color:var(--color-destructive)]">{error}</p> : null}
          {result?.status === 'completed' ? <p className="text-[11px] text-[color:var(--color-muted-foreground)]">{t('learning.browserScreenshot.completed', { value: `${result.width ?? 0} × ${result.height ?? 0}` })}</p> : null}
        </main>
        <footer className="app-no-drag flex justify-end gap-2 border-t px-4 py-3" style={{ borderColor: 'var(--color-border)' }}>
          {result?.status === 'completed' ? (
            <Button variant="outline" size="sm" onClick={() => void openViewer()}>
              <Eye />
              {t('learning.browserScreenshot.viewImage')}
            </Button>
          ) : null}
          {result?.status === 'completed' ? (
            <Button variant={feedback === 'copied' ? 'default' : 'outline'} size="sm" loading={copying} disabled={saving} onClick={() => void copy()}>
              {feedback === 'copied' ? <Check /> : <Clipboard />}
              {feedback === 'copied' ? t('learning.browserScreenshot.copySuccess') : t('learning.browserScreenshot.copy')}
            </Button>
          ) : null}
          {result?.status === 'completed' ? (
            <Button variant={feedback === 'saved' ? 'default' : 'outline'} size="sm" loading={saving} disabled={copying} onClick={() => void save()}>
              <Download />
              {feedback === 'saved' ? t('learning.browserScreenshot.saveSuccess') : t('learning.browserScreenshot.save')}
            </Button>
          ) : null}
          {isRunning ? (
            <Button variant="outline" size="sm" onClick={() => void window.electronAPI.cancelBrowserScreenshot(progress!.taskId)}>
              {t('learning.browserScreenshot.cancel')}
            </Button>
          ) : null}
          <Button size="sm" loading={loading} disabled={(!targetId && !url.trim()) || isRunning} onClick={() => void start()}>
            <Camera />
            {t('learning.browserScreenshot.start')}
          </Button>
        </footer>
      </div>
    </div>
  )
}
