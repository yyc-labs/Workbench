import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { readEffectiveTheme } from '../hooks/useEffectiveTheme'

export type MonacoThemeName = 'vs' | 'vs-dark' | 'hc-black' | 'hc-light'

interface MonacoEnvironmentShape {
  getWorker: (_workerId: string, label: string) => Worker
}

declare global {
  interface Window {
    MonacoEnvironment?: MonacoEnvironmentShape
  }
}

const FIND_WIDGET_HOVER_GUARD_CLASS = 'monaco-find-widget-control-hover'
const FIND_WIDGET_CONTROL_SELECTOR = '.find-widget .button, .find-widget .monaco-custom-toggle, .findOptionsWidget .button, .findOptionsWidget .monaco-custom-toggle'

let monacoEnvironmentReady = false

// Monaco 编辑器 dispose 时，内部 WordHighlighter 等组件的 Delayer.cancel 会以
// name/message 均为 "Canceled" 的 Error 拒绝 pending promise，产生无害的
// Uncaught (in promise) 报错。这里在全局做一次过滤，避免噪音。
const MONACO_CANCELED_ERROR_NAME = 'Canceled'
const MONACO_CANCELED_ERROR_MESSAGE = 'Canceled'

function isMonacoCanceledRejection(reason: unknown): boolean {
  return reason instanceof Error && reason.name === MONACO_CANCELED_ERROR_NAME && reason.message === MONACO_CANCELED_ERROR_MESSAGE
}

export function ensureMonacoEnvironmentConfigured(): void {
  if (monacoEnvironmentReady) return
  if (typeof window === 'undefined') return

  window.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      if (label === 'json') return new JsonWorker()
      if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
      if (label === 'typescript' || label === 'javascript') return new TsWorker()
      return new EditorWorker()
    },
  }

  window.addEventListener('unhandledrejection', (event) => {
    if (isMonacoCanceledRejection(event.reason)) {
      event.preventDefault()
    }
  })

  monacoEnvironmentReady = true
}

export function installMonacoFindWidgetHoverGuard(container: HTMLElement): () => void {
  const handleCaptureMouseOver = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const findWidgetControl = target.closest(FIND_WIDGET_CONTROL_SELECTOR)
    if (!findWidgetControl) return
    document.body.classList.add(FIND_WIDGET_HOVER_GUARD_CLASS)
    event.stopPropagation()
  }

  const handleCaptureMouseOut = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const fromControl = target.closest(FIND_WIDGET_CONTROL_SELECTOR)
    if (!fromControl) return
    const related = event.relatedTarget
    if (related instanceof Element && related.closest(FIND_WIDGET_CONTROL_SELECTOR)) return
    document.body.classList.remove(FIND_WIDGET_HOVER_GUARD_CLASS)
  }

  container.addEventListener('mouseover', handleCaptureMouseOver, true)
  container.addEventListener('mouseout', handleCaptureMouseOut, true)

  return () => {
    container.removeEventListener('mouseover', handleCaptureMouseOver, true)
    container.removeEventListener('mouseout', handleCaptureMouseOut, true)
    document.body.classList.remove(FIND_WIDGET_HOVER_GUARD_CLASS)
  }
}

export function resolveMonacoTheme(): MonacoThemeName {
  return readEffectiveTheme() === 'dark' ? 'vs-dark' : 'vs'
}

const MONACO_OVERFLOW_WIDGETS_CONTAINER_CLASS = 'monaco-overflow-widgets-container'

let monacoOverflowWidgetsContainer: HTMLElement | null = null

// hover / suggest 等 overflow widget 由编辑器以 position:fixed 渲染。若它们留在
// 编辑器 DOM 内，带 backdrop-filter / transform 的祖先面板（如 surface-card）
// 会劫持 fixed 包含块，导致 widget 出现位置整体偏移。挂到 body 下的独立容器，
// 让 fixed 恢复以 viewport 为参照；主题 class 需单独同步，否则 widget 丢失
// `.monaco-editor.vs*` 作用域下的配色。
export function getMonacoOverflowWidgetsContainer(): HTMLElement {
  if (monacoOverflowWidgetsContainer) return monacoOverflowWidgetsContainer

  const container = document.createElement('div')
  container.className = `monaco-editor ${MONACO_OVERFLOW_WIDGETS_CONTAINER_CLASS}`
  container.style.position = 'fixed'
  container.style.top = '0'
  container.style.left = '0'
  container.style.width = '0'
  container.style.height = '0'
  container.style.zIndex = '10040'
  container.style.pointerEvents = 'none'
  document.body.appendChild(container)
  monacoOverflowWidgetsContainer = container
  return container
}

export function syncMonacoOverflowWidgetsTheme(theme: MonacoThemeName): void {
  const container = getMonacoOverflowWidgetsContainer()
  container.className = `monaco-editor ${MONACO_OVERFLOW_WIDGETS_CONTAINER_CLASS} ${theme}`
}
