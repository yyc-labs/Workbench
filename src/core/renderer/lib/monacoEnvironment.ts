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
