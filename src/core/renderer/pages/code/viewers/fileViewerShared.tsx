import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ExternalLink, Maximize2, Minimize2, RefreshCw } from 'lucide-react'
import { Tooltip } from '../../../components/ui/tooltip'
import { useI18n } from '../../../i18n'

type PreviewMouseGestureMessage = {
  type: 'preview:mouse-gesture'
  eventType: 'mousedown' | 'mousemove' | 'mouseup' | 'contextmenu'
  clientX: number
  clientY: number
  button: number
  buttons: number
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

export function dispatchPreviewMouseGesture(message: Partial<PreviewMouseGestureMessage> | null, bounds: DOMRect): void {
  if (
    !message ||
    message.type !== 'preview:mouse-gesture' ||
    typeof message.eventType !== 'string' ||
    !['mousedown', 'mousemove', 'mouseup', 'contextmenu'].includes(message.eventType) ||
    typeof message.clientX !== 'number' ||
    typeof message.clientY !== 'number' ||
    typeof message.button !== 'number' ||
    typeof message.buttons !== 'number'
  )
    return

  document.dispatchEvent(
    new MouseEvent(message.eventType, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: bounds.left + message.clientX,
      clientY: bounds.top + message.clientY,
      button: message.button,
      buttons: message.buttons,
      ctrlKey: Boolean(message.ctrlKey),
      metaKey: Boolean(message.metaKey),
      shiftKey: Boolean(message.shiftKey),
      altKey: Boolean(message.altKey),
    }),
  )
}

/**
 * Iframes have their own event document, so right-drag events never reach the
 * app-level gesture navigator. Preview pages forward the raw mouse sequence via
 * postMessage; re-dispatching it here keeps their coordinates in the host window.
 */
export function usePreviewIframeMouseGestureBridge(iframeRef: RefObject<HTMLIFrameElement | null>, enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const message = event.data as Partial<PreviewMouseGestureMessage> | null
      const bounds = iframeRef.current.getBoundingClientRect()
      dispatchPreviewMouseGesture(message, bounds)
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [enabled, iframeRef])
}

type FileViewerShellProps = {
  title?: string
  actions?: ReactNode
  children: ReactNode
  /** Whether the toolbar should show the enter/exit fullscreen toggle (default true). */
  canFullscreen?: boolean
  isFullscreen?: boolean
  onFullscreenChange?: (isFullscreen: boolean) => void
}

/**
 * Shared shell for every non-text file preview: a compact toolbar (title + actions)
 * and a scrollable/fillable frame that hosts the actual viewer content.
 *
 * Fullscreen keeps the viewer node exactly where it is and simply applies
 * `position: fixed; inset: 0` to the shell itself — no portal, no DOM reparenting.
 * Reparenting the frame (the previous approach) forces Chromium to reload any
 * iframe/webview inside it, so HTML and PDF previews were rendered from scratch
 * on every toggle. The editor pane sits inside `.surface-card` (backdrop-filter),
 * which becomes the containing block for `position: fixed`; while fullscreen is
 * active we neutralize such properties on the ancestor chain and restore them on
 * exit, so the fixed layer covers the whole window. The fullscreen layer is
 * opaque, so the temporarily lost blur on ancestors is never visible.
 */
const FULLSCREEN_BLOCKING_PROPS = ['transform', 'translate', 'rotate', 'scale', 'filter', 'backdrop-filter', 'perspective', 'contain', 'will-change', 'content-visibility'] as const

