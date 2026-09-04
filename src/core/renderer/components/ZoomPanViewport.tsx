import { type MutableRefObject, type ReactNode, type Ref, useEffect, useRef } from 'react'
import { computeFitZoom } from '../lib/computeFitZoom'

type ZoomPanViewportProps = {
  captureTargetRef?: Ref<HTMLDivElement>
  children: ReactNode
  resetKey: string
}

function applyCanvasTransform(canvas: HTMLDivElement | null, zoom: number, offset: { x: number; y: number }): void {
  if (!canvas) return
  // Use layout zoom instead of a composited `scale()`: layout zoom re-lays-out
  // and re-rasterizes SVG/text at the final size, so zoomed diagrams stay
  // sharp instead of being blown up from a 1x raster cache. `offset` is kept
  // in viewport px; CSS zoom scales the canvas local coordinate space, so the
  // translate has to be divided back into local px.
  canvas.style.setProperty('zoom', String(zoom))
  canvas.style.transform = `translate3d(${offset.x / zoom}px, ${offset.y / zoom}px, 0)`
}

export function ZoomPanViewport({ captureTargetRef, children, resetKey }: ZoomPanViewportProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const zoomRef = useRef(1)
  const lastFitZoomRef = useRef(1)
  const offsetRef = useRef({ x: 0, y: 0 })
  const dragRef = useRef<{
    pointerId: number
    startPointer: { x: number; y: number }
    startOffset: { x: number; y: number }
    viewportOrigin: { x: number; y: number }
    moved: boolean
  } | null>(null)
  const didDragRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const pendingPointerRef = useRef<{ x: number; y: number } | null>(null)
  const wheelIdleTimerRef = useRef<number | null>(null)

  useEffect(() => {
    void resetKey
    didDragRef.current = false

    const viewport = viewportRef.current
    const canvas = canvasRef.current
    if (!viewport || !canvas) {
      zoomRef.current = 1
      lastFitZoomRef.current = 1
      offsetRef.current = { x: 0, y: 0 }
      applyCanvasTransform(canvas, 1, offsetRef.current)
      return
    }

    const fitContent = () => {
      const viewportWidth = viewport.clientWidth
      const viewportHeight = viewport.clientHeight
      const contentWidth = canvas.scrollWidth
      const contentHeight = canvas.scrollHeight
      if (viewportWidth <= 0 || viewportHeight <= 0 || contentWidth <= 0 || contentHeight <= 0) return

      // Derive the zoom from the actual measured content instead of a fixed
      // value: vector diagrams (svg) may grow past 100% to fill the viewport,
      // raster content stays at or below 100% to avoid blur.
      const nextZoom = computeFitZoom({
        viewportWidth,
        viewportHeight,
        contentWidth,
        contentHeight,
        allowUpscale: Boolean(canvas.querySelector('svg')),
      })
      zoomRef.current = nextZoom
      lastFitZoomRef.current = nextZoom
      offsetRef.current = {
        x: (viewportWidth - canvas.offsetWidth * nextZoom) / 2,
        y: (viewportHeight - canvas.offsetHeight * nextZoom) / 2,
      }
      applyCanvasTransform(canvas, nextZoom, offsetRef.current)
    }

    const animationFrame = window.requestAnimationFrame(fitContent)
    const resizeObserver = new ResizeObserver(() => {
      // With layout zoom the canvas box reports local (zoom-invariant) px, but
      // be defensive: ignore resize notifications triggered by zoom changes so
      // refitting never fights the user's manual zoom. Refit only while the
      // fitted zoom is still active (async content growth, viewport resize).
      if (zoomRef.current !== lastFitZoomRef.current) return
      fitContent()
    })
    resizeObserver.observe(viewport)
    resizeObserver.observe(canvas)

    return () => {
      window.cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
    }
  }, [resetKey])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    let wheelViewportOrigin: { x: number; y: number } | null = null
    let wheelAnchor: { x: number; y: number } | null = null

    const consumePendingPointer = () => {
      const pendingPointer = pendingPointerRef.current
      const drag = dragRef.current
      if (!pendingPointer || !drag) return
      const deltaX = pendingPointer.x - drag.startPointer.x
      const deltaY = pendingPointer.y - drag.startPointer.y
      const moved = drag.moved || Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1
      drag.moved = moved
      didDragRef.current = moved
      offsetRef.current = { x: drag.startOffset.x + deltaX, y: drag.startOffset.y + deltaY }
      pendingPointerRef.current = null
    }

    const scheduleTransform = () => {
      if (animationFrameRef.current !== null) return
      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = null
        consumePendingPointer()
        applyCanvasTransform(canvasRef.current, zoomRef.current, offsetRef.current)
      })
    }

    const finishWheelInteraction = () => {
      wheelIdleTimerRef.current = null
      wheelViewportOrigin = null
      wheelAnchor = null
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      if (dragRef.current) return
      consumePendingPointer()
      if (!wheelViewportOrigin) {
        const bounds = viewport.getBoundingClientRect()
        wheelViewportOrigin = { x: bounds.left + viewport.clientLeft, y: bounds.top + viewport.clientTop }
        wheelAnchor = { x: event.clientX - wheelViewportOrigin.x, y: event.clientY - wheelViewportOrigin.y }
      }
      if (wheelIdleTimerRef.current !== null) window.clearTimeout(wheelIdleTimerRef.current)
      wheelIdleTimerRef.current = window.setTimeout(finishWheelInteraction, 120)
      const cursor = wheelAnchor ?? { x: event.clientX - wheelViewportOrigin.x, y: event.clientY - wheelViewportOrigin.y }
      const currentZoom = zoomRef.current
      // Layout zoom re-rasterizes the whole canvas at the final size on every
      // change, with pixel cost growing ~zoom². Cap at 8x: beyond that each
      // wheel frame blows past the GPU texture/tile budget and the modal
      // stutters. 8x is plenty to inspect vector content.
      const nextZoom = Math.min(8, Math.max(0.25, currentZoom * 1.0015 ** -event.deltaY))
      const scale = nextZoom / currentZoom
      zoomRef.current = nextZoom
      offsetRef.current = { x: cursor.x - (cursor.x - offsetRef.current.x) * scale, y: cursor.y - (cursor.y - offsetRef.current.y) * scale }
      scheduleTransform()
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      // Ctrl + left button opts into native text selection instead of panning.
      if (event.ctrlKey) return
      event.preventDefault()
      if (wheelIdleTimerRef.current !== null) window.clearTimeout(wheelIdleTimerRef.current)
      finishWheelInteraction()
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      applyCanvasTransform(canvasRef.current, zoomRef.current, offsetRef.current)
      const bounds = viewport.getBoundingClientRect()
      const viewportOrigin = { x: bounds.left + viewport.clientLeft, y: bounds.top + viewport.clientTop }
      const pointerPosition = { x: event.clientX - viewportOrigin.x, y: event.clientY - viewportOrigin.y }
      viewport.setPointerCapture(event.pointerId)
      viewport.classList.add('is-panning')
      didDragRef.current = false
      dragRef.current = {
        pointerId: event.pointerId,
        startPointer: pointerPosition,
        startOffset: offsetRef.current,
        viewportOrigin,
        moved: false,
      }
    }

    const updatePendingPointer = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      const coalescedEvents = event.getCoalescedEvents?.()
      const pointerEvent = coalescedEvents?.[coalescedEvents.length - 1] ?? event
      const pointerPosition = { x: pointerEvent.clientX - drag.viewportOrigin.x, y: pointerEvent.clientY - drag.viewportOrigin.y }
      pendingPointerRef.current = pointerPosition
      scheduleTransform()
    }
    const updatePendingPointerListener: EventListener = (event) => updatePendingPointer(event as PointerEvent)

    const supportsPointerRawUpdate = 'onpointerrawupdate' in window

    const onPointerUp = (event: PointerEvent) => {
      if (dragRef.current?.pointerId !== event.pointerId) return
      consumePendingPointer()
      dragRef.current = null
      viewport.classList.remove('is-panning')
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId)
    }

    const onClickCapture = (event: MouseEvent) => {
      if (!didDragRef.current) return
      event.preventDefault()
      event.stopPropagation()
      didDragRef.current = false
    }

    // Hold Ctrl to switch the viewport into text-selection mode: the cursor
    // hint changes and pointer events stay native so the user can select text.
    const setTextSelectMode = (enabled: boolean) => {
      viewport.classList.toggle('is-text-select-mode', enabled)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Control') setTextSelectMode(true)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Control') setTextSelectMode(false)
    }
    const onWindowBlur = () => setTextSelectMode(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onWindowBlur)

    viewport.addEventListener('wheel', onWheel, { passive: false })
    viewport.addEventListener('pointerdown', onPointerDown)
    viewport.addEventListener(supportsPointerRawUpdate ? 'pointerrawupdate' : 'pointermove', updatePendingPointerListener)
    viewport.addEventListener('pointerup', onPointerUp)
    viewport.addEventListener('pointercancel', onPointerUp)
    viewport.addEventListener('lostpointercapture', onPointerUp)
    viewport.addEventListener('click', onClickCapture, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onWindowBlur)
      viewport.classList.remove('is-text-select-mode')
      viewport.removeEventListener('wheel', onWheel)
      viewport.removeEventListener('pointerdown', onPointerDown)
      viewport.removeEventListener(supportsPointerRawUpdate ? 'pointerrawupdate' : 'pointermove', updatePendingPointerListener)
      viewport.removeEventListener('pointerup', onPointerUp)
      viewport.removeEventListener('pointercancel', onPointerUp)
      viewport.removeEventListener('lostpointercapture', onPointerUp)
      viewport.removeEventListener('click', onClickCapture, true)
      viewport.classList.remove('is-panning')
      if (wheelIdleTimerRef.current !== null) window.clearTimeout(wheelIdleTimerRef.current)
      if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current)
    }
  }, [])

  return (
    <div
      ref={(element) => {
        viewportRef.current = element
        if (typeof captureTargetRef === 'function') {
          captureTargetRef(element)
        } else if (captureTargetRef) {
          ;(captureTargetRef as MutableRefObject<HTMLDivElement | null>).current = element
        }
      }}
      className="transcript-preview-zoom-viewport min-h-0 flex-1 overflow-hidden rounded-[20px] border border-[color:var(--color-border)] bg-[color:var(--color-background-subtle)]"
      style={{ touchAction: 'none' }}
    >
      <div ref={canvasRef} className="transcript-preview-zoom-canvas">
        {children}
      </div>
    </div>
  )
}
