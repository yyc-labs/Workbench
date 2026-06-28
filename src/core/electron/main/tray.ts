import {
  Menu,
  Tray,
  type MenuItemConstructorOptions,
  type Rectangle,
} from 'electron'
import { resolveAppResourcePath } from './app-resource-path'

export interface AppTrayController {
  ensure(): boolean
  destroy(): void
  getBounds(): Rectangle | null
}

interface CreateAppTrayOptions {
  getTooltip: () => string
  buildMenu: () => MenuItemConstructorOptions[]
  onOpenMainWindow: () => void
}

function resolveTrayIconPath(): string {
  return process.platform === 'win32'
    ? resolveAppResourcePath('icon', 'Y.ico')
    : resolveAppResourcePath('icon', 'Y.png')
}

export function createAppTray(options: CreateAppTrayOptions): AppTrayController {
  let tray: Tray | null = null

  const showNativeMenu = () => {
    if (!tray) return
    tray.setToolTip(options.getTooltip())
    tray.popUpContextMenu(Menu.buildFromTemplate(options.buildMenu()))
  }

  return {
    ensure(): boolean {
      if (tray) {
        tray.setToolTip(options.getTooltip())
        return true
      }

      try {
        tray = new Tray(resolveTrayIconPath())
        tray.setToolTip(options.getTooltip())
        tray.on('click', () => {
          options.onOpenMainWindow()
        })
        tray.on('right-click', () => {
          showNativeMenu()
        })
        tray.on('double-click', () => {
          options.onOpenMainWindow()
        })
        return true
      } catch {
        tray = null
        return false
      }
    },
    getBounds(): Rectangle | null {
      if (!tray) return null
      try {
        return tray.getBounds()
      } catch {
        return null
      }
    },
    destroy(): void {
      if (!tray) return
      tray.destroy()
      tray = null
    },
  }
}
