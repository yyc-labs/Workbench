import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { computeNextRunAt, computeYearContentHash, formatLocalDate, isValidDateString, isValidTimeString, mapUpstreamYear, normalizeYearCalendar, parseLocalDate, parseTimeMinutes, parseYearCalendarJson, weekdayOf } = loadTsModule('src/core/electron/main/calendar/calendar-data.ts')

function yearPayload(overrides = {}) {
  return {
    schemaVersion: 1,
    year: 2026,
    region: 'CN',
    updatedAt: '2025-11-04',
    sourceUrl: 'https://cdn.jsdelivr.net/npm/chinese-days/dist/years/2026.json',
    officialNoticeUrl: 'https://example.com/notice',
    days: [
      { date: '2026-01-01', name: '元旦', type: 'holiday', isStatutory: true },
      { date: '2026-01-04', name: '元旦调休', type: 'makeup_workday' },
    ],
    ...overrides,
  }
}

test('isValidDateString accepts real calendar dates only', () => {
  assert.equal(isValidDateString('2026-01-01'), true)
  assert.equal(isValidDateString('2024-02-29'), true)
  assert.equal(isValidDateString('2026-02-29'), false)
  assert.equal(isValidDateString('2026-13-01'), false)
  assert.equal(isValidDateString('2026-00-10'), false)
  assert.equal(isValidDateString('2026-01-32'), false)
  assert.equal(isValidDateString('2026-1-1'), false)
  assert.equal(isValidDateString('not-a-date'), false)
  assert.equal(isValidDateString(20260101), false)
})

test('time helpers validate HH:mm and convert to minutes', () => {
  assert.equal(isValidTimeString('09:30'), true)
  assert.equal(isValidTimeString('00:00'), true)
  assert.equal(isValidTimeString('23:59'), true)
  assert.equal(isValidTimeString('24:00'), false)
  assert.equal(isValidTimeString('9:30'), false)
  assert.equal(isValidTimeString('09:60'), false)
  assert.equal(isValidTimeString('nope'), false)
  assert.equal(parseTimeMinutes('09:30'), 570)
  assert.equal(parseTimeMinutes('24:00'), null)
})

test('local date helpers keep the local-timezone contract', () => {
  assert.equal(formatLocalDate(new Date(2026, 0, 5, 23, 30)), '2026-01-05')
  assert.equal(formatLocalDate(new Date(2026, 11, 31, 0, 1)), '2026-12-31')
  assert.equal(parseLocalDate('2026-01-05').getTime(), new Date(2026, 0, 5).getTime())
  // 星期判断用 UTC 解析纯日期串，不受本地时区影响（D6）。
  assert.equal(weekdayOf('2026-01-01'), 4)
  assert.equal(weekdayOf('2026-01-04'), 0)
  assert.equal(weekdayOf('2026-01-05'), 1)
})

test('normalizeYearCalendar rejects unusable shapes', () => {
  assert.equal(normalizeYearCalendar(undefined), null)
  assert.equal(normalizeYearCalendar(null), null)
  assert.equal(normalizeYearCalendar('nope'), null)
  // schemaVersion 不匹配 → 回落（调用方拿到 null 后用内置）。
  assert.equal(normalizeYearCalendar(yearPayload({ schemaVersion: 2 })), null)
  // region 不匹配 → 拒绝。
  assert.equal(normalizeYearCalendar(yearPayload({ region: 'US' })), null)
  // year 与文件名不一致 → 拒绝。
  assert.equal(normalizeYearCalendar(yearPayload(), 2025), null)
  assert.equal(normalizeYearCalendar(yearPayload({ year: 2027 }), 2026), null)
  // year 本身非法。
  assert.equal(normalizeYearCalendar(yearPayload({ year: 'twenty' })), null)
  assert.equal(normalizeYearCalendar(yearPayload({ year: 1999 })), null)
  // days 非数组。
  assert.equal(normalizeYearCalendar(yearPayload({ days: 'nope' })), null)
})

