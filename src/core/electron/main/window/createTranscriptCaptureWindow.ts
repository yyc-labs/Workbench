import { BrowserWindow } from 'electron'
import { join } from 'path'
import { getWindowBackgroundColor, type ThemeMode } from './createWindow'

interface CreateTranscriptCaptureWindowOptions {
  theme: ThemeMode
  shouldUseDarkColors: boolean
}

export const TRANSCRIPT_CAPTURE_WINDOW_WIDTH = 680
export const TRANSCRIPT_CAPTURE_WINDOW_HEIGHT = 530

export function createTranscriptCaptureWindow(
  options: CreateTranscriptCaptureWindowOptions
): BrowserWindow {
  const window = new BrowserWindow({
    width: TRANSCRIPT_CAPTURE_WINDOW_WIDTH,
    height: TRANSCRIPT_CAPTURE_WINDOW_HEIGHT,
    minWidth: TRANSCRIPT_CAPTURE_WINDOW_WIDTH,
    minHeight: TRANSCRIPT_CAPTURE_WINDOW_HEIGHT,
    maxWidth: TRANSCRIPT_CAPTURE_WINDOW_WIDTH,
    maxHeight: TRANSCRIPT_CAPTURE_WINDOW_HEIGHT,
    show: false,
    frame: false,
    transparent: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    roundedCorners: true,
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
    window.loadURL(`${process.env.ELECTRON_RENDERER_URL}#transcript-capture`)
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'transcript-capture' })
  }

  return window
}
