// 编辑器字号偏好：仅持久化到 localStorage（浏览器存储），不进设置页。
const FONT_SIZE_STORAGE_KEY = 'workbench.monacoEditorFontSize'

export const MONACO_EDITOR_FONT_SIZE_MIN = 10
export const MONACO_EDITOR_FONT_SIZE_MAX = 24
export const MONACO_EDITOR_FONT_SIZE_DEFAULT = 13

export function clampMonacoEditorFontSize(value: number): number {
  const rounded = Math.round(value)
  if (!Number.isFinite(rounded)) return MONACO_EDITOR_FONT_SIZE_DEFAULT
  return Math.min(Math.max(rounded, MONACO_EDITOR_FONT_SIZE_MIN), MONACO_EDITOR_FONT_SIZE_MAX)
}

export function readMonacoEditorFontSizePreference(): number {
  try {
    const raw = window.localStorage.getItem(FONT_SIZE_STORAGE_KEY)
    const parsed = raw == null ? Number.NaN : Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed)) return MONACO_EDITOR_FONT_SIZE_DEFAULT
    return clampMonacoEditorFontSize(parsed)
  } catch {
    return MONACO_EDITOR_FONT_SIZE_DEFAULT
  }
}

export function writeMonacoEditorFontSizePreference(fontSize: number): void {
  try {
    window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(clampMonacoEditorFontSize(fontSize)))
  } catch {
    // localStorage 不可用时静默忽略，仅影响持久化，不影响本次会话的字号。
  }
}

// 与默认 13px/行高 20 的比例保持一致。
export function monacoLineHeightForFontSize(fontSize: number): number {
  return Math.round((fontSize * 20) / 13)
}
