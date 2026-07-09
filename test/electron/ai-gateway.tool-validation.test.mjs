import test from 'node:test'
import {
  assert,
  assertToolValidationPassed,
  validateChatToolCalls,
} from '../helpers/ai-gateway-test-helpers.mjs'

test('validates tool arguments against declared schemas and records diagnostic warnings', () => {
  const report = validateChatToolCalls([
    {
      id: 'call_1',
      index: 0,
      type: 'function',
      function: {
        name: 'Write',
        arguments: '{"file_path":"void","content":""}',
      },
    },
  ], [
    {
      type: 'function',
      function: {
        name: 'Write',
        parameters: {
          type: 'object',
          properties: {
            file_path: { type: 'string', pattern: '^src/' },
            content: { type: 'string' },
          },
          required: ['file_path', 'content'],
          additionalProperties: false,
        },
      },
    },
  ])

  assert.equal(report.valid, false)
  assert.equal(report.entries[0].forwarded, false)
  assert.match(report.entries[0].validationErrors.join('\n'), /must match pattern/)
  assert.match(report.entries[0].diagnosticWarnings.join('\n'), /code token/)
  assert.throws(() => assertToolValidationPassed(report), /tool call "Write" failed validation/i)
})

test('normalizes compatible legacy enum aliases before validation', () => {
  const report = validateChatToolCalls([
    {
      id: 'call_grep_compat',
      index: 0,
      type: 'function',
      function: {
        name: 'Grep',
        arguments: '{"pattern":"ToolPageRendererConfig","output_mode":"files_with_match"}',
      },
    },
  ], [
    {
      type: 'function',
      function: {
        name: 'Grep',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string' },
            output_mode: {
              type: 'string',
              enum: ['content', 'files_with_matches', 'count'],
            },
          },
          required: ['pattern', 'output_mode'],
          additionalProperties: false,
        },
      },
    },
  ])

  assert.equal(report.valid, true)
  assert.deepEqual(report.entries[0].parsedArguments, {
    pattern: 'ToolPageRendererConfig',
    output_mode: 'files_with_matches',
  })
  assert.equal(
    report.normalizedToolCalls[0].function.arguments,
    '{"pattern":"ToolPageRendererConfig","output_mode":"files_with_matches"}'
  )
  assert.match(
    report.entries[0].diagnosticWarnings.join('\n'),
    /\$\.output_mode normalized from "files_with_match" to "files_with_matches"/
  )
  assert.doesNotThrow(() => assertToolValidationPassed(report))
})
