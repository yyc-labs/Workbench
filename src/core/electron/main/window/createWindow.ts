import { BrowserWindow } from 'electron'
import { join } from 'path'
import { IPC } from '../ipc'
import { resolveAppResourcePath } from '../app-resource-path'
import type { AppConfig } from '../../../shared/types'

export type ThemeMode = AppConfig['theme']

export function resolveEffectiveTheme(theme: ThemeMode, shouldUseDarkColors: boolean): 'light' | 'dark' {
  if (theme === 'system') {
    return shouldUseDarkColors ? 'dark' : 'light'
  }
  return theme
}

export function getWindowBackgroundColor(theme: ThemeMode, shouldUseDarkColors: boolean): string {
  return resolveEffectiveTheme(theme, shouldUseDarkColors) === 'dark' ? '#09090b' : '#f5f7fb'
}

export function applyWindowBackground(mainWindow: BrowserWindow | null, theme: ThemeMode, shouldUseDarkColors: boolean): void {
  if (!mainWindow) return
  mainWindow.setBackgroundColor(getWindowBackgroundColor(theme, shouldUseDarkColors))
}

interface CreateWindowOptions {
  theme: ThemeMode
  shouldUseDarkColors: boolean
  showOnReady?: boolean
  onToggleViewMode: () => void
  onFocusSearch: () => void
  onWindowStateChange: (isMaximized: boolean) => void
  onClosed: () => void
}

export function createWindow(options: CreateWindowOptions): BrowserWindow {
  const { theme, shouldUseDarkColors, showOnReady = true, onToggleViewMode, onFocusSearch, onWindowStateChange, onClosed } = options

  const windowIcon = process.platform === 'win32' ? resolveAppResourcePath('icon', 'Y.ico') : resolveAppResourcePath('icon', 'Y.png')

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: getWindowBackgroundColor(theme, shouldUseDarkColors),
    icon: windowIcon,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  })

  mainWindow.setMenuBarVisibility(false)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' && input.type !== 'rawKeyDown') return

    const key = input.key.toLowerCase()
    const hasPrimaryModifier = input.control || input.meta
    const isCtrlTab = key === 'tab' && hasPrimaryModifier && !input.shift && !input.alt
    const isCtrlShiftF = key === 'f' && hasPrimaryModifier && input.shift && !input.alt
    const isCtrlAltF = key === 'f' && hasPrimaryModifier && input.alt && !input.shift

    if (isCtrlTab) {
      event.preventDefault()
      onToggleViewMode()
      return
    }

    if (!isCtrlShiftF && !isCtrlAltF) return
    event.preventDefault()
    onFocusSearch()
  })

  mainWindow.on('maximize', () => {
    onWindowStateChange(true)
  })
  mainWindow.on('unmaximize', () => {
    onWindowStateChange(false)
  })
  mainWindow.on('ready-to-show', () => {
    if (!showOnReady) return
    mainWindow.show()
  })
  mainWindow.on('closed', onClosed)

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}
