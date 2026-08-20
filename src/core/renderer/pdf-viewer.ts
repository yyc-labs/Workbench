import { TextLayer } from 'pdfjs-dist'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const scrollEl = document.getElementById('pdf-scroll') as HTMLDivElement
const pagesEl = document.getElementById('pdf-pages') as HTMLDivElement

const PAGE_GUTTER = 32
const ZOOM_STEP = 0.1
const MIN_SCALE = 0.25
const MAX_SCALE = 5
const RESIZE_DEBOUNCE_MS = 150
const PDF_ZOOM_STORAGE_KEY = 'yyc-workbench.pdf-zoom'

let loadingTask: PDFDocumentLoadingTask | null = null
let pdfDocument: PDFDocumentProxy | null = null
let currentScale: number | 'fit-width' = 'fit-width'
let resolvedScale = 1
let renderToken = 0
let disposed = false
let resizeTimer: number | null = null
let theme: 'light' | 'dark' = 'dark'
let renderedScale: number | null = null
let previewScale = 1
let zoomNeedsRender = false

function readStoredZoom(): number | null {
  try {
    const value = Number.parseFloat(window.localStorage.getItem(PDF_ZOOM_STORAGE_KEY) ?? '')
    return Number.isFinite(value) && value >= MIN_SCALE && value <= MAX_SCALE ? value : null
  } catch {
    return null
  }
}

function storeZoom(scale: number): void {
  try {
    window.localStorage.setItem(PDF_ZOOM_STORAGE_KEY, String(scale))
  } catch {
    // PDF rendering remains usable when storage is unavailable.
  }
}

function postToParent(message: unknown): void {
  window.parent.postMessage(message, '*')
}

let rightDragActive = false
let rightDragStartX = 0
let rightDragStartY = 0

function forwardMouseGesture(event: MouseEvent): void {
  postToParent({
    type: 'preview:mouse-gesture',
    eventType: event.type,
    clientX: event.clientX,
    clientY: event.clientY,
    button: event.button,
    buttons: event.buttons,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
  })
}

window.addEventListener(
  'mousedown',
  (event) => {
    if (event.button !== 2) return
    rightDragActive = false
    rightDragStartX = event.clientX
    rightDragStartY = event.clientY
    forwardMouseGesture(event)
  },
  true,
)

window.addEventListener(
  'mousemove',
  (event) => {
    if ((event.buttons & 2) === 0) return
    if (!rightDragActive && Math.hypot(event.clientX - rightDragStartX, event.clientY - rightDragStartY) >= 8) {
      rightDragActive = true
    }
    forwardMouseGesture(event)
  },
  true,
)

window.addEventListener(
  'mouseup',
  (event) => {
    if (event.button !== 2) return
    forwardMouseGesture(event)
  },
  true,
)

window.addEventListener(
  'contextmenu',
  (event) => {
    if (rightDragActive) event.preventDefault()
    forwardMouseGesture(event)
    rightDragActive = false
  },
  true,
)

function computeFitWidthScale(page: PDFPageProxy): number {
  const baseViewport = page.getViewport({ scale: 1 })
  const usableWidth = Math.max(scrollEl.clientWidth - PAGE_GUTTER * 2, 80)
  return usableWidth / baseViewport.width
}

