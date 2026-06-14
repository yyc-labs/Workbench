const DEFAULT_CAPTURE_BODY_CLASS = 'structured-capture-active'
const DEFAULT_SETTLE_DELAY_MS = 40
const DEFAULT_SETTLE_FRAME_COUNT = 2
const CAPTURE_CONTENT_PADDING_CSS = 5
const CAPTURE_STITCH_OVERLAP_CSS = 1
const MAX_CANVAS_DIMENSION = 32_767
const MAX_CANVAS_AREA = 268_000_000

type CaptureRect = {
  x: number
  y: number
  width: number
  height: number
}

type ContentCaptureBounds = {
  offsetLeftCss: number
  offsetTopCss: number
  widthCss: number
  heightCss: number
}

const STRUCTURED_CONTENT_SELECTOR = [
  '[data-structured-block-kind]',
  'table',
  'pre',
  '.code-markdown-box-flow',
  '.code-markdown-vertical-flow',
  '.code-markdown-box-diagram',
  '.code-markdown-architecture-diagram',
  '.code-markdown-mermaid-wrap',
].join(', ')

export type ScrollableContentCaptureResult = {
  outputWidth: number
  outputHeight: number
  scale: number
}

type CaptureScrollableContentOptions = {
  bodyClassName?: string
  contentElement?: HTMLElement | null
  settleDelayMs?: number
  settleFrameCount?: number
}

function waitForTimeout(windowObject: Window, delayMs: number): Promise<void> {
  if (delayMs <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    windowObject.setTimeout(resolve, delayMs)
  })
}

function waitForAnimationFrames(windowObject: Window, frameCount: number): Promise<void> {
  if (frameCount <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    let remaining = frameCount
    const step = () => {
      remaining -= 1
      if (remaining <= 0) {
        resolve()
        return
      }
      windowObject.requestAnimationFrame(step)
    }
    windowObject.requestAnimationFrame(step)
  })
}

async function waitForCaptureSettle(windowObject: Window, frameCount: number, delayMs: number): Promise<void> {
  await waitForAnimationFrames(windowObject, frameCount)
  await waitForTimeout(windowObject, delayMs)
}

function buildCaptureRect(element: HTMLElement): CaptureRect {
  const rect = element.getBoundingClientRect()
  return {
    x: rect.left + element.clientLeft,
    y: rect.top + element.clientTop,
    width: element.clientWidth,
    height: element.clientHeight,
  }
}

function resolveCaptureContentElement(contentElement: HTMLElement | null | undefined): HTMLElement | null {
  if (!contentElement || !contentElement.isConnected) return null
  return contentElement.querySelector<HTMLElement>(STRUCTURED_CONTENT_SELECTOR) ?? contentElement
}

function resolveContentCaptureBounds(
  scrollElement: HTMLElement,
  contentElement: HTMLElement | null | undefined
): ContentCaptureBounds {
  const viewportHeightCss = Math.max(1, Math.floor(scrollElement.clientHeight))
  const viewportWidthCss = Math.max(1, Math.floor(scrollElement.clientWidth))
  const totalWidthCss = Math.max(viewportWidthCss, Math.ceil(scrollElement.scrollWidth))
  const totalHeightCss = Math.max(viewportHeightCss, Math.ceil(scrollElement.scrollHeight))
  const resolvedContentElement = resolveCaptureContentElement(contentElement)

  if (!resolvedContentElement) {
    return {
      offsetLeftCss: 0,
      offsetTopCss: 0,
      widthCss: totalWidthCss,
      heightCss: totalHeightCss,
    }
  }

  const scrollRect = scrollElement.getBoundingClientRect()
  const contentRect = resolvedContentElement.getBoundingClientRect()

  const rawLeftCss = contentRect.left - scrollRect.left - scrollElement.clientLeft + scrollElement.scrollLeft
  const rawRightCss = contentRect.right - scrollRect.left - scrollElement.clientLeft + scrollElement.scrollLeft
  const rawTopCss = contentRect.top - scrollRect.top - scrollElement.clientTop + scrollElement.scrollTop
  const rawBottomCss = contentRect.bottom - scrollRect.top - scrollElement.clientTop + scrollElement.scrollTop

  if (
    !Number.isFinite(rawLeftCss)
    || !Number.isFinite(rawRightCss)
    || !Number.isFinite(rawTopCss)
    || !Number.isFinite(rawBottomCss)
  ) {
    return {
      offsetLeftCss: 0,
      offsetTopCss: 0,
      widthCss: totalWidthCss,
      heightCss: totalHeightCss,
    }
  }

  const maxRightCss = Math.max(1, Math.ceil(scrollElement.scrollWidth))
  const maxBottomCss = Math.max(1, Math.ceil(scrollElement.scrollHeight))
  const leftCss = Math.max(0, Math.floor(rawLeftCss) - CAPTURE_CONTENT_PADDING_CSS)
  const rightCss = Math.min(maxRightCss, Math.ceil(rawRightCss) + CAPTURE_CONTENT_PADDING_CSS)
  const topCss = Math.max(0, Math.floor(rawTopCss) - CAPTURE_CONTENT_PADDING_CSS)
  const bottomCss = Math.min(maxBottomCss, Math.ceil(rawBottomCss) + CAPTURE_CONTENT_PADDING_CSS)
  const widthCss = Math.max(1, rightCss - leftCss)
  const heightCss = Math.max(1, bottomCss - topCss)

  return {
    offsetLeftCss: leftCss,
    offsetTopCss: topCss,
    widthCss,
    heightCss,
  }
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const normalized = base64.replace(/^data:image\/png;base64,/, '').trim()
  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: mimeType })
}

