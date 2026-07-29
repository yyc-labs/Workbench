import type { BrowserContext, Frame, Page } from 'playwright-core'
import type {
  BrowserScreenshotCaptureMode,
  BrowserScreenshotErrorCode,
  BrowserScreenshotFixedElementPolicy,
  BrowserScreenshotMarkedElement,
  BrowserScreenshotMarkedElementPolicy,
  BrowserScreenshotProgress,
  BrowserScreenshotRequest,
  BrowserScreenshotResult,
  BrowserScreenshotTarget,
  BrowserScreenshotTargetsChanged,
  BrowserScreenshotViewerPayload,
} from '../../../shared/types'
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
  openViewer: (payload: BrowserScreenshotViewerPayload) => Promise<boolean>
  openCaptureWindow: () => Promise<boolean>
  getCaptureControlLabels: () => CaptureControlLabels
}

type CaptureControlLabels = {
  triggerLabel: string
  fixedPolicy: string
  keepFixed: string
  hideFixed: string
  chooseContainer: string
  chooseElements: string
  markElement: string
  lastAppearance: string
  alwaysHide: string
  confirmElements: string
  cancelSelection: string
  fullPage: string
  selectArea: string
}

type PreciseContainerTarget = 'document' | { framePath: number[]; selector: string }

type PageState = { scrollX: number; scrollY: number; videos: boolean[]; containerTarget?: PreciseContainerTarget; containerScrollTop?: number }

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

function throwIfCancelled(isCancelled: () => boolean): void {
  if (isCancelled()) throw Object.assign(new Error(errorMessage('CAPTURE_CANCELLED')), { code: 'CAPTURE_CANCELLED' })
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

type PageCaptureControlResult = { status: BrowserScreenshotResult['status']; errorMessage?: string }
type PageCaptureControlRequest = { captureMode: BrowserScreenshotCaptureMode; fixedElementPolicy: BrowserScreenshotFixedElementPolicy } | 'open-window'

function installCaptureControl({ bindingName, labels }: { bindingName: string; labels: CaptureControlLabels }): void {
  const hostId = '__ide-browser-screenshot-control__'
  if (document.getElementById(hostId)) return
  const host = document.createElement('div')
  host.id = hostId
  host.style.cssText = 'all:initial;position:fixed;top:12px;right:12px;z-index:2147483646;'
  const shadow = host.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `<style>
    :host { all: initial; font-family: system-ui, sans-serif; }
    .wrap { position: relative; }
    button { border: 0; cursor: pointer; font: 600 12px/1 system-ui, sans-serif; }
    .trigger { width: 34px; height: 34px; border-radius: 11px; color: #fff; background: #356cff; box-shadow: 0 3px 14px rgba(0,0,0,.22); touch-action: none; user-select: none; }
    .menu { position: absolute; top: 40px; right: 0; display: none; min-width: 180px; padding: 5px; border: 1px solid rgba(0,0,0,.12); border-radius: 10px; background: #fff; box-shadow: 0 8px 24px rgba(0,0,0,.18); }
    .menu.open { display: grid; gap: 3px; }
    .policy-label { padding: 7px 10px 3px; color: #777; font: 600 11px/1.2 system-ui, sans-serif; }
    .policy-item.selected { background: #edf2ff; }
    .item { padding: 8px 10px; border-radius: 7px; color: #222; background: transparent; text-align: left; }
    .item:hover { background: #edf2ff; }
    .trigger:disabled, .item:disabled { cursor: wait; opacity: .55; }
  </style><div class="wrap"><button class="trigger" type="button">▣</button><div class="menu"><div class="policy-label"></div><button class="item policy-item selected" type="button" data-policy="keep"></button><button class="item policy-item" type="button" data-policy="hide"></button><button class="item" type="button" data-mode="standard"></button><button class="item" type="button" data-mode="precise"></button></div></div>`
  const trigger = shadow.querySelector<HTMLButtonElement>('.trigger')
  const menu = shadow.querySelector<HTMLElement>('.menu')
  const items = Array.from(shadow.querySelectorAll<HTMLButtonElement>('.item'))
  if (!trigger || !menu) return
  trigger.setAttribute('aria-label', labels.triggerLabel)
  const policyLabel = shadow.querySelector<HTMLElement>('.policy-label')
  const keepPolicyItem = shadow.querySelector<HTMLButtonElement>('[data-policy="keep"]')
  const hidePolicyItem = shadow.querySelector<HTMLButtonElement>('[data-policy="hide"]')
  const fullPageItem = shadow.querySelector<HTMLButtonElement>('[data-mode="standard"]')
  const selectAreaItem = shadow.querySelector<HTMLButtonElement>('[data-mode="precise"]')
  if (policyLabel) policyLabel.textContent = labels.fixedPolicy
  if (keepPolicyItem) keepPolicyItem.textContent = labels.keepFixed
  if (hidePolicyItem) hidePolicyItem.textContent = labels.hideFixed
  if (fullPageItem) fullPageItem.textContent = labels.fullPage
  if (selectAreaItem) selectAreaItem.textContent = labels.selectArea
  let fixedElementPolicy: BrowserScreenshotFixedElementPolicy = 'keep'
  let dragStartX = 0
  let dragStartY = 0
  let dragOffsetX = 0
  let dragOffsetY = 0
  let isDragging = false
  let suppressClick = false
  trigger.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || trigger.disabled) return
    const bounds = host.getBoundingClientRect()
    dragStartX = event.clientX
    dragStartY = event.clientY
    dragOffsetX = event.clientX - bounds.left
    dragOffsetY = event.clientY - bounds.top
    isDragging = false
    trigger.setPointerCapture(event.pointerId)
    event.preventDefault()
  })
  trigger.addEventListener('pointermove', (event) => {
    if (!trigger.hasPointerCapture(event.pointerId)) return
    if (!isDragging && Math.hypot(event.clientX - dragStartX, event.clientY - dragStartY) < 4) return
    isDragging = true
    host.style.left = `${Math.max(0, Math.min(window.innerWidth - host.offsetWidth, event.clientX - dragOffsetX))}px`
    host.style.top = `${Math.max(0, Math.min(window.innerHeight - host.offsetHeight, event.clientY - dragOffsetY))}px`
    host.style.right = 'auto'
    event.preventDefault()
  })
  trigger.addEventListener('pointerup', (event) => {
    if (trigger.hasPointerCapture(event.pointerId)) trigger.releasePointerCapture(event.pointerId)
    if (isDragging) {
      suppressClick = true
      window.setTimeout(() => {
        suppressClick = false
      }, 0)
    }
    isDragging = false
  })
  trigger.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (suppressClick) return
    menu.classList.toggle('open')
  })
  items.forEach((item) => {
    item.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const mode = item.dataset.mode as BrowserScreenshotCaptureMode | undefined
      if (!mode) {
        fixedElementPolicy = item.dataset.policy as BrowserScreenshotFixedElementPolicy
        keepPolicyItem?.classList.toggle('selected', fixedElementPolicy === 'keep')
        hidePolicyItem?.classList.toggle('selected', fixedElementPolicy === 'hide')
        return
      }
      trigger.disabled = true
      items.forEach((next) => {
        next.disabled = true
      })
      menu.classList.remove('open')
      void (window as unknown as Record<string, (request: PageCaptureControlRequest) => Promise<PageCaptureControlResult>>)[bindingName]({ captureMode: mode, fixedElementPolicy }).finally(() => {
        trigger.disabled = false
        items.forEach((next) => {
          next.disabled = false
        })
      })
    })
  })
  trigger.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (trigger.disabled) return
    trigger.disabled = true
    void (window as unknown as Record<string, (request: PageCaptureControlRequest) => Promise<PageCaptureControlResult>>)[bindingName]('open-window').finally(() => {
      trigger.disabled = false
    })
  })
  document.documentElement.appendChild(host)
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

