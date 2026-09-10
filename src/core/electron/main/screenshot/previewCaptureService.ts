import type { WebContents } from 'electron'
import { webContents } from 'electron'
import type { BrowserScreenshotErrorCode, BrowserScreenshotProgress, PreviewPageCaptureRequest, PreviewPageCaptureResult } from '../../../shared/types'
import { composePngSlices, type PngSlice } from './pngComposer'

// Ported from screenshotService.ts: the segmented full-page capture pipeline
// (page preparation, fixed-element policy, overlap slicing, PNG composing,
// progress, cancellation, state restore) adapted from a Playwright Page to an
// Electron guest WebContents so the HTML preview can capture itself locally.

const DEFAULT_MAX_HEIGHT = 60_000
const DEFAULT_MAX_DURATION = 120_000
const MAX_IMAGE_AREA = 268_000_000
const SEGMENT_OVERLAP = 32

type PreviewPageCaptureDependencies = {
  emitProgress: (event: BrowserScreenshotProgress) => void
}

type PreviewPageState = { scrollX: number; scrollY: number; videos: boolean[] }

type PreviewGuestInfo = { viewportWidth: number; viewportHeight: number; totalHeight: number }

function previewErrorMessage(code: BrowserScreenshotErrorCode): string {
  const messages: Record<BrowserScreenshotErrorCode, string> = {
    BROWSER_NOT_CONNECTED: '浏览器连接不可用。',
    TARGET_NOT_FOUND: '目标浏览器标签页已关闭。',
    PAGE_NOT_SUPPORTED: '该网页使用了暂不支持的复杂滚动结构。',
    CAPTURE_TIMEOUT: '网页长截图超时。',
    IMAGE_TOO_LARGE: '网页截图尺寸过大，已停止处理。',
    CAPTURE_CANCELLED: '截图已取消。',
    COMPOSE_FAILED: '网页截图拼接失败。',
    RESTORE_WARNING: '截图已完成，但网页状态恢复可能不完整。',
    TASK_ALREADY_RUNNING: '已有一个网页截图任务正在运行。',
    UNKNOWN: '网页截图失败。',
  }
  return messages[code]
}

function previewError(code: BrowserScreenshotErrorCode): Error {
  return Object.assign(new Error(previewErrorMessage(code)), { code })
}

function throwIfCancelled(isCancelled: () => boolean): void {
  if (isCancelled()) throw previewError('CAPTURE_CANCELLED')
}

async function evalGuest<T>(guest: WebContents, code: string): Promise<T> {
  return (await guest.executeJavaScript(code)) as T
}

/** 注入截图辅助样式：冻结动画/过渡、隐藏滚动条，并暂停视频。 */
async function prepareGuestPage(guest: WebContents): Promise<PreviewPageState> {
  const state = await evalGuest<PreviewPageState>(guest, '({ scrollX: window.scrollX, scrollY: window.scrollY, videos: Array.from(document.querySelectorAll("video")).map((video) => !video.paused) })')
  await evalGuest<unknown>(
    guest,
    `(function () {
      const style = document.createElement('style')
      style.id = '__ide_browser_screenshot_style__'
      style.textContent = '* { animation: none !important; transition: none !important; caret-color: transparent !important; scroll-behavior: auto !important; overflow-anchor: none !important; } ::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }'
      document.documentElement.appendChild(style)
      document.querySelectorAll('video').forEach((video) => video.pause())
      const eventTypes = ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'wheel', 'touchstart', 'touchmove', 'keydown']
      const interactionLockHandler = (event) => {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
      const interactionLockOptions = { capture: true, passive: false }
      eventTypes.forEach((type) => window.addEventListener(type, interactionLockHandler, interactionLockOptions))
      window.__ide_browser_screenshot_interaction_lock__ = { eventTypes, handler: interactionLockHandler }
    })()`,
  ).catch(() => undefined)
  return state
}

