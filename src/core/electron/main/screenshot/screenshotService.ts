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
  setCaptureWindowVisible?: (visible: boolean) => void
}

type PageState = { scrollX: number; scrollY: number; videos: boolean[]; containerPath?: string; containerScrollTop?: number }

type PreciseContainerRect = {
  x: number
  y: number
  width: number
  height: number
  scrollTop: number
  totalHeight: number
}

function formatPreciseCoordinate(value: number): string {
  return Number.isFinite(value) ? Number(value.toFixed(2)).toString() : String(value)
}

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

async function waitForSegmentReady(page: Page, timeoutMs = 800): Promise<void> {
  await Promise.race([
    page.evaluate(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const images = Array.from(document.images).filter((image) => image.getBoundingClientRect().bottom >= 0 && image.getBoundingClientRect().top <= innerHeight)
      await Promise.all(images.map((image) => image.decode?.().catch(() => undefined)))
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]).catch(() => undefined)
}

async function waitForDomQuiet(page: Page, quietMs = 1_200, timeoutMs = 8_000): Promise<void> {
  await page
    .evaluate(
      ({ quietMs, timeoutMs }) =>
        new Promise<void>((resolve) => {
          let quietTimer: number | null = null
          let timeout = 0
          const observer = new MutationObserver(() => schedule())
          const done = () => {
            if (quietTimer !== null) window.clearTimeout(quietTimer)
            window.clearTimeout(timeout)
            observer.disconnect()
            resolve()
          }
          const schedule = () => {
            if (quietTimer !== null) window.clearTimeout(quietTimer)
            quietTimer = window.setTimeout(done, quietMs)
          }
          timeout = window.setTimeout(done, timeoutMs)
          observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
          schedule()
        }),
      { quietMs, timeoutMs },
    )
    .catch(() => undefined)
}

async function stabilizePreciseContainer(page: Page, path: string, requestedTop?: number): Promise<PreciseContainerRect> {
  return page.evaluate(
    async ({ selector, requestedTop }) => {
      const element = selector === '__document__' ? document.scrollingElement : document.querySelector(selector)
      if (!(element instanceof HTMLElement)) throw new Error('选中的滚动容器已不存在。')
      const read = () => {
        const bounds = selector === '__document__' ? { x: 0, y: 0, width: innerWidth, height: innerHeight } : element.getBoundingClientRect()
        return {
          x: bounds.x,
          y: bounds.y,
          width: selector === '__document__' ? innerWidth : element.clientWidth,
          height: selector === '__document__' ? innerHeight : element.clientHeight,
          scrollTop: selector === '__document__' ? window.scrollY : element.scrollTop,
          totalHeight: element.scrollHeight,
        }
      }
      if (typeof requestedTop === 'number') {
        const maximumTop = Math.max(0, element.scrollHeight - element.clientHeight)
        const targetTop = Math.min(maximumTop, Math.max(0, requestedTop))
        if (selector === '__document__') window.scrollTo({ top: targetTop, behavior: 'auto' })
        else element.scrollTo({ top: targetTop, behavior: 'auto' })
      }
      let previous = read()
      let stableFrames = 0
      const deadline = performance.now() + 3_000
      while (performance.now() < deadline) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        const current = read()
        const unchanged = current.x === previous.x && current.y === previous.y && current.width === previous.width && current.height === previous.height && current.scrollTop === previous.scrollTop && current.totalHeight === previous.totalHeight
        stableFrames = unchanged ? stableFrames + 1 : 0
        if (stableFrames >= 3) return current
        previous = current
      }
      throw new Error('滚动容器布局未在截图前稳定。')
    },
    { selector: path, requestedTop },
  )
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
      const interactionLockKey = '__ide_browser_screenshot_interaction_lock__'
      const eventTypes = ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'wheel', 'touchstart', 'touchmove', 'keydown']
      const interactionLockHandler = (event: Event) => {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
      const interactionLockOptions = { capture: true, passive: false }
      eventTypes.forEach((type) => window.addEventListener(type, interactionLockHandler, interactionLockOptions))
      ;(window as unknown as Record<string, unknown>)[interactionLockKey] = { eventTypes, handler: interactionLockHandler }
    },
    { policy },
  )
  return state
}

