import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { continueMarkdownList, indentMarkdownLines, outdentMarkdownLines } = loadTsModule('src/core/renderer/pages/learning/notes/learningMarkdownEditor.ts')

test('indents current ordered list line to create nested list item', () => {
  const source = ['1. 第一项', '2. 第二项', '3. 第三项'].join('\n')
  const start = source.indexOf('3. 第三项')
  const result = indentMarkdownLines(source, start, start)

  assert.equal(result.value, ['1. 第一项', '2. 第二项', '  3. 第三项'].join('\n'))
})

test('outdents selected nested list lines', () => {
  const source = ['1. 第一项', '  2. 第二项', '  - 列表项'].join('\n')
  const start = source.indexOf('  2. 第二项')
  const result = outdentMarkdownLines(source, start, source.length)

  assert.equal(result.value, ['1. 第一项', '2. 第二项', '- 列表项'].join('\n'))
})

test('continues ordered list on enter with matching indentation', () => {
  const source = ['1. 第一项', '  2. 第二项'].join('\n')
  const result = continueMarkdownList(source, source.length, source.length)

  assert.deepEqual(result, {
    value: ['1. 第一项', '  2. 第二项', '  3. '].join('\n'),
    selectionStart: source.length + '\n  3. '.length,
    selectionEnd: source.length + '\n  3. '.length,
  })
})

test('continues bullet list on enter', () => {
  const source = '- 列表项'
  const result = continueMarkdownList(source, source.length, source.length)

  assert.deepEqual(result, {
    value: '- 列表项\n- ',
    selectionStart: source.length + '\n- '.length,
    selectionEnd: source.length + '\n- '.length,
  })
})

test('removes empty ordered list item on enter', () => {
  const source = ['1. 第一项', '2. '].join('\n')
  const start = source.length
  const result = continueMarkdownList(source, start, start)

  assert.deepEqual(result, {
    value: '1. 第一项\n',
    selectionStart: '1. 第一项\n'.length,
    selectionEnd: '1. 第一项\n'.length,
  })
})