function createPage(page: PDFPageProxy, scale: number): { wrapper: HTMLDivElement; canvas: HTMLCanvasElement; textLayerDiv: HTMLDivElement; viewport: PageViewport; outputScale: number } {
  const outputScale = window.devicePixelRatio || 1
  const viewport = page.getViewport({ scale })

  // The canvas buffer uses device pixels for sharpness while its layout size,
  // the page wrapper, and the PDF.js text layer all use the CSS viewport.
  // Keeping those coordinates separate prevents selection offsets at high DPI.
  const canvas = document.createElement('canvas')
  canvas.className = 'pdf-page-canvas'
  canvas.width = Math.floor(viewport.width * outputScale)
  canvas.height = Math.floor(viewport.height * outputScale)
  canvas.style.width = `${viewport.width}px`
  canvas.style.height = `${viewport.height}px`

  // Selectable/copyable text overlay. Variables mirror pdf.js' own text layer
  // styles so the spans line up with the painted canvas.
  const textLayerDiv = document.createElement('div')
  textLayerDiv.className = 'textLayer'
  textLayerDiv.style.setProperty('--total-scale-factor', String(scale))
  textLayerDiv.style.setProperty('--scale-round-x', '0.01px')
  textLayerDiv.style.setProperty('--scale-round-y', '0.01px')

  const wrapper = document.createElement('div')
  wrapper.className = 'pdf-page-wrapper'
  wrapper.style.width = `${viewport.width}px`
  wrapper.style.height = `${viewport.height}px`
  wrapper.appendChild(canvas)
  wrapper.appendChild(textLayerDiv)

  return { wrapper, canvas, textLayerDiv, viewport, outputScale }
}

async function renderOnePage(page: PDFPageProxy, scale: number, token: number): Promise<HTMLDivElement | null> {
  const { wrapper, canvas, textLayerDiv, viewport, outputScale } = createPage(page, scale)
  await page.render({
    canvas,
    viewport,
    transform: [outputScale, 0, 0, outputScale, 0, 0],
    pageColors: theme === 'dark' ? { background: '#202023', foreground: '#eee9e2' } : undefined,
  }).promise
  if (token !== renderToken || disposed) return null

  try {
    const textLayer = new TextLayer({
      textContentSource: page.streamTextContent(),
      container: textLayerDiv,
      viewport,
    })
    await textLayer.render()
  } catch {
    // A failing text layer must not block the page canvas from showing.
  }
  return token === renderToken && !disposed ? wrapper : null
}

/**
 * Renders off-screen and swaps the complete stack only after every page is
 * ready. This keeps the visible document and scroll range stable during zoom.
 */
async function renderDocument(scale: number): Promise<void> {
  if (!pdfDocument) return
  const token = ++renderToken
  const pages = document.createDocumentFragment()

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    if (token !== renderToken || disposed) return
    const page = await pdfDocument.getPage(pageNumber)
    if (token !== renderToken || disposed) return
    const wrapper = await renderOnePage(page, scale, token)
    if (!wrapper) return
    pages.appendChild(wrapper)
  }

  if (token !== renderToken || disposed) return
  pagesEl.style.zoom = ''
  pagesEl.replaceChildren(pages)
  renderedScale = scale
  previewScale = scale
  postToParent({ type: 'pdf:ready' })
}

async function openPdf(data: Uint8Array): Promise<void> {
  try {
    await loadingTask?.destroy()
    const task = pdfjsLib.getDocument({ data })
    loadingTask = task
    const doc = await task.promise
    pdfDocument = doc
    currentScale = 'fit-width'
    renderedScale = null
    zoomNeedsRender = false
    const firstPage = await doc.getPage(1)
    const storedZoom = readStoredZoom()
    currentScale = storedZoom ?? 'fit-width'
    resolvedScale = storedZoom ?? computeFitWidthScale(firstPage)
    previewScale = resolvedScale
    await renderDocument(resolvedScale)
  } catch (error) {
    console.error('[pdf-viewer] failed to load PDF:', error)
    postToParent({ type: 'pdf:error' })
  }
}

function applyZoomPreview(nextScale: number, anchor: { x: number; y: number }): void {
  if (!renderedScale || pagesEl.childElementCount === 0) return
  const scaleRatio = nextScale / renderedScale
  const scrollScale = nextScale / previewScale
  const scrollTop = scrollEl.scrollTop
  const scrollLeft = scrollEl.scrollLeft

  pagesEl.style.zoom = String(scaleRatio)

  const maxScrollTop = Math.max(scrollEl.scrollHeight - scrollEl.clientHeight, 0)
  const maxScrollLeft = Math.max(scrollEl.scrollWidth - scrollEl.clientWidth, 0)
  scrollEl.scrollTop = Math.min(Math.max((scrollTop + anchor.y) * scrollScale - anchor.y, 0), maxScrollTop)
  scrollEl.scrollLeft = Math.min(Math.max((scrollLeft + anchor.x) * scrollScale - anchor.x, 0), maxScrollLeft)
  previewScale = nextScale
}

