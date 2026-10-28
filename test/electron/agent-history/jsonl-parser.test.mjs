import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../../helpers/load-ts-module.mjs'

const mod = loadTsModule('src/core/electron/main/agent-history/providers/shared/jsonl-parser.ts')

const limits = { previewMessageCount: 3, previewTextMaxLength: 10 }

test('toIsoTimestamp normalizes epoch ms and ISO strings, rejects garbage', () => {
  assert.equal(mod.toIsoTimestamp(0), '1970-01-01T00:00:00.000Z')
  assert.equal(mod.toIsoTimestamp('2026-10-20T10:00:00.000Z'), '2026-10-20T10:00:00.000Z')
  assert.equal(mod.toIsoTimestamp('nope'), null)
  assert.equal(mod.toIsoTimestamp(null), null)
  assert.equal(mod.toIsoTimestamp(undefined), null)
})

test('accumulator keeps min/max timestamps and last-N previews', () => {
  const acc = mod.createSessionAccumulator(limits)
  acc.touch('2026-10-20T10:00:00.000Z')
  acc.touch('2026-10-20T09:00:00.000Z')
  acc.touch('2026-10-20T12:00:00.000Z')
  acc.addMessage({ role: 'user', text: 'a'.repeat(25), timestamp: '2026-10-20T10:00:00.000Z' })
  acc.addMessage({ role: 'assistant', text: '  ', timestamp: '2026-10-20T10:01:00.000Z' })
  for (let i = 1; i <= 5; i++) {
    acc.addMessage({ role: 'assistant', text: `m${i}`, timestamp: `2026-10-20T10:0${i}:00.000Z` })
  }
  const summary = acc.summary()
  assert.equal(summary.createdAt, '2026-10-20T09:00:00.000Z')
  assert.equal(summary.updatedAt, '2026-10-20T12:00:00.000Z')
  assert.equal(summary.messageCount, 6)
  assert.equal(summary.previewMessages.length, 3)
  assert.deepEqual(
    summary.previewMessages.map((m) => m.text),
    ['m3', 'm4', 'm5'],
  )
  assert.equal(summary.previewMessages[0].timestamp, '2026-10-20T10:03:00.000Z')
})

test('accumulator truncates text to preview limit', () => {
  const acc = mod.createSessionAccumulator(limits)
  acc.addMessage({ role: 'user', text: 'abcdefghijk', timestamp: null })
  const [message] = acc.summary().previewMessages
  assert.equal(message.text, 'abcdefghij…')
})

test('parseJsonLine returns null on empty, garbage and truncated lines', () => {
  assert.equal(mod.parseJsonLine(''), null)
  assert.equal(mod.parseJsonLine('   '), null)
  assert.equal(mod.parseJsonLine('{"type":"user"'), null)
  assert.deepEqual(mod.parseJsonLine('{"type":"user"}'), { type: 'user' })
})
