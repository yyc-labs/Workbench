const MARKDOWN_PREVIEW_DEBUG_STORAGE_KEY = 'app:debug-markdown-preview-performance'

let measurementSequence = 0

export function isMarkdownPreviewPerformanceDebugEnabled(): boolean {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return false
  }

  try {
    return window.localStorage.getItem(MARKDOWN_PREVIEW_DEBUG_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function markMarkdownPreviewPerformance(label: string): void {
  if (!isMarkdownPreviewPerformanceDebugEnabled() || typeof performance === 'undefined') return
  performance.mark(`markdown-preview:${label}`)
}

export function measureMarkdownPreviewSync<T>(label: string, callback: () => T): T {
  if (!isMarkdownPreviewPerformanceDebugEnabled() || typeof performance === 'undefined') {
    return callback()
  }

  measurementSequence += 1
  const id = measurementSequence
  const startMark = `markdown-preview:${label}:start:${id}`
  const endMark = `markdown-preview:${label}:end:${id}`
  const measureName = `markdown-preview:${label}:${id}`
  performance.mark(startMark)

  try {
    return callback()
  } finally {
    performance.mark(endMark)
    performance.measure(measureName, startMark, endMark)
    const entries = performance.getEntriesByName(measureName)
    const entry = entries[entries.length - 1]
    if (entry) {
      console.debug(`[markdown-preview] ${label}: ${entry.duration.toFixed(1)}ms`)
    }
  }
}

export function reportMarkdownPreviewCommit(_id: string, phase: 'mount' | 'update' | 'nested-update', actualDuration: number, baseDuration: number): void {
  if (!isMarkdownPreviewPerformanceDebugEnabled()) return
  console.debug(`[markdown-preview] React ${phase}: actual ${actualDuration.toFixed(1)}ms, base ${baseDuration.toFixed(1)}ms`)
}

export function observeMarkdownPreviewLongTasks(): () => void {
  if (!isMarkdownPreviewPerformanceDebugEnabled() || typeof PerformanceObserver === 'undefined') {
    return () => {}
  }

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        console.debug(`[markdown-preview] long task: ${entry.duration.toFixed(1)}ms`)
      }
    })
    observer.observe({ entryTypes: ['longtask'] })
    return () => observer.disconnect()
  } catch {
    return () => {}
  }
}
