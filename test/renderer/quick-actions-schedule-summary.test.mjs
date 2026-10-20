import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { describeQuickActionFailedToday, describeQuickActionLastRun, describeQuickActionNextRun, describeQuickActionScheduleBadge, describeQuickActionScheduleNotes } = loadTsModule('src/core/renderer/pages/settings/quick-actions/quickActions.schedule.ts')

// 与 i18n messages/quickActions.ts（en-US）对齐的测试翻译函数。
const MESSAGES = {
  'quickActions.schedule.weekdays.sun': 'Sun',
  'quickActions.schedule.weekdays.mon': 'Mon',
  'quickActions.schedule.weekdays.tue': 'Tue',
  'quickActions.schedule.weekdays.wed': 'Wed',
  'quickActions.schedule.weekdays.thu': 'Thu',
  'quickActions.schedule.weekdays.fri': 'Fri',
  'quickActions.schedule.weekdays.sat': 'Sat',
  'quickActions.schedule.weekdayJoin': ', ',
  'quickActions.schedule.badgeEveryDay': 'Every day {time}',
  'quickActions.schedule.badgeWeekly': 'Weekly {weekdays} {time}',
  'quickActions.schedule.timeJoin': ', ',
  'quickActions.schedule.badgeWorkdaysOnly': 'workdays only',
  'quickActions.schedule.nextRun': 'Next {when}',
  'quickActions.schedule.lastRun': 'Last run {when}',
  'quickActions.schedule.failedToday': 'Failed {count} times today',
  'quickActions.schedule.whenToday': 'today {time}',
  'quickActions.schedule.whenTomorrow': 'tomorrow {time}',
  'quickActions.schedule.whenYesterday': 'yesterday {time}',
  'quickActions.schedule.whenDate': '{date} {time}',
}

const t = (key, values) => {
  const template = MESSAGES[key] ?? key
  if (!values) return template
  return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name]))
}

const NOW = new Date(2026, 0, 15, 12, 0, 0) // 2026-01-15 周四中午

function schedule(overrides = {}) {
  return {
    kind: 'daily',
    times: ['09:00'],
    calendarMode: 'every-day',
    enabled: true,
    ...overrides,
  }
}

test('badge covers the three kinds across both calendar modes', () => {
  assert.equal(describeQuickActionScheduleBadge(t, schedule()), 'Every day 09:00')
  assert.equal(describeQuickActionScheduleBadge(t, schedule({ calendarMode: 'workdays-only' })), 'Every day 09:00 · workdays only')
  assert.equal(describeQuickActionScheduleBadge(t, schedule({ kind: 'weekly', weekdays: [1, 3] })), 'Weekly Mon, Wed 09:00')
  assert.equal(describeQuickActionScheduleBadge(t, schedule({ kind: 'weekly', weekdays: [3, 1], calendarMode: 'workdays-only' })), 'Weekly Mon, Wed 09:00 · workdays only')
  assert.equal(describeQuickActionScheduleBadge(t, schedule({ kind: 'once', date: '2026-11-05' })), '2026-11-05 09:00')
  // weekly 空 weekdays = 每天。
  assert.equal(describeQuickActionScheduleBadge(t, schedule({ kind: 'weekly', weekdays: [] })), 'Every day 09:00')
  // 乱序 weekdays 归一为升序。
  assert.equal(describeQuickActionScheduleBadge(t, schedule({ kind: 'weekly', weekdays: [5, 1, 5] })), 'Weekly Mon, Fri 09:00')
  // 多时间点：按序拼接。
  assert.equal(describeQuickActionScheduleBadge(t, schedule({ times: ['18:00', '09:00'] })), 'Every day 09:00, 18:00')
  assert.equal(describeQuickActionScheduleBadge(t, schedule({ times: ['09:00', '18:00'], calendarMode: 'workdays-only' })), 'Every day 09:00, 18:00 · workdays only')
  assert.equal(describeQuickActionScheduleBadge(t, schedule({ kind: 'once', date: '2026-11-05', times: ['09:00', '21:30'] })), '2026-11-05 09:00, 21:30')
  // 空时间点列表退化为仅时间后缀缺失时不崩（normalize 已拦截，这里防御）。
  assert.equal(describeQuickActionScheduleBadge(t, schedule({ times: [] })), 'Every day ')
})

test('badge returns null for missing or disabled schedules', () => {
  assert.equal(describeQuickActionScheduleBadge(t, undefined), null)
  assert.equal(describeQuickActionScheduleBadge(t, schedule({ enabled: false })), null)
})

test('next run uses today / tomorrow / date phrasing', () => {
  assert.equal(describeQuickActionNextRun(t, new Date(2026, 0, 15, 9, 0).getTime(), NOW), 'Next today 09:00')
  assert.equal(describeQuickActionNextRun(t, new Date(2026, 0, 16, 9, 30).getTime(), NOW), 'Next tomorrow 09:30')
  // 同年其他日期省略年份。
  assert.equal(describeQuickActionNextRun(t, new Date(2026, 2, 3, 8, 5).getTime(), NOW), 'Next 03-03 08:05')
  // 跨年保留完整日期。
  assert.equal(describeQuickActionNextRun(t, new Date(2027, 0, 2, 23, 59).getTime(), NOW), 'Next 2027-01-02 23:59')
  assert.equal(describeQuickActionNextRun(t, undefined, NOW), null)
  assert.equal(describeQuickActionNextRun(t, Number.NaN, NOW), null)
})

test('last run uses today / yesterday / date phrasing', () => {
  assert.equal(describeQuickActionLastRun(t, new Date(2026, 0, 15, 9, 0).getTime(), NOW), 'Last run today 09:00')
  assert.equal(describeQuickActionLastRun(t, new Date(2026, 0, 14, 22, 15).getTime(), NOW), 'Last run yesterday 22:15')
  assert.equal(describeQuickActionLastRun(t, new Date(2026, 0, 10, 7, 0).getTime(), NOW), 'Last run 01-10 07:00')
  assert.equal(describeQuickActionLastRun(t, undefined, NOW), null)
})

test('failed-today hint only appears with a positive count', () => {
  assert.equal(describeQuickActionFailedToday(t, 0), null)
  assert.equal(describeQuickActionFailedToday(t, -1), null)
  assert.equal(describeQuickActionFailedToday(t, 2), 'Failed 2 times today')
})

test('schedule notes combine next run, last run and failure hints', () => {
  // 仅有下次运行。
  assert.equal(describeQuickActionScheduleNotes(t, schedule(), new Date(2026, 0, 16, 9, 0).getTime(), NOW), 'Next tomorrow 09:00')
  // 完整组合。
  assert.equal(describeQuickActionScheduleNotes(t, schedule({ lastRunAt: new Date(2026, 0, 14, 9, 0).getTime(), attemptCount: 2 }), new Date(2026, 0, 16, 9, 0).getTime(), NOW), 'Next tomorrow 09:00 · Last run yesterday 09:00 · Failed 2 times today')
  // 无 schedule。
  assert.equal(describeQuickActionScheduleNotes(t, undefined, undefined, NOW), null)
  // 禁用 schedule：不展示下次运行，仅展示历史。
  assert.equal(describeQuickActionScheduleNotes(t, schedule({ enabled: false, lastRunAt: new Date(2026, 0, 15, 9, 0).getTime() }), undefined, NOW), 'Last run today 09:00')
  // 有 schedule 但无任何可展示信息。
  assert.equal(describeQuickActionScheduleNotes(t, schedule(), undefined, NOW), null)
})
