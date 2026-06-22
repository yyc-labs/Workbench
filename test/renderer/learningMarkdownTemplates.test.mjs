import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const {
  applyLearningMarkdownInsert,
  buildMarkdownTable,
} = loadTsModule('src/core/renderer/pages/learning/learningMarkdownTemplates.ts')

test('wraps selected text with bold markdown', () => {
  const result = applyLearningMarkdownInsert('hello world', 6, 11, {
    kind: 'template',
    template: 'bold',
  })

  assert.equal(result.value, 'hello **world**')
  assert.equal(result.selectionStart, result.selectionEnd)
})

test('inserts task list placeholder at caret', () => {
  const result = applyLearningMarkdownInsert('', 0, 0, {
    kind: 'template',
    template: 'taskList',
  })

  assert.equal(result.value, '- [ ] 待办事项')
  assert.equal(result.selectionStart, 6)
  assert.equal(result.selectionEnd, 10)
})

test('turns selected lines into ordered list', () => {
  const result = applyLearningMarkdownInsert('alpha\nbeta', 0, 10, {
    kind: 'template',
    template: 'orderedList',
  })

  assert.equal(result.value, '1. alpha\n2. beta')
})

test('inserts multiple bullet list items when count is provided', () => {
  const result = applyLearningMarkdownInsert('', 0, 0, {
    kind: 'template',
    template: 'bulletList',
    count: 3,
  })

  assert.equal(result.value, ['- 列表项', '- 列表项', '- 列表项'].join('\n'))
})

test('inserts multiple ordered list items when count is provided', () => {
  const result = applyLearningMarkdownInsert('', 0, 0, {
    kind: 'template',
    template: 'orderedList',
    count: 3,
  })

  assert.equal(result.value, ['1. 列表项', '2. 列表项', '3. 列表项'].join('\n'))
})

test('inserts multiple task list items when count is provided', () => {
  const result = applyLearningMarkdownInsert('', 0, 0, {
    kind: 'template',
    template: 'taskList',
    count: 2,
  })

  assert.equal(result.value, ['- [ ] 待办事项', '- [ ] 待办事项'].join('\n'))
})

test('creates fenced code block with selected content', () => {
  const result = applyLearningMarkdownInsert('const x = 1', 0, 11, {
    kind: 'template',
    template: 'codeBlock',
  })

  assert.match(result.value, /^```text\nconst x = 1\n```$/)
})

test('builds markdown table with header and body rows', () => {
  const table = buildMarkdownTable(3, 2)

  assert.equal(
    table,
    [
      '| 列1 | 列2 |',
      '| --- | --- |',
      '| 内容 | 内容 |',
      '| 内容 | 内容 |',
    ].join('\n')
  )
})

test('inserts table block with bounded size', () => {
  const result = applyLearningMarkdownInsert('start', 5, 5, {
    kind: 'table',
    rows: 20,
    columns: 20,
  })

  assert.match(result.value, /\| 列1 \| 列2 \|/)
  assert.match(result.value, /\| --- \| --- \|/)
  assert.equal(result.value.includes('列12'), true)
  assert.equal(result.value.includes('列13'), false)
})

test('inserts knowledge points learning template', () => {
  const result = applyLearningMarkdownInsert('', 0, 0, {
    kind: 'template',
    template: 'knowledgePoints',
  })

  assert.match(result.value, /^## 知识点/)
  assert.match(result.value, /- 核心概念：/)
})

test('inserts references learning template with link placeholder selected', () => {
  const result = applyLearningMarkdownInsert('', 0, 0, {
    kind: 'template',
    template: 'referencesSection',
  })

  assert.match(result.value, /\[文档标题\]\(https:\/\/example\.com\)/)
  assert.equal(result.selectionStart < result.selectionEnd, true)
})
