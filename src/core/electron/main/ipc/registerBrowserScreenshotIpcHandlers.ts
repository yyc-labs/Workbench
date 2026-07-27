import { ipcMain } from 'electron'
import type { BrowserScreenshotRequest, BrowserScreenshotViewerPayload } from '../../../shared/types'
import { IPC } from '../ipc'
import type { RegisterIpcHandlersDependencies } from './registerIpcHandlers.shared'

export function registerBrowserScreenshotIpcHandlers(deps: RegisterIpcHandlersDependencies): void {
  ipcMain.handle(IPC.BROWSER_SCREENSHOT_LIST_TARGETS, () => deps.browserScreenshotService.listTargets())
  ipcMain.handle(IPC.BROWSER_SCREENSHOT_START, (_event, request: BrowserScreenshotRequest) => deps.browserScreenshotService.start(request))
  ipcMain.handle(IPC.BROWSER_SCREENSHOT_CANCEL, (_event, taskId: string) => deps.browserScreenshotService.cancel(taskId))
  ipcMain.handle(IPC.BROWSER_SCREENSHOT_SAVE, (_event, pngBase64: string, suggestedName?: string) => deps.browserScreenshotService.save(pngBase64, suggestedName))
  ipcMain.handle(IPC.BROWSER_SCREENSHOT_OPEN_DEFAULT, (_event, pngBase64: string, suggestedName?: string) => deps.browserScreenshotService.openInDefaultApp(pngBase64, suggestedName))
  ipcMain.handle(IPC.BROWSER_SCREENSHOT_OPEN_VIEWER, (_event, payload: BrowserScreenshotViewerPayload) => deps.openBrowserScreenshotViewer(payload))
  ipcMain.handle(IPC.BROWSER_SCREENSHOT_GET_VIEWER_DATA, () => deps.getBrowserScreenshotViewerData())
  ipcMain.handle(IPC.BROWSER_SCREENSHOT_TOGGLE_WINDOW, () => deps.toggleBrowserScreenshotWindow())
  ipcMain.handle(IPC.BROWSER_SCREENSHOT_VIEWER_READY, (event) => deps.markBrowserScreenshotViewerReady(event.sender.id))
}
