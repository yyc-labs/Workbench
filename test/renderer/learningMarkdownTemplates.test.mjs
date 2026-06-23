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

test('deletes selected text before inserting heading', () => {
  const source = 'hello world'
  const result = applyLearningMarkdownInsert(source, 6, 11, {
    kind: 'template',
    template: 'heading2',
  })
  const collapsedResult = applyLearningMarkdownInsert('hello ', 6, 6, {
    kind: 'template',
    template: 'heading2',
  })

  assert.deepEqual(result, collapsedResult)
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

test('deletes selected text before inserting ordered list', () => {
  const source = 'alpha\nbeta'
  const result = applyLearningMarkdownInsert(source, 0, 10, {
    kind: 'template',
    template: 'orderedList',
  })
  const collapsedResult = applyLearningMarkdownInsert('', 0, 0, {
    kind: 'template',
    template: 'orderedList',
  })

  assert.deepEqual(result, collapsedResult)
})

test('deletes partial inline selection before inserting list', () => {
  const source = 'alpha beta gamma'
  const partialSelectionResult = applyLearningMarkdownInsert(source, 6, 10, {
    kind: 'template',
    template: 'bulletList',
  })
  const collapsedResult = applyLearningMarkdownInsert('alpha  gamma', 6, 6, {
    kind: 'template',
    template: 'bulletList',
  })

  assert.deepEqual(partialSelectionResult, collapsedResult)
})

test('deletes partial inline selection before inserting task list', () => {
  const source = 'alpha beta gamma'
  const partialSelectionResult = applyLearningMarkdownInsert(source, 6, 10, {
    kind: 'template',
    template: 'taskList',
  })
  const collapsedResult = applyLearningMarkdownInsert('alpha  gamma', 6, 6, {
    kind: 'template',
    template: 'taskList',
  })

  assert.deepEqual(partialSelectionResult, collapsedResult)
})

test('inserts multiple bullet list items when count is provided', () => {
  const result = applyLearningMarkdownInsert('', 0, 0, {
    kind: 'template',
    template: 'bulletList',
    count: 3,
  })

  assert.equal(result.value, ['- 列表项', '- ', '- '].join('\n'))
})

test('inserts multiple ordered list items when count is provided', () => {
  const result = applyLearningMarkdownInsert('', 0, 0, {
    kind: 'template',
    template: 'orderedList',
    count: 3,
  })

  assert.equal(result.value, ['1. 列表项', '2. ', '3. '].join('\n'))
})

test('continues ordered list numbering from the previous adjacent line', () => {
  const source = '1. 第一项\n2. 第二项\n'
  const result = applyLearningMarkdownInsert(source, source.length, source.length, {
    kind: 'template',
    template: 'orderedList',
  })

  assert.equal(result.value, '1. 第一项\n2. 第二项\n3. 列表项')
})

test('continues ordered list numbering when indentation matches', () => {
  const source = '  1. 第一项\n  2. 第二项\n  '
  const result = applyLearningMarkdownInsert(source, source.length, source.length, {
    kind: 'template',
    template: 'orderedList',
  })

  assert.equal(result.value, '  1. 第一项\n  2. 第二项\n  3. 列表项')
})

test('resets ordered list numbering when indentation changes', () => {
  const source = '  1. 第一项\n'
  const result = applyLearningMarkdownInsert(source, source.length, source.length, {
    kind: 'template',
    template: 'orderedList',
  })

  assert.equal(result.value, '  1. 第一项\n1. 列表项')
})

test('resets ordered list numbering after a blank line', () => {
  const source = '1. 第一项\n2. 第二项\n\n'
  const result = applyLearningMarkdownInsert(source, source.length, source.length, {
    kind: 'template',
    template: 'orderedList',
  })

  assert.equal(result.value, '1. 第一项\n2. 第二项\n\n1. 列表项')
})

test('deletes selected lines before inserting ordered list after existing ordered line', () => {
  const source = '2. 已有条目\nalpha\nbeta'
  const result = applyLearningMarkdownInsert(source, 8, source.length, {
    kind: 'template',
    template: 'orderedList',
  })
  const collapsedResult = applyLearningMarkdownInsert('2. 已有条目\n', 8, 8, {
    kind: 'template',
    template: 'orderedList',
  })

  assert.deepEqual(result, collapsedResult)
})

test('deletes selected text before inserting blockquote', () => {
  const source = 'alpha\nbeta'
  const result = applyLearningMarkdownInsert(source, 0, source.length, {
    kind: 'template',
    template: 'blockquote',
  })
  const collapsedResult = applyLearningMarkdownInsert('', 0, 0, {
    kind: 'template',
    template: 'blockquote',
  })

  assert.deepEqual(result, collapsedResult)
})

test('deletes selected text before inserting code block', () => {
  const source = 'const x = 1'
  const result = applyLearningMarkdownInsert(source, 0, source.length, {
    kind: 'template',
    template: 'codeBlock',
  })
  const collapsedResult = applyLearningMarkdownInsert('', 0, 0, {
    kind: 'template',
    template: 'codeBlock',
  })

  assert.deepEqual(result, collapsedResult)
})

test('deletes selected text before inserting horizontal rule', () => {
  const source = 'alpha\nbeta'
  const result = applyLearningMarkdownInsert(source, 0, source.length, {
    kind: 'template',
    template: 'horizontalRule',
  })
  const collapsedResult = applyLearningMarkdownInsert('', 0, 0, {
    kind: 'template',
    template: 'horizontalRule',
  })

  assert.deepEqual(result, collapsedResult)
})

test('inserts bullet list as nested children when caret is at ordered list item end', () => {
  const source = '5. 父项'
  const result = applyLearningMarkdownInsert(source, source.length, source.length, {
    kind: 'template',
    template: 'bulletList',
    count: 3,
  })

  assert.equal(
    result.value,
    [
      '5. 父项',
      '   - 列表项',
      '   - ',
      '   - ',
    ].join('\n')
  )
})

test('inserts ordered list as nested children when caret is at ordered list item end', () => {
  const source = '5. 父项'
  const result = applyLearningMarkdownInsert(source, source.length, source.length, {
    kind: 'template',
    template: 'orderedList',
    count: 2,
  })

  assert.equal(
    result.value,
    [
      '5. 父项',
      '   1. 列表项',
      '   2. ',
    ].join('\n')
  )
})

test('inserts multiple task list items when count is provided', () => {
  const result = applyLearningMarkdownInsert('', 0, 0, {
    kind: 'template',
    template: 'taskList',
    count: 2,
  })

  assert.equal(result.value, ['- [ ] 待办事项', '- [ ] '].join('\n'))
})

test('creates fenced code block with selected content', () => {
  const result = applyLearningMarkdownInsert('', 0, 0, {
    kind: 'template',
    template: 'codeBlock',
  })

  assert.match(result.value, /^```text\ncode\n```$/)
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

test('deletes selected text before inserting table block', () => {
  const source = 'alpha beta'
  const result = applyLearningMarkdownInsert(source, 0, source.length, {
    kind: 'table',
    rows: 3,
    columns: 2,
  })
  const collapsedResult = applyLearningMarkdownInsert('', 0, 0, {
    kind: 'table',
    rows: 3,
    columns: 2,
  })

  assert.deepEqual(result, collapsedResult)
})

test('inserts knowledge points learning template', () => {
  const result = applyLearningMarkdownInsert('', 0, 0, {
    kind: 'template',
    template: 'knowledgePoints',
  })

  assert.match(result.value, /^## 知识点/)
  assert.match(result.value, /- 核心概念：/)
})

test('deletes selected text before inserting learning preset block', () => {
  const source = 'alpha beta'
  const result = applyLearningMarkdownInsert(source, 0, source.length, {
    kind: 'template',
    template: 'knowledgePoints',
  })
  const collapsedResult = applyLearningMarkdownInsert('', 0, 0, {
    kind: 'template',
    template: 'knowledgePoints',
  })

  assert.deepEqual(result, collapsedResult)
})

test('inserts references learning template with link placeholder selected', () => {
  const result = applyLearningMarkdownInsert('', 0, 0, {
    kind: 'template',
    template: 'referencesSection',
  })

  assert.match(result.value, /\[文档标题\]\(https:\/\/example\.com\)/)
  assert.equal(result.selectionStart < result.selectionEnd, true)
})
