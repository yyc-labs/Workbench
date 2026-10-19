import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { TERMINAL_FONT_METRICS, TERMINAL_LIST_WIDTH, TERMINAL_PANEL_HEADER_HEIGHT, TERMINAL_SCROLLBAR_WIDTH, computeTerminalPanelViewport } = loadTsModule('src/core/renderer/lib/terminalViewportSize.ts')

// 与 Consolas 13px / lineHeight 1.45 对应的典型单元格尺寸
const CELL = { width: 7.15, height: 21 }

test('字体规格与面板常量保持度量基准', () => {
  assert.equal(TERMINAL_FONT_METRICS.fontSize, 13)
  assert.equal(TERMINAL_FONT_METRICS.lineHeight, 1.45)
  assert.equal(TERMINAL_LIST_WIDTH, 208)
  assert.equal(TERMINAL_PANEL_HEADER_HEIGHT, 36)
  assert.equal(TERMINAL_SCROLLBAR_WIDTH, 14)
})

test('bottom dock：宽取视口宽、高取 ratio 视口高，扣边框/列表/header/滚动条', () => {
  const { cols, rows } = computeTerminalPanelViewport({
    dock: 'bottom',
    sizeRatio: 0.35,
    windowWidth: 1477,
    windowHeight: 873,
    cellSize: CELL,
  })
  // areaWidth = 1477 - 2 - 208 = 1267 → floor((1267-14)/7.15) = 175
  // areaHeight = trunc(873*0.35) - 2 - 36 = 267 → floor(267/21) = 12
  assert.deepEqual({ cols, rows }, { cols: 175, rows: 12 })
})

test('left dock：宽取 ratio 视口宽（小数截断）、高取视口高', () => {
  const { cols, rows } = computeTerminalPanelViewport({
    dock: 'left',
    sizeRatio: 0.35,
    windowWidth: 1477,
    windowHeight: 873,
    cellSize: CELL,
  })
  // areaWidth = trunc(516.95) - 2 - 208 = 306 → floor((306-14)/7.15) = 40
  // areaHeight = 873 - 2 - 36 = 835 → floor(835/21) = 39
  assert.deepEqual({ cols, rows }, { cols: 40, rows: 39 })
})

test('top / right dock 与 bottom / left 对称', () => {
  const top = computeTerminalPanelViewport({ dock: 'top', sizeRatio: 0.5, windowWidth: 1200, windowHeight: 800, cellSize: CELL })
  const bottom = computeTerminalPanelViewport({ dock: 'bottom', sizeRatio: 0.5, windowWidth: 1200, windowHeight: 800, cellSize: CELL })
  assert.deepEqual(top, bottom)
  const left = computeTerminalPanelViewport({ dock: 'left', sizeRatio: 0.5, windowWidth: 1200, windowHeight: 800, cellSize: CELL })
  const right = computeTerminalPanelViewport({ dock: 'right', sizeRatio: 0.5, windowWidth: 1200, windowHeight: 800, cellSize: CELL })
  assert.deepEqual(left, right)
})

test('极端尺寸按 FitAddon 语义钳制最小值', () => {
  const { cols, rows } = computeTerminalPanelViewport({
    dock: 'left',
    sizeRatio: 0.2,
    windowWidth: 300,
    windowHeight: 200,
    cellSize: CELL,
  })
  // areaWidth = 60 - 2 - 208 < 0 → cols 钳到 2；areaHeight = 162 → floor(162/21) = 7
  assert.equal(cols, 2)
  assert.equal(rows, 7)
})
