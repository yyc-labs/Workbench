import { BrowserWindow } from 'electron'
import { join } from 'path'
import { resolveAppResourcePath } from '../app-resource-path'
import { getWindowBackgroundColor, type ThemeMode } from './createWindow'

export const BROWSER_SCREENSHOT_WINDOW_WIDTH = 540
export const BROWSER_SCREENSHOT_WINDOW_HEIGHT = 410
export const BROWSER_SCREENSHOT_DOCK_SIZE = 64

export function createBrowserScreenshotWindow(options: { theme: ThemeMode; shouldUseDarkColors: boolean }): BrowserWindow {
  const windowIcon = process.platform === 'win32' ? resolveAppResourcePath('icon', 'Y.ico') : resolveAppResourcePath('icon', 'Y.png')
  const window = new BrowserWindow({
    width: BROWSER_SCREENSHOT_WINDOW_WIDTH,
    height: BROWSER_SCREENSHOT_WINDOW_HEIGHT,
    minWidth: BROWSER_SCREENSHOT_WINDOW_WIDTH,
    minHeight: BROWSER_SCREENSHOT_WINDOW_HEIGHT,
    maxWidth: BROWSER_SCREENSHOT_WINDOW_WIDTH,
    maxHeight: BROWSER_SCREENSHOT_WINDOW_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    roundedCorners: true,
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
  window.setAlwaysOnTop(true, 'pop-up-menu')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.webContents.setZoomFactor(1)

  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(`${process.env.ELECTRON_RENDERER_URL}#browser-screenshot`)
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'browser-screenshot' })
  }

  return window
}