async function decodePngBase64(base64: string): Promise<ImageBitmap> {
  const blob = base64ToBlob(base64, 'image/png')
  return createImageBitmap(blob)
}

function resolveCanvasScale(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 1
  const dimensionScale = Math.min(
    1,
    MAX_CANVAS_DIMENSION / width,
    MAX_CANVAS_DIMENSION / height
  )
  const areaScale = Math.min(1, Math.sqrt(MAX_CANVAS_AREA / (width * height)))
  return Math.min(dimensionScale, areaScale)
}

function sanitizeOutputSize(size: number): number {
  return Math.max(1, Math.round(size))
}

export async function captureScrollableContentToClipboard(
  scrollElement: HTMLElement,
  options: CaptureScrollableContentOptions = {}
): Promise<ScrollableContentCaptureResult> {
  if (!scrollElement.isConnected) {
    throw new Error('Capture target is not mounted.')
  }

  const ownerDocument = scrollElement.ownerDocument
  const windowObject = ownerDocument.defaultView
  if (!windowObject) {
    throw new Error('Capture target window is not available.')
  }

  const captureBodyClass = options.bodyClassName ?? DEFAULT_CAPTURE_BODY_CLASS
  const contentElement = options.contentElement ?? null
  const settleDelayMs = options.settleDelayMs ?? DEFAULT_SETTLE_DELAY_MS
  const settleFrameCount = options.settleFrameCount ?? DEFAULT_SETTLE_FRAME_COUNT

  const originalScrollLeft = scrollElement.scrollLeft
  const originalScrollTop = scrollElement.scrollTop
  const originalScrollBehavior = scrollElement.style.scrollBehavior
  const originalOverflowAnchor = scrollElement.style.overflowAnchor
  const classTarget = ownerDocument.body ?? ownerDocument.documentElement

  scrollElement.style.scrollBehavior = 'auto'
  scrollElement.style.overflowAnchor = 'none'
  classTarget.classList.add(captureBodyClass)

  try {
    if (ownerDocument.fonts?.ready) {
      await ownerDocument.fonts.ready
    }

    await waitForCaptureSettle(windowObject, settleFrameCount, settleDelayMs)

    const viewportWidthCss = Math.max(1, Math.floor(scrollElement.clientWidth))
    const viewportHeightCss = Math.max(1, Math.floor(scrollElement.clientHeight))
    const totalWidthCss = Math.max(viewportWidthCss, Math.ceil(scrollElement.scrollWidth))
    const totalHeightCss = Math.max(viewportHeightCss, Math.ceil(scrollElement.scrollHeight))
    const captureBounds = resolveContentCaptureBounds(scrollElement, contentElement)
    const captureStartLeftCss = Math.max(0, Math.min(captureBounds.offsetLeftCss, totalWidthCss - 1))
    const captureEndLeftCss = Math.max(
      captureStartLeftCss + 1,
      Math.min(totalWidthCss, captureBounds.offsetLeftCss + captureBounds.widthCss)
    )
    const captureWidthCss = Math.max(1, captureEndLeftCss - captureStartLeftCss)
    const captureStartCss = Math.max(0, Math.min(captureBounds.offsetTopCss, totalHeightCss - 1))
    const captureEndCss = Math.max(
      captureStartCss + 1,
      Math.min(totalHeightCss, captureBounds.offsetTopCss + captureBounds.heightCss)
    )
    const captureHeightCss = Math.max(1, captureEndCss - captureStartCss)

    if (viewportWidthCss <= 0 || viewportHeightCss <= 0) {
      throw new Error('Capture target has no visible area.')
    }

    let logicalTopCss = captureStartCss
    let bitmapScaleX = 1
    let bitmapScaleY = 1
    let outputScale = 1
    let canvas: HTMLCanvasElement | null = null
    let context: CanvasRenderingContext2D | null = null

    while (logicalTopCss < captureEndCss) {
      const stitchOverlapTopCss = logicalTopCss > captureStartCss ? CAPTURE_STITCH_OVERLAP_CSS : 0
      const desiredScrollTopCss = Math.max(
        0,
        Math.min(logicalTopCss - stitchOverlapTopCss, totalHeightCss - viewportHeightCss)
      )
      const visibleStartTopCss = Math.max(0, logicalTopCss - desiredScrollTopCss)
      const visibleHeightCss = Math.min(
        viewportHeightCss - visibleStartTopCss,
        captureEndCss - logicalTopCss
      )
      const nextLogicalTopCss = logicalTopCss + visibleHeightCss

      let logicalLeftCss = captureStartLeftCss
      while (logicalLeftCss < captureEndLeftCss) {
        const stitchOverlapLeftCss = logicalLeftCss > captureStartLeftCss ? CAPTURE_STITCH_OVERLAP_CSS : 0
        const desiredScrollLeftCss = Math.max(
          0,
          Math.min(logicalLeftCss - stitchOverlapLeftCss, totalWidthCss - viewportWidthCss)
        )
        const visibleStartLeftCss = Math.max(0, logicalLeftCss - desiredScrollLeftCss)
        const visibleWidthCss = Math.min(
          viewportWidthCss - visibleStartLeftCss,
          captureEndLeftCss - logicalLeftCss
        )
        const nextLogicalLeftCss = logicalLeftCss + visibleWidthCss

        scrollElement.scrollLeft = desiredScrollLeftCss
        scrollElement.scrollTop = desiredScrollTopCss

        await waitForCaptureSettle(windowObject, settleFrameCount, settleDelayMs)

        const captureRect = buildCaptureRect(scrollElement)
        const pngBase64 = await window.electronAPI.captureWindowRectToPngBase64(captureRect)
        const bitmap = await decodePngBase64(pngBase64)

        try {
          if (!canvas || !context) {
            bitmapScaleX = bitmap.width / captureRect.width
            bitmapScaleY = bitmap.height / captureRect.height

            const baseOutputWidth = sanitizeOutputSize(captureWidthCss * bitmapScaleX)
            const baseOutputHeight = sanitizeOutputSize(captureHeightCss * bitmapScaleY)
            outputScale = resolveCanvasScale(baseOutputWidth, baseOutputHeight)

            canvas = ownerDocument.createElement('canvas')
            canvas.width = sanitizeOutputSize(baseOutputWidth * outputScale)
            canvas.height = sanitizeOutputSize(baseOutputHeight * outputScale)
            context = canvas.getContext('2d')

            if (!context) {
              throw new Error('Failed to create capture canvas.')
            }
          }

          const sourceLeft = Math.round(visibleStartLeftCss * bitmapScaleX)
          const sourceRight = Math.round((visibleStartLeftCss + visibleWidthCss) * bitmapScaleX)
          const sourceTop = Math.round(visibleStartTopCss * bitmapScaleY)
          const sourceBottom = Math.round((visibleStartTopCss + visibleHeightCss) * bitmapScaleY)
          const destinationLeft = Math.round((logicalLeftCss - captureStartLeftCss) * bitmapScaleX * outputScale)
          const destinationRight = Math.round((nextLogicalLeftCss - captureStartLeftCss) * bitmapScaleX * outputScale)
          const destinationTop = Math.round((logicalTopCss - captureStartCss) * bitmapScaleY * outputScale)
          const destinationBottom = Math.round((nextLogicalTopCss - captureStartCss) * bitmapScaleY * outputScale)

          context.drawImage(
            bitmap,
            sourceLeft,
            sourceTop,
            Math.max(1, sourceRight - sourceLeft),
            Math.max(1, sourceBottom - sourceTop),
            destinationLeft,
            destinationTop,
            Math.max(1, destinationRight - destinationLeft),
            Math.max(1, destinationBottom - destinationTop)
          )

          logicalLeftCss = nextLogicalLeftCss
        } finally {
          bitmap.close()
        }
      }

      logicalTopCss = nextLogicalTopCss
    }

    if (!canvas) {
      throw new Error('Failed to capture scrollable content.')
    }

    const pngBase64 = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
    await window.electronAPI.writeClipboardImagePngBase64(pngBase64)

    return {
      outputWidth: canvas.width,
      outputHeight: canvas.height,
      scale: outputScale,
    }
  } finally {
    scrollElement.scrollLeft = originalScrollLeft
    scrollElement.scrollTop = originalScrollTop
    scrollElement.style.scrollBehavior = originalScrollBehavior
    scrollElement.style.overflowAnchor = originalOverflowAnchor
    classTarget.classList.remove(captureBodyClass)
    await waitForCaptureSettle(windowObject, 1, 0)
  }
}
