import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { createPortal } from 'react-dom'
import { Camera, CircleAlert, Code2, Crop, Eye, Globe, History, Loader2, Monitor, RefreshCw, Smartphone, Square } from 'lucide-react'
import { dropdownSurfaceClassName, dropdownSurfaceStyle, useDropdownLayer } from '../../../components/ui/dropdown'
import { toast } from '../../../components/ui/toast'
import { Tooltip } from '../../../components/ui/tooltip'
import { useI18n } from '../../../i18n'
import { MonacoCodeEditor } from '../MonacoCodeEditor'
import { dispatchPreviewMouseGesture, FileViewerOpenButton, FileViewerShell } from './fileViewerShared'

type FileHtmlViewerProps = {
  previewUrl: string
  sourceHtml: string
  projectPath: string
  relativePath: string
  monacoTheme: 'vs' | 'vs-dark'
  activeLanguage: string | null
}

type HtmlViewMode = 'render' | 'source'
type HtmlViewportMode = 'desktop' | 'mobile'

type PreviewLoadEvent = Event & { errorCode?: number }
type PreviewIpcMessageEvent = Event & { channel?: string; args?: unknown[] }
type PreviewNavigateEvent = Event & { url?: string }

type PreviewCapturedImage = { toPNG(): Uint8Array<ArrayBuffer> }

type PreviewWebviewElement = HTMLElement & {
  goBack(): void
  goForward(): void
  canGoBack(): boolean
  canGoForward(): boolean
  getURL(): string
  getWebContentsId?(): number
  capturePage?(): Promise<PreviewCapturedImage>
}

type PreviewNavigateState = {
  url: string
  canGoBack: boolean
  canGoForward: boolean
}

function normalizePreviewUrlInput(raw: string): string {
  const value = raw.trim()
  if (!value) return ''
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) return value
  return `http://${value}`
}

const PREVIEW_URL_HISTORY_STORAGE_KEY = 'yyc-workbench.preview-url-history'
const PREVIEW_URL_HISTORY_LIMIT = 12

