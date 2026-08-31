import { BrowserWindow } from 'electron'
import { join } from 'path'
import { resolveAppResourcePath } from '../app-resource-path'
import { getWindowBackgroundColor, type ThemeMode } from './createWindow'

export const APP_VIEW_WINDOW_WIDTH = 1_100
export const APP_VIEW_WINDOW_HEIGHT = 800

/** 各独立窗口视图的原生窗口标题;同时作为允许打开的视图路径白名单。 */
export const APP_VIEW_WINDOW_TITLES: Record<string, string> = {
  '/markdown': 'Markdown Document',
  '/learning': 'Learning Center',
}

/** 各独立窗口视图对应的 renderer 入口 hash。 */
export const APP_VIEW_WINDOW_HASHES: Record<string, string> = {
  '/markdown': 'markdown-document',
  '/learning': 'learning-center',
}

export function createAppViewWindow(options: { path: string; theme: ThemeMode; shouldUseDarkColors: boolean }): BrowserWindow {
  const windowIcon = process.platform === 'win32' ? resolveAppResourcePath('icon', 'Y.ico') : resolveAppResourcePath('icon', 'Y.png')
  const window = new BrowserWindow({
    width: APP_VIEW_WINDOW_WIDTH,
    height: APP_VIEW_WINDOW_HEIGHT,
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
    title: APP_VIEW_WINDOW_TITLES[options.path] ?? 'IDE',
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

  const hash = APP_VIEW_WINDOW_HASHES[options.path]
  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`)
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  }

  return window
}