async function restoreGuestPage(guest: WebContents, state: PreviewPageState): Promise<void> {
  await evalGuest<unknown>(
    guest,
    `(function () {
      const state = ${JSON.stringify(state)}
      document.getElementById('__ide_browser_screenshot_style__')?.remove()
      const interactionLock = window.__ide_browser_screenshot_interaction_lock__
      if (interactionLock?.handler) {
        interactionLock.eventTypes?.forEach((type) => window.removeEventListener(type, interactionLock.handler, { capture: true }))
      }
      delete window.__ide_browser_screenshot_interaction_lock__
      document.querySelectorAll('video').forEach((video, index) => {
        if (state.videos[index]) void video.play().catch(() => undefined)
      })
      window.scrollTo(state.scrollX, state.scrollY)
    })()`,
  ).catch(() => undefined)
}

async function waitForSegmentReady(guest: WebContents, timeoutMs = 800): Promise<void> {
  await Promise.race([
    evalGuest<unknown>(
      guest,
      `(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => resolve()))
        const images = Array.from(document.images).filter((image) => image.getBoundingClientRect().bottom >= 0 && image.getBoundingClientRect().top <= innerHeight)
        await Promise.all(images.map((image) => image.decode?.().catch(() => undefined)))
        await new Promise((resolve) => requestAnimationFrame(() => resolve()))
      })()`,
    ),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]).catch(() => undefined)
}

/** 等待字体与首屏图片就绪，避免测量高度后内容回流导致接缝错位。 */
async function waitForGuestSettle(guest: WebContents): Promise<void> {
  await Promise.race([
    evalGuest<unknown>(
      guest,
      `(async () => {
        await Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((resolve) => setTimeout(resolve, 1500))])
        const images = Array.from(document.images).filter((image) => image.getBoundingClientRect().bottom >= 0 && image.getBoundingClientRect().top <= innerHeight)
        await Promise.all(images.map((image) => image.decode?.().catch(() => undefined)))
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      })()`,
    ),
    new Promise((resolve) => setTimeout(resolve, 2500)),
  ]).catch(() => undefined)
}

async function captureSegmentedFromGuest(guest: WebContents, taskId: string, request: PreviewPageCaptureRequest, emit: (taskId: string, event: Omit<BrowserScreenshotProgress, 'taskId'>) => void, isCancelled: () => boolean): Promise<{ png: Buffer; width: number; height: number }> {
  const deadline = Date.now() + (request.maxDurationMs ?? DEFAULT_MAX_DURATION)
  await waitForGuestSettle(guest)
  const maxHeight = request.maxHeight ?? DEFAULT_MAX_HEIGHT

  let info = await evalGuest<PreviewGuestInfo>(guest, '({ viewportWidth: innerWidth, viewportHeight: innerHeight, totalHeight: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0) })')
  if (info.totalHeight > maxHeight) throw previewError('IMAGE_TOO_LARGE')
  const probeImage = await guest.capturePage()
  const scale = probeImage.getSize().height / Math.max(1, info.viewportHeight)
  if (!Number.isFinite(scale) || scale <= 0) throw previewError('COMPOSE_FAILED')

  let slices: PngSlice[] = []
  let width = 0
  let height = 0
  // Content height can drift while capturing (late fonts/images reflow). If a
  // full pass ends with a different height, redo it once so slice destinations
  // and the canvas height stay consistent.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    slices = []
    const totalHeight = info.totalHeight
    width = Math.round(info.viewportWidth * scale)
    height = Math.round(totalHeight * scale)
    if (width * height > MAX_IMAGE_AREA) throw previewError('IMAGE_TOO_LARGE')
    const totalSegments = Math.max(1, Math.ceil(totalHeight / Math.max(1, info.viewportHeight - SEGMENT_OVERLAP)))
    for (let index = 0, requestedTop = 0; requestedTop < totalHeight; index += 1, requestedTop += Math.max(1, info.viewportHeight - SEGMENT_OVERLAP)) {
      if (guest.isDestroyed()) throw previewError('TARGET_NOT_FOUND')
      throwIfCancelled(isCancelled)
      if (Date.now() > deadline) throw previewError('CAPTURE_TIMEOUT')
      await evalGuest<unknown>(guest, `window.scrollTo(0, ${requestedTop})`)
      await waitForSegmentReady(guest)
      throwIfCancelled(isCancelled)
      // Force a fresh compositor frame: a stale pre-scroll frame would stitch
      // whole sections into the wrong position.
      guest.invalidate()
      await evalGuest<unknown>(guest, 'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      throwIfCancelled(isCancelled)
      const actualTop = await evalGuest<number>(guest, 'window.scrollY')
      const image = await guest.capturePage()
      const png = image.toPNG()
      // Place the full captured viewport at its true document offset; later
      // slices overwrite the identical overlap, so placement is self-correcting
      // even when the scroll position gets clamped at the document end.
      const destinationTop = Math.round(actualTop * scale)
      const sourceBottom = Math.min(Math.round(info.viewportHeight * scale), Math.max(0, Math.round((totalHeight - actualTop) * scale)))
      slices.push({ buffer: png, sourceTop: 0, sourceBottom, destinationTop })
      emit(taskId, { stage: 'capturing', message: `正在截图第 ${index + 1}/${totalSegments} 段。`, currentSegment: index + 1, totalSegments, percent: 15 + Math.round(((index + 1) / totalSegments) * 70) })
      if (requestedTop + info.viewportHeight >= totalHeight) break
    }
    const remeasured = await evalGuest<number>(guest, 'Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0)')
    if (Math.abs(remeasured - info.totalHeight) <= 2 || attempt === 1) break
    info = { ...info, totalHeight: remeasured }
    await evalGuest<unknown>(guest, 'window.scrollTo(0, 0)')
    await waitForSegmentReady(guest)
  }
  return { png: composePngSlices(slices, width, height), width, height }
}

