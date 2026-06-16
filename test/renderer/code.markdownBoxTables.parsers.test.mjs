import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { buildTranscriptSession } = loadTsModule('src/core/shared/transcript/transcript.parser.ts')
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

test('parseBoxTable parses transcript cli-style segmented tables without outer borders', () => {
  const table = [
    '项目                                       当前是否可改            代码来源            说明                                     前端建议',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━',
    'Subtype                                    可改                    nanopct_inf/        页面下拉输入                             暴露',
    '─────────────────────────────────────────  ──────────────────────  ──────────────────  ───────────────────────────────────────  ──────────────────',
    'Surface Modification                       可改                    nanopct_inf/        页面下拉输入                             暴露',
  ].join('\n')

  const parsed = parseBoxTable(table, 1)

  assert.equal(parsed?.columnCount, 5)
  assert.deepEqual(parsed?.rows.map((row) => row.cells), [
    ['项目', '当前是否可改', '代码来源', '说明', '前端建议'],
    ['Subtype', '可改', 'nanopct_inf/', '页面下拉输入', '暴露'],
    ['Surface Modification', '可改', 'nanopct_inf/', '页面下拉输入', '暴露'],
  ])
  assert.deepEqual(
    parsed?.rows.map((row) => [row.startLine, row.endLine]),
    [[1, 1], [3, 3], [5, 5]]
  )
})

test('parseBoxTable keeps multiline transcript table rows after reference markdown injection', () => {
  const rawText = [
    '项目                                       当前是否可改            代码来源            说明                                     前端建议',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━',
    'Size (TEM)                                 可改                    nanopct_inf/        页面滑块输入                             暴露',
    '                                                                      app.py:120',
  ].join('\n')

  const session = buildTranscriptSession(
    {
      projectId: 'project-1',
      sourceType: 'manual',
      rawText,
    },
    {
      sessionId: 'session-1',
      projectPath: '/repo/project',
      createdAt: 1000,
      title: 'Transcript',
      isProjectFilePath: (relativePath) => relativePath === 'app.py',
    }
  )

  const parsed = parseBoxTable(session.markdownText, 1)

  assert.equal(parsed?.columnCount, 5)
  assert.deepEqual(parsed?.rows.map((row) => row.cells), [
    ['项目', '当前是否可改', '代码来源', '说明', '前端建议'],
    ['Size (TEM)', '可改', '[nanopct_inf/app.py:120](transcript-ref://session-1-ref-1)', '页面滑块输入', '暴露'],
  ])
  assert.deepEqual(
    parsed?.rows.map((row) => [row.startLine, row.endLine]),
    [[1, 1], [3, 4]]
  )
})

test('parseBoxTable preserves header and wrapped project paths for the full transcript cli table sample', () => {
  const rawText = readFileSync(
    new URL('../fixtures/transcript.cli-table-sample.txt', import.meta.url),
    'utf8'
  )

  const session = buildTranscriptSession(
    {
      projectId: 'project-1',
      sourceType: 'manual',
      rawText,
    },
    {
      sessionId: 'session-1',
      projectPath: '/repo/project',
      createdAt: 1000,
      title: 'Transcript',
      isProjectFilePath: (relativePath) => (
        relativePath === 'nanopct_inf/app.py'
        || relativePath === 'nanopct_inf/model/data_config.json'
        || relativePath === 'nanopct_inf/inf.py'
      ),
    }
  )

  const parsed = parseBoxTable(session.markdownText, 1)
  const rows = parsed?.rows.map((row) => row.cells) ?? []

  assert.equal(parsed?.columnCount, 5)
  assert.deepEqual(rows[0], ['项目', '当前是否可改', '代码来源', '说明', '前端建议'])
  assert.deepEqual(rows[1], [
    'Subtype',
    '可改',
    '[nanopct_inf/app.py:102](transcript-ref://session-1-ref-1)',
    '页面下拉输入',
    '暴露',
  ])
  assert.deepEqual(rows[11], [
    '分类参数候选项',
    '不可在页面改',
    '[nanopct_inf/model/data_config.json:20](transcript-ref://session-1-ref-11)',
    '下拉选项集合由配置文件固定',
    '不暴露为高级参数',
  ])
  assert.deepEqual(rows[17], [
    '蛋白名称映射 selected_groups.txt /\nunseen_groups.txt',
    '不可改',
    '[nanopct_inf/app.py:31](transcript-ref://session-1-ref-17)',
    '仅用于结果展示名称',
    '不暴露',
  ])
  assert.deepEqual(rows[25], [
    '模型结构超参数',
    '不可改',
    '[nanopct_inf/inf.py:61](transcript-ref://session-1-ref-25),\n[nanopct_inf/inf.py:451](transcript-ref://session-1-ref-26)',
    'embedding dim、层数、dropout 等都写死',
    '不暴露',
  ])
})

test('parseBoxTable tolerates remark paragraph slicing that removes leading indentation from the first line', () => {
  const source = readFileSync(
    new URL('../fixtures/transcript.cli-table-sample.txt', import.meta.url),
    'utf8'
  )
  const slicedParagraph = source.slice(3, source.length - 1)

  const parsed = parseBoxTable(slicedParagraph, 1)

  assert.equal(parsed?.columnCount, 5)
  assert.deepEqual(parsed?.rows[0]?.cells, ['项目', '当前是否可改', '代码来源', '说明', '前端建议'])
  assert.deepEqual(parsed?.rows[1]?.cells, [
    'Subtype',
    '可改',
    'nanopct_inf/app.py:102',
    '页面下拉输入',
    '暴露',
  ])
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
