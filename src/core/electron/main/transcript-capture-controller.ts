import type { TranscriptCaptureInitialText } from '../../shared/types'

export type TranscriptCaptureTextSource = {
  capture: () => Promise<TranscriptCaptureInitialText>
  fallback: () => TranscriptCaptureInitialText
}

export class TranscriptCaptureController {
  private initialText: TranscriptCaptureInitialText = { text: '', source: 'empty' }
  private initialTextPromise: Promise<TranscriptCaptureInitialText> | null = null
  private requestId = 0
  private shortcutPending = false
  private focusOnReady = false

  reset(): void {
    this.requestId += 1
    this.initialText = { text: '', source: 'empty' }
    this.initialTextPromise = null
    this.shortcutPending = false
    this.focusOnReady = false
  }

  requestFocus(): void {
    this.focusOnReady = true
  }

  consumeFocusRequest(): boolean {
    const shouldFocus = this.focusOnReady
    this.focusOnReady = false
    return shouldFocus
  }

  isShortcutPending(): boolean {
    return this.shortcutPending
  }

  begin(source: TranscriptCaptureTextSource): Promise<TranscriptCaptureInitialText> {
    const requestId = ++this.requestId
    this.shortcutPending = true
    this.initialText = { text: '', source: 'empty' }

    const capturePromise = source.capture().catch(() => source.fallback())
    this.initialTextPromise = capturePromise
    void capturePromise
      .then((initialText) => {
        if (this.requestId !== requestId || this.initialTextPromise !== capturePromise) return
        this.initialText = initialText
      })
      .finally(() => {
        if (this.requestId !== requestId || this.initialTextPromise !== capturePromise) return
        this.initialTextPromise = null
        this.shortcutPending = false
      })

    return capturePromise
  }

  async consume(): Promise<TranscriptCaptureInitialText> {
    const pendingCapture = this.initialTextPromise
    const requestId = this.requestId
    if (pendingCapture) {
      const snapshot = await pendingCapture
      if (this.requestId === requestId && this.initialTextPromise === pendingCapture) {
        this.initialTextPromise = null
        this.shortcutPending = false
      }
      if (this.requestId === requestId) {
        this.initialText = { text: '', source: 'empty' }
      }
      return snapshot
    }

    const snapshot = this.initialText
    this.initialText = { text: '', source: 'empty' }
    return snapshot
  }
}
