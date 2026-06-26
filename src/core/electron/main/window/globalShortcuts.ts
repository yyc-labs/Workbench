import { globalShortcut } from 'electron'

export const GLOBAL_HOME_SHORTCUT_ACCELERATOR = 'CommandOrControl+Alt+H'
export const GLOBAL_THEME_SHORTCUT_ACCELERATOR = 'CommandOrControl+Alt+L'

function registerGlobalShortcut(accelerator: string, action: () => void): void {
  const registered = globalShortcut.register(accelerator, action)
  if (!registered) {
    console.warn(`[globalShortcut] failed to register ${accelerator}`)
  }
}

export function registerGlobalShortcuts(
  onHomeShortcut: () => void,
  onThemeShortcut: () => void
): void {
  registerGlobalShortcut(GLOBAL_HOME_SHORTCUT_ACCELERATOR, onHomeShortcut)
  registerGlobalShortcut(GLOBAL_THEME_SHORTCUT_ACCELERATOR, onThemeShortcut)
}

export function unregisterGlobalShortcuts(): void {
  globalShortcut.unregister(GLOBAL_HOME_SHORTCUT_ACCELERATOR)
  globalShortcut.unregister(GLOBAL_THEME_SHORTCUT_ACCELERATOR)
}
