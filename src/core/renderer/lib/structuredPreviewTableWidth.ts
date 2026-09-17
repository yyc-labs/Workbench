const STORAGE_KEY = 'app:structured-preview-table-width'

export const STRUCTURED_PREVIEW_TABLE_WIDTH_MIN = 320
export const STRUCTURED_PREVIEW_TABLE_WIDTH_MAX = 4000
export const STRUCTURED_PREVIEW_TABLE_WIDTH_STEP = 80

/** 将任意输入归一化为合法宽度；<=0 表示不限制（返回 0）。 */
export function normalizeStructuredPreviewTableWidth(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(STRUCTURED_PREVIEW_TABLE_WIDTH_MAX, Math.max(STRUCTURED_PREVIEW_TABLE_WIDTH_MIN, Math.round(value)))
}

/** 读取表格弹窗宽度偏好（px）；0 表示未设置、不限制。 */
export function readStructuredPreviewTableWidth(): number {
  try {
    if (typeof window === 'undefined') return 0
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return 0
    return normalizeStructuredPreviewTableWidth(Number.parseInt(raw, 10))
  } catch {
    return 0
  }
}

/** 保存表格弹窗宽度偏好；width<=0 表示清除（不限制）。 */
export function saveStructuredPreviewTableWidth(width: number): void {
  try {
    const normalized = normalizeStructuredPreviewTableWidth(width)
    if (normalized <= 0) {
      window.localStorage.removeItem(STORAGE_KEY)
      return
    }
    window.localStorage.setItem(STORAGE_KEY, String(normalized))
  } catch {
    // localStorage 不可用时静默忽略，仅当前会话内生效
  }
}