test('normalizeYearCalendar drops invalid day entries and keeps valid ones', () => {
  const result = normalizeYearCalendar(
    yearPayload({
      days: [
        { date: '2026-01-01', name: '元旦', type: 'holiday' },
        { date: '2026-13-01', name: '坏月', type: 'holiday' },
        { date: '2026-02-30', name: '坏日', type: 'holiday' },
        { date: 'not-a-date', name: '坏串', type: 'holiday' },
        { date: '2025-12-31', name: '跨年', type: 'holiday' },
        { date: '2026-01-04', name: '', type: 'makeup_workday' },
        { date: '2026-01-05', name: '坏类型', type: 'party' },
        { date: '2026-02-28', name: '春节调休', type: 'makeup_workday' },
        'garbage',
      ],
    }),
  )
  assert.deepEqual(
    result.days.map((day) => [day.date, day.name, day.type]),
    [
      ['2026-01-01', '元旦', 'holiday'],
      ['2026-02-28', '春节调休', 'makeup_workday'],
    ],
  )
  // 元数据字段缺省降级为空串，isStatutory 仅在布尔时保留。
  const bare = normalizeYearCalendar({ schemaVersion: 1, year: 2026, region: 'CN', days: [] })
  assert.deepEqual(bare, {
    schemaVersion: 1,
    year: 2026,
    region: 'CN',
    updatedAt: '',
    sourceUrl: '',
    officialNoticeUrl: '',
    days: [],
  })
  const statutory = normalizeYearCalendar(yearPayload())
  assert.equal(statutory.days[0].isStatutory, true)
  assert.equal('isStatutory' in statutory.days[1], false)
})

test('parseYearCalendarJson returns null for malformed text', () => {
  assert.equal(parseYearCalendarJson('not json'), null)
  assert.equal(parseYearCalendarJson('null'), null)
  const parsed = parseYearCalendarJson(JSON.stringify(yearPayload()))
  assert.equal(parsed.year, 2026)
  assert.equal(parsed.days.length, 2)
  assert.equal(parseYearCalendarJson(JSON.stringify(yearPayload()), 2025), null)
})

test('mapUpstreamYear maps the three-part upstream structure', () => {
  const mapped = mapUpstreamYear(
    {
      year: 2026,
      holidays: {
        '2026-01-01': "New Year's Day,元旦,1",
        '2026-01-02': "New Year's Day,元旦,1",
        '2026-01-03': "New Year's Day,元旦,1",
        'bad-date': "New Year's Day,元旦,1",
        '2025-12-31': "New Year's Day,元旦,1",
        '2026-01-04': 'no-separator',
      },
      workdays: {
        '2026-01-04': "New Year's Day,元旦,1",
        '2026-02-14': 'Spring Festival,春节,4',
      },
      inLieuDays: {
        '2026-01-02': "New Year's Day,元旦,1",
      },
    },
    2026,
  )
  assert.deepEqual(mapped, [
    { date: '2026-01-01', name: '元旦', type: 'holiday' },
    { date: '2026-01-02', name: '元旦', type: 'holiday' },
    { date: '2026-01-03', name: '元旦', type: 'holiday' },
    { date: '2026-01-04', name: '元旦调休', type: 'makeup_workday' },
    { date: '2026-02-14', name: '春节调休', type: 'makeup_workday' },
  ])
  // 不推断 isStatutory（D12）。
  assert.equal(
    mapped.every((day) => !('isStatutory' in day)),
    true,
  )
  // 非对象输入返回空。
  assert.deepEqual(mapUpstreamYear(null, 2026), [])
  assert.deepEqual(mapUpstreamYear('nope', 2026), [])
})

