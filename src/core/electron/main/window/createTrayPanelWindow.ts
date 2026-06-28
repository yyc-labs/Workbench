import { BrowserWindow, app } from 'electron'
import { join } from 'path'

interface CreateTrayPanelWindowOptions {
  preloadPath: string
}

export function createTrayPanelWindow(
  options: CreateTrayPanelWindowOptions
): BrowserWindow {
  const window = new BrowserWindow({
    width: 206,
    height: 172,
    minWidth: 180,
    minHeight: 120,
    maxWidth: 320,
    maxHeight: 320,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    roundedCorners: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  window.setMenuBarVisibility(false)
  window.setAlwaysOnTop(true, 'pop-up-menu')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(`${process.env.ELECTRON_RENDERER_URL}#tray-panel`)
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'tray-panel' })
  }

  return window
}
