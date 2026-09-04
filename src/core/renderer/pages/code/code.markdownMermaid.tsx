import { LoaderCircle } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import { computeFitZoom } from '../../lib/computeFitZoom'
import { sanitizeMermaidSvgMarkup } from './code.markdownMermaid.sanitize'
import type { SourceLineDataProps } from './code.markdown'
import { createMermaidRenderConfig } from './code.markdownMermaid.config'

const MARKDOWN_MERMAID_RENDER_ID_PREFIX = 'code-markdown-mermaid'
const MARKDOWN_MERMAID_THEME_VERSION = 3

type MermaidModule = typeof import('mermaid')

let mermaidModulePromise: Promise<MermaidModule> | null = null
const mermaidSvgMarkupCache = new Map<string, Promise<string>>()

async function loadMermaid(): Promise<MermaidModule> {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('mermaid')
  }
  return mermaidModulePromise
}

export async function renderMermaidDiagram(id: string, codeText: string, themeMode: 'light' | 'dark'): Promise<string> {
  const cacheKey = `${MARKDOWN_MERMAID_THEME_VERSION}\u0000${themeMode}\u0000${codeText}`
  const cached = mermaidSvgMarkupCache.get(cacheKey)
  if (cached) return cached

  const renderPromise = renderMermaidDiagramUncached(id, codeText, themeMode).catch((error: unknown) => {
    mermaidSvgMarkupCache.delete(cacheKey)
    throw error
  })
  mermaidSvgMarkupCache.set(cacheKey, renderPromise)
  return renderPromise
}

async function renderMermaidDiagramUncached(id: string, codeText: string, themeMode: 'light' | 'dark'): Promise<string> {
  const mermaidModule = await loadMermaid()
  const mermaid = mermaidModule.default

  mermaid.initialize(createMermaidRenderConfig(themeMode))

  const { svg } = await mermaid.render(id, codeText)
  return sanitizeMermaidSvgMarkup(svg)
}

type MermaidBlockProps = {
  codeText: string
  /** Inline wheel zoom + drag-to-scroll inside the markdown flow (disabled inside modal viewports that zoom themselves). */
  enableInlineZoom: boolean
  sourceLineProps?: SourceLineDataProps
  themeMode: 'light' | 'dark'
}

// Same engine constants as ZoomPanViewport/computeFitZoom: layout zoom keeps
// the SVG vector-sharp at any level, and the clamp range matches its wheel zoom.
const MERMAID_WHEEL_ZOOM_MIN = 0.25
const MERMAID_WHEEL_ZOOM_MAX = 16
const MERMAID_WHEEL_ZOOM_STEP = 1.0015
const MERMAID_DRAG_START_THRESHOLD_PX = 2

