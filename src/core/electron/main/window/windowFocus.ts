import type { BrowserWindow } from 'electron'

export function ensureWindowVisible(window: BrowserWindow | null): BrowserWindow | null {
  if (!window) return null
  if (window.isMinimized()) {
    window.restore()
  }
  window.show()
  window.focus()
  return window
}