test('computeYearContentHash covers date/name/type only', () => {
  const base = [
    { date: '2026-01-01', name: '元旦', type: 'holiday' },
    { date: '2026-01-04', name: '元旦调休', type: 'makeup_workday' },
  ]
  const withStatutory = [
    { date: '2026-01-01', name: '元旦', type: 'holiday', isStatutory: true },
    { date: '2026-01-04', name: '元旦调休', type: 'makeup_workday' },
  ]
  // isStatutory 是展示注解，不改变哈希（D12）。
  assert.equal(computeYearContentHash(base), computeYearContentHash(withStatutory))
  // 规范化排序稳定：乱序输入同哈希。
  const reordered = [base[1], base[0]]
  assert.equal(computeYearContentHash(base), computeYearContentHash(reordered))
  // 语义核心变化一定改变哈希。
  assert.notEqual(
    computeYearContentHash(base),
    computeYearContentHash([
      { date: '2026-01-01', name: '元旦', type: 'holiday' },
      { date: '2026-01-05', name: '元旦调休', type: 'makeup_workday' },
    ]),
  )
  assert.notEqual(computeYearContentHash(base), computeYearContentHash([{ date: '2026-01-01', name: '新年', type: 'holiday' }, base[1]]))
  assert.notEqual(computeYearContentHash(base), computeYearContentHash([{ date: '2026-01-01', name: '元旦', type: 'makeup_workday' }, base[1]]))
  assert.equal(computeYearContentHash([]), computeYearContentHash([]))
})

// 测试用日历：元旦 01-01~01-03 连休，01-04（周日）补班，其余周末休息。
const fakeIsWorkday = (date) => {
  if (date >= '2026-01-01' && date <= '2026-01-03') return false
  if (date === '2026-01-04') return true
  const weekday = weekdayOf(date)
  return weekday >= 1 && weekday <= 5
}

const neverWorkday = () => false

function schedule(overrides = {}) {
  return {
    kind: 'daily',
    times: ['09:00'],
    calendarMode: 'every-day',
    enabled: true,
    ...overrides,
  }
}

test('computeNextRunAt handles daily / weekly / once', () => {
  // daily：今天时间已过 → 明天同一时刻。
  assert.equal(computeNextRunAt(schedule(), neverWorkday, new Date(2026, 0, 2, 10, 0)).valueOf(), new Date(2026, 0, 3, 9, 0).getTime())
  // daily：今天时间未到 → 今天。
  assert.equal(computeNextRunAt(schedule(), neverWorkday, new Date(2026, 0, 2, 8, 0)).valueOf(), new Date(2026, 0, 2, 9, 0).getTime())
  // weekly：只在周一/周三触发；2026-01-01 是周四 → 下一个周一 01-05。
  assert.equal(computeNextRunAt(schedule({ kind: 'weekly', weekdays: [1, 3] }), neverWorkday, new Date(2026, 0, 1, 12, 0)).valueOf(), new Date(2026, 0, 5, 9, 0).getTime())
  // weekly：weekdays 缺省/空数组 = 每天。
  assert.equal(computeNextRunAt(schedule({ kind: 'weekly', weekdays: [] }), neverWorkday, new Date(2026, 0, 2, 10, 0)).valueOf(), new Date(2026, 0, 3, 9, 0).getTime())
  // once：未来日期返回该时刻。
  assert.equal(computeNextRunAt(schedule({ kind: 'once', date: '2026-03-10', times: ['08:30'] }), neverWorkday, new Date(2026, 0, 1, 0, 0)).valueOf(), new Date(2026, 2, 10, 8, 30).getTime())
  // once：已过期 → undefined。
  assert.equal(computeNextRunAt(schedule({ kind: 'once', date: '2025-12-01' }), neverWorkday, new Date(2026, 0, 1)), undefined)
  // once：日期缺失/非法 → undefined。
  assert.equal(computeNextRunAt(schedule({ kind: 'once' }), neverWorkday, new Date(2026, 0, 1)), undefined)
  assert.equal(computeNextRunAt(schedule({ kind: 'once', date: 'garbage' }), neverWorkday, new Date(2026, 0, 1)), undefined)
  // 禁用或时间非法 → undefined。
  assert.equal(computeNextRunAt(schedule({ enabled: false }), neverWorkday, new Date(2026, 0, 1)), undefined)
  assert.equal(computeNextRunAt(schedule({ times: ['9:00'] }), neverWorkday, new Date(2026, 0, 1)), undefined)
  assert.equal(computeNextRunAt(schedule({ times: [] }), neverWorkday, new Date(2026, 0, 1)), undefined)
})