async function chooseScrollContainer(page: Page, setCaptureWindowVisible?: (visible: boolean) => void): Promise<string | null> {
  setCaptureWindowVisible?.(false)
  try {
    return await page.evaluate(
      () =>
        new Promise<string | null>((resolve) => {
          const marker = '__ide_browser_screenshot_picker__'
          let highlighted: HTMLElement | null = null
          const highlightBox = document.createElement('div')
          highlightBox.id = marker
          highlightBox.style.cssText = 'position:fixed;display:none;pointer-events:none;z-index:2147483647;border:4px solid #ff3b30;background:rgba(255,59,48,.12);box-shadow:0 0 0 2px rgba(255,255,255,.9),0 0 0 9999px rgba(255,59,48,.04);box-sizing:border-box;'
          const highlightLabel = document.createElement('span')
          highlightLabel.textContent = '选择滚动容器'
          highlightLabel.style.cssText = 'position:absolute;left:-4px;top:-30px;padding:4px 8px;border-radius:6px;background:#ff3b30;color:#fff;font:600 13px/1.2 system-ui,sans-serif;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.25);'
          highlightBox.appendChild(highlightLabel)
          document.documentElement.appendChild(highlightBox)
          const originalOutline = new WeakMap<HTMLElement, string>()
          const isScrollable = (element: HTMLElement): boolean => {
            const style = getComputedStyle(element)
            const canScrollVertically = element.scrollHeight > element.clientHeight + 4
            const canScrollHorizontally = element.scrollWidth > element.clientWidth + 4
            const allowsVerticalScroll = ['auto', 'scroll', 'overlay'].includes(style.overflowY) || ['auto', 'scroll', 'overlay'].includes(style.overflow)
            const allowsHorizontalScroll = ['auto', 'scroll', 'overlay'].includes(style.overflowX) || ['auto', 'scroll', 'overlay'].includes(style.overflow)
            return (canScrollVertically && allowsVerticalScroll) || (canScrollHorizontally && allowsHorizontalScroll)
          }
          const pathFor = (element: Element): string => {
            const parts: string[] = []
            let current: Element | null = element
            while (current && current !== document.documentElement) {
              const parent: Element | null = current.parentElement
              if (!parent) break
              const index = Array.from(parent.children).indexOf(current)
              parts.unshift(`${current.tagName.toLowerCase()}:nth-child(${index + 1})`)
              current = parent
            }
            return parts.join(' > ')
          }
          const findContainer = (target: EventTarget | null): HTMLElement => {
            let current = target instanceof Element ? target : null
            while (current && current !== document.body) {
              if (current instanceof HTMLElement && isScrollable(current)) return current
              current = current.parentElement
            }
            return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : document.documentElement
          }
          const clear = () => {
            if (highlighted) highlighted.style.outline = originalOutline.get(highlighted) ?? ''
            highlightBox.remove()
            document.documentElement.removeAttribute('data-ide-screenshot-picker')
            document.removeEventListener('mousemove', onMove, true)
            document.removeEventListener('pointermove', onMove, true)
            document.removeEventListener('mouseover', onMove, true)
            document.removeEventListener('click', onClick, true)
            document.removeEventListener('keydown', onKeyDown, true)
            window.clearTimeout(timeout)
          }
          const onMove = (event: MouseEvent) => {
            const next = findContainer(event.target)
            if (next !== highlighted) {
              if (highlighted) highlighted.style.outline = originalOutline.get(highlighted) ?? ''
              highlighted = next
              originalOutline.set(next, next.style.outline)
            }
            const bounds = next.getBoundingClientRect()
            highlightBox.style.display = 'block'
            highlightBox.style.left = `${bounds.left}px`
            highlightBox.style.top = `${bounds.top}px`
            highlightBox.style.width = `${bounds.width}px`
            highlightBox.style.height = `${bounds.height}px`
          }
          const onClick = (event: MouseEvent) => {
            event.preventDefault()
            event.stopPropagation()
            const selected = findContainer(event.target)
            clear()
            resolve(selected === document.documentElement || selected === document.scrollingElement ? '__document__' : pathFor(selected))
          }
          const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            clear()
            resolve(null)
          }
          const timeout = window.setTimeout(() => {
            clear()
            resolve(null)
          }, 60_000)
          document.documentElement.setAttribute('data-ide-screenshot-picker', marker)
          document.addEventListener('mousemove', onMove, true)
          document.addEventListener('pointermove', onMove, true)
          document.addEventListener('mouseover', onMove, true)
          document.addEventListener('click', onClick, true)
          document.addEventListener('keydown', onKeyDown, true)
        }),
    )
  } finally {
    setCaptureWindowVisible?.(true)
  }
}

