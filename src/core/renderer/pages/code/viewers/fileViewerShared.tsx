import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { ExternalLink, Maximize2, Minimize2, RefreshCw } from 'lucide-react'
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

      const bounds = iframeRef.current.getBoundingClientRect()
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
 * Fullscreen renders through a portal attached to `document.body`. The editor pane
 * sits inside `.surface-card` (backdrop-filter), which would otherwise act as the
 * containing block for `position: fixed` and keep the fullscreen layer pinned to the
 * pane instead of the whole Electron window — portaling out sidesteps that.
 *
 * The frame node itself is moved between the inline and fullscreen containers with
 * DOM APIs instead of being unmounted, so an iframe-based viewer (e.g. the PDF
 * preview) is not reloaded on every fullscreen toggle.
 */
export function FileViewerShell({ title, actions, children, canFullscreen = true, isFullscreen: controlledFullscreen, onFullscreenChange }: FileViewerShellProps) {
  const { t } = useI18n()
  const location = useLocation()
  const [uncontrolledFullscreen, setUncontrolledFullscreen] = useState(false)
  const isFullscreen = controlledFullscreen ?? uncontrolledFullscreen
  const inlineRef = useRef<HTMLDivElement>(null)
  const fullscreenRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)

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

  // Relocate the already-mounted frame (with any iframe inside it) without
  // rebuilding it; toggling fullscreen must not reload the viewer content.
  // useLayoutEffect keeps the swap inside the same paint, avoiding a blank
  // frame where the viewer has left one container but not arrived in the other.
  useLayoutEffect(() => {
    const frame = frameRef.current
    const target = isFullscreen ? fullscreenRef.current : inlineRef.current
    if (frame && target && frame.parentElement !== target) {
      target.appendChild(frame)
    }
  }, [isFullscreen])

  const fullscreenLabel = isFullscreen ? t('codeWorkspace.previewExitFullscreen') : t('codeWorkspace.previewEnterFullscreen')

  const toolbar = (
    <div className="code-file-viewer-toolbar">
      {title ? <span className="text-[11px] text-[color:var(--color-muted-foreground)]">{title}</span> : null}
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {actions}
        {canFullscreen ? (
          <button
            type="button"
            className="code-file-viewer-fullscreen-btn"
            onClick={() => {
              const nextFullscreen = !isFullscreen
              setUncontrolledFullscreen(nextFullscreen)
              onFullscreenChange?.(nextFullscreen)
            }}
            title={fullscreenLabel}
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        ) : null}
      </div>
    </div>
  )

  return (
    <>
      <div ref={inlineRef} className={`code-file-viewer ${isFullscreen ? 'code-file-viewer--hidden' : ''}`}>
        {toolbar}
        <div ref={frameRef} className="code-file-viewer-frame">
          {children}
        </div>
      </div>
      {createPortal(
        <div ref={fullscreenRef} className={`code-file-viewer code-file-viewer--fullscreen ${isFullscreen ? '' : 'code-file-viewer--hidden'}`}>
          {toolbar}
        </div>,
        document.body,
      )}
    </>
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
      <button
        type="button"
        className="code-editor-preview-mode-btn inline-flex items-center gap-1.5"
        onClick={() => {
          void handleOpen()
        }}
        title={t('codeWorkspace.previewOpenInSystem')}
      >
        <ExternalLink className="h-3.5 w-3.5" />
        <span>{t('codeWorkspace.previewOpenInSystem')}</span>
      </button>
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
