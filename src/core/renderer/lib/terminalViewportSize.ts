import { MONO_FONT_STACK } from './fonts'

/**
 * 终端视口尺寸预测：在没有任何 Terminal 视图挂载时（面板隐藏、项目卡启动 dev server 等），
 * 也能算出集合面板终端区域将要 fit 出的 cols/rows。
 *
 * 为什么需要：pty 以硬编码 80x24 启动，等视图挂载才 resize。若 shell 已在这段窗口内
 * 渲染了 prompt（长 CJK 路径会换行），随后 conpty 的 reflow 会污染屏幕并让
 * PSReadLine 的输入回显错位（输入位置错误）。以面板实际尺寸启动 pty 可消除该窗口。
 *
 * 尺寸公式与 xterm 侧保持同源：
 * - 单元格度量复刻 CharSizeService(TextMetricsMeasureStrategy) 的 measureText('W')；
 * - 几何复刻 FitAddon.proposeDimensions（扣滚动条后按单元格向下取整）。
 * 任一处公式漂移都会造成 spawn 尺寸与 fit 尺寸差 1 列，重新引入上述问题，
 * 因此面板侧常量（header 高度 / 列表宽度）也由此文件单一提供。
 */

/** 终端字体规格：Terminal.tsx 的 XTerm 选项与此保持单一事实源。 */
export const TERMINAL_FONT_METRICS = {
  fontFamily: MONO_FONT_STACK,
  fontSize: 13,
  lineHeight: 1.45,
  letterSpacing: 0.2,
} as const

/** 面板 header 行高度：由 TerminalCollectionPanel 的 header 行消费（原 h-9，rem=16px）。 */
export const TERMINAL_PANEL_HEADER_HEIGHT = 36
/** 面板右侧终端列表宽度（含其 1px border-l，border-box）。 */
export const TERMINAL_LIST_WIDTH = 208
/** 面板 1px 边框（四边）。 */
export const TERMINAL_PANEL_BORDER = 1
/** FitAddon 在 scrollback≠0 时扣除的滚动条宽度（xterm ViewportConstants.DEFAULT_SCROLL_BAR_WIDTH）。 */
export const TERMINAL_SCROLLBAR_WIDTH = 14

/** canvas 度量不可用时的兜底单元格尺寸（Consolas 13px：0.55em 步进 + 1.45 行高）。 */
const TERMINAL_CELL_SIZE_FALLBACK = { width: 7.15, height: 21 }

export interface TerminalCellSize {
  width: number
  height: number
}

export interface TerminalPanelViewportInput {
  dock: 'bottom' | 'top' | 'left' | 'right'
  sizeRatio: number
  windowWidth: number
  windowHeight: number
  /** 测试注入；缺省时走 measureTerminalCellSize()。 */
  cellSize?: TerminalCellSize
}

let cachedCellSize: TerminalCellSize | null = null

/**
 * 测量终端单元格 CSS 尺寸，复刻 xterm 的度量链路：
 * CharSizeService 测 'W' 步进与 fontBoundingBox 高度，DomRenderer 再按
 * dpr → device → css 换算（初始 cols=80/rows=24）。结果缓存（字体配置不变时恒定）。
 */
export function measureTerminalCellSize(): TerminalCellSize {
  if (cachedCellSize) return cachedCellSize

  let measured: TerminalCellSize | null = null
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (ctx) {
      ctx.font = `${TERMINAL_FONT_METRICS.fontSize}px ${TERMINAL_FONT_METRICS.fontFamily}`
      const metrics = ctx.measureText('W')
      if (typeof metrics.fontBoundingBoxAscent === 'number' && typeof metrics.fontBoundingBoxDescent === 'number') {
        const charWidth = metrics.width
        const charHeight = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent
        const dpr = window.devicePixelRatio || 1
        measured = {
          width: Math.round(((charWidth * dpr + Math.round(TERMINAL_FONT_METRICS.letterSpacing)) * 80) / dpr) / 80,
          height: Math.round((Math.floor(Math.ceil(charHeight * dpr) * TERMINAL_FONT_METRICS.lineHeight) * 24) / dpr) / 24,
        }
      }
    }
  } catch {
    /* 度量不可用：走兜底常量 */
  }

  if (!measured || !(measured.width > 0) || !(measured.height > 0)) {
    measured = TERMINAL_CELL_SIZE_FALLBACK
  }
  cachedCellSize = measured
  return cachedCellSize
}

/**
 * 预测集合面板终端区域的 cols/rows（与 Terminal 挂载后 FitAddon.fit() 的结果一致）。
 *
 * 几何推导（均 border-box，见 TerminalCollectionPanel.tsx）：
 * - 面板内容区 = 面板尺寸 - 2×1px 边框；
 * - 终端区宽 = 内容宽 - 208px 列表；终端区高 = 内容高 - 36px header；
 * - 面板宽/高按 dock 由视口或 sizeRatio 决定（CSS vh/vw，可能为小数，
 *   这里按 getComputedStyle→parseInt 的截断语义取整）。
 */
export function computeTerminalPanelViewport(input: TerminalPanelViewportInput): { cols: number; rows: number } {
  const horizontal = input.dock === 'bottom' || input.dock === 'top'
  const panelWidth = horizontal ? input.windowWidth : input.sizeRatio * input.windowWidth
  const panelHeight = horizontal ? input.sizeRatio * input.windowHeight : input.windowHeight

  const areaWidth = Math.trunc(panelWidth) - TERMINAL_PANEL_BORDER * 2 - TERMINAL_LIST_WIDTH
  const areaHeight = Math.trunc(panelHeight) - TERMINAL_PANEL_BORDER * 2 - TERMINAL_PANEL_HEADER_HEIGHT

  const cell = input.cellSize ?? measureTerminalCellSize()
  // 与 FitAddon.proposeDimensions 同构：滚动条宽度从可用宽度中扣除，再向下取整
  const cols = Math.max(2, Math.floor((areaWidth - TERMINAL_SCROLLBAR_WIDTH) / cell.width))
  const rows = Math.max(1, Math.floor(areaHeight / cell.height))
  return { cols, rows }
}
