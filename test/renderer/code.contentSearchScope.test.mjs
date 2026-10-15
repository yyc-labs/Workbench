import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { parseContentSearchScopeGlobs } = loadTsModule('src/core/renderer/pages/code/code.contentSearchScope.ts')

test('点前缀目录 scope 追加递归后缀（#4 回归）', () => {
  assert.deepEqual(parseContentSearchScopeGlobs('.yworkbench/my-ai-chat/'), ['.yworkbench/my-ai-chat/**'])
  assert.deepEqual(parseContentSearchScopeGlobs('.yworkbench/my-ai-chat'), ['.yworkbench/my-ai-chat/**'])
})

test('普通目录与既有形态不回归', () => {
  assert.deepEqual(parseContentSearchScopeGlobs('src/'), ['src/**'])
  assert.deepEqual(parseContentSearchScopeGlobs('src/components'), ['src/components/**'])
  assert.deepEqual(parseContentSearchScopeGlobs('./src/'), ['src/**'])
  assert.deepEqual(parseContentSearchScopeGlobs('src\\components\\'), ['src/components/**'])
  assert.deepEqual(parseContentSearchScopeGlobs('.tsx'), ['*.tsx'])
  assert.deepEqual(parseContentSearchScopeGlobs('tsx'), ['*.tsx'])
  assert.deepEqual(parseContentSearchScopeGlobs('*.ts'), ['*.ts'])
  assert.deepEqual(parseContentSearchScopeGlobs('src/*.ts'), ['src/*.ts'])
  assert.deepEqual(parseContentSearchScopeGlobs('docs/**'), ['docs/**'])
  assert.deepEqual(parseContentSearchScopeGlobs('.yworkbench'), ['*.yworkbench']) // 单段点前缀保持扩展名语义
})

test('多 token 分隔、去重、上限 24', () => {
  assert.deepEqual(parseContentSearchScopeGlobs('src/ docs/, src/'), ['src/**', 'docs/**']) // 裸词是扩展名语义，目录需带 /
  assert.deepEqual(parseContentSearchScopeGlobs('tsx tsx'), ['*.tsx'])
  const many = Array.from({ length: 30 }, (_, i) => `dir${i}/`)
  assert.equal(parseContentSearchScopeGlobs(many.join(' ')).length, 24)
})
