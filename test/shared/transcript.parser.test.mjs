import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { buildTranscriptSession } = loadTsModule('src/core/shared/transcript/transcript.parser.ts')
const { parseBoxTable } = loadTsModule('src/core/renderer/pages/code/code.markdownBoxTables.parsers.ts')

function buildSession(rawText, overrides = {}) {
  const existingPaths = new Set(overrides.paths ?? ['src/app.ts', 'docs/guide.md', 'src/utils/math.ts'])
  return buildTranscriptSession(
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
      isProjectFilePath: (relativePath) => existingPaths.has(relativePath),
      ...overrides,
    }
  )
}

test('buildTranscriptSession normalizes line endings, strips ANSI, and links project file references', () => {
  const session = buildSession([
    '\u001b[32mCheck src/app.ts:12:4\u001b[0m\r',
    'Absolute /repo/project/docs/guide.md:3 should link.',
    'Outside /tmp/other.ts:1 should not link.',
  ].join('\n'))

  assert.equal(session.rawText.includes('\r'), false)
  assert.equal(session.references.length, 2)
  assert.deepEqual(
    session.references.map((reference) => ({
      relativePath: reference.relativePath,
      lineNumber: reference.lineNumber,
      column: reference.column,
      rawText: reference.rawText,
    })),
    [
      { relativePath: 'src/app.ts', lineNumber: 12, column: 4, rawText: 'src/app.ts:12:4' },
      { relativePath: 'docs/guide.md', lineNumber: 3, column: undefined, rawText: '/repo/project/docs/guide.md:3' },
    ]
  )
  assert.match(session.markdownText, /\[src\/app\.ts:12:4\]\(transcript-ref:\/\/session-1-ref-1\)/)
  assert.doesNotMatch(session.markdownText, /transcript-ref:\/\/.*other\.ts/)
})

test('buildTranscriptSession links windows absolute references with a leading slash', () => {
  const session = buildSession(
    'Inspect /D:/repo/project/src/app.ts:283 in parser.',
    {
      projectPath: 'D:/repo/project',
      paths: ['src/app.ts'],
    }
  )

  assert.equal(session.references.length, 1)
  assert.deepEqual(
    session.references.map((reference) => ({
      relativePath: reference.relativePath,
      lineNumber: reference.lineNumber,
      rawText: reference.rawText,
    })),
    [
      {
        relativePath: 'src/app.ts',
        lineNumber: 283,
        rawText: '/D:/repo/project/src/app.ts:283',
      },
    ]
  )
  assert.match(
    session.markdownText,
    /\[\/D:\/repo\/project\/src\/app\.ts:283\]\(transcript-ref:\/\/session-1-ref-1\)/
  )
})

test('buildTranscriptSession detects wrapped references and standalone project paths', () => {
  const session = buildSession([
    'Open this wrapped file:',
    'src/utils/math.ts',
    ':',
    '42',
    'Standalone path below:',
    '  docs/guide.md  ',
  ].join('\n'))

  assert.equal(session.references.length, 2)
  assert.equal(session.references[0]?.relativePath, 'src/utils/math.ts')
  assert.equal(session.references[0]?.lineNumber, 42)
  assert.equal(session.references[0]?.label, 'src/utils/math.ts:42')
  assert.equal(session.references[1]?.relativePath, 'docs/guide.md')
  assert.equal(session.references[1]?.lineNumber, 1)
})

test('buildTranscriptSession fences implicit structured data and code blocks', () => {
  const session = buildSession([
    'Data:',
    '{',
    '"name": "demo",',
    '"enabled": true',
    '}',
    'Then code:',
    'const value = compute(input)',
    'return compute(value)',
  ].join('\n'))

  assert.match(session.markdownText, /```json\n\{\n"name": "demo",\n"enabled": true\n\}\n```/)
  assert.match(session.markdownText, /```typescript\nconst value = compute\(input\)\nreturn compute\(value\)\n```/)
})

test('buildTranscriptSession keeps indented standalone table references on their own lines', () => {
  const rawText = [
    '项目                                       当前是否可改            代码来源            说明                                     前端建议',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━',
    'Size (TEM)                                 可改                    nanopct_inf/        页面滑块输入                             暴露',
    '                                                                      app.py:120',
  ].join('\n')

  const session = buildSession(rawText, {
    projectPath: '/repo/project',
    paths: ['app.py'],
  })

  assert.match(session.markdownText, /\n\s*\[app\.py:120\]\(transcript-ref:\/\/session-1-ref-1\)$/)
  const parsedTable = parseBoxTable(session.markdownText, 1)
  assert.deepEqual(parsedTable?.rows.map((row) => row.cells), [
    ['项目', '当前是否可改', '代码来源', '说明', '前端建议'],
    ['Size (TEM)', '可改', '[nanopct_inf/app.py:120](transcript-ref://session-1-ref-1)', '页面滑块输入', '暴露'],
  ])
})

test('buildTranscriptSession infers path prefixes for indented table continuations', () => {
  const rawText = [
    '分类参数候选项                             不可在页面改            nanopct_inf/        下拉选项集合由配置文件固定               不暴露为高级参数',
    '                                                                      model/',
    '                                                                      data_config.json',
    '                                                                      :20',
    '模型结构超参数                             不可改                  nanopct_inf/        embedding dim、层数、dropout 等都写死    不暴露',
    '                                                                      inf.py:61,',
    '                                                                      nanopct_inf/',
    '                                                                      inf.py:451',
  ].join('\n')

  const session = buildSession(rawText, {
    projectPath: '/repo/project',
    paths: ['nanopct_inf/model/data_config.json', 'nanopct_inf/inf.py'],
  })

  assert.deepEqual(
    session.references.map((reference) => ({
      label: reference.label,
      relativePath: reference.relativePath,
      lineNumber: reference.lineNumber,
    })),
    [
      {
        label: 'model/data_config.json:20',
        relativePath: 'nanopct_inf/model/data_config.json',
        lineNumber: 20,
      },
      {
        label: 'inf.py:61',
        relativePath: 'nanopct_inf/inf.py',
        lineNumber: 61,
      },
      {
        label: 'nanopct_inf/inf.py:451',
        relativePath: 'nanopct_inf/inf.py',
        lineNumber: 451,
      },
    ]
  )
})