export function FileViewerShell({ title, actions, children, canFullscreen = true, isFullscreen: controlledFullscreen, onFullscreenChange }: FileViewerShellProps) {
  const { t } = useI18n()
  const location = useLocation()
  const [uncontrolledFullscreen, setUncontrolledFullscreen] = useState(false)
  const isFullscreen = controlledFullscreen ?? uncontrolledFullscreen
  const viewerRef = useRef<HTMLDivElement>(null)

  // Collapse the overlay when leaving the code route. The shell stays mounted
  // inside the always-present code pane (which is only hidden via CSS when
  // another pane is active), so switching panes/pages would otherwise leave a
  // fullscreen layer stuck on top of the whole window.
  useEffect(() => {
    if (!isFullscreen) return
    if (/^\/project\/[^/]+\/code$/.test(location.pathname)) return
    setUncontrolledFullscreen(false)
    onFullscreenChange?.(false)
  }, [location.pathname, isFullscreen, onFullscreenChange])

  useEffect(() => {
    if (!isFullscreen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setUncontrolledFullscreen(false)
      onFullscreenChange?.(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isFullscreen, onFullscreenChange])

  useEffect(() => {
    onFullscreenChange?.(isFullscreen)
  }, [isFullscreen, onFullscreenChange])

  // `backdrop-filter` / `transform` / ... on ancestors turns them into the
  // containing block for `position: fixed` and would trap the fullscreen layer
  // inside the editor pane. Neutralize those while fullscreen, restore on exit.
  useLayoutEffect(() => {
    if (!isFullscreen) return
    const viewer = viewerRef.current
    if (!viewer) return
    const restores: Array<() => void> = []
    let el = viewer.parentElement
    while (el && el !== document.body) {
      const target = el as HTMLElement
      const computed = window.getComputedStyle(target)
      for (const prop of FULLSCREEN_BLOCKING_PROPS) {
        const value = computed.getPropertyValue(prop)
        if (!value || value === 'none' || value === 'auto' || value === 'visible') continue
        const inlineValue = target.style.getPropertyValue(prop)
        const inlinePriority = target.style.getPropertyPriority(prop)
        target.style.setProperty(prop, 'none', 'important')
        restores.push(() => {
          if (inlineValue) target.style.setProperty(prop, inlineValue, inlinePriority)
          else target.style.removeProperty(prop)
        })
      }
      el = el.parentElement
    }
    return () => {
      for (const restore of restores) restore()
    }
  }, [isFullscreen])

  const fullscreenLabel = isFullscreen ? t('codeWorkspace.previewExitFullscreen') : t('codeWorkspace.previewEnterFullscreen')

  return (
    <div ref={viewerRef} className={`code-file-viewer ${isFullscreen ? 'code-file-viewer--fullscreen' : ''}`}>
      <div className="code-file-viewer-toolbar">
        {title ? <span className="text-[11px] text-[color:var(--color-muted-foreground)]">{title}</span> : null}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {actions}
          {canFullscreen ? (
            <Tooltip content={fullscreenLabel} interactive={false}>
              <button
                type="button"
                className="code-file-viewer-fullscreen-btn"
                onClick={() => {
                  const nextFullscreen = !isFullscreen
                  setUncontrolledFullscreen(nextFullscreen)
                  onFullscreenChange?.(nextFullscreen)
                }}
              >
                {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </button>
            </Tooltip>
          ) : null}
        </div>
      </div>
      <div className="code-file-viewer-frame">{children}</div>
    </div>
  )
}

type FileViewerOpenButtonProps = {
  projectPath: string
  relativePath: string
}

/**
 * Opens the underlying project file with the system default application.
 * On failure a restrained inline error is shown next to the button.
 */
export function FileViewerOpenButton({ projectPath, relativePath }: FileViewerOpenButtonProps) {
  const { t } = useI18n()
  const [error, setError] = useState<string | null>(null)

  const handleOpen = async () => {
    setError(null)
    const result = await window.electronAPI.openProjectFilePath(projectPath, relativePath)
    if (!result.ok) {
      const message = result.error || t('codeWorkspace.previewOpenFailed')
      setError(message)
      console.warn(`[file-preview] failed to open "${relativePath}" with system app: ${message}`)
    }
  }

  return (
    <>
      <Tooltip content={t('codeWorkspace.previewOpenInSystem')} interactive={false}>
        <button
          type="button"
          className="code-editor-preview-mode-btn inline-flex items-center gap-1.5"
          onClick={() => {
            void handleOpen()
          }}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          <span>{t('codeWorkspace.previewOpenInSystem')}</span>
        </button>
      </Tooltip>
      {error ? <span className="code-file-viewer-error">{error}</span> : null}
    </>
  )
}

type FileViewerStateProps = {
  loading?: boolean
  error?: string
}

/** Lightweight loading / error placeholder rendered inside the viewer frame. */
export function FileViewerState({ loading, error }: FileViewerStateProps) {
  const { t } = useI18n()
  if (loading) {
    return (
      <div className="code-file-viewer-loading">
        <RefreshCw className="h-5 w-5 animate-spin" />
        <span>{t('common.loading')}</span>
      </div>
    )
  }
  if (error) {
    return <div className="code-file-viewer-error">{error}</div>
  }
  return null
}