export type PreviewPageCaptureService = {
  capture: (request: PreviewPageCaptureRequest) => Promise<PreviewPageCaptureResult>
  cancel: () => boolean
}

export function createPreviewPageCaptureService(deps: PreviewPageCaptureDependencies): PreviewPageCaptureService {
  let activeTaskId: string | null = null
  let cancelRequested = false

  const emit = (taskId: string, event: Omit<BrowserScreenshotProgress, 'taskId'>) => deps.emitProgress({ taskId, ...event })

  const capture = async (request: PreviewPageCaptureRequest): Promise<PreviewPageCaptureResult> => {
    if (activeTaskId) throw previewError('TASK_ALREADY_RUNNING')
    const taskId = `preview-capture-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const guest = webContents.fromId(request.webContentsId)
    if (!guest || guest.isDestroyed()) return { taskId, status: 'failed', errorCode: 'TARGET_NOT_FOUND', errorMessage: previewErrorMessage('TARGET_NOT_FOUND') }

    activeTaskId = taskId
    cancelRequested = false
    let state: PreviewPageState | null = null
    try {
      emit(taskId, { stage: 'analyzing', message: '正在分析预览页面。', percent: 5 })
      emit(taskId, { stage: 'preparing', message: '正在准备页面。', percent: 12 })
      state = await prepareGuestPage(guest)
      throwIfCancelled(() => cancelRequested)
      const captured = await captureSegmentedFromGuest(guest, taskId, request, emit, () => cancelRequested)
      emit(taskId, { stage: 'composing', message: '正在整理截图结果。', percent: 92 })
      emit(taskId, { stage: 'saving', message: '正在准备输出图片。', percent: 97 })
      emit(taskId, { stage: 'completed', message: '网页长截图完成。', percent: 100 })
      return { taskId, status: 'completed', pngBase64: captured.png.toString('base64'), width: captured.width, height: captured.height }
    } catch (error) {
      const code = (error as { code?: BrowserScreenshotErrorCode }).code ?? (cancelRequested ? 'CAPTURE_CANCELLED' : 'UNKNOWN')
      const stage = code === 'CAPTURE_CANCELLED' ? 'cancelled' : 'failed'
      emit(taskId, { stage, message: error instanceof Error ? error.message : previewErrorMessage(code), errorCode: code, percent: 100 })
      return { taskId, status: stage, errorCode: code, errorMessage: error instanceof Error ? error.message : previewErrorMessage(code) }
    } finally {
      if (guest && !guest.isDestroyed() && state) await restoreGuestPage(guest, state)
      activeTaskId = null
      cancelRequested = false
    }
  }

  const cancel = (): boolean => {
    if (!activeTaskId) return false
    cancelRequested = true
    return true
  }

  return { capture, cancel }
}
