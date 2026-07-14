import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { browserAiHistoryRecordToContextSource, filterBrowserAiHistoryRecords, getBrowserAiHistoryTimeRange, getBrowserAiHistoryRecordTime } = loadTsModule('src/core/renderer/pages/learning/browser-ai/learningBrowserAiHistory.ts')

function localDate(day, hour = 0) {
  return new Date(2026, 6, day, hour, 0, 0, 0).getTime()
}

function summary(id, updatedAt, overrides = {}) {
  return {
    id,
    title: `Record ${id}`,
    createdAt: updatedAt - 100,
    updatedAt,
    startedAt: updatedAt - 200,
    status: 'completed',
    siteName: 'Example AI',
    taskExcerpt: `Task ${id}`,
    sourceLabels: ['Learning note'],
    answerExcerpt: `Answer ${id}`,
    ...overrides,
  }
}

test('browser AI history uses local calendar boundaries and rolling windows', () => {
  const now = localDate(15, 12)
  assert.equal(getBrowserAiHistoryTimeRange('today', now).from, localDate(15))
  assert.equal(getBrowserAiHistoryTimeRange('this-week', now).from, localDate(13))
  assert.equal(getBrowserAiHistoryTimeRange('this-month', now).from, localDate(1))

  const records = [summary('today', localDate(15, 9)), summary('monday', localDate(13, 9)), summary('sunday', localDate(12, 23)), summary('rolling', now - 7 * 24 * 60 * 60 * 1_000), summary('too-old', now - 7 * 24 * 60 * 60 * 1_000 - 1)]
  assert.deepEqual(
    filterBrowserAiHistoryRecords(records, '', 'this-week', now).map((record) => record.id),
    ['today', 'monday'],
  )
  assert.deepEqual(
    filterBrowserAiHistoryRecords(records, '', 'last-7-days', now).map((record) => record.id),
    ['today', 'monday', 'sunday', 'rolling'],
  )
})

test('browser AI history searches task, answer, site, and source labels case-insensitively', () => {
  const records = [summary('task', 30, { taskExcerpt: 'Compare deployment modes' }), summary('answer', 20, { answerExcerpt: 'Use the managed profile' }), summary('source', 10, { sourceLabels: ['Web security'] })]
  assert.deepEqual(
    filterBrowserAiHistoryRecords(records, 'DEPLOYMENT', 'all', 100).map((record) => record.id),
    ['task'],
  )
  assert.deepEqual(
    filterBrowserAiHistoryRecords(records, 'managed PROFILE', 'all', 100).map((record) => record.id),
    ['answer'],
  )
  assert.deepEqual(
    filterBrowserAiHistoryRecords(records, 'SECURITY', 'all', 100).map((record) => record.id),
    ['source'],
  )
})

test('browser AI history falls back to created time and preserves selected result ordering', () => {
  const record = summary('fallback', 0, { updatedAt: Number.NaN, createdAt: 42 })
  assert.equal(getBrowserAiHistoryRecordTime(record), 42)
  const records = [summary('first', 30), summary('second', 20), summary('third', 10)]
  assert.deepEqual(
    filterBrowserAiHistoryRecords(records, '', 'all', 100).map((item) => item.id),
    ['first', 'second', 'third'],
  )
})

test('browser AI history context includes task metadata without expanding saved personal context', () => {
  const source = browserAiHistoryRecordToContextSource({
    id: 'record-1',
    title: 'Deployment comparison',
    createdAt: 100,
    updatedAt: 200,
    startedAt: 100,
    completedAt: 300,
    site: { site: 'generic-web', name: 'Example AI', url: 'https://example.com' },
    sources: [{ kind: 'personal-context', label: 'Personal context', included: true, sensitive: true, characterCount: 20, content: 'Private address' }],
    status: 'completed',
    answer: 'Use the managed profile.',
    steps: [],
    input: {
      task: 'Compare deployment modes.',
      responseFormat: 'Use a table.',
      sources: [{ kind: 'personal-context', label: 'Personal context', included: true, sensitive: true, characterCount: 20, content: 'Private address' }],
      promptSaved: true,
    },
  })
  assert.equal(source.kind, 'browser-history')
  assert.equal(source.referenceId, 'record-1')
  assert.match(source.content, /Compare deployment modes\./)
  assert.match(source.content, /Use the managed profile\./)
  assert.doesNotMatch(source.content, /Private address/)
})