function readPreviewUrlHistory(projectKey: string): string[] {
  try {
    const raw = localStorage.getItem(PREVIEW_URL_HISTORY_STORAGE_KEY)
    if (!raw) return []
    const entries = (JSON.parse(raw) as Record<string, unknown>)[projectKey]
    return Array.isArray(entries) ? entries.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

function appendPreviewUrlHistory(projectKey: string, url: string): string[] {
  const next = [url, ...readPreviewUrlHistory(projectKey).filter((entry) => entry !== url)].slice(0, PREVIEW_URL_HISTORY_LIMIT)
  try {
    const raw = localStorage.getItem(PREVIEW_URL_HISTORY_STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    parsed[projectKey] = next
    localStorage.setItem(PREVIEW_URL_HISTORY_STORAGE_KEY, JSON.stringify(parsed))
  } catch {
    // History is best-effort; ignore storage failures.
  }
  return next
}

function toPngBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function HtmlPreviewGuest({
  previewUrl,
  relativePath,
  refreshKey,
  webviewRef,
  onGuestAttached,
  onNavigateStateChange,
  onDidNavigate,
  onStopped,
}: {
  previewUrl: string
  relativePath: string
  refreshKey: number
  webviewRef: MutableRefObject<PreviewWebviewElement | null>
  onGuestAttached: (webContentsId: number | null) => void
  onNavigateStateChange: (state: PreviewNavigateState) => void
  onDidNavigate: (url: string) => void
  onStopped: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const webview = document.createElement('webview')
    webview.className = 'code-file-viewer-iframe code-file-viewer-html-iframe'
    webview.setAttribute('aria-label', relativePath)
    webview.setAttribute('allowpopups', '')
    webview.setAttribute('webpreferences', 'contextIsolation=yes, nodeIntegration=no, sandbox=yes')

    const handleProcessGone = () => onStopped()
    const handleLoadFailure = (event: Event) => {
      // Reloading a guest aborts its previous navigation; it is not a preview failure.
      if ((event as PreviewLoadEvent).errorCode !== -3) onStopped()
    }
    const handleIpcMessage = (event: Event) => {
      const messageEvent = event as PreviewIpcMessageEvent
      if (messageEvent.channel !== 'preview:mouse-gesture') return
      dispatchPreviewMouseGesture((messageEvent.args?.[0] as Parameters<typeof dispatchPreviewMouseGesture>[0]) ?? null, webview.getBoundingClientRect())
    }

    webviewRef.current = webview as PreviewWebviewElement

    const reportNavigateState = () => {
      const el = webview as PreviewWebviewElement
      let url = ''
      let canGoBack = false
      let canGoForward = false
      try {
        url = el.getURL?.() ?? ''
        canGoBack = Boolean(el.canGoBack?.())
        canGoForward = Boolean(el.canGoForward?.())
      } catch {
        // Guest not attached yet; keep the defaults.
      }
      onNavigateStateChange({ url, canGoBack, canGoForward })
    }

    // Only full navigations enter the history list; in-page (SPA) transitions
    // would flood it.
    const handleDidNavigate = (event: Event) => {
      const url = (event as PreviewNavigateEvent).url
      if (typeof url === 'string' && url) onDidNavigate(url)
      reportNavigateState()
    }

    // The guest webContents id is only valid after attach; cache it here so
    // local full-page capture can target this guest from the main process.
    const handleDidAttach = () => {
      try {
        onGuestAttached((webview as PreviewWebviewElement).getWebContentsId?.() ?? null)
      } catch {
        onGuestAttached(null)
      }
    }

    webview.addEventListener('render-process-gone', handleProcessGone)
    webview.addEventListener('did-fail-load', handleLoadFailure)
    webview.addEventListener('ipc-message', handleIpcMessage)
    webview.addEventListener('did-attach', handleDidAttach)
    webview.addEventListener('did-attach', reportNavigateState)
    webview.addEventListener('did-navigate', handleDidNavigate)
    webview.addEventListener('did-navigate-in-page', reportNavigateState)
    container.replaceChildren(webview)

    // Electron creates the guest before CSS layout settles. Keep its native
    // viewport synchronized with the flex container so viewport units and
    // nested iframes use the visible preview height rather than 300x150.
    const syncGuestViewport = () => {
      const { width, height } = container.getBoundingClientRect()
      webview.setAttribute('width', `${Math.round(width)}`)
      webview.setAttribute('height', `${Math.round(height)}`)

      // Electron 42 exposes the guest iframe through an open shadow root, but
      // leaves its default 150px height in place. Size the actual guest frame,
      // not only the host <webview> element.
      const guestFrame = webview.shadowRoot?.querySelector('iframe')
      if (guestFrame instanceof HTMLIFrameElement) {
        guestFrame.style.position = 'absolute'
        guestFrame.style.inset = '0'
        guestFrame.style.width = '100%'
        guestFrame.style.height = '100%'
      }
    }
    const resizeObserver = new ResizeObserver(syncGuestViewport)
    resizeObserver.observe(container)
    webview.addEventListener('did-attach', syncGuestViewport)
    syncGuestViewport()
    webview.setAttribute('src', previewUrl)

    return () => {
      resizeObserver.disconnect()
      webview.removeEventListener('did-attach', syncGuestViewport)
      webview.removeEventListener('render-process-gone', handleProcessGone)
      webview.removeEventListener('did-fail-load', handleLoadFailure)
      webview.removeEventListener('ipc-message', handleIpcMessage)
      webview.removeEventListener('did-attach', handleDidAttach)
      webview.removeEventListener('did-attach', reportNavigateState)
      webview.removeEventListener('did-navigate', handleDidNavigate)
      webview.removeEventListener('did-navigate-in-page', reportNavigateState)
      onGuestAttached(null)
      webviewRef.current = null
      webview.remove()
    }
  }, [onDidNavigate, onGuestAttached, onNavigateStateChange, onStopped, previewUrl, refreshKey, relativePath, webviewRef])

  return <div ref={containerRef} className="code-file-viewer-html-guest" />
}

export function FileHtmlViewer({ previewUrl, sourceHtml, projectPath, relativePath, monacoTheme, activeLanguage }: FileHtmlViewerProps) {
  const { t } = useI18n()
  const [mode, setMode] = useState<HtmlViewMode>('render')
  const [viewportMode, setViewportMode] = useState<HtmlViewportMode>('desktop')
  const [refreshKey, setRefreshKey] = useState(0)
  const [isPreviewStopped, setIsPreviewStopped] = useState(false)
  const [navState, setNavState] = useState<PreviewNavigateState>({ url: previewUrl, canGoBack: false, canGoForward: false })
  const [urlHistory, setUrlHistory] = useState<string[]>(() => readPreviewUrlHistory(projectPath))
  const webviewRef = useRef<PreviewWebviewElement | null>(null)
  const guestContentsIdRef = useRef<number | null>(null)
  const [captureMenuOpen, setCaptureMenuOpen] = useState(false)
  const [isCapturing, setIsCapturing] = useState(false)
  const [capturePercent, setCapturePercent] = useState<number | null>(null)
  const captureTriggerRef = useRef<HTMLButtonElement | null>(null)
  const captureMenuRef = useRef<HTMLDivElement | null>(null)
  const { layout: captureMenuLayout } = useDropdownLayer({
    open: captureMenuOpen,
    onClose: () => setCaptureMenuOpen(false),
    triggerRef: captureTriggerRef,
    contentRef: captureMenuRef,
    matchTriggerWidth: false,
    minWidth: 208,
  })

  const isMobile = viewportMode === 'mobile'
  const stopPreview = useCallback(() => setIsPreviewStopped(true), [])
  const handleGuestAttached = useCallback((webContentsId: number | null) => {
    guestContentsIdRef.current = webContentsId
  }, [])
  const handleNavigateStateChange = useCallback((state: PreviewNavigateState) => setNavState(state), [])
  const handleDidNavigate = useCallback(
    (url: string) => {
      if (url === 'about:blank') return
      setUrlHistory(appendPreviewUrlHistory(projectPath, url))
    },
    [projectPath],
  )

  // Guest is recreated on refresh / file switch; reset navigation state.
  useEffect(() => {
    setNavState({ url: previewUrl, canGoBack: false, canGoForward: false })
  }, [previewUrl, refreshKey])

  // Track local full-page capture progress (emitted by the main-process
  // preview capture service over the browser-screenshot progress channel).
  useEffect(() => {
    const unsubscribe = window.electronAPI.onBrowserScreenshotProgress((progress) => {
      if (!progress.taskId.startsWith('preview-capture-')) return
      if (progress.stage === 'completed' || progress.stage === 'failed' || progress.stage === 'cancelled') setCapturePercent(null)
      else setCapturePercent(typeof progress.percent === 'number' ? progress.percent : null)
    })
    return unsubscribe
  }, [])

  const navigateTo = (rawUrl: string) => {
    const url = normalizePreviewUrlInput(rawUrl)
    const webview = webviewRef.current
    if (!url || !webview) return
    webview.setAttribute('src', url)
  }

  const refreshPreview = () => {
    setIsPreviewStopped(false)
    setRefreshKey((value) => value + 1)
  }

  const openCapturedImage = useCallback(
    async (pngBase64: string, width?: number, height?: number) => {
      const opened = await window.electronAPI.openBrowserScreenshotViewer({ pngBase64, title: relativePath, width, height })
      if (!opened) toast.error(t('codeWorkspace.htmlScreenshotFailed'))
    },
    [relativePath, t],
  )

  const captureFullPage = useCallback(async () => {
    setCaptureMenuOpen(false)
    const webContentsId = guestContentsIdRef.current
    if (webContentsId == null) {
      toast.error(t('codeWorkspace.htmlScreenshotUnsupported'))
      return
    }
    setIsCapturing(true)
    try {
      const result = await window.electronAPI.startPreviewPageCapture({ webContentsId })
      if (result.status === 'completed' && result.pngBase64) {
        await openCapturedImage(result.pngBase64, result.width, result.height)
      } else if (result.status !== 'cancelled') {
        toast.error(result.errorMessage ?? t('codeWorkspace.htmlScreenshotFailed'))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('codeWorkspace.htmlScreenshotFailed'))
    } finally {
      setIsCapturing(false)
      setCapturePercent(null)
    }
  }, [openCapturedImage, t])

  const captureViewport = useCallback(async () => {
    setCaptureMenuOpen(false)
    const webview = webviewRef.current
    if (!webview?.capturePage) {
      toast.error(t('codeWorkspace.htmlScreenshotUnsupported'))
      return
    }
    setIsCapturing(true)
    try {
      const image = await webview.capturePage()
      const { width, height } = webview.getBoundingClientRect()
      await openCapturedImage(toPngBase64(image.toPNG()), Math.round(width), Math.round(height))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('codeWorkspace.htmlScreenshotFailed'))
    } finally {
      setIsCapturing(false)
    }
  }, [openCapturedImage, t])

  return (
    <FileViewerShell
      title={relativePath}
      actions={
        <>
          <div className="code-editor-preview-mode-group">
            <Tooltip content={t('codeWorkspace.htmlViewRender')} interactive={false}>
              <button type="button" className={`code-editor-preview-mode-btn ${mode === 'render' ? 'is-active' : ''}`} onClick={() => setMode('render')}>
                <Eye className="h-3.5 w-3.5" />
                {t('codeWorkspace.htmlViewRender')}
              </button>
            </Tooltip>
            <Tooltip content={t('codeWorkspace.htmlViewSource')} interactive={false}>
              <button type="button" className={`code-editor-preview-mode-btn ${mode === 'source' ? 'is-active' : ''}`} onClick={() => setMode('source')}>
                <Code2 className="h-3.5 w-3.5" />
                {t('codeWorkspace.htmlViewSource')}
              </button>
            </Tooltip>
          </div>
          {mode === 'render' && (
            <>
              <HtmlPreviewUrlPopover url={navState.url} history={urlHistory} onNavigate={navigateTo} />
              <Tooltip content={isMobile ? t('codeWorkspace.htmlViewDesktop') : t('codeWorkspace.htmlViewMobile')} interactive={false}>
                <button type="button" className={`code-editor-preview-mode-btn inline-flex items-center gap-1.5 ${isMobile ? 'is-active' : ''}`} onClick={() => setViewportMode(isMobile ? 'desktop' : 'mobile')}>
                  {isMobile ? <Smartphone className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />}
                </button>
              </Tooltip>
              <Tooltip content={t('codeWorkspace.htmlRefresh')} interactive={false}>
                <button type="button" className="code-editor-preview-mode-btn inline-flex items-center gap-1.5" onClick={refreshPreview}>
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
              <Tooltip content={t('codeWorkspace.htmlStop')} interactive={false}>
                <button type="button" className="code-editor-preview-mode-btn inline-flex items-center gap-1.5" onClick={stopPreview}>
                  <Square className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
              <div className="relative inline-flex">
                <Tooltip content={t(isCapturing ? 'codeWorkspace.htmlScreenshotCancel' : 'codeWorkspace.htmlScreenshot')} interactive={false}>
                  <button
                    type="button"
                    ref={captureTriggerRef}
                    className={`code-editor-preview-mode-btn inline-flex items-center gap-1.5 ${captureMenuOpen ? 'is-active' : ''}`}
                    onClick={() => {
                      if (isCapturing) {
                        void window.electronAPI.cancelPreviewPageCapture()
                        return
                      }
                      setCaptureMenuOpen((open) => !open)
                    }}
                  >
                    {isCapturing ? capturePercent != null ? <span className="min-w-[1.6rem] text-center text-[9px] font-semibold tabular-nums">{capturePercent}%</span> : <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                  </button>
                </Tooltip>
                {captureMenuOpen &&
                  createPortal(
                    <div
                      ref={captureMenuRef}
                      className={dropdownSurfaceClassName}
                      style={{
                        ...dropdownSurfaceStyle,
                        top: captureMenuLayout?.top ?? 0,
                        left: captureMenuLayout?.left ?? 0,
                        width: captureMenuLayout?.width ?? 208,
                        maxHeight: captureMenuLayout?.maxHeight ?? 240,
                        visibility: captureMenuLayout ? 'visible' : 'hidden',
                      }}
                    >
                      <button type="button" className="flex w-full items-center gap-2 rounded-[13px] px-3 py-2 text-left text-sm text-[color:var(--color-foreground)] outline-none transition-colors hover:bg-[color:var(--color-accent)]" onClick={() => void captureFullPage()}>
                        <Camera className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
                        <span className="min-w-0 truncate">{t('codeWorkspace.htmlScreenshotFullPage')}</span>
                      </button>
                      <button type="button" className="flex w-full items-center gap-2 rounded-[13px] px-3 py-2 text-left text-sm text-[color:var(--color-foreground)] outline-none transition-colors hover:bg-[color:var(--color-accent)]" onClick={() => void captureViewport()}>
                        <Crop className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
                        <span className="min-w-0 truncate">{t('codeWorkspace.htmlScreenshotViewport')}</span>
                      </button>
                    </div>,
                    document.body,
                  )}
              </div>
            </>
          )}
          <FileViewerOpenButton projectPath={projectPath} relativePath={relativePath} />
        </>
      }
    >
      {mode === 'render' ? (
        <div className={`code-file-viewer-html-viewport ${isMobile ? 'is-mobile' : ''}`}>
          <div className="code-file-viewer-html-iframe-shell">
            {isPreviewStopped ? (
              <div className="code-file-viewer-unsupported code-file-viewer--center">
                <CircleAlert className="h-5 w-5" aria-hidden="true" />
                <h2 className="code-file-viewer-unsupported-title">{t('codeWorkspace.htmlPreviewStopped')}</h2>
                <p className="code-file-viewer-unsupported-hint">{t('codeWorkspace.htmlPreviewStoppedHint')}</p>
              </div>
            ) : (
              <HtmlPreviewGuest previewUrl={previewUrl} relativePath={relativePath} refreshKey={refreshKey} webviewRef={webviewRef} onGuestAttached={handleGuestAttached} onNavigateStateChange={handleNavigateStateChange} onDidNavigate={handleDidNavigate} onStopped={stopPreview} />
            )}
          </div>
        </div>
      ) : (
        <MonacoCodeEditor filePath={relativePath} value={sourceHtml} language={activeLanguage || 'html'} theme={monacoTheme} isReadOnly onChange={() => {}} onSave={() => {}} />
      )}
    </FileViewerShell>
  )
}

type HtmlPreviewUrlPopoverProps = {
  url: string
  history: string[]
  onNavigate: (url: string) => void
}

/**
 * Compact URL control for the preview toolbar: hovering (or clicking) the
 * trigger opens a small popover showing the live URL where it can be edited
 * and re-entered, with the recent navigation history below it — no permanent
 * URL bar eating toolbar space.
 */
function HtmlPreviewUrlPopover({ url, history, onNavigate }: HtmlPreviewUrlPopoverProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [layout, setLayout] = useState({ top: 0, left: 0, width: 420 })
  const triggerRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const hoverRef = useRef({ trigger: false, popover: false })
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  const isWithinArea = (target: EventTarget | null) => target instanceof Node && Boolean(triggerRef.current?.contains(target) || popoverRef.current?.contains(target))

  const updateLayout = () => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const viewportPadding = 12
    const gap = 6
    const width = Math.min(420, window.innerWidth - viewportPadding * 2)
    setLayout({
      top: rect.bottom + gap,
      left: Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - viewportPadding - width)),
      width,
    })
  }

  const scheduleClose = () => {
    clearCloseTimer()
    closeTimerRef.current = setTimeout(() => {
      if (hoverRef.current.trigger || hoverRef.current.popover) return
      const active = document.activeElement
      if (active instanceof Node && popoverRef.current?.contains(active)) return
      setOpen(false)
    }, 150)
  }

  useEffect(() => {
    if (!open) {
      hoverRef.current = { trigger: false, popover: false }
      return
    }
    updateLayout()
    const raf = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
    // `pointerdown` (not `mousedown`) so synthetic pointer events re-dispatched
    // from the preview guest also close the popover.
    const onPointerDown = (event: PointerEvent) => {
      if (!isWithinArea(event.target)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', updateLayout)
    return () => {
      window.cancelAnimationFrame(raf)
      clearCloseTimer()
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', updateLayout)
    }
  }, [open])

  // The input is for entering a NEW url only; the current one stays visible
  // (and highlighted) in the history list below.
  useEffect(() => {
    if (open) setDraft('')
  }, [open])

  useEffect(() => {
    return () => clearCloseTimer()
  }, [])

  const submit = () => {
    const next = normalizePreviewUrlInput(draft)
    if (!next) return
    onNavigate(next)
    setOpen(false)
  }

  return (
    <div
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={() => {
        hoverRef.current.trigger = true
        clearCloseTimer()
        if (!open) {
          updateLayout()
          setOpen(true)
        }
      }}
      onMouseLeave={(event) => {
        hoverRef.current.trigger = false
        if (!isWithinArea(event.relatedTarget)) scheduleClose()
      }}
    >
      <button
        type="button"
        className={`code-editor-preview-mode-btn inline-flex items-center gap-1.5 ${open ? 'is-active' : ''}`}
        aria-label={t('codeWorkspace.htmlPreviewUrl')}
        title={t('codeWorkspace.htmlPreviewUrl')}
        onClick={() => {
          clearCloseTimer()
          if (!open) updateLayout()
          setOpen((prev) => !prev)
        }}
      >
        <Globe className="h-3.5 w-3.5" />
      </button>
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed rounded-[14px] p-2"
            style={{
              top: layout.top,
              left: layout.left,
              width: layout.width,
              // Above the fullscreen preview layer (`code-file-viewer--fullscreen`, z-index 10000).
              zIndex: 10001,
              background: 'var(--color-popover)',
              border: '1px solid var(--color-border)',
              boxShadow: 'var(--shadow-popover)',
              backdropFilter: 'saturate(145%) blur(14px)',
              WebkitBackdropFilter: 'saturate(145%) blur(14px)',
            }}
            onMouseEnter={() => {
              hoverRef.current.popover = true
              clearCloseTimer()
            }}
            onMouseLeave={(event) => {
              hoverRef.current.popover = false
              if (!isWithinArea(event.relatedTarget)) scheduleClose()
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <input
              ref={inputRef}
              type="text"
              value={draft}
              spellCheck={false}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  submit()
                  return
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setOpen(false)
                }
              }}
              onFocus={clearCloseTimer}
              placeholder={t('codeWorkspace.htmlPreviewUrlHint')}
              className="quiet-control h-8 w-full rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)]"
            />
            {history.length > 0 && (
              <div className="mt-1.5 max-h-[220px] overflow-y-auto" style={{ overscrollBehavior: 'contain' }}>
                {history.map((entry) => {
                  const isCurrent = entry === url
                  return (
                    <button
                      key={entry}
                      type="button"
                      className={`flex w-full items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-left text-xs transition-colors ${
                        isCurrent ? 'bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]' : 'text-[color:var(--color-foreground)]/88 hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
                      }`}
                      onClick={() => {
                        onNavigate(entry)
                        setOpen(false)
                      }}
                    >
                      <History className="h-3 w-3 shrink-0 text-[color:var(--color-muted-foreground)]" />
                      <span className="truncate">{entry}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}
