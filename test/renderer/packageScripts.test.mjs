import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { parsePackageScriptsWithLines, parsePackageScripts } = loadTsModule('src/core/renderer/lib/packageScripts.ts')

test('parsePackageScriptsWithLines returns document-order entries with 1-based key lines', () => {
  const content = ['{', '  "name": "demo",', '  "scripts": {', '    "dev": "vite",', '    "build": "tsc && vite build",', '    "test": "vitest"', '  },', '  "dependencies": {}', '}'].join('\n')
  assert.deepEqual(parsePackageScriptsWithLines(content), [
    { name: 'dev', line: 4 },
    { name: 'build', line: 5 },
    { name: 'test', line: 6 },
  ])
})

test('parsePackageScriptsWithLines handles indented root and multiline values', () => {
  const content = ['  {', '    "scripts": {', '      "lint": "eslint . \\', '           --max-warnings 0",', '      "start": "node server.js"', '    }', '  }'].join('\n')
  assert.deepEqual(parsePackageScriptsWithLines(content), [
    { name: 'lint', line: 3 },
    { name: 'start', line: 5 },
  ])
})

test('parsePackageScriptsWithLines decodes escaped key names', () => {
  const content = '{"scripts":{"a\\u0075th":"x","with\\"quote":"y"}}'
  assert.deepEqual(parsePackageScriptsWithLines(content), [
    { name: 'auth', line: 1 },
    { name: 'with"quote', line: 1 },
  ])
})

test('parsePackageScriptsWithLines hides actions for invalid or in-progress content', () => {
  // 注释（JSON 不支持）
  assert.equal(parsePackageScriptsWithLines('{\n  // comment\n  "scripts": {}\n}'), null)
  // 截断
  assert.equal(parsePackageScriptsWithLines('{"scripts":{"dev":'), null)
  // scripts 值尚未输入时无动作（不是解析失败）。
  assert.deepEqual(parsePackageScriptsWithLines('{"scripts":'), [])
  // 非 JSON 文本
  assert.equal(parsePackageScriptsWithLines('not json at all'), null)
})

test('parsePackageScriptsWithLines tolerates trailing commas inside the scripts object (legacy parity)', () => {
  // 与旧流式解析一致：scripts 对象内已完整的条目 + 尾逗号视为可解析（用户正在追加条目时保留现有动作）。
  assert.deepEqual(parsePackageScriptsWithLines('{"scripts":{"dev":"vite",}}'), [{ name: 'dev', line: 1 }])
  assert.deepEqual(parsePackageScriptsWithLines('{"scripts":{"dev":"vite",},}'), [{ name: 'dev', line: 1 }])
})

test('parsePackageScriptsWithLines returns empty array when scripts missing or non-object', () => {
  assert.deepEqual(parsePackageScriptsWithLines('{"name":"demo"}'), [])
  assert.deepEqual(parsePackageScriptsWithLines('{"scripts":"dev"}'), [])
})

test('parsePackageScriptsWithLines picks the first scripts block and ignores later duplicates', () => {
  const content = '{"scripts":{"dev":"a"},"scripts":{"build":"b"}}'
  assert.deepEqual(parsePackageScriptsWithLines(content), [{ name: 'dev', line: 1 }])
})

test('parsePackageScripts legacy consumer keeps sorted names with JSON.parse fallback', () => {
  // 流式成功路径
  assert.deepEqual(parsePackageScripts('{"scripts":{"zeta":"a","dev":"b"}}'), ['dev', 'zeta'])
  // 流式失败但 ≤64KB：JSON.parse 兜底再试一次（run-tasks 模板选择器等无行号消费方）；
  // 注释对 JSON.parse 同样非法，因此返回空数组而不是抛错。
  assert.deepEqual(parsePackageScripts('{"scripts": {"dev": "a" /* comment */}}'), [])
  // scripts 对象解析成功即返回（沿用旧流式行为：不校验 scripts 之后的尾部内容）。
  assert.deepEqual(parsePackageScripts('{"scripts":{"dev":"a"},}'), ['dev'])
})