async function waitForPreciseSegmentReady(page: Page, target: PreciseContainerTarget, timeoutMs = 800): Promise<void> {
  if (target === 'document') return waitForSegmentReady(page, timeoutMs)
  const frame = resolveFrame(page, target.framePath)
  if (!frame) return
  await Promise.race([
    frame.evaluate(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const images = Array.from(document.images).filter((image) => image.getBoundingClientRect().bottom >= 0 && image.getBoundingClientRect().top <= innerHeight)
      await Promise.all(images.map((image) => image.decode?.().catch(() => undefined)))
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]).catch(() => undefined)
}

async function setFrameInteractionLock(frame: Frame, locked: boolean): Promise<void> {
  await frame
    .evaluate(
      ({ locked }) => {
        const key = '__ide_browser_screenshot_interaction_lock__'
        const current = (window as unknown as Record<string, unknown>)[key] as { eventTypes?: string[]; handler?: EventListener } | undefined
        if (current?.handler) {
          current.eventTypes?.forEach((type) => window.removeEventListener(type, current.handler!, { capture: true }))
        }
        delete (window as unknown as Record<string, unknown>)[key]
        if (!locked) return
        const eventTypes = ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'wheel', 'touchstart', 'touchmove', 'keydown']
        const handler = (event: Event) => {
          event.preventDefault()
          event.stopImmediatePropagation()
        }
        const options = { capture: true, passive: false }
        eventTypes.forEach((type) => window.addEventListener(type, handler, options))
        ;(window as unknown as Record<string, unknown>)[key] = { eventTypes, handler }
      },
      { locked },
    )
    .catch(() => undefined)
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

function resolveFrame(page: Page, framePath: number[]): Frame | null {
  let frame: Frame = page.mainFrame()
  for (const index of framePath) {
    const child = frame.childFrames()[index]
    if (!child) return null
    frame = child
  }
  return frame
}

function getFramePath(frame: Frame): number[] {
  const path: number[] = []
  let current: Frame | null = frame
  while (current?.parentFrame()) {
    const parent: Frame = current.parentFrame()!
    path.unshift(parent.childFrames().indexOf(current))
    current = parent
  }
  return path
}

async function stabilizePreciseContainer(page: Page, target: PreciseContainerTarget, requestedTop?: number): Promise<PreciseContainerRect> {
  if (target === 'document') {
    return page.evaluate(
      async ({ requestedTop }) => {
        const element = document.scrollingElement
        if (!(element instanceof HTMLElement)) throw new Error('页面滚动容器已不存在。')
        const read = () => ({ x: 0, y: 0, width: innerWidth, height: innerHeight, scrollTop: window.scrollY, totalHeight: element.scrollHeight })
        if (typeof requestedTop === 'number') window.scrollTo({ top: Math.min(Math.max(0, element.scrollHeight - innerHeight), Math.max(0, requestedTop)), behavior: 'auto' })
        let previous = read()
        let stableFrames = 0
        const deadline = performance.now() + 800
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
      { requestedTop },
    )
  }
  const frame = resolveFrame(page, target.framePath)
  if (!frame) throw new Error('选中的 iframe 已不存在。')
  if (target.selector === '__document__') {
    return frame.evaluate(
      async ({ requestedTop }) => {
        const element = document.scrollingElement
        if (!(element instanceof HTMLElement)) throw new Error('iframe 页面滚动容器已不存在。')
        const read = () => ({ x: 0, y: 0, width: innerWidth, height: innerHeight, scrollTop: window.scrollY, totalHeight: element.scrollHeight })
        if (typeof requestedTop === 'number') window.scrollTo({ top: Math.min(Math.max(0, element.scrollHeight - innerHeight), Math.max(0, requestedTop)), behavior: 'auto' })
        let previous = read()
        let stableFrames = 0
        const deadline = performance.now() + 800
        while (performance.now() < deadline) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
          const current = read()
          const unchanged = current.x === previous.x && current.y === previous.y && current.width === previous.width && current.height === previous.height && current.scrollTop === previous.scrollTop && current.totalHeight === previous.totalHeight
          stableFrames = unchanged ? stableFrames + 1 : 0
          if (stableFrames >= 3) return current
          previous = current
        }
        throw new Error('iframe 页面布局未在截图前稳定。')
      },
      { requestedTop },
    )
  }
  return frame.evaluate(
    async ({ selector, requestedTop }) => {
      const element = document.querySelector(selector)
      if (!(element instanceof HTMLElement)) throw new Error('选中的滚动容器已不存在。')
      const read = () => {
        const bounds = element.getBoundingClientRect()
        return {
          x: bounds.x,
          y: bounds.y,
          width: element.clientWidth,
          height: element.clientHeight,
          scrollTop: element.scrollTop,
          totalHeight: element.scrollHeight,
        }
      }
      if (typeof requestedTop === 'number') {
        const maximumTop = Math.max(0, element.scrollHeight - element.clientHeight)
        const targetTop = Math.min(maximumTop, Math.max(0, requestedTop))
        element.scrollTo({ top: targetTop, behavior: 'auto' })
      }
      let previous = read()
      let stableFrames = 0
      const deadline = performance.now() + 800
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
    { selector: target.selector, requestedTop },
  )
}

async function getPreciseContainerBounds(page: Page, target: PreciseContainerTarget): Promise<{ x: number; y: number; width: number; height: number } | null> {
  if (target === 'document') return { x: 0, y: 0, width: await page.evaluate(() => innerWidth), height: await page.evaluate(() => innerHeight) }
  const frame = resolveFrame(page, target.framePath)
  if (!frame) return null
  if (target.selector === '__document__') {
    const frameElement = await frame.frameElement().catch(() => null)
    const frameBounds = await frameElement?.boundingBox().catch(() => null)
    if (!frameBounds) return null
    return frameBounds
  }
  return frame.locator(target.selector).boundingBox()
}

async function preparePage(page: Page, policy: BrowserScreenshotFixedElementPolicy): Promise<PageState> {
  const state = await page.evaluate(() => ({ scrollX, scrollY, videos: Array.from(document.querySelectorAll('video')).map((video) => !video.paused) }))
  await page.evaluate(
    ({ policy }) => {
      const style = document.createElement('style')
      style.id = '__ide_browser_screenshot_style__'
      style.textContent =
        '* { animation: none !important; transition: none !important; caret-color: transparent !important; } html { scroll-behavior: auto !important; overflow-anchor: none !important; } ::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; } [data-ide-screenshot-hidden] { visibility: hidden !important; }'
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
      document.getElementById('__ide-browser-screenshot-control__')?.setAttribute('data-ide-screenshot-hidden', 'true')
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
  await Promise.all(
    page
      .frames()
      .filter((frame) => frame !== page.mainFrame())
      .map((frame) =>
        frame
          .evaluate(() => {
            if (document.getElementById('__ide_browser_screenshot_style__')) return
            const style = document.createElement('style')
            style.id = '__ide_browser_screenshot_style__'
            style.textContent =
              '* { animation: none !important; transition: none !important; caret-color: transparent !important; } html { scroll-behavior: auto !important; overflow-anchor: none !important; } ::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; } [data-ide-screenshot-hidden] { visibility: hidden !important; }'
            document.documentElement.appendChild(style)
          })
          .catch(() => undefined),
      ),
  )
  return state
}

async function chooseScrollContainer(page: Page, labels: CaptureControlLabels, setCaptureWindowVisible?: (visible: boolean) => void): Promise<PreciseContainerTarget | null> {
  setCaptureWindowVisible?.(false)
  const pickerPromise = page.evaluate(
    ({ chooseContainer }) =>
      new Promise<PreciseContainerTarget | null>((resolve) => {
        const marker = '__ide_browser_screenshot_picker__'
        let highlighted: HTMLElement | null = null
        const highlightBox = document.createElement('div')
        highlightBox.id = marker
        highlightBox.style.cssText = 'position:fixed;display:none;pointer-events:none;z-index:2147483647;border:4px solid #ff3b30;background:rgba(255,59,48,.12);box-shadow:0 0 0 2px rgba(255,255,255,.9),0 0 0 9999px rgba(255,59,48,.04);box-sizing:border-box;'
        const highlightLabel = document.createElement('span')
        highlightLabel.textContent = chooseContainer
        highlightLabel.style.cssText = 'position:absolute;left:-4px;top:-30px;padding:4px 8px;border-radius:6px;background:#ff3b30;color:#fff;font:600 13px/1.2 system-ui,sans-serif;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.25);'
        highlightBox.appendChild(highlightLabel)
        document.documentElement.appendChild(highlightBox)
        const originalOutline = new WeakMap<HTMLElement, string>()
        const showBounds = (bounds: { left: number; top: number; width: number; height: number }, next?: HTMLElement) => {
          if (next && next !== highlighted) {
            if (highlighted) highlighted.style.outline = originalOutline.get(highlighted) ?? ''
            highlighted = next
            originalOutline.set(next, next.style.outline)
          }
          highlightBox.style.display = 'block'
          highlightBox.style.left = `${bounds.left}px`
          highlightBox.style.top = `${bounds.top}px`
          highlightBox.style.width = `${bounds.width}px`
          highlightBox.style.height = `${bounds.height}px`
        }
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
        const findContainers = (target: EventTarget | null): HTMLElement[] => {
          const containers: HTMLElement[] = []
          let current = target instanceof Element ? target : null
          while (current && current !== document.body) {
            if (current instanceof HTMLElement && isScrollable(current)) containers.push(current)
            current = current.parentElement
          }
          const documentContainer = document.scrollingElement instanceof HTMLElement ? document.scrollingElement : document.documentElement
          if (!containers.includes(documentContainer)) containers.push(documentContainer)
          return containers
        }
        const clear = () => {
          if (highlighted) highlighted.style.outline = originalOutline.get(highlighted) ?? ''
          highlightBox.remove()
          document.documentElement.removeAttribute('data-ide-screenshot-picker')
          document.querySelectorAll('[data-ide-screenshot-frame-path]').forEach((element) => element.removeAttribute('data-ide-screenshot-frame-path'))
          document.removeEventListener('mousemove', onMove, true)
          document.removeEventListener('pointermove', onMove, true)
          document.removeEventListener('mouseover', onMove, true)
          document.removeEventListener('click', onClick, true)
          document.removeEventListener('keydown', onKeyDown, true)
          window.removeEventListener('message', onMessage)
          window.clearTimeout(timeout)
        }
        const onMove = (event: MouseEvent) => {
          if (event.target instanceof HTMLElement && event.target.hasAttribute('data-ide-screenshot-frame-path')) return
          const next = findContainers(event.target)[0]
          if (!next) {
            highlightBox.style.display = 'none'
            return
          }
          showBounds(next.getBoundingClientRect(), next)
        }
        const onClick = (event: MouseEvent) => {
          if (event.target instanceof HTMLElement && event.target.hasAttribute('data-ide-screenshot-frame-path')) return
          event.preventDefault()
          event.stopPropagation()
          const containers = findContainers(event.target)
          const selected = containers[0]
          if (!selected) return
          const framePathText = selected.getAttribute('data-ide-screenshot-frame-path')
          clear()
          if (framePathText) {
            try {
              const framePath = JSON.parse(framePathText) as unknown
              if (Array.isArray(framePath) && framePath.every((item) => Number.isInteger(item) && item >= 0)) {
                resolve({ framePath, selector: '__document__' })
                return
              }
            } catch {
              // Fall back to selecting the element itself.
            }
          }
          resolve(selected === document.documentElement || selected === document.scrollingElement ? 'document' : { framePath: [], selector: pathFor(selected) })
        }
        const onMessage = (event: MessageEvent) => {
          const data = event.data as { marker?: string; action?: 'move' | 'click' | 'cancel'; framePath?: number[]; selector?: string; bounds?: { left: number; top: number; width: number; height: number } } | null
          if (!data || data.marker !== '__ide_browser_screenshot_picker__' || !data.action || !data.framePath || !data.selector || !data.bounds) return
          if (data.action === 'cancel') {
            clear()
            resolve(null)
            return
          }
          if (data.framePath.length === 0) showBounds(data.bounds)
          else highlightBox.style.display = 'none'
          if (data.action === 'click') {
            clear()
            resolve({ framePath: data.framePath, selector: data.selector })
          }
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
        document.documentElement.setAttribute('data-ide-browser-screenshot-picker', marker)
        document.addEventListener('mousemove', onMove, true)
        document.addEventListener('pointermove', onMove, true)
        document.addEventListener('mouseover', onMove, true)
        document.addEventListener('click', onClick, true)
        document.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('message', onMessage)
      }),
    { chooseContainer: labels.chooseContainer },
  )
  try {
    const frames = page.frames().filter((frame) => frame !== page.mainFrame())
    await Promise.all(
      frames.map(async (frame) => {
        const framePath = getFramePath(frame)
        const frameElement = await frame.frameElement().catch(() => null)
        await frameElement
          ?.evaluate((element, path) => {
            if (element instanceof HTMLElement) element.setAttribute('data-ide-screenshot-frame-path', JSON.stringify(path))
          }, framePath)
          .catch(() => undefined)
        await frame
          .evaluate(
            ({ framePath }) => {
              const key = '__ide_browser_screenshot_frame_picker__'
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
                  const parent: HTMLElement | null = current.parentElement
                  if (!parent) break
                  parts.unshift(`${current.tagName.toLowerCase()}:nth-child(${Array.from(parent.children).indexOf(current) + 1})`)
                  current = parent
                }
                return parts.join(' > ')
              }
              const findContainers = (target: EventTarget | null): HTMLElement[] => {
                const containers: HTMLElement[] = []
                let current = target instanceof Element ? target : null
                while (current && current !== document.body) {
                  if (current instanceof HTMLElement && isScrollable(current)) containers.push(current)
                  current = current.parentElement
                }
                const documentContainer = document.scrollingElement instanceof HTMLElement ? document.scrollingElement : document.documentElement
                if (!containers.includes(documentContainer)) containers.push(documentContainer)
                return containers
              }
              const toTopBounds = (bounds: DOMRect) => {
                let result = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }
                let current: Window = window
                while (current !== window.top) {
                  const frameElement = current.frameElement
                  if (!(frameElement instanceof Element)) break
                  const frameBounds = frameElement.getBoundingClientRect()
                  result = { ...result, left: result.left + frameBounds.left, top: result.top + frameBounds.top }
                  current = current.parent as Window
                }
                return result
              }
              const frameHighlight = document.createElement('div')
              frameHighlight.style.cssText = 'position:fixed;display:none;pointer-events:none;z-index:2147483647;border:4px solid #ff3b30;background:rgba(255,59,48,.12);box-shadow:0 0 0 2px rgba(255,255,255,.9);box-sizing:border-box;'
              document.documentElement.appendChild(frameHighlight)
              const showFrameBounds = (container: HTMLElement) => {
                const isDocument = container === document.scrollingElement || container === document.documentElement
                const bounds = isDocument ? { left: 0, top: 0, width: innerWidth, height: innerHeight } : container.getBoundingClientRect()
                frameHighlight.style.display = 'block'
                frameHighlight.style.left = `${bounds.left}px`
                frameHighlight.style.top = `${bounds.top}px`
                frameHighlight.style.width = `${bounds.width}px`
                frameHighlight.style.height = `${bounds.height}px`
              }
              const emit = (event: Event, action: 'move' | 'click') => {
                if (event.target instanceof HTMLElement && event.target.hasAttribute('data-ide-screenshot-frame-path')) return
                const containers = findContainers(event.target)
                const container = containers[0]
                if (!container) return
                if (action === 'click') {
                  event.preventDefault()
                  event.stopPropagation()
                }
                showFrameBounds(container)
                const isDocument = container === document.scrollingElement || container === document.documentElement
                const localBounds = isDocument ? { left: 0, top: 0, width: innerWidth, height: innerHeight } : container.getBoundingClientRect()
                window.top?.postMessage(
                  {
                    marker: '__ide_browser_screenshot_picker__',
                    action,
                    framePath,
                    selector: isDocument ? '__document__' : pathFor(container),
                    bounds: toTopBounds(new DOMRect(localBounds.left, localBounds.top, localBounds.width, localBounds.height)),
                  },
                  '*',
                )
              }
              const onMove = (event: Event) => emit(event, 'move')
              const onClick = (event: Event) => emit(event, 'click')
              const onKeyDown = (event: Event) => {
                if (event instanceof KeyboardEvent && event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  window.top?.postMessage({ marker: '__ide_browser_screenshot_picker__', action: 'cancel', framePath, selector: '__document__', bounds: { left: 0, top: 0, width: 0, height: 0 } }, '*')
                }
              }
              document.addEventListener('mousemove', onMove, true)
              document.addEventListener('pointermove', onMove, true)
              document.addEventListener('mouseover', onMove, true)
              document.addEventListener('click', onClick, true)
              document.addEventListener('keydown', onKeyDown, true)
              ;(window as unknown as Record<string, unknown>)[key] = { onMove, onClick, onKeyDown, frameHighlight }
            },
            { framePath },
          )
          .catch(() => undefined)
      }),
    )
    const result = await pickerPromise
    await Promise.all(
      frames.map((frame) =>
        frame
          .evaluate(() => {
            const key = '__ide_browser_screenshot_frame_picker__'
            const picker = (window as unknown as Record<string, unknown>)[key] as { onMove?: EventListener; onClick?: EventListener; onKeyDown?: EventListener; frameHighlight?: HTMLElement } | undefined
            if (picker?.onMove) {
              document.removeEventListener('mousemove', picker.onMove, true)
              document.removeEventListener('pointermove', picker.onMove, true)
              document.removeEventListener('mouseover', picker.onMove, true)
            }
            if (picker?.onClick) document.removeEventListener('click', picker.onClick, true)
            if (picker?.onKeyDown) document.removeEventListener('keydown', picker.onKeyDown, true)
            picker?.frameHighlight?.remove()
            delete (window as unknown as Record<string, unknown>)[key]
          })
          .catch(() => undefined),
      ),
    )
    return result
  } finally {
    setCaptureWindowVisible?.(true)
  }
}

async function chooseMarkedElements(page: Page, labels: CaptureControlLabels, setCaptureWindowVisible?: (visible: boolean) => void): Promise<BrowserScreenshotMarkedElement[] | null> {
  setCaptureWindowVisible?.(false)
  const pickerPromise = page.evaluate(
    ({ labels }) =>
      new Promise<BrowserScreenshotMarkedElement[] | null>((resolve) => {
        const key = '__ide_browser_screenshot_element_picker__'
        const markedAttribute = 'data-ide-browser-screenshot-marked'
        const host = document.createElement('div')
        host.id = key
        host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;font-family:system-ui,sans-serif;'
        const status = document.createElement('div')
        status.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);padding:9px 14px;border-radius:10px;background:rgba(20,20,24,.9);color:#fff;font:600 13px/1.2 system-ui,sans-serif;white-space:nowrap;box-shadow:0 4px 18px rgba(0,0,0,.25);'
        status.textContent = `${labels.chooseElements} · ${labels.cancelSelection}`
        host.appendChild(status)
        const highlight = document.createElement('div')
        highlight.style.cssText = 'position:fixed;display:none;pointer-events:none;border:2px solid #356cff;background:rgba(53,108,255,.08);box-shadow:0 0 0 1px rgba(255,255,255,.85);box-sizing:border-box;'
        host.appendChild(highlight)
        const menu = document.createElement('div')
        menu.style.cssText = 'position:fixed;display:none;pointer-events:auto;min-width:190px;padding:5px;border:1px solid rgba(0,0,0,.14);border-radius:10px;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.2);'
        const menuTitle = document.createElement('div')
        menuTitle.style.cssText = 'padding:6px 9px 4px;color:#777;font:600 11px/1.2 system-ui,sans-serif;'
        menuTitle.textContent = labels.markElement
        menu.appendChild(menuTitle)
        const marked = new Map<string, BrowserScreenshotMarkedElement>()
        let pending: { element: HTMLElement | null; item: BrowserScreenshotMarkedElement; bounds: { left: number; top: number; width: number; height: number }; source: Window | null } | null = null
        let highlighted: HTMLElement | null = null
        let originalOutline = ''
        let finished = false
        const button = (text: string, policy: BrowserScreenshotMarkedElementPolicy) => {
          const item = document.createElement('button')
          item.type = 'button'
          item.textContent = text
          item.style.cssText = 'display:block;width:100%;padding:8px 9px;border:0;border-radius:7px;background:transparent;color:#222;text-align:left;cursor:pointer;font:600 12px/1.2 system-ui,sans-serif;'
          item.addEventListener('mouseenter', () => {
            item.style.background = '#edf2ff'
          })
          item.addEventListener('mouseleave', () => {
            item.style.background = 'transparent'
          })
          item.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopPropagation()
            if (!pending) return
            const next = { ...pending.item, policy }
            marked.set(`${next.framePath.join('.')}:${next.selector}`, next)
            if (pending.element) {
              pending.element.setAttribute(markedAttribute, policy)
              pending.element.style.outline = policy === 'hide' ? '3px solid #ff3b30' : '3px solid #34a853'
              pending.element.style.outlineOffset = '2px'
            }
            pending.source?.postMessage({ marker: key, action: 'mark', selector: next.selector, policy }, '*')
            pending = null
            menu.style.display = 'none'
            status.textContent = `${labels.chooseElements} · ${marked.size} · ${labels.confirmElements}`
          })
          return item
        }
        menu.appendChild(button(labels.lastAppearance, 'keep-once'))
        menu.appendChild(button(labels.alwaysHide, 'hide'))
        host.appendChild(menu)
        document.documentElement.appendChild(host)
        const selectorFor = (element: Element): string => {
          const parts: string[] = []
          let current: Element | null = element
          while (current && current !== document.documentElement && current !== document.body) {
            if (current.id && /^[A-Za-z][\w-]*$/.test(current.id)) {
              parts.unshift(`#${CSS.escape(current.id)}`)
              break
            }
            const parent: HTMLElement | null = current.parentElement
            if (!parent) break
            const index = Array.from(parent.children).indexOf(current)
            parts.unshift(`${current.tagName.toLowerCase()}:nth-child(${index + 1})`)
            current = parent
          }
          return parts.join(' > ')
        }
        const isInternal = (element: Element | null): boolean => Boolean(element && (element.closest(`#${key}`) || element.closest('#__ide-browser-screenshot-control__')))
        const showMenu = (item: BrowserScreenshotMarkedElement, element: HTMLElement | null, bounds: { left: number; top: number; width: number; height: number }, source: Window | null = null) => {
          pending = { item, element, bounds, source }
          menu.style.display = 'block'
          menu.style.left = `${Math.max(8, Math.min(innerWidth - 205, bounds.left))}px`
          menu.style.top = `${Math.max(8, Math.min(innerHeight - 110, bounds.top + bounds.height + 8))}px`
        }
        const showCandidate = (element: HTMLElement | null, bounds: { left: number; top: number; width: number; height: number } | null) => {
          if (highlighted && highlighted !== element) highlighted.style.outline = originalOutline
          highlighted = element
          originalOutline = element?.style.outline ?? ''
          if (!bounds) {
            highlight.style.display = 'none'
            return
          }
          highlight.style.display = 'block'
          highlight.style.left = `${bounds.left}px`
          highlight.style.top = `${bounds.top}px`
          highlight.style.width = `${bounds.width}px`
          highlight.style.height = `${bounds.height}px`
        }
        const cleanup = (result: BrowserScreenshotMarkedElement[] | null) => {
          if (finished) return
          finished = true
          if (highlighted) highlighted.style.outline = originalOutline
          document.querySelectorAll(`[${markedAttribute}]`).forEach((element) => {
            element.removeAttribute(markedAttribute)
            ;(element as HTMLElement).style.outline = ''
            ;(element as HTMLElement).style.outlineOffset = ''
          })
          host.remove()
          document.removeEventListener('mousemove', onMove, true)
          document.removeEventListener('pointermove', onMove, true)
          document.removeEventListener('click', onClick, true)
          document.removeEventListener('keydown', onKeyDown, true)
          window.removeEventListener('message', onMessage)
          resolve(result)
        }
        const targetAt = (target: EventTarget | null): HTMLElement | null => {
          const element = target instanceof HTMLElement ? target : null
          return element && !isInternal(element) ? element : null
        }
        const onMove = (event: MouseEvent) => {
          if (pending) return
          const element = targetAt(event.target)
          showCandidate(
            element,
            element
              ? (() => {
                  const rect = element.getBoundingClientRect()
                  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
                })()
              : null,
          )
        }
        const onClick = (event: MouseEvent) => {
          const element = targetAt(event.target)
          if (!element || menu.contains(event.target as Node)) return
          event.preventDefault()
          event.stopImmediatePropagation()
          const rect = element.getBoundingClientRect()
          const item = { framePath: [], selector: selectorFor(element), policy: 'keep-once' as BrowserScreenshotMarkedElementPolicy }
          if (!item.selector) return
          showMenu(item, element, { left: rect.left, top: rect.top, width: rect.width, height: rect.height })
        }
        const onMessage = (event: MessageEvent) => {
          const data = event.data as { marker?: string; action?: 'move' | 'click' | 'key'; key?: string; framePath?: number[]; selector?: string; bounds?: { left: number; top: number; width: number; height: number } } | null
          if (!data || data.marker !== key || !data.action) return
          if (data.action === 'key') {
            if (data.key === 'Escape') cleanup(null)
            if (data.key === 'Enter' && !pending) cleanup(Array.from(marked.values()))
            return
          }
          if (!data.framePath || !data.selector || !data.bounds) return
          const item = { framePath: data.framePath, selector: data.selector, policy: 'keep-once' as BrowserScreenshotMarkedElementPolicy }
          showCandidate(null, data.framePath.length === 0 ? data.bounds : null)
          if (data.action === 'click') showMenu(item, null, data.bounds, event.source as Window | null)
        }
        const onKeyDown = (event: KeyboardEvent) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopImmediatePropagation()
            cleanup(null)
          } else if (event.key === 'Enter' && !pending) {
            event.preventDefault()
            event.stopImmediatePropagation()
            cleanup(Array.from(marked.values()))
          }
        }
        document.addEventListener('mousemove', onMove, true)
        document.addEventListener('pointermove', onMove, true)
        document.addEventListener('click', onClick, true)
        document.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('message', onMessage)
        const timeout = window.setTimeout(() => cleanup(null), 60_000)
        const originalCleanup = cleanup
        ;(window as unknown as Record<string, unknown>)[key] = {
          cleanup: (result: BrowserScreenshotMarkedElement[] | null) => {
            window.clearTimeout(timeout)
            originalCleanup(result)
          },
        }
      }),
    { labels },
  )
  const frames = page.frames().filter((frame) => frame !== page.mainFrame())
  await Promise.all(
    frames.map(async (frame) => {
      const framePath = getFramePath(frame)
      await frame
        .evaluate(
          ({ framePath, marker }) => {
            const selectorFor = (element: Element): string => {
              const parts: string[] = []
              let current: Element | null = element
              while (current && current !== document.documentElement && current !== document.body) {
                if (current.id && /^[A-Za-z][\w-]*$/.test(current.id)) {
                  parts.unshift(`#${CSS.escape(current.id)}`)
                  break
                }
                const parent: HTMLElement | null = current.parentElement
                if (!parent) break
                parts.unshift(`${current.tagName.toLowerCase()}:nth-child(${Array.from(parent.children).indexOf(current) + 1})`)
                current = parent
              }
              return parts.join(' > ')
            }
            const toTopBounds = (bounds: DOMRect) => {
              let result = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }
              let current: Window = window
              while (current !== window.top) {
                const frameElement = current.frameElement
                if (!(frameElement instanceof Element)) break
                const frameBounds = frameElement.getBoundingClientRect()
                const frameOffset = frameElement instanceof HTMLIFrameElement ? { left: frameElement.clientLeft, top: frameElement.clientTop } : { left: 0, top: 0 }
                result = { ...result, left: result.left + frameBounds.left + frameOffset.left, top: result.top + frameBounds.top + frameOffset.top }
                current = current.parent as Window
              }
              return result
            }
            const frameHighlight = document.createElement('div')
            frameHighlight.style.cssText = 'position:fixed;display:none;pointer-events:none;z-index:2147483647;border:2px solid #356cff;background:rgba(53,108,255,.08);box-shadow:0 0 0 1px rgba(255,255,255,.85);box-sizing:border-box;'
            document.documentElement.appendChild(frameHighlight)
            let selectionLocked = false
            const showFrameHighlight = (element: HTMLElement | null) => {
              if (!element) {
                frameHighlight.style.display = 'none'
                return
              }
              const rect = element.getBoundingClientRect()
              frameHighlight.style.display = 'block'
              frameHighlight.style.left = `${rect.left}px`
              frameHighlight.style.top = `${rect.top}px`
              frameHighlight.style.width = `${rect.width}px`
              frameHighlight.style.height = `${rect.height}px`
            }
            const onMove = (event: MouseEvent) => {
              if (selectionLocked) return
              const element = event.target instanceof HTMLElement ? event.target : null
              if (!element || element.closest('[data-ide-browser-screenshot-frame-picker]')) return
              showFrameHighlight(element)
              const rect = toTopBounds(element.getBoundingClientRect())
              window.top?.postMessage({ marker, action: 'move', framePath, selector: selectorFor(element), bounds: rect }, '*')
            }
            const onClick = (event: MouseEvent) => {
              const element = event.target instanceof HTMLElement ? event.target : null
              if (!element) return
              event.preventDefault()
              event.stopImmediatePropagation()
              selectionLocked = true
              showFrameHighlight(element)
              const rect = toTopBounds(element.getBoundingClientRect())
              window.top?.postMessage({ marker, action: 'click', framePath, selector: selectorFor(element), bounds: rect }, '*')
            }
            const onMessage = (event: MessageEvent) => {
              const data = event.data as { marker?: string; action?: 'mark'; selector?: string; policy?: string } | null
              if (!data || data.marker !== marker || data.action !== 'mark' || !data.selector || !data.policy) return
              const element = document.querySelector(data.selector)
              if (!(element instanceof HTMLElement)) return
              selectionLocked = false
              element.setAttribute('data-ide-browser-screenshot-marked', data.policy)
              element.style.outline = data.policy === 'hide' ? '3px solid #ff3b30' : '3px solid #34a853'
              element.style.outlineOffset = '2px'
            }
            const onKeyDown = (event: KeyboardEvent) => {
              if (event.key === 'Enter' || event.key === 'Escape') window.top?.postMessage({ marker, action: 'key', key: event.key }, '*')
            }
            document.addEventListener('mousemove', onMove, true)
            document.addEventListener('pointermove', onMove, true)
            document.addEventListener('click', onClick, true)
            document.addEventListener('keydown', onKeyDown, true)
            window.addEventListener('message', onMessage)
            ;(window as unknown as Record<string, unknown>).__ide_browser_screenshot_frame_element_picker__ = { onMove, onClick, onKeyDown, onMessage, frameHighlight }
          },
          { framePath, marker: '__ide_browser_screenshot_element_picker__' },
        )
        .catch(() => undefined)
    }),
  )
  const result = await pickerPromise
  await Promise.all(
    frames.map((frame) =>
      frame
        .evaluate(() => {
          const picker = (window as unknown as Record<string, unknown>).__ide_browser_screenshot_frame_element_picker__ as { onMove?: EventListener; onClick?: EventListener; onKeyDown?: EventListener; onMessage?: EventListener; frameHighlight?: HTMLElement } | undefined
          if (picker?.onMove) {
            document.removeEventListener('mousemove', picker.onMove, true)
            document.removeEventListener('pointermove', picker.onMove, true)
          }
          if (picker?.onClick) document.removeEventListener('click', picker.onClick, true)
          if (picker?.onKeyDown) document.removeEventListener('keydown', picker.onKeyDown, true)
          if (picker?.onMessage) window.removeEventListener('message', picker.onMessage)
          picker?.frameHighlight?.remove()
          document.querySelectorAll('[data-ide-browser-screenshot-marked]').forEach((element) => {
            element.removeAttribute('data-ide-browser-screenshot-marked')
            ;(element as HTMLElement).style.outline = ''
            ;(element as HTMLElement).style.outlineOffset = ''
          })
          delete (window as unknown as Record<string, unknown>).__ide_browser_screenshot_frame_element_picker__
        })
        .catch(() => undefined),
    ),
  )
  setCaptureWindowVisible?.(true)
  return result
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
      if (state.containerTarget === 'document' && typeof state.containerScrollTop === 'number') document.scrollingElement?.scrollTo({ top: state.containerScrollTop })
    }, state)
    .catch(() => undefined)
  if (state.containerTarget && state.containerTarget !== 'document' && typeof state.containerScrollTop === 'number') {
    const frame = resolveFrame(page, state.containerTarget.framePath)
    if (frame) {
      await frame
        .evaluate(
          ({ selector, scrollTop }) => {
            document.querySelector(selector)?.scrollTo({ top: scrollTop })
          },
          { selector: state.containerTarget.selector, scrollTop: state.containerScrollTop },
        )
        .catch(() => undefined)
    }
  }
  await Promise.all(
    page
      .frames()
      .filter((frame) => frame !== page.mainFrame())
      .map((frame) => Promise.all([frame.evaluate(() => document.getElementById('__ide_browser_screenshot_style__')?.remove()).catch(() => undefined), setFrameInteractionLock(frame, false)])),
  )
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
  const captureControlPages = new Set<Page>()
  const captureControlInstallPromises = new Map<Page, Promise<void>>()
  let startFromPage: ((pageId: string, captureMode: BrowserScreenshotCaptureMode, fixedElementPolicy: BrowserScreenshotFixedElementPolicy) => Promise<PageCaptureControlResult>) | null = null
  let targetsChangedTimer: ReturnType<typeof setTimeout> | null = null

  const getPageId = (page: Page): string => {
    const existingId = pageIds.get(page)
    if (existingId) return existingId
    const id = `browser-page-${nextPageId++}`
    pageIds.set(page, id)
    return id
  }

  const installPageCaptureControls = async (page: Page, pageId: string): Promise<void> => {
    if (page.isClosed()) return
    const pending = captureControlInstallPromises.get(page)
    if (pending) return pending
    const bindingName = `__ideBrowserScreenshot_${pageId.replace(/[^a-zA-Z0-9_$]/g, '_')}`
    const labels = deps.getCaptureControlLabels()
    const installPromise = (async () => {
      if (!captureControlPages.has(page)) {
        await page.exposeFunction(bindingName, async (request: PageCaptureControlRequest) => {
          if (request === 'open-window') {
            await deps.openCaptureWindow()
            return { status: 'completed' } satisfies PageCaptureControlResult
          }
          if (!startFromPage) return { status: 'failed', errorMessage: '截图服务尚未准备好。' } satisfies PageCaptureControlResult
          return startFromPage(pageId, request.captureMode, request.fixedElementPolicy)
        })
        await page.addInitScript(installCaptureControl, { bindingName, labels })
        captureControlPages.add(page)
      }
      await page.evaluate(installCaptureControl, { bindingName, labels }).catch(() => undefined)
    })()
    captureControlInstallPromises.set(page, installPromise)
    try {
      await installPromise
    } finally {
      captureControlInstallPromises.delete(page)
    }
  }

  const listTargetsFromContext = async (context: BrowserContext): Promise<BrowserScreenshotTarget[]> => {
    const pages = context.pages()
    for (const page of pageIds.keys()) {
      if (page.isClosed()) pageIds.delete(page)
    }
    return Promise.all(
      pages.map(async (page, index) => {
        const id = getPageId(page)
        await installPageCaptureControls(page, id)
        return {
          id,
          title: await page.title().catch(() => page.url()),
          url: page.url(),
          isClosed: page.isClosed(),
          isActiveCandidate: index === pages.length - 1,
        }
      }),
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
      captureControlPages.delete(page)
      captureControlInstallPromises.delete(page)
      emitCurrentTargets(context)
    })
    void installPageCaptureControls(page, getPageId(page)).catch(() => undefined)
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
      let containerTarget: PreciseContainerTarget | undefined
      let captureRequest = request
      if (request.captureMode === 'precise') {
        emit(taskId, { stage: 'preparing', message: '正在等待网页完成加载。', percent: 7 })
        await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
        if (cancelRequested) throw Object.assign(new Error(errorMessage('CAPTURE_CANCELLED')), { code: 'CAPTURE_CANCELLED' })
        await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => undefined)
        await waitForPageSettle(page, 6_000)
        await waitForDomQuiet(page, 1_500, 10_000)
        emit(taskId, { stage: 'analyzing', message: '请在浏览器中移动鼠标并点击要滚动的容器。按 Esc 可取消。', percent: 8 })
        containerTarget = (await chooseScrollContainer(page, deps.getCaptureControlLabels(), deps.setCaptureWindowVisible)) ?? undefined
        if (!containerTarget) {
          throw Object.assign(new Error(errorMessage('CAPTURE_CANCELLED')), { code: 'CAPTURE_CANCELLED' })
        }
        emit(taskId, { stage: 'analyzing', message: deps.getCaptureControlLabels().chooseElements, percent: 9 })
        const markedElements = await chooseMarkedElements(page, deps.getCaptureControlLabels(), deps.setCaptureWindowVisible)
        if (!markedElements) {
          throw Object.assign(new Error(errorMessage('CAPTURE_CANCELLED')), { code: 'CAPTURE_CANCELLED' })
        }
        captureRequest = { ...request, markedElements }
      }
      const policy = request.fixedElementPolicy ?? 'keep'
      const state = await preparePage(page, policy)
      await Promise.all(
        page
          .frames()
          .filter((frame) => frame !== page.mainFrame())
          .map((frame) => setFrameInteractionLock(frame, true)),
      )
      if (containerTarget) {
        state.containerTarget = containerTarget
        state.containerScrollTop = await stabilizePreciseContainer(page, containerTarget).then((rect) => rect.scrollTop)
        if (containerTarget !== 'document' && containerTarget.framePath.length === 0) {
          await page.evaluate((selector) => {
            document.querySelector(selector)?.removeAttribute('data-ide-screenshot-hidden')
          }, containerTarget.selector)
        }
      }
      restoreState = state
      emit(taskId, { stage: 'preparing', message: '正在准备页面并等待资源稳定。', percent: 12 })
      await waitForPageSettle(page, 4_000)
      if (cancelRequested) throw Object.assign(new Error(errorMessage('CAPTURE_CANCELLED')), { code: 'CAPTURE_CANCELLED' })
      if (containerTarget) await waitForDomQuiet(page, 1_500, 10_000)
      if (cancelRequested) throw Object.assign(new Error(errorMessage('CAPTURE_CANCELLED')), { code: 'CAPTURE_CANCELLED' })
      let png: Buffer
      let width = 0
      let height = 0
      if (containerTarget) {
        png = await capturePreciseContainer(
          page,
          taskId,
          captureRequest,
          containerTarget,
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

  startFromPage = async (pageId, captureMode, fixedElementPolicy) => {
    const result = await start({ targetId: pageId, captureMode, fixedElementPolicy })
    if (result.status === 'completed' && result.pngBase64) {
      await deps.openViewer({ pngBase64: result.pngBase64, title: result.title ?? 'Browser screenshot', width: result.width, height: result.height })
    }
    return { status: result.status, errorMessage: result.errorMessage }
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

async function applyMarkedElementPolicies(page: Page, elements: BrowserScreenshotMarkedElement[], showKeepOnce: boolean): Promise<void> {
  const apply = async (frame: Frame, framePath: number[]) => {
    const matching = elements.filter((element) => element.framePath.length === framePath.length && element.framePath.every((value, index) => value === framePath[index]))
    if (!matching.length) return
    await frame
      .evaluate(
        ({ elements: markedElements, showKeepOnce: shouldShow }) => {
          for (const marked of markedElements) {
            const element = document.querySelector(marked.selector)
            if (!(element instanceof HTMLElement)) continue
            if (marked.policy === 'hide' || !shouldShow) element.setAttribute('data-ide-screenshot-hidden', 'true')
            else element.removeAttribute('data-ide-screenshot-hidden')
          }
        },
        { elements: matching, showKeepOnce },
      )
      .catch(() => undefined)
  }
  await Promise.all(page.frames().map((frame) => apply(frame, getFramePath(frame))))
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
    throwIfCancelled(isCancelled)
    await waitForSegmentReady(page)
    throwIfCancelled(isCancelled)
    const actualTop = await page.evaluate(() => scrollY)
    throwIfCancelled(isCancelled)
    await applyMarkedElementPolicies(page, request.markedElements ?? [], requestedTop + info.viewportHeight >= info.totalHeight)
    const buffer = await page.screenshot({ type: 'png' })
    throwIfCancelled(isCancelled)
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

async function capturePreciseContainer(
  page: Page,
  taskId: string,
  request: BrowserScreenshotRequest,
  target: PreciseContainerTarget,
  emit: (taskId: string, event: Omit<BrowserScreenshotProgress, 'taskId'>) => void,
  isCancelled: () => boolean,
  onSize: (size: { width: number; height: number }) => void,
): Promise<Buffer> {
  const deadline = Date.now() + (request.maxDurationMs ?? DEFAULT_MAX_DURATION)
  await page.bringToFront().catch(() => undefined)
  await waitForPageSettle(page, 2_500)
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }))
  const initialRect = await stabilizePreciseContainer(page, target)
  const info = { ...initialRect, dpr: viewport.dpr, viewportWidth: viewport.width, viewportHeightLimit: viewport.height }
  const totalHeight = Math.max(1, info.totalHeight)
  const slices: PngSlice[] = []
  const totalSegments = Math.max(1, Math.ceil(totalHeight / Math.max(1, info.height)))
  let index = 0
  let requestedTop = 0
  let previousCapturedEnd = 0
  let previousActualTop = -1
  while (requestedTop < totalHeight) {
    if (isCancelled()) throw Object.assign(new Error(errorMessage('CAPTURE_CANCELLED')), { code: 'CAPTURE_CANCELLED' })
    if (Date.now() > deadline) throw Object.assign(new Error(errorMessage('CAPTURE_TIMEOUT')), { code: 'CAPTURE_TIMEOUT' })
    const scrolledRect = await stabilizePreciseContainer(page, target, requestedTop)
    throwIfCancelled(isCancelled)
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
    throwIfCancelled(isCancelled)
    await waitForPreciseSegmentReady(page, target)
    throwIfCancelled(isCancelled)
    await waitForDomQuiet(page, 200, 800)
    throwIfCancelled(isCancelled)
    let rect = await stabilizePreciseContainer(page, target)
    throwIfCancelled(isCancelled)
    if (Math.abs(rect.scrollTop - scrolledRect.scrollTop) > 1) {
      throw Object.assign(new Error(`精准截图等待期间滚动位置改变（段=${index + 1}，requestedTop=${formatPreciseCoordinate(requestedTop)}，afterScroll=${formatPreciseCoordinate(scrolledRect.scrollTop)}，beforeShot=${formatPreciseCoordinate(rect.scrollTop)}）。`), { code: 'PAGE_NOT_SUPPORTED' })
    }
    let bounds = await getPreciseContainerBounds(page, target)
    if (!bounds) throw new Error('选中的 iframe 或滚动容器已不存在。')
    let left = Math.max(0, bounds.x)
    let top = Math.max(0, bounds.y)
    let right = Math.min(info.viewportWidth, bounds.x + bounds.width)
    let bottom = Math.min(info.viewportHeightLimit, bounds.y + bounds.height)
    let clip = { x: left, y: top, width: right - left, height: bottom - top }
    for (let attempt = 0; attempt < 3 && (clip.width <= 0 || clip.height <= 0); attempt += 1) {
      if (target !== 'document') {
        const frame = resolveFrame(page, target.framePath)
        if (target.selector !== '__document__') {
          await frame?.evaluate((selector) => {
            document.querySelector(selector)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
          }, target.selector)
        }
      }
      await waitForPageSettle(page, 1_000)
      await waitForDomQuiet(page, 700, 3_000)
      rect = await stabilizePreciseContainer(page, target)
      bounds = await getPreciseContainerBounds(page, target)
      if (!bounds) throw new Error('选中的 iframe 或滚动容器已不存在。')
      left = Math.max(0, bounds.x)
      top = Math.max(0, bounds.y)
      right = Math.min(info.viewportWidth, bounds.x + bounds.width)
      bottom = Math.min(info.viewportHeightLimit, bounds.y + bounds.height)
      clip = { x: left, y: top, width: right - left, height: bottom - top }
    }
    if (clip.width <= 0 || clip.height <= 0) throw new Error('选中的滚动容器不在浏览器可视区域内。')
    const actualTop = Math.max(0, rect.scrollTop)
    const willFinish = actualTop + clip.height >= totalHeight - 0.5
    await applyMarkedElementPolicies(page, request.markedElements ?? [], willFinish)
    const buffer = await page.screenshot({ type: 'png' })
    throwIfCancelled(isCancelled)
    const scale = info.dpr
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
  if (target === 'document') {
    await page.evaluate((scrollTop) => window.scrollTo(0, scrollTop), info.scrollTop)
  } else {
    const frame = resolveFrame(page, target.framePath)
    await frame?.evaluate(
      ({ selector, scrollTop }) => {
        if (selector === '__document__') window.scrollTo({ top: scrollTop })
        else document.querySelector(selector)?.scrollTo({ top: scrollTop })
      },
      { selector: target.selector, scrollTop: info.scrollTop },
    )
  }
  return composePngSlices(slices, width, height)
}
