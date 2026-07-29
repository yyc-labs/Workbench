import { ArrowLeft, Camera, Check, Clipboard, Download, ExternalLink, X } from 'lucide-react'
import { type PointerEvent, type WheelEvent, useEffect, useRef, useState } from 'react'
import type { BrowserScreenshotViewerPayload } from '../shared/types'
import { resolveTheme } from './app/windowTitle'
import { Button } from './components/ui/button'
import { useI18n } from './i18n'
import { useAppStore } from './stores/appStore'

const MIN_ZOOM = 0.1
const MAX_ZOOM = 20

export function BrowserScreenshotViewerApp() {
  const { t, locale } = useI18n()
  const theme = useAppStore((state) => state.config.theme)
  const [payload, setPayload] = useState<BrowserScreenshotViewerPayload | null>(null)
  const [copying, setCopying] = useState(false)
  const [saving, setSaving] = useState(false)
  const [openingDefaultApp, setOpeningDefaultApp] = useState(false)
  const [feedback, setFeedback] = useState<'copied' | 'saved' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const feedbackTimerRef = useRef<number | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const canvasRef = useRef<HTMLElement | null>(null)
  const zoomRef = useRef(1)
  const offsetRef = useRef({ x: 0, y: 0 })
  const draggingRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)

  useEffect(() => {
    void window.electronAPI
      .getConfig()
      .then((config) => {
        useAppStore.setState((state) => ({ config: { ...state.config, theme: config.theme, locale: config.locale } }))
      })
      .catch(() => undefined)
    const unsubscribe = window.electronAPI.onBrowserScreenshotViewerData(setPayload)
    void window.electronAPI.getBrowserScreenshotViewerData().then((nextPayload) => {
      if (nextPayload) setPayload(nextPayload)
    })
    return () => {
      unsubscribe()
      if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current)
    }
  }, [])

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

  useEffect(() => {
    zoomRef.current = 1
    offsetRef.current = { x: 0, y: 0 }
    if (imageRef.current) imageRef.current.style.transform = 'translate3d(0px, 0px, 0) scale(1)'
  }, [payload])

  useEffect(() => {
    if (!payload) return
    const revealWhenReady = () => {
      if (imageRef.current?.complete) void window.electronAPI.markBrowserScreenshotViewerReady()
    }
    const frame = window.requestAnimationFrame(revealWhenReady)
    return () => window.cancelAnimationFrame(frame)
  }, [payload])

  const handleWheel = (event: WheelEvent<HTMLElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const bounds = canvas.getBoundingClientRect()
    const cursor = { x: event.clientX - (bounds.left + bounds.width / 2), y: event.clientY - (bounds.top + bounds.height / 2) }
    const currentZoom = zoomRef.current
    const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, currentZoom * Math.pow(1.0015, -event.deltaY)))
    const scale = nextZoom / currentZoom
    const nextOffset = {
      x: cursor.x - (cursor.x - offsetRef.current.x) * scale,
      y: cursor.y - (cursor.y - offsetRef.current.y) * scale,
    }
    zoomRef.current = nextZoom
    offsetRef.current = nextOffset
    if (imageRef.current) imageRef.current.style.transform = `translate3d(${nextOffset.x}px, ${nextOffset.y}px, 0) scale(${nextZoom})`
  }

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    draggingRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    setIsDragging(true)
  }

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const dragging = draggingRef.current
    if (!dragging || dragging.pointerId !== event.pointerId) return
    const deltaX = event.clientX - dragging.x
    const deltaY = event.clientY - dragging.y
    draggingRef.current = { ...dragging, x: event.clientX, y: event.clientY }
    const nextOffset = { x: offsetRef.current.x + deltaX, y: offsetRef.current.y + deltaY }
    offsetRef.current = nextOffset
    if (imageRef.current) imageRef.current.style.transform = `translate3d(${nextOffset.x}px, ${nextOffset.y}px, 0) scale(${zoomRef.current})`
  }

  const handlePointerUp = (event: PointerEvent<HTMLElement>) => {
    if (draggingRef.current?.pointerId !== event.pointerId) return
    draggingRef.current = null
    setIsDragging(false)
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const showFeedback = (kind: 'copied' | 'saved') => {
    setFeedback(kind)
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current)
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(null), 2200)
  }

  const fileName = `${(payload?.title || 'browser-page').replace(/[\\/:*?"<>|]+/g, '_')}-screenshot.png`

  const copy = async () => {
    if (!payload) return
    setCopying(true)
    setError(null)
    try {
      if (await window.electronAPI.writeClipboardImagePngBase64(payload.pngBase64)) showFeedback('copied')
      else setError(t('learning.browserScreenshot.copyFailed'))
    } finally {
      setCopying(false)
    }
  }

  const save = async () => {
    if (!payload) return
    setSaving(true)
    setError(null)
    try {
      if (await window.electronAPI.saveBrowserScreenshot(payload.pngBase64, fileName)) showFeedback('saved')
    } finally {
      setSaving(false)
    }
  }

  const openInDefaultApp = async () => {
    if (!payload) return
    setOpeningDefaultApp(true)
    setError(null)
    try {
      if (!(await window.electronAPI.openBrowserScreenshotInDefaultApp(payload.pngBase64, fileName))) setError(t('learning.browserScreenshot.openDefaultFailed'))
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : t('learning.browserScreenshot.openDefaultFailed'))
    } finally {
      setOpeningDefaultApp(false)
    }
  }

  return (
    <div className="flex h-screen flex-col bg-[color:var(--color-background)] text-[color:var(--color-foreground)]">
      <header className="app-drag-region flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2.5" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[13px] bg-[color:var(--color-primary)] text-white shadow-sm">
            <Camera className="h-5 w-5" />
          </div>
          <div className="app-no-drag min-w-0">
            <div className="section-label">{t('learning.browserScreenshot.kicker')}</div>
            <h1 className="truncate text-sm font-semibold">{payload?.title || t('learning.browserScreenshot.preview')}</h1>
            {payload ? <p className="mt-0.5 text-[11px] text-[color:var(--color-muted-foreground)]">{t('learning.browserScreenshot.completed', { value: `${payload.width ?? 0} × ${payload.height ?? 0}` })}</p> : null}
          </div>
        </div>
        <div className="app-no-drag flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => void window.electronAPI.closeWindow()} title={t('learning.browserScreenshot.backToCapture')}>
            <ArrowLeft />
            {t('learning.browserScreenshot.backToCapture')}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void window.electronAPI.closeWindow()} title={t('common.close')}>
            <X />
          </Button>
        </div>
      </header>
      <main
        ref={canvasRef}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDragStart={(event) => event.preventDefault()}
        className="min-h-0 flex-1 overflow-hidden bg-[color:var(--color-background-sunken)] p-4"
        style={{ cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
      >
        {payload ? (
          <div className="flex h-full w-full items-center justify-center">
            <img
              src={`data:image/png;base64,${payload.pngBase64}`}
              alt={payload.title}
              ref={imageRef}
              draggable={false}
              onDragStart={(event) => event.preventDefault()}
              onLoad={() => void window.electronAPI.markBrowserScreenshotViewerReady()}
              onError={() => void window.electronAPI.markBrowserScreenshotViewerReady()}
              className="pointer-events-none max-h-full max-w-full select-none object-contain shadow-sm"
              style={{ transform: 'translate3d(0px, 0px, 0) scale(1)', WebkitUserDrag: 'none' }}
            />
          </div>
        ) : (
          <p className="text-sm text-[color:var(--color-muted-foreground)]">{t('common.loading')}</p>
        )}
      </main>
      <footer className="app-no-drag flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-4 py-2.5" style={{ borderColor: 'var(--color-border)' }}>
        {feedback ? (
          <span className="mr-auto flex items-center gap-1.5 text-xs text-[color:var(--color-primary)]">
            <Check className="h-4 w-4" />
            {feedback === 'copied' ? t('learning.browserScreenshot.copySuccess') : t('learning.browserScreenshot.saveSuccess')}
          </span>
        ) : null}
        {error ? <span className="mr-auto text-xs text-[color:var(--color-destructive)]">{error}</span> : null}
        <Button variant="outline" size="sm" disabled={!payload || saving} loading={copying} onClick={() => void copy()}>
          <Clipboard />
          {t('learning.browserScreenshot.copy')}
        </Button>
        <Button variant="outline" size="sm" disabled={!payload || copying} loading={saving} onClick={() => void save()}>
          <Download />
          {t('learning.browserScreenshot.save')}
        </Button>
        <Button variant="outline" size="sm" disabled={!payload} loading={openingDefaultApp} onClick={() => void openInDefaultApp()}>
          <ExternalLink />
          {t('learning.browserScreenshot.openDefault')}
        </Button>
      </footer>
    </div>
  )
}
