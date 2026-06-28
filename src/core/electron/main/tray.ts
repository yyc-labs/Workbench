import { Menu, Tray } from 'electron'
import { resolveAppResourcePath } from './app-resource-path'

export interface AppTrayController {
  ensure(): boolean
  destroy(): void
}

interface CreateAppTrayOptions {
  getShowLabel: () => string
  getHideLabel: () => string
  getQuitLabel: () => string
  getTooltip: () => string
  onShow: () => void
  onHide: () => void
  onQuit: () => void
  isWindowVisible: () => boolean
}

function resolveTrayIconPath(): string {
  return process.platform === 'win32'
    ? resolveAppResourcePath('icon', 'Y.ico')
    : resolveAppResourcePath('icon', 'Y.png')
}

export function createAppTray(options: CreateAppTrayOptions): AppTrayController {
  let tray: Tray | null = null

  const rebuildMenu = () => {
    if (!tray) return
    tray.setToolTip(options.getTooltip())
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: options.isWindowVisible() ? options.getHideLabel() : options.getShowLabel(),
        click: () => {
          if (options.isWindowVisible()) {
            options.onHide()
            return
          }
          options.onShow()
        },
      },
      { type: 'separator' },
      {
        label: options.getQuitLabel(),
        click: () => options.onQuit(),
      },
    ]))
  }

  return {
    ensure(): boolean {
      if (tray) {
        rebuildMenu()
        return true
      }

      try {
        tray = new Tray(resolveTrayIconPath())
        tray.on('click', () => {
          if (options.isWindowVisible()) {
            options.onHide()
            return
          }
          options.onShow()
        })
        tray.on('double-click', () => {
          options.onShow()
        })
        rebuildMenu()
        return true
      } catch {
        tray = null
        return false
      }
    },
    destroy(): void {
      if (!tray) return
      tray.destroy()
      tray = null
    },
  }
}
