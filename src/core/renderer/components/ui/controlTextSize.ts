/**
 * 表单控件字号硬契约（ui 表单控件族共用）。
 *
 * 背景：组件默认 className 一旦含多个字号类（如 `text-base` + `md:text-sm`），
 * twMerge 不会让无前缀的 `text-*` 覆盖带 `md:` 前缀的类，调用方意图字号在
 * 部分视口下静默失效，表现为「聚焦/出现后字体突然变大」。
 *
 * 契约：字号只由 `textSize` prop 经内联 style 下发。内联 style 优先级高于
 * 一切 class（无 !important 场景），外部 className 传任何 `text-*` 均无效，
 * 从 CSS 优先级机制上杜绝类名冲突导致的字号漂移。
 */

export type ControlTextSize = 'xs' | 'sm' | 'base'

/** 预设档位，对齐 Tailwind 字号阶（text-xs / text-sm / text-base）。 */
export const CONTROL_TEXT_SIZE_PX: Record<ControlTextSize, string> = {
  xs: '12px',
  sm: '14px',
  base: '16px',
}

/** 控件默认字号：sm（14px），与历史桌面端视觉一致。 */
export const DEFAULT_CONTROL_TEXT_SIZE: ControlTextSize = 'sm'

/** 解析 textSize prop 为 CSS font-size 值；数字按 px 处理（支持 11.5 等任意值）。 */
export function resolveControlFontSize(textSize: ControlTextSize | number | undefined): string {
  if (textSize === undefined) return CONTROL_TEXT_SIZE_PX[DEFAULT_CONTROL_TEXT_SIZE]
  if (typeof textSize === 'number') return `${textSize}px`
  return CONTROL_TEXT_SIZE_PX[textSize]
}