async function restorePage(page: Page, state: PageState): Promise<void> {
  await page
    .evaluate((state) => {
      document.getElementById('__ide_browser_screenshot_style__')?.remove()
      const interactionLockKey = '__ide_browser_screenshot_interaction_lock__'
      const interactionLock = (window as unknown as Record<string, unknown>)[interactionLockKey] as { eventTypes?: string[]; handler?: EventListener } | undefined
      if (interactionLock?.handler) {
        interactionLock.eventTypes?.forEach((type) => window.removeEventListener(type, interactionLock.handler!, { capture: true }))
      }
      delete (window as unknown as Record<string, unknown>)[interactionLockKey]
      document.querySelectorAll('[data-ide-screenshot-hidden]').forEach((element) => {
        element.removeAttribute('data-ide-screenshot-hidden')
      })
      document.querySelectorAll('video').forEach((video, index) => {
        if (state.videos[index]) void video.play().catch(() => undefined)
      })
      window.scrollTo(state.scrollX, state.scrollY)
      if (state.containerPath && typeof state.containerScrollTop === 'number') {
        const element = state.containerPath === '__document__' ? document.scrollingElement : document.querySelector(state.containerPath)
        element?.scrollTo({ top: state.containerScrollTop })
      }
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
      let containerPath: string | undefined
      if (request.captureMode === 'precise') {
        emit(taskId, { stage: 'preparing', message: '正在等待网页完成加载。', percent: 7 })
        await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
        await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => undefined)
        await waitForPageSettle(page, 6_000)
        await waitForDomQuiet(page, 1_500, 10_000)
        emit(taskId, { stage: 'analyzing', message: '请在浏览器中移动鼠标并点击要滚动的容器。按 Esc 可取消。', percent: 8 })
        containerPath = (await chooseScrollContainer(page, deps.setCaptureWindowVisible)) ?? undefined
        if (!containerPath) {
          throw Object.assign(new Error(errorMessage('CAPTURE_CANCELLED')), { code: 'CAPTURE_CANCELLED' })
        }
      }
      const policy = request.fixedElementPolicy ?? 'keep'
      const state = await preparePage(page, policy)
      if (containerPath) {
        state.containerPath = containerPath
        state.containerScrollTop = await page.evaluate((selector) => {
          const element = selector === '__document__' ? document.scrollingElement : document.querySelector(selector)
          return element instanceof HTMLElement ? (selector === '__document__' ? window.scrollY : element.scrollTop) : 0
        }, containerPath)
        if (containerPath !== '__document__') {
          await page.evaluate((selector) => {
            document.querySelector(selector)?.removeAttribute('data-ide-screenshot-hidden')
          }, containerPath)
        }
      }
      restoreState = state
      emit(taskId, { stage: 'preparing', message: '正在准备页面并等待资源稳定。', percent: 12 })
      await waitForPageSettle(page, 4_000)
      if (containerPath) await waitForDomQuiet(page, 1_500, 10_000)
      if (cancelRequested) throw Object.assign(new Error(errorMessage('CAPTURE_CANCELLED')), { code: 'CAPTURE_CANCELLED' })
      let png: Buffer
      let width = 0
      let height = 0
      if (containerPath) {
        png = await capturePreciseContainer(
          page,
          taskId,
          request,
          containerPath,
          emit,
          () => cancelRequested,
          (value) => {
            width = value.width
            height = value.height
          },
        )
      } else if (!request.forceSegmented) {
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
    await waitForSegmentReady(page)
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

async function capturePreciseContainer(page: Page, taskId: string, request: BrowserScreenshotRequest, path: string, emit: (taskId: string, event: Omit<BrowserScreenshotProgress, 'taskId'>) => void, isCancelled: () => boolean, onSize: (size: { width: number; height: number }) => void): Promise<Buffer> {
  const deadline = Date.now() + (request.maxDurationMs ?? DEFAULT_MAX_DURATION)
  await page.bringToFront().catch(() => undefined)
  await waitForPageSettle(page, 2_500)
  const info = await page.evaluate((selector) => {
    const element = selector === '__document__' ? document.scrollingElement : document.querySelector(selector)
    if (!(element instanceof HTMLElement)) throw new Error('选中的滚动容器已不存在。')
    const rect = element.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: element.clientWidth, viewportHeight: element.clientHeight, totalHeight: element.scrollHeight, dpr: devicePixelRatio, scrollTop: selector === '__document__' ? window.scrollY : element.scrollTop, viewportWidth: innerWidth, viewportHeightLimit: innerHeight }
  }, path)
  const totalHeight = Math.max(1, info.totalHeight)
  const slices: PngSlice[] = []
  const totalSegments = Math.max(1, Math.ceil(totalHeight / Math.max(1, info.viewportHeight)))
  let index = 0
  let requestedTop = 0
  let previousCapturedEnd = 0
  let previousActualTop = -1
  while (requestedTop < totalHeight) {
    if (isCancelled()) throw Object.assign(new Error(errorMessage('CAPTURE_CANCELLED')), { code: 'CAPTURE_CANCELLED' })
    if (Date.now() > deadline) throw Object.assign(new Error(errorMessage('CAPTURE_TIMEOUT')), { code: 'CAPTURE_TIMEOUT' })
    const scrolledRect = await stabilizePreciseContainer(page, path, requestedTop)
    const expectedTop = Math.min(requestedTop, Math.max(0, scrolledRect.totalHeight - scrolledRect.height))
    if (Math.abs(scrolledRect.scrollTop - expectedTop) > 1) {
      throw Object.assign(
        new Error(
          `精准截图滚动未到目标位置（段=${index + 1}，requestedTop=${formatPreciseCoordinate(requestedTop)}，expectedTop=${formatPreciseCoordinate(expectedTop)}，actualTop=${formatPreciseCoordinate(scrolledRect.scrollTop)}，maxTop=${formatPreciseCoordinate(Math.max(0, scrolledRect.totalHeight - scrolledRect.height))}）。`,
        ),
        { code: 'PAGE_NOT_SUPPORTED' },
      )
    }
    await waitForDomQuiet(page, 300, 1_000)
    await waitForSegmentReady(page)
    await waitForDomQuiet(page, 200, 800)
    let rect = await stabilizePreciseContainer(page, path)
    if (Math.abs(rect.scrollTop - scrolledRect.scrollTop) > 1) {
      throw Object.assign(new Error(`精准截图等待期间滚动位置改变（段=${index + 1}，requestedTop=${formatPreciseCoordinate(requestedTop)}，afterScroll=${formatPreciseCoordinate(scrolledRect.scrollTop)}，beforeShot=${formatPreciseCoordinate(rect.scrollTop)}）。`), { code: 'PAGE_NOT_SUPPORTED' })
    }
    let left = Math.max(0, rect.x)
    let top = Math.max(0, rect.y)
    let right = Math.min(info.viewportWidth, rect.x + rect.width)
    let bottom = Math.min(info.viewportHeightLimit, rect.y + rect.height)
    let clip = { x: left, y: top, width: right - left, height: bottom - top }
    for (let attempt = 0; attempt < 3 && (clip.width <= 0 || clip.height <= 0); attempt += 1) {
      if (path !== '__document__') {
        await page.evaluate((selector) => {
          document.querySelector(selector)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        }, path)
      }
      await waitForPageSettle(page, 1_000)
      await waitForDomQuiet(page, 700, 3_000)
      rect = await stabilizePreciseContainer(page, path)
      left = Math.max(0, rect.x)
      top = Math.max(0, rect.y)
      right = Math.min(info.viewportWidth, rect.x + rect.width)
      bottom = Math.min(info.viewportHeightLimit, rect.y + rect.height)
      clip = { x: left, y: top, width: right - left, height: bottom - top }
    }
    if (clip.width <= 0 || clip.height <= 0) throw new Error('选中的滚动容器不在浏览器可视区域内。')
    const buffer = await page.screenshot({ type: 'png' })
    const scale = info.dpr
    const actualTop = Math.max(0, rect.scrollTop)
    if (index > 0 && actualTop <= previousActualTop) {
      throw Object.assign(
        new Error(`精准截图分段没有前进（段=${index + 1}，requestedTop=${formatPreciseCoordinate(requestedTop)}，actualTop=${formatPreciseCoordinate(actualTop)}，previousActualTop=${formatPreciseCoordinate(previousActualTop)}，previousCapturedEnd=${formatPreciseCoordinate(previousCapturedEnd)}）。`),
        { code: 'PAGE_NOT_SUPPORTED' },
      )
    }
    const contentCropTop = Math.min(clip.height, Math.max(0, previousCapturedEnd - actualTop))
    const sourceTop = Math.round((top + contentCropTop) * scale)
    const destinationTop = Math.round((actualTop + contentCropTop) * scale)
    const remainingHeight = Math.max(0, totalHeight - (actualTop + contentCropTop))
    const copyHeight = Math.min(clip.height - contentCropTop, remainingHeight)
    const sourceBottom = sourceTop + Math.round(copyHeight * scale)
    if (sourceBottom <= sourceTop) {
      throw Object.assign(
        new Error(
          `精准截图切片坐标无效（段=${index + 1}，requestedTop=${formatPreciseCoordinate(requestedTop)}，actualTop=${formatPreciseCoordinate(actualTop)}，previousCapturedEnd=${formatPreciseCoordinate(previousCapturedEnd)}，rectY=${formatPreciseCoordinate(rect.y)}，clipHeight=${formatPreciseCoordinate(clip.height)}，contentCropTop=${formatPreciseCoordinate(contentCropTop)}，remainingHeight=${formatPreciseCoordinate(remainingHeight)}，sourceTop=${sourceTop}，sourceBottom=${sourceBottom}，destinationTop=${destinationTop}）。`,
        ),
        { code: 'COMPOSE_FAILED' },
      )
    }
    slices.push({ buffer, sourceLeft: Math.round(left * scale), sourceRight: Math.round((left + clip.width) * scale), sourceTop, sourceBottom, destinationTop })
    previousCapturedEnd = (destinationTop + (sourceBottom - sourceTop)) / scale
    previousActualTop = actualTop
    emit(taskId, { stage: 'capturing', message: `正在精准截图第 ${index + 1}/${totalSegments} 段。`, currentSegment: index + 1, totalSegments, percent: 15 + Math.round(((index + 1) / totalSegments) * 70) })
    if (previousCapturedEnd >= totalHeight - 0.5) break
    const nextTop = Math.max(0, previousCapturedEnd - SEGMENT_OVERLAP)
    if (nextTop <= requestedTop + 0.5) {
      throw Object.assign(
        new Error(
          `精准截图无法生成下一段（段=${index + 1}，requestedTop=${formatPreciseCoordinate(requestedTop)}，nextTop=${formatPreciseCoordinate(nextTop)}，actualTop=${formatPreciseCoordinate(actualTop)}，previousCapturedEnd=${formatPreciseCoordinate(previousCapturedEnd)}，totalHeight=${formatPreciseCoordinate(totalHeight)}）。`,
        ),
        { code: 'PAGE_NOT_SUPPORTED' },
      )
    }
    requestedTop = nextTop
    index += 1
  }
  const width = Math.round(info.width * info.dpr)
  const height = Math.round(totalHeight * info.dpr)
  if (height > (request.maxHeight ?? DEFAULT_MAX_HEIGHT) || width * height > MAX_IMAGE_AREA) throw Object.assign(new Error(errorMessage('IMAGE_TOO_LARGE')), { code: 'IMAGE_TOO_LARGE' })
  onSize({ width, height })
  await page.evaluate(
    ({ selector, scrollTop }) => {
      const element = selector === '__document__' ? document.scrollingElement : document.querySelector(selector)
      if (selector === '__document__') window.scrollTo(0, scrollTop)
      else element?.scrollTo({ top: scrollTop })
    },
    { selector: path, scrollTop: info.scrollTop },
  )
  return composePngSlices(slices, width, height)
}