function zoomBy(delta: number, anchor: { x: number; y: number }): void {
  if (!pdfDocument || disposed) return
  const base = currentScale === 'fit-width' ? resolvedScale : currentScale
  const next = Math.min(Math.max(base + delta, MIN_SCALE), MAX_SCALE)
  if (next === base) return
  currentScale = next
  resolvedScale = next
  storeZoom(next)
  renderToken += 1
  applyZoomPreview(next, anchor)
  zoomNeedsRender = true
}

function handleWheel(event: WheelEvent): void {
  // Ctrl/Cmd + wheel zooms like a browser PDF reader; plain wheel scrolls the
  // stacked pages naturally (no page-turn interception needed).
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault()
    const bounds = scrollEl.getBoundingClientRect()
    zoomBy(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP, { x: event.clientX - bounds.left, y: event.clientY - bounds.top })
  }
}

function dispose(): void {
  disposed = true
  if (resizeTimer !== null) window.clearTimeout(resizeTimer)
  resizeObserver.disconnect()
  dprMediaQuery?.removeEventListener('change', handleDprChange)
  scrollEl.removeEventListener('wheel', handleWheel)
  loadingTask?.destroy().catch(() => {})
  TextLayer.cleanup()
  pagesEl.replaceChildren()
}

window.addEventListener('message', (event) => {
  const message = event.data
  if (!message || typeof message.type !== 'string') return
  switch (message.type) {
    case 'pdf:open':
      void openPdf(message.data)
      break
    case 'pdf:theme':
      theme = message.theme === 'dark' ? 'dark' : 'light'
      document.documentElement.dataset.theme = theme
      if (pdfDocument && !disposed) {
        const scale = currentScale === 'fit-width' ? resolvedScale : currentScale
        void renderDocument(scale)
      }
      break
    default:
      break
  }
})

// Let the page clean up pdf.js resources when the frame is removed.
window.addEventListener('pagehide', dispose)

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return
  event.preventDefault()
  postToParent({ type: 'pdf:escape' })
})

window.addEventListener('keyup', (event) => {
  if (!zoomNeedsRender || (event.key !== 'Control' && event.key !== 'Meta')) return
  zoomNeedsRender = false
  void renderDocument(resolvedScale)
})

scrollEl.addEventListener('wheel', handleWheel, { passive: false })

// In fit-width mode reflow the whole stack when the container resizes.
const resizeObserver = new ResizeObserver(() => {
  if (currentScale !== 'fit-width' || !pdfDocument || disposed) return
  if (resizeTimer !== null) window.clearTimeout(resizeTimer)
  resizeTimer = window.setTimeout(() => {
    resizeTimer = null
    if (disposed || !pdfDocument) return
    void (async () => {
      const firstPage = await pdfDocument.getPage(1)
      resolvedScale = computeFitWidthScale(firstPage)
      await renderDocument(resolvedScale)
    })()
  }, RESIZE_DEBOUNCE_MS)
})
resizeObserver.observe(scrollEl)

// When the device pixel ratio changes (e.g. the window moves to a monitor with
// a different scale), the canvas bitmaps are re-created so the text layer
// stays aligned; otherwise the painted page is stretched relative to the text.
let dprMediaQuery: MediaQueryList | null = null

function handleDprChange(): void {
  if (disposed || !pdfDocument) return
  const scale = currentScale === 'fit-width' ? resolvedScale : currentScale
  void renderDocument(scale)
}

dprMediaQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
dprMediaQuery.addEventListener('change', handleDprChange)
