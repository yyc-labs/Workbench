import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { buildTranscriptSession } = loadTsModule('src/core/shared/transcript/transcript.parser.ts')

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
