import { globalShortcut } from 'electron'

export const GLOBAL_HOME_SHORTCUT_ACCELERATOR = 'CommandOrControl+Alt+H'
export const GLOBAL_THEME_SHORTCUT_ACCELERATOR = 'CommandOrControl+Alt+L'
export const GLOBAL_TRANSCRIPT_CAPTURE_SHORTCUT_ACCELERATOR = 'CommandOrControl+Shift+K'
export const GLOBAL_BROWSER_SCREENSHOT_SHORTCUT_ACCELERATOR = 'CommandOrControl+Shift+S'
export const GLOBAL_AGENT_SKILL_PROMPT_SHORTCUT_ACCELERATOR = 'CommandOrControl+Shift+L'

function registerGlobalShortcut(accelerator: string, action: () => void): void {
  const registered = globalShortcut.register(accelerator, action)
  if (!registered) {
    console.warn(`[globalShortcut] failed to register ${accelerator}`)
  }
}

export function registerGlobalShortcuts(onHomeShortcut: () => void, onThemeShortcut: () => void, onTranscriptCaptureShortcut: () => void, onBrowserScreenshotShortcut: () => void, onAgentSkillPromptShortcut: () => void): void {
  registerGlobalShortcut(GLOBAL_HOME_SHORTCUT_ACCELERATOR, onHomeShortcut)
  registerGlobalShortcut(GLOBAL_THEME_SHORTCUT_ACCELERATOR, onThemeShortcut)
  registerGlobalShortcut(GLOBAL_TRANSCRIPT_CAPTURE_SHORTCUT_ACCELERATOR, onTranscriptCaptureShortcut)
  registerGlobalShortcut(GLOBAL_BROWSER_SCREENSHOT_SHORTCUT_ACCELERATOR, onBrowserScreenshotShortcut)
  registerGlobalShortcut(GLOBAL_AGENT_SKILL_PROMPT_SHORTCUT_ACCELERATOR, onAgentSkillPromptShortcut)
}

export function unregisterGlobalShortcuts(): void {
  globalShortcut.unregister(GLOBAL_HOME_SHORTCUT_ACCELERATOR)
  globalShortcut.unregister(GLOBAL_THEME_SHORTCUT_ACCELERATOR)
  globalShortcut.unregister(GLOBAL_TRANSCRIPT_CAPTURE_SHORTCUT_ACCELERATOR)
  globalShortcut.unregister(GLOBAL_BROWSER_SCREENSHOT_SHORTCUT_ACCELERATOR)
  globalShortcut.unregister(GLOBAL_AGENT_SKILL_PROMPT_SHORTCUT_ACCELERATOR)
}