test('computeNextRunAt applies workdays-only calendar mode', () => {
  const workdaysOnly = schedule({ calendarMode: 'workdays-only' })
  // 周五 2026-01-02 10:00 → 周六休假、周日补班 → 补班日 2026-01-04 09:00。
  assert.equal(computeNextRunAt(workdaysOnly, fakeIsWorkday, new Date(2026, 0, 2, 10, 0)).valueOf(), new Date(2026, 0, 4, 9, 0).getTime())
  // 普通周末跳过：周五 2026-01-09 10:00 → 下周一 2026-01-12 09:00。
  assert.equal(computeNextRunAt(workdaysOnly, fakeIsWorkday, new Date(2026, 0, 9, 10, 0)).valueOf(), new Date(2026, 0, 12, 9, 0).getTime())
  // 2025-12-31（周三）晚 → 跳过元旦连休与周末 → 补班周日 2026-01-04 命中。
  assert.equal(computeNextRunAt(workdaysOnly, fakeIsWorkday, new Date(2025, 11, 31, 20, 0)).valueOf(), new Date(2026, 0, 4, 9, 0).getTime())
  // 元旦当天 10:00（连休中）→ 次日仍是假期 → 01-04 补班。
  assert.equal(computeNextRunAt(workdaysOnly, fakeIsWorkday, new Date(2026, 0, 1, 10, 0)).valueOf(), new Date(2026, 0, 4, 9, 0).getTime())
  // every-day 模式不参与日历判定。
  assert.equal(computeNextRunAt(schedule(), fakeIsWorkday, new Date(2026, 0, 1, 10, 0)).valueOf(), new Date(2026, 0, 2, 9, 0).getTime())
})

test('computeNextRunAt picks the earliest upcoming slot across multiple times', () => {
  // 今天 12:00，times ['09:00','18:00']：09:00 已过 → 今天 18:00。
  assert.equal(computeNextRunAt(schedule({ times: ['18:00', '09:00'] }), neverWorkday, new Date(2026, 0, 15, 12, 0)).valueOf(), new Date(2026, 0, 15, 18, 0).getTime())
  // 今天 20:00：两个时间点都已过 → 明天 09:00。
  assert.equal(computeNextRunAt(schedule({ times: ['09:00', '18:00'] }), neverWorkday, new Date(2026, 0, 15, 20, 0)).valueOf(), new Date(2026, 0, 16, 9, 0).getTime())
  // 今天 08:00：当天最近的 09:00。
  assert.equal(computeNextRunAt(schedule({ times: ['09:00', '18:00'] }), neverWorkday, new Date(2026, 0, 15, 8, 0)).valueOf(), new Date(2026, 0, 15, 9, 0).getTime())
  // workdays-only：周五 20:00 跳过周六日 → 下周一 09:00。
  assert.equal(computeNextRunAt(schedule({ times: ['09:00', '18:00'], calendarMode: 'workdays-only' }), fakeIsWorkday, new Date(2026, 0, 9, 20, 0)).valueOf(), new Date(2026, 0, 12, 9, 0).getTime())
  // once 多时间点：取当天第一个未到的点。
  assert.equal(computeNextRunAt(schedule({ kind: 'once', date: '2026-03-10', times: ['08:30', '12:00'] }), neverWorkday, new Date(2026, 0, 1, 0, 0)).valueOf(), new Date(2026, 2, 10, 8, 30).getTime())
  assert.equal(computeNextRunAt(schedule({ kind: 'once', date: '2026-03-10', times: ['08:30', '12:00'] }), neverWorkday, new Date(2026, 2, 10, 9, 0)).valueOf(), new Date(2026, 2, 10, 12, 0).getTime())
})

test('computeNextRunAt terminates on the bounded scan when no day matches', () => {
  // 永远没有工作日（模拟无数据 + 极端过滤）时有界终止，不悬挂。
  assert.equal(computeNextRunAt(schedule({ calendarMode: 'workdays-only' }), neverWorkday, new Date(2026, 11, 31, 23, 0)), undefined)
  // 跨年到无数据年度：纯星期兜底仍能在 400 天内找到工作日。
  assert.equal(computeNextRunAt(schedule({ calendarMode: 'workdays-only' }), fakeIsWorkday, new Date(2026, 11, 31, 23, 0)).valueOf(), new Date(2027, 0, 1, 9, 0).getTime())
})
