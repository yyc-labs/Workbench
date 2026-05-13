import type { PtySize } from '../shared/types'

const DEBOUNCE_MS = 80

class ResizeController {
  private timer: ReturnType<typeof setTimeout> | null = null
  private latest: PtySize | null = null
  private callback: ((size: PtySize) => void) | null = null

  /** Register the single resize sink (e.g. pty.resize). */
  onResize(fn: (size: PtySize) => void): void {
    this.callback = fn
  }

  /** Called from IPC handler on every renderer resize event. Debounced + coalesced. */
  emit(size: PtySize): void {
    this.latest = size

    if (this.timer) {
      clearTimeout(this.timer)
    }

    this.timer = setTimeout(() => {
      if (this.latest && this.callback) {
        this.callback(this.latest)
      }
      this.timer = null
    }, DEBOUNCE_MS)
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.latest = null
    this.callback = null
  }
}

export { ResizeController }
