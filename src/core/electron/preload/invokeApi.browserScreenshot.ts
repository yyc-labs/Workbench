import { ipcRenderer } from 'electron'
import { IPC } from '../main/ipc'
import type { BrowserScreenshotRequest, BrowserScreenshotResult, BrowserScreenshotTarget, BrowserScreenshotViewerPayload } from '../../shared/types'

export function createBrowserScreenshotInvokeApi() {
  return {
    listBrowserScreenshotTargets: () => ipcRenderer.invoke(IPC.BROWSER_SCREENSHOT_LIST_TARGETS) as Promise<BrowserScreenshotTarget[]>,
    startBrowserScreenshot: (request: BrowserScreenshotRequest) => ipcRenderer.invoke(IPC.BROWSER_SCREENSHOT_START, request) as Promise<BrowserScreenshotResult>,
    cancelBrowserScreenshot: (taskId: string) => ipcRenderer.invoke(IPC.BROWSER_SCREENSHOT_CANCEL, taskId) as Promise<boolean>,
    saveBrowserScreenshot: (pngBase64: string, suggestedName?: string) => ipcRenderer.invoke(IPC.BROWSER_SCREENSHOT_SAVE, pngBase64, suggestedName) as Promise<boolean>,
    openBrowserScreenshotInDefaultApp: (pngBase64: string, suggestedName?: string) => ipcRenderer.invoke(IPC.BROWSER_SCREENSHOT_OPEN_DEFAULT, pngBase64, suggestedName) as Promise<boolean>,
    openBrowserScreenshotViewer: (payload: BrowserScreenshotViewerPayload) => ipcRenderer.invoke(IPC.BROWSER_SCREENSHOT_OPEN_VIEWER, payload) as Promise<boolean>,
    getBrowserScreenshotViewerData: () => ipcRenderer.invoke(IPC.BROWSER_SCREENSHOT_GET_VIEWER_DATA) as Promise<BrowserScreenshotViewerPayload | null>,
    toggleBrowserScreenshotWindow: () => ipcRenderer.invoke(IPC.BROWSER_SCREENSHOT_TOGGLE_WINDOW) as Promise<boolean>,
    markBrowserScreenshotViewerReady: () => ipcRenderer.invoke(IPC.BROWSER_SCREENSHOT_VIEWER_READY) as Promise<boolean>,
  }
}
