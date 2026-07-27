import type { BrowserContext, Page } from 'playwright-core'
import type { BrowserScreenshotErrorCode, BrowserScreenshotFixedElementPolicy, BrowserScreenshotProgress, BrowserScreenshotRequest, BrowserScreenshotResult, BrowserScreenshotTarget, BrowserScreenshotTargetsChanged } from '../../../shared/types'
import type { BrowserAiService } from '../browser-ai/browserAiService'
import { composePngSlices, type PngSlice } from './pngComposer'

const DEFAULT_MAX_HEIGHT = 60_000
const DEFAULT_MAX_DURATION = 120_000
const MAX_IMAGE_AREA = 268_000_000
const SEGMENT_OVERLAP = 32

type ScreenshotDependencies = {
  browserAiService: BrowserAiService
  emitProgress: (event: BrowserScreenshotProgress) => void
  saveFile: (pngBase64: string, suggestedName: string) => Promise<boolean>
  openFile: (pngBase64: string, suggestedName: string) => Promise<boolean>
  emitTargetsChanged: (targets: BrowserScreenshotTargetsChanged) => void
}

type PageState = { scrollX: number; scrollY: number; videos: boolean[] }

function errorMessage(code: BrowserScreenshotErrorCode): string {
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

async function waitForPageSettle(page: Page, timeoutMs: number): Promise<void> {
  await Promise.race([
    (async () => {
      await page.evaluate(async () => {
        await Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((resolve) => setTimeout(resolve, 1_500))])
        const images = Array.from(document.images).filter((image) => image.getBoundingClientRect().bottom >= 0 && image.getBoundingClientRect().top <= innerHeight)
        await Promise.all(images.map((image) => image.decode?.().catch(() => undefined)))
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      })
    })(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('settle-timeout')), timeoutMs)),
  ]).catch(() => undefined)
}

async function preparePage(page: Page, policy: BrowserScreenshotFixedElementPolicy): Promise<PageState> {
  const state = await page.evaluate(() => ({ scrollX, scrollY, videos: Array.from(document.querySelectorAll('video')).map((video) => !video.paused) }))
  await page.evaluate(
    ({ policy }) => {
      const style = document.createElement('style')
      style.id = '__ide_browser_screenshot_style__'
      style.textContent = '* { animation: none !important; transition: none !important; caret-color: transparent !important; } html { scroll-behavior: auto !important; overflow-anchor: none !important; } [data-ide-screenshot-hidden] { visibility: hidden !important; }'
      document.documentElement.appendChild(style)
      document.querySelectorAll('video').forEach((video) => video.pause())
      if (policy === 'hide') {
        document.querySelectorAll('*').forEach((element) => {
          const position = getComputedStyle(element).position
          if (position === 'fixed' || position === 'sticky') {
            element.setAttribute('data-ide-screenshot-hidden', 'true')
          }
        })
      }
    },
    { policy },
  )
  return state
}

async function restorePage(page: Page, state: PageState): Promise<void> {
  await page
    .evaluate((state) => {
      document.getElementById('__ide_browser_screenshot_style__')?.remove()
      document.querySelectorAll('[data-ide-screenshot-hidden]').forEach((element) => {
        element.removeAttribute('data-ide-screenshot-hidden')
      })
      document.querySelectorAll('video').forEach((video, index) => {
        if (state.videos[index]) void video.play().catch(() => undefined)
      })
      window.scrollTo(state.scrollX, state.scrollY)
    }, state)
    .catch(() => undefined)
}

function findPage(context: BrowserContext, id: string, pageIds: Map<Page, string>): Page | null {
  const pages = context.pages()
  const index = pages.findIndex((page) => pageIds.get(page) === id)
  return index >= 0 ? pages[index] : null
}

export interface BrowserScreenshotService {
  listTargets: () => Promise<BrowserScreenshotTarget[]>
  start: (request: BrowserScreenshotRequest) => Promise<BrowserScreenshotResult>
  cancel: (taskId: string) => Promise<boolean>
  save: (pngBase64: string, suggestedName?: string) => Promise<boolean>
  openInDefaultApp: (pngBase64: string, suggestedName?: string) => Promise<boolean>
  cleanupOnBeforeQuit: () => Promise<void>
}

