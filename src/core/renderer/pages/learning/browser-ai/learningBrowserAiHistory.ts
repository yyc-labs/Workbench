import type { BrowserAiContextSource, BrowserAiTaskRecord, BrowserAiTaskRecordSummary } from '../../../../shared/types'

export type LearningBrowserAiHistoryTimeFilter = 'all' | 'today' | 'this-week' | 'this-month' | 'last-7-days' | 'last-30-days' | 'last-90-days'

export type LearningBrowserAiHistoryTimeRange = {
  from?: number
  to: number
}

const DAY_MS = 24 * 60 * 60 * 1_000

function startOfLocalDay(value: number): Date {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

export function getBrowserAiHistoryTimeRange(filter: LearningBrowserAiHistoryTimeFilter, now = Date.now()): LearningBrowserAiHistoryTimeRange {
  const end = Number.isFinite(now) ? now : Date.now()
  if (filter === 'all') return { to: end }
  if (filter === 'today') return { from: startOfLocalDay(end).getTime(), to: end }
  if (filter === 'this-week') {
    const start = startOfLocalDay(end)
    const daysSinceMonday = (start.getDay() + 6) % 7
    start.setDate(start.getDate() - daysSinceMonday)
    return { from: start.getTime(), to: end }
  }
  if (filter === 'this-month') {
    const start = startOfLocalDay(end)
    start.setDate(1)
    return { from: start.getTime(), to: end }
  }
  const days = filter === 'last-7-days' ? 7 : filter === 'last-30-days' ? 30 : 90
  return { from: end - days * DAY_MS, to: end }
}

export function getBrowserAiHistoryRecordTime(record: Pick<BrowserAiTaskRecordSummary, 'updatedAt' | 'createdAt'>): number {
  return Number.isFinite(record.updatedAt) && record.updatedAt > 0 ? record.updatedAt : record.createdAt
}

export function matchesBrowserAiHistoryTimeFilter(record: Pick<BrowserAiTaskRecordSummary, 'updatedAt' | 'createdAt'>, filter: LearningBrowserAiHistoryTimeFilter, now = Date.now()): boolean {
  const range = getBrowserAiHistoryTimeRange(filter, now)
  const timestamp = getBrowserAiHistoryRecordTime(record)
  return timestamp >= (range.from ?? Number.NEGATIVE_INFINITY) && timestamp <= range.to
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase()
}

export function matchesBrowserAiHistoryQuery(record: BrowserAiTaskRecordSummary, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return true
  return [record.title, record.siteName, record.taskExcerpt, record.answerExcerpt, ...record.sourceLabels].join(' ').toLocaleLowerCase().includes(normalizedQuery)
}

export function filterBrowserAiHistoryRecords(records: BrowserAiTaskRecordSummary[], query: string, timeFilter: LearningBrowserAiHistoryTimeFilter, now = Date.now()): BrowserAiTaskRecordSummary[] {
  return records
    .filter((record) => matchesBrowserAiHistoryQuery(record, query))
    .filter((record) => matchesBrowserAiHistoryTimeFilter(record, timeFilter, now))
    .slice()
    .sort((left, right) => getBrowserAiHistoryRecordTime(right) - getBrowserAiHistoryRecordTime(left) || right.createdAt - left.createdAt)
}

function formatRecordTime(value: number): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toISOString()
}

export function browserAiHistoryRecordToContextSource(record: BrowserAiTaskRecord): BrowserAiContextSource {
  const includedSources = record.sources.filter((source) => source.included && source.kind !== 'task').map((source) => source.label)
  const lines = ['Historical browser AI task', `Title: ${record.title}`, `Target site: ${record.site.name} (${record.site.url})`, `Last updated: ${formatRecordTime(record.updatedAt || record.createdAt)}`, `Status: ${record.status}`, `Sources used: ${includedSources.length > 0 ? includedSources.join(', ') : 'None'}`]
  if (record.input.task?.trim()) lines.push(`Original task:\n${record.input.task.trim()}`)
  if (record.input.responseFormat?.trim()) lines.push(`Response format:\n${record.input.responseFormat.trim()}`)
  if (record.answer?.trim()) lines.push(`Answer:\n${record.answer.trim()}`)
  if (record.errorMessage?.trim()) lines.push(`Failure:\n${record.errorMessage.trim()}`)

  return {
    kind: 'browser-history',
    label: record.title,
    referenceId: record.id,
    content: lines.join('\n\n'),
    included: true,
  }
}
