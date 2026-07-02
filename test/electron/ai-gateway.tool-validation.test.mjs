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