export function createBrowserScreenshotService(deps: ScreenshotDependencies): BrowserScreenshotService {
  let activeTaskId: string | null = null
  let cancelRequested = false
  let activePage: Page | null = null
  let nextPageId = 0
  const pageIds = new Map<Page, string>()
  let boundContext: BrowserContext | null = null
  const boundPages = new Set<Page>()
  let targetsChangedTimer: ReturnType<typeof setTimeout> | null = null

  const getPageId = (page: Page): string => {
    const existingId = pageIds.get(page)
    if (existingId) return existingId
    const id = `browser-page-${nextPageId++}`
    pageIds.set(page, id)
    return id
  }

  const listTargetsFromContext = async (context: BrowserContext): Promise<BrowserScreenshotTarget[]> => {
    const pages = context.pages()
    for (const page of pageIds.keys()) {
      if (page.isClosed()) pageIds.delete(page)
    }
    return Promise.all(
      pages.map(async (page, index) => ({
        id: getPageId(page),
        title: await page.title().catch(() => page.url()),
        url: page.url(),
        isClosed: page.isClosed(),
        isActiveCandidate: index === pages.length - 1,
      })),
    )
  }

  const emitCurrentTargets = (context: BrowserContext): void => {
    if (targetsChangedTimer !== null) return
    targetsChangedTimer = setTimeout(() => {
      targetsChangedTimer = null
      void listTargetsFromContext(context)
        .then((targets) => deps.emitTargetsChanged(targets))
        .catch(() => undefined)
    }, 60)
  }

  const bindPage = (page: Page, context: BrowserContext): void => {
    if (boundPages.has(page)) return
    boundPages.add(page)
    getPageId(page)
    page.on('close', () => {
      boundPages.delete(page)
      emitCurrentTargets(context)
    })
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) emitCurrentTargets(context)
    })
    page.on('framenavigated', () => emitCurrentTargets(context))
    page.on('domcontentloaded', () => emitCurrentTargets(context))
    page.on('load', () => emitCurrentTargets(context))
  }

  const bindContext = (context: BrowserContext): void => {
    if (boundContext === context) return
    boundContext = context
    for (const page of context.pages()) bindPage(page, context)
    context.on('page', (page) => {
      bindPage(page, context)
      emitCurrentTargets(context)
    })
  }

  const listTargets = async (): Promise<BrowserScreenshotTarget[]> => {
    const { context } = await deps.browserAiService.ensureBrowserConnection()
    bindContext(context)
    return listTargetsFromContext(context)
  }

  const emit = (taskId: string, event: Omit<BrowserScreenshotProgress, 'taskId'>) => deps.emitProgress({ taskId, ...event })

  const start = async (request: BrowserScreenshotRequest): Promise<BrowserScreenshotResult> => {
    if (activeTaskId) throw new Error(errorMessage('TASK_ALREADY_RUNNING'))
    const taskId = `browser-screenshot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const startedAt = Date.now()
    const warnings: string[] = []
    let restoreState: PageState | null = null
    let ownedPage = false
    activeTaskId = taskId
    cancelRequested = false
    try {
      emit(taskId, { stage: 'analyzing', message: '正在分析浏览器页面。', percent: 5 })
      const { context } = await deps.browserAiService.ensureBrowserConnection()
      bindContext(context)
      let page: Page | null = request.targetId ? findPage(context, request.targetId, pageIds) : null
      if (request.url?.trim()) {
        const url = request.url.trim()
        let parsedUrl: URL
        try {
          parsedUrl = new URL(url)
        } catch {
          throw new Error('请输入有效的网址。')
        }
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('只支持 http 或 https 网址。')
        if (!page || page.isClosed()) {
          page = await context.newPage()
          ownedPage = true
          bindPage(page, context)
        }
        await page.goto(parsedUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 })
      }
      if (!page || page.isClosed()) throw Object.assign(new Error(errorMessage('TARGET_NOT_FOUND')), { code: 'TARGET_NOT_FOUND' })
      activePage = page
      const policy = request.fixedElementPolicy ?? 'keep'
      const state = await preparePage(page, policy)
      restoreState = state
      emit(taskId, { stage: 'preparing', message: '正在准备页面并等待资源稳定。', percent: 12 })
      await waitForPageSettle(page, 4_000)
      if (cancelRequested) throw Object.assign(new Error(errorMessage('CAPTURE_CANCELLED')), { code: 'CAPTURE_CANCELLED' })
      let png: Buffer
      let width = 0
      let height = 0
      if (!request.forceSegmented) {
        try {
          emit(taskId, { stage: 'capturing', message: '正在生成网页整页截图。', percent: 20 })
          if (Date.now() - startedAt > (request.maxDurationMs ?? DEFAULT_MAX_DURATION)) throw Object.assign(new Error(errorMessage('CAPTURE_TIMEOUT')), { code: 'CAPTURE_TIMEOUT' })
          png = await page.screenshot({ type: 'png', fullPage: true })
          const size = await page.evaluate(() => ({ width: innerWidth, height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0), dpr: devicePixelRatio }))
          width = Math.round(size.width * size.dpr)
          height = Math.round(size.height * size.dpr)
          if (height > (request.maxHeight ?? DEFAULT_MAX_HEIGHT) || width * height > MAX_IMAGE_AREA) throw new Error('image-too-large')
        } catch {
          warnings.push('浏览器原生整页截图不可用，已切换为分段截图。')
          png = await captureSegmented(
            page,
            taskId,
            request,
            emit,
            () => cancelRequested,
            (value) => {
              width = value.width
              height = value.height
            },
          )
        }
      } else {
        png = await captureSegmented(
          page,
          taskId,
          request,
          emit,
          () => cancelRequested,
          (value) => {
            width = value.width
            height = value.height
          },
        )
      }
      emit(taskId, { stage: 'composing', message: '正在整理截图结果。', percent: 92 })
      emit(taskId, { stage: 'saving', message: '正在准备输出图片。', percent: 97 })
      emit(taskId, { stage: 'completed', message: '网页长截图完成。', percent: 100 })
      return { taskId, status: 'completed', pngBase64: png.toString('base64'), title: await page.title().catch(() => page.url()), url: page.url(), width, height, startedAt, completedAt: Date.now(), warnings }
    } catch (error) {
      const code = (error as { code?: string }).code ?? (cancelRequested ? 'CAPTURE_CANCELLED' : 'UNKNOWN')
      const normalizedCode = code === 'image-too-large' ? 'IMAGE_TOO_LARGE' : code
      const finalCode = normalizedCode as BrowserScreenshotErrorCode
      emit(taskId, { stage: finalCode === 'CAPTURE_CANCELLED' ? 'cancelled' : 'failed', message: error instanceof Error ? error.message : errorMessage(finalCode), errorCode: finalCode, percent: 100 })
      return { taskId, status: finalCode === 'CAPTURE_CANCELLED' ? 'cancelled' : 'failed', startedAt, completedAt: Date.now(), warnings, errorCode: finalCode, errorMessage: error instanceof Error ? error.message : errorMessage(finalCode) }
    } finally {
      if (activePage && restoreState) await restorePage(activePage, restoreState)
      if (ownedPage && activePage && !activePage.isClosed()) await activePage.close()
      activePage = null
      activeTaskId = null
      cancelRequested = false
    }
  }

  const cancel = async (taskId: string): Promise<boolean> => {
    if (taskId !== activeTaskId) return false
    cancelRequested = true
    return true
  }

  return {
    listTargets,
    start,
    cancel,
    save: (pngBase64, suggestedName) => deps.saveFile(pngBase64, suggestedName || 'browser-long-screenshot.png'),
    openInDefaultApp: (pngBase64, suggestedName) => deps.openFile(pngBase64, suggestedName || 'browser-long-screenshot.png'),
    cleanupOnBeforeQuit: async () => {
      cancelRequested = true
      if (targetsChangedTimer !== null) clearTimeout(targetsChangedTimer)
    },
  }
}

async function captureSegmented(page: Page, taskId: string, request: BrowserScreenshotRequest, emit: (taskId: string, event: Omit<BrowserScreenshotProgress, 'taskId'>) => void, isCancelled: () => boolean, onSize: (size: { width: number; height: number }) => void): Promise<Buffer> {
  const deadline = Date.now() + (request.maxDurationMs ?? DEFAULT_MAX_DURATION)
  const info = await page.evaluate(() => ({ viewportWidth: innerWidth, viewportHeight: innerHeight, totalHeight: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0), dpr: devicePixelRatio }))
  const maxHeight = request.maxHeight ?? DEFAULT_MAX_HEIGHT
  if (info.totalHeight > maxHeight) throw Object.assign(new Error(errorMessage('IMAGE_TOO_LARGE')), { code: 'IMAGE_TOO_LARGE' })
  const totalSegments = Math.max(1, Math.ceil(info.totalHeight / Math.max(1, info.viewportHeight - SEGMENT_OVERLAP)))
  const slices: PngSlice[] = []
  for (let index = 0, requestedTop = 0; requestedTop < info.totalHeight; index += 1, requestedTop += Math.max(1, info.viewportHeight - SEGMENT_OVERLAP)) {
    if (isCancelled()) throw Object.assign(new Error(errorMessage('CAPTURE_CANCELLED')), { code: 'CAPTURE_CANCELLED' })
    if (Date.now() > deadline) throw Object.assign(new Error(errorMessage('CAPTURE_TIMEOUT')), { code: 'CAPTURE_TIMEOUT' })
    await page.evaluate((top) => window.scrollTo(0, top), requestedTop)
    await waitForPageSettle(page, 2_500)
    const actualTop = await page.evaluate(() => scrollY)
    const buffer = await page.screenshot({ type: 'png' })
    const scale = info.dpr
    const imageTop = Math.max(0, Math.round((requestedTop - actualTop) * scale))
    const destinationTop = Math.round(actualTop * scale)
    const sourceBottom = Math.min(Math.round(info.viewportHeight * scale), Math.round((info.totalHeight - actualTop) * scale) + imageTop)
    slices.push({ buffer, sourceTop: imageTop, sourceBottom, destinationTop })
    emit(taskId, { stage: 'capturing', message: `正在截图第 ${index + 1}/${totalSegments} 段。`, currentSegment: index + 1, totalSegments, percent: 15 + Math.round(((index + 1) / totalSegments) * 70) })
    if (requestedTop + info.viewportHeight >= info.totalHeight) break
  }
  const width = Math.round(info.viewportWidth * info.dpr)
  const height = Math.round(info.totalHeight * info.dpr)
  if (width * height > MAX_IMAGE_AREA) throw Object.assign(new Error(errorMessage('IMAGE_TOO_LARGE')), { code: 'IMAGE_TOO_LARGE' })
  onSize({ width, height })
  return composePngSlices(slices, width, height)
}
