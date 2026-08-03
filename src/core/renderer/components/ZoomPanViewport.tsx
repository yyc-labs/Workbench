import { type MutableRefObject, type ReactNode, type Ref, useEffect, useRef } from 'react'

type ZoomPanViewportProps = {
  captureTargetRef?: Ref<HTMLDivElement>
  children: ReactNode
  resetKey: string
}

function applyCanvasTransform(canvas: HTMLDivElement | null, zoom: number, offset: { x: number; y: number }): void {
  if (!canvas) return
  canvas.style.transform = `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})`
}

export function ZoomPanViewport({ captureTargetRef, children, resetKey }: ZoomPanViewportProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const zoomRef = useRef(1)
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
    zoomRef.current = 1
    offsetRef.current = { x: 0, y: 0 }
    didDragRef.current = false
    applyCanvasTransform(canvasRef.current, 1, offsetRef.current)
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
      const nextZoom = Math.min(8, Math.max(0.25, currentZoom * 1.0015 ** -event.deltaY))
      const scale = nextZoom / currentZoom
      zoomRef.current = nextZoom
      offsetRef.current = { x: cursor.x - (cursor.x - offsetRef.current.x) * scale, y: cursor.y - (cursor.y - offsetRef.current.y) * scale }
      scheduleTransform()
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
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

    viewport.addEventListener('wheel', onWheel, { passive: false })
    viewport.addEventListener('pointerdown', onPointerDown)
    viewport.addEventListener(supportsPointerRawUpdate ? 'pointerrawupdate' : 'pointermove', updatePendingPointerListener)
    viewport.addEventListener('pointerup', onPointerUp)
    viewport.addEventListener('pointercancel', onPointerUp)
    viewport.addEventListener('lostpointercapture', onPointerUp)
    viewport.addEventListener('click', onClickCapture, true)
    return () => {
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
