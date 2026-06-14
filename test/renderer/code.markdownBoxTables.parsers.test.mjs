import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const {
  parseBoxDiagram,
  parseBoxTable,
  parseTranscriptInlineArrowFlow,
  parseVerticalFlow,
} = loadTsModule('src/core/renderer/pages/code/code.markdownBoxTables.parsers.ts')

test('parseBoxTable parses box drawing tables with multiline rows', () => {
  const table = [
    '┌──────┬────────┐',
    '│ Name │ Status │',
    '├──────┼────────┤',
    '│ API  │ Ready  │',
    '│      │ Live   │',
    '└──────┴────────┘',
  ].join('\n')

  const parsed = parseBoxTable(table, 10)

  assert.equal(parsed?.columnCount, 2)
  assert.deepEqual(parsed?.rows.map((row) => row.cells), [
    ['Name', 'Status'],
    ['API', 'Ready\nLive'],
  ])
  assert.deepEqual(
    parsed?.rows.map((row) => [row.startLine, row.endLine]),
    [[11, 11], [13, 14]]
  )
})

test('parseVerticalFlow parses connector labels and step notes', () => {
  const flow = [
    'Collect input // user prompt',
    '  ↓ validate',
    'Plan answer',
    '  ↓',
    'Write files # apply patch',
  ].join('\n')

  const parsed = parseVerticalFlow(flow, 20)

  assert.deepEqual(parsed?.steps.map((step) => ({ title: step.title, note: step.note })), [
    { title: 'Collect input', note: 'user prompt' },
    { title: 'Plan answer', note: undefined },
    { title: 'Write files', note: 'apply patch' },
  ])
  assert.deepEqual(parsed?.connectors.map((connector) => ({
    label: connector.label,
    direction: connector.direction,
    lineNumber: connector.lineNumber,
  })), [
    { label: 'validate', direction: 'down', lineNumber: 21 },
    { label: '', direction: 'down', lineNumber: 23 },
  ])
})

test('parseTranscriptInlineArrowFlow parses transcript shorthand arrows', () => {
  const parsed = parseTranscriptInlineArrowFlow('Start -> Inspect -> Patch -> Verify', 4)

  assert.deepEqual(parsed?.steps.map((step) => step.title), ['Start', 'Inspect', 'Patch', 'Verify'])
  assert.equal(parsed?.connectors.length, 3)
  assert.equal(parsed?.steps[0]?.lineNumber, 4)
})

test('parseBoxDiagram requires connector-like diagram content and preserves source lines', () => {
  const diagram = [
    '┌──────────────┐       ┌──────────────┐',
    '│   Renderer   │  →    │ Main process │',
    '└──────────────┘       └──────────────┘',
  ].join('\n')

  const parsed = parseBoxDiagram(diagram, 30)

  assert.deepEqual(parsed?.lines, [
    { text: '┌──────────────┐       ┌──────────────┐', lineNumber: 30 },
    { text: '│   Renderer   │  →    │ Main process │', lineNumber: 31 },
    { text: '└──────────────┘       └──────────────┘', lineNumber: 32 },
  ])
  assert.equal(parseBoxDiagram('┌──┐\n│A │\n└──┘', 1), null)
})