export function MermaidBlock({ codeText, enableInlineZoom, sourceLineProps, themeMode }: MermaidBlockProps) {
  const { t } = useI18n()
  const diagramId = useId().replace(/:/g, '-')
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const diagramRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const zoomRef = useRef(1)
  const lastFitZoomRef = useRef(1)
  const offsetRef = useRef({ x: 0, y: 0 })
  const [svgMarkup, setSvgMarkup] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isRendering, setIsRendering] = useState(false)

  useEffect(() => {
    let cancelled = false

    setErrorMessage(null)
    setIsRendering(true)

    void renderMermaidDiagram(`${MARKDOWN_MERMAID_RENDER_ID_PREFIX}-${diagramId}`, codeText, themeMode)
      .then((svg) => {
        if (cancelled) return
        setSvgMarkup(svg)
        setErrorMessage(null)
        setIsRendering(false)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : t('codeMarkdown.unknownRenderError')
        setSvgMarkup('')
        setErrorMessage(message)
        setIsRendering(false)
      })

    return () => {
      cancelled = true
    }
  }, [codeText, diagramId, themeMode, t])

  useEffect(() => {
    if (!enableInlineZoom) return
    const wrap = wrapRef.current
    const diagram = diagramRef.current
    const canvas = canvasRef.current
    if (!wrap || !diagram || !canvas) return

    // Same engine as the structured preview modal (ZoomPanViewport): the svg
    // is laid out at its natural viewBox size inside an absolutely positioned
    // canvas, the initial zoom comes from computeFitZoom, wheel zoom anchors
    // at the cursor, and drag pans via translate3d. The canvas is out of flow
    // and the wrap height is frozen from the fitted size, so zooming can never
    // grow the surrounding page layout.
    const drag = { pointerId: -1, startX: 0, startY: 0, startOffset: { x: 0, y: 0 }, moved: false }
    let wheelViewportOrigin: { x: number; y: number } | null = null
    let wheelAnchor: { x: number; y: number } | null = null
    let animationFrame: number | null = null
    let wheelIdleTimer: number | null = null

    const applyTransform = () => {
      const zoom = zoomRef.current
      // CSS zoom scales the canvas local coordinate space, so the translate
      // has to be divided back into local px (offset stays in viewport px).
      canvas.style.setProperty('zoom', String(zoom))
      canvas.style.transform = `translate3d(${offsetRef.current.x / zoom}px, ${offsetRef.current.y / zoom}px, 0)`
    }

    const scheduleTransform = () => {
      if (animationFrame !== null) return
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null
        applyTransform()
      })
    }

    const readCanvasPaddings = (): { padX: number; padY: number } => {
      const canvasStyle = getComputedStyle(canvas)
      return {
        padX: Number.parseFloat(canvasStyle.paddingLeft) + Number.parseFloat(canvasStyle.paddingRight),
        padY: Number.parseFloat(canvasStyle.paddingTop) + Number.parseFloat(canvasStyle.paddingBottom),
      }
    }

    // Fit the svg (natural viewBox size) into the region width, like the
    // modal's initial fit. Raster upscaling is disallowed the same way: the
    // fit never grows past 100% for small diagrams.
    const fitDiagram = () => {
      const svg = canvas.querySelector<SVGGraphicsElement>('svg')
      if (!svg) return
      const { padX, padY } = readCanvasPaddings()
      const [, , viewBoxWidth, viewBoxHeight] = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number)
      if (Number.isFinite(viewBoxWidth) && Number.isFinite(viewBoxHeight) && viewBoxWidth > 0 && viewBoxHeight > 0) {
        svg.style.setProperty('width', `${viewBoxWidth}px`)
        svg.style.setProperty('height', `${viewBoxHeight}px`)
        const fitZoom = computeFitZoom({
          viewportWidth: Math.max(0, wrap.clientWidth - padX),
          viewportHeight: viewBoxHeight,
          contentWidth: viewBoxWidth,
          contentHeight: viewBoxHeight,
          allowUpscale: false,
        })
        zoomRef.current = fitZoom
        lastFitZoomRef.current = fitZoom
        offsetRef.current = { x: 0, y: 0 }
        wrap.style.height = `${viewBoxHeight * fitZoom + padY}px`
        applyTransform()
        return
      }
      // Fallback without a viewBox: keep the CSS-fitted svg at 100%.
      const naturalHeight = svg.getBoundingClientRect().height + padY
      zoomRef.current = 1
      lastFitZoomRef.current = 1
      offsetRef.current = { x: 0, y: 0 }
      if (naturalHeight > 0) wrap.style.height = `${naturalHeight}px`
      applyTransform()
    }

    const finishWheelInteraction = () => {
      wheelIdleTimer = null
      wheelViewportOrigin = null
      wheelAnchor = null
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      if (drag.pointerId !== -1) return
      if (!wheelViewportOrigin) {
        const bounds = wrap.getBoundingClientRect()
        wheelViewportOrigin = { x: bounds.left + wrap.clientLeft, y: bounds.top + wrap.clientTop }
        wheelAnchor = { x: event.clientX - wheelViewportOrigin.x, y: event.clientY - wheelViewportOrigin.y }
      }
      if (wheelIdleTimer !== null) window.clearTimeout(wheelIdleTimer)
      wheelIdleTimer = window.setTimeout(finishWheelInteraction, 120)
      const cursor = wheelAnchor ?? { x: event.clientX - wheelViewportOrigin.x, y: event.clientY - wheelViewportOrigin.y }
      const currentZoom = zoomRef.current
      const nextZoom = Math.min(MERMAID_WHEEL_ZOOM_MAX, Math.max(MERMAID_WHEEL_ZOOM_MIN, currentZoom * MERMAID_WHEEL_ZOOM_STEP ** -event.deltaY))
      if (nextZoom === currentZoom) return
      const scale = nextZoom / currentZoom
      zoomRef.current = nextZoom
      const offset = offsetRef.current
      offsetRef.current = { x: cursor.x - (cursor.x - offset.x) * scale, y: cursor.y - (cursor.y - offset.y) * scale }
      scheduleTransform()
    }

    const onPointerDown = (event: PointerEvent) => {
      // Hold Ctrl to keep native text selection instead of drag-panning.
      if (event.button !== 0 || event.ctrlKey) return
      event.preventDefault()
      drag.pointerId = event.pointerId
      drag.startX = event.clientX
      drag.startY = event.clientY
      drag.startOffset = { ...offsetRef.current }
      drag.moved = false
      wrap.setPointerCapture(event.pointerId)
      wrap.classList.add('is-panning')
    }

    const onPointerMove = (event: PointerEvent) => {
      if (drag.pointerId !== event.pointerId) return
      const deltaX = event.clientX - drag.startX
      const deltaY = event.clientY - drag.startY
      if (!drag.moved && Math.abs(deltaX) <= MERMAID_DRAG_START_THRESHOLD_PX && Math.abs(deltaY) <= MERMAID_DRAG_START_THRESHOLD_PX) return
      drag.moved = true
      offsetRef.current = { x: drag.startOffset.x + deltaX, y: drag.startOffset.y + deltaY }
      scheduleTransform()
    }

    const finishPointer = (event: PointerEvent) => {
      if (drag.pointerId !== event.pointerId) return
      drag.pointerId = -1
      wrap.classList.remove('is-panning')
      if (wrap.hasPointerCapture(event.pointerId)) wrap.releasePointerCapture(event.pointerId)
    }

    // A drag must not trigger the surrounding markdown click behavior.
    const onClickCapture = (event: MouseEvent) => {
      if (!drag.moved) return
      drag.moved = false
      event.preventDefault()
      event.stopPropagation()
    }

    // Refit on viewport resizes, but never fight the user's manual zoom
    // (same guard as the modal viewport).
    const resizeObserver = new ResizeObserver(() => {
      if (zoomRef.current !== lastFitZoomRef.current) return
      fitDiagram()
    })
    resizeObserver.observe(wrap)
    fitDiagram()

    wrap.addEventListener('wheel', onWheel, { passive: false })
    wrap.addEventListener('pointerdown', onPointerDown)
    wrap.addEventListener('pointermove', onPointerMove)
    wrap.addEventListener('pointerup', finishPointer)
    wrap.addEventListener('pointercancel', finishPointer)
    wrap.addEventListener('lostpointercapture', finishPointer)
    wrap.addEventListener('click', onClickCapture, true)
    return () => {
      resizeObserver.disconnect()
      wrap.removeEventListener('wheel', onWheel)
      wrap.removeEventListener('pointerdown', onPointerDown)
      wrap.removeEventListener('pointermove', onPointerMove)
      wrap.removeEventListener('pointerup', finishPointer)
      wrap.removeEventListener('pointercancel', finishPointer)
      wrap.removeEventListener('lostpointercapture', finishPointer)
      wrap.removeEventListener('click', onClickCapture, true)
      wrap.classList.remove('is-panning')
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame)
      if (wheelIdleTimer !== null) window.clearTimeout(wheelIdleTimer)
      const svg = canvas.querySelector<SVGGraphicsElement>('svg')
      svg?.style.removeProperty('width')
      svg?.style.removeProperty('height')
      zoomRef.current = 1
      lastFitZoomRef.current = 1
      offsetRef.current = { x: 0, y: 0 }
      canvas.style.removeProperty('zoom')
      canvas.style.removeProperty('transform')
      wrap.style.removeProperty('height')
    }
  }, [enableInlineZoom, svgMarkup])

  const wrapClassName = ['code-markdown-mermaid-wrap', enableInlineZoom ? 'code-markdown-mermaid-wrap--zoomable' : ''].filter(Boolean).join(' ')

  return (
    <div ref={wrapRef} className={wrapClassName} {...sourceLineProps}>
      {svgMarkup ? (
        <div ref={diagramRef} className="code-markdown-mermaid-diagram">
          <div ref={canvasRef} className="code-markdown-mermaid-canvas" dangerouslySetInnerHTML={{ __html: svgMarkup }} />
        </div>
      ) : isRendering ? (
        <div className="code-markdown-mermaid-loading" role="status">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          <span>{t('codeMarkdown.rendering')}</span>
        </div>
      ) : (
        <pre className="code-markdown-plain-block">
          <code className="language-mermaid">{codeText}</code>
        </pre>
      )}
      {errorMessage && (
        <div className="code-markdown-mermaid-error" title={errorMessage}>
          {errorMessage}
        </div>
      )}
    </div>
  )
}
