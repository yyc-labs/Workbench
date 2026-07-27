import { BrowserWindow } from 'electron'
import { join } from 'path'
import { resolveAppResourcePath } from '../app-resource-path'
import { getWindowBackgroundColor, type ThemeMode } from './createWindow'

export const BROWSER_SCREENSHOT_VIEWER_WINDOW_WIDTH = 1_100
export const BROWSER_SCREENSHOT_VIEWER_WINDOW_HEIGHT = 800

export function createBrowserScreenshotViewerWindow(options: { theme: ThemeMode; shouldUseDarkColors: boolean }): BrowserWindow {
  const windowIcon = process.platform === 'win32' ? resolveAppResourcePath('icon', 'Y.ico') : resolveAppResourcePath('icon', 'Y.png')
  const window = new BrowserWindow({
    width: BROWSER_SCREENSHOT_VIEWER_WINDOW_WIDTH,
    height: BROWSER_SCREENSHOT_VIEWER_WINDOW_HEIGHT,
    minWidth: 640,
    minHeight: 420,
    show: false,
    frame: false,
    movable: true,
    minimizable: true,
    maximizable: true,
    fullscreenable: true,
    hasShadow: true,
    roundedCorners: true,
    title: 'Browser Screenshot',
    icon: windowIcon,
    backgroundColor: getWindowBackgroundColor(options.theme, options.shouldUseDarkColors),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  window.setMenuBarVisibility(false)
  window.webContents.setZoomFactor(1)

  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(`${process.env.ELECTRON_RENDERER_URL}#browser-screenshot-viewer`)
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'browser-screenshot-viewer' })
  }

  return window
}
