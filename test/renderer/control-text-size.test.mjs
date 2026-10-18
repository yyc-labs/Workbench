import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { CONTROL_TEXT_SIZE_PX, DEFAULT_CONTROL_TEXT_SIZE, resolveControlFontSize } = loadTsModule('src/core/renderer/components/ui/controlTextSize.ts')

test('预设档位对齐 Tailwind 字号阶', () => {
  assert.deepEqual(CONTROL_TEXT_SIZE_PX, { xs: '12px', sm: '14px', base: '16px' })
  assert.equal(DEFAULT_CONTROL_TEXT_SIZE, 'sm')
})

test('resolveControlFontSize 处理预设、任意 px 与缺省', () => {
  assert.equal(resolveControlFontSize(undefined), '14px')
  assert.equal(resolveControlFontSize('xs'), '12px')
  assert.equal(resolveControlFontSize('sm'), '14px')
  assert.equal(resolveControlFontSize('base'), '16px')
  assert.equal(resolveControlFontSize(11), '11px')
  assert.equal(resolveControlFontSize(11.5), '11.5px')
  assert.equal(resolveControlFontSize(10), '10px')
})
