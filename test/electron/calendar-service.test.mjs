import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { createCalendarService, readBuiltinYearCalendar } = loadTsModule('src/core/electron/main/calendar/calendar-service.ts')

const FIXED_NOW = new Date(2026, 0, 15, 12, 0, 0)

function setup() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'workbench-calendar-'))
  const service = createCalendarService({
    getUserDataDir: () => userDataDir,
    now: () => FIXED_NOW,
    readBuiltin: readBuiltinYearCalendar,
  })
  return {
    service,
    userDataDir,
    writeUserYear(year, text) {
      const dir = join(userDataDir, 'calendar', 'CN')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, String(year) + '.json'), text)
    },
    cleanup() {
      rmSync(userDataDir, { recursive: true, force: true })
    },
  }
}

test('getDayInfo covers the five branches of the builtin 2026 data', () => {
  const { service, cleanup } = setup()
  // 元旦法定日。
  assert.deepEqual(service.getDayInfo('2026-01-01'), { date: '2026-01-01', name: '元旦', type: 'holiday', isStatutory: true })
  // 春节连休中的周六（D1：假期中的周末归属节日名）。
  assert.deepEqual(service.getDayInfo('2026-02-21'), { date: '2026-02-21', name: '春节', type: 'holiday', isStatutory: false })
  // 补班周日。
  assert.deepEqual(service.getDayInfo('2026-01-04'), { date: '2026-01-04', name: '元旦调休', type: 'makeup_workday', isStatutory: false })
  // 普通周末（2026-03-07 是周六，不在任何假期内）。
  assert.deepEqual(service.getDayInfo('2026-03-07'), { date: '2026-03-07', name: '周末', type: 'weekend', isStatutory: false })
  // 普通工作日（2026-03-09 是周一）。
  assert.deepEqual(service.getDayInfo('2026-03-09'), { date: '2026-03-09', name: '工作日', type: 'workday', isStatutory: false })
  cleanup()
})

test('isWorkday applies makeup-workday semantics (2026-01-04 Sunday is a workday)', () => {
  const { service, cleanup } = setup()
  assert.equal(service.isWorkday('2026-01-04'), true)
  assert.equal(service.isWorkday('2026-01-01'), false)
  assert.equal(service.isWorkday('2026-05-01'), false)
  assert.equal(service.isWorkday('2026-03-07'), false)
  assert.equal(service.isWorkday('2026-03-09'), true)
  assert.equal(service.isHoliday('2026-10-01'), true)
  assert.equal(service.isHoliday('2026-03-07'), false)
  assert.equal(service.isMakeupWorkday('2026-05-09'), true)
  assert.equal(service.isMakeupWorkday('2026-05-01'), false)
  cleanup()
})

test('years without data degrade to pure weekday judgment', () => {
  const { service, cleanup } = setup()
  // 2027-01-01 是周五，2027-01-02 是周六；无数据年度不报错。
  assert.equal(service.hasYearData(2027), false)
  assert.equal(service.hasYearData(2026), true)
  assert.equal(service.getDayInfo('2027-01-01').type, 'workday')
  assert.equal(service.getDayInfo('2027-01-02').type, 'weekend')
  // 非法日期串不抛错，降级为工作日。
  assert.equal(service.getDayInfo('not-a-date').type, 'workday')
  cleanup()
})

test('user-directory data overrides the builtin calendar', () => {
  const { service, writeUserYear, cleanup } = setup()
  writeUserYear(
    2026,
    JSON.stringify({
      schemaVersion: 1,
      year: 2026,
      region: 'CN',
      updatedAt: '2026-01-01',
      sourceUrl: 'https://example.com/2026.json',
      officialNoticeUrl: 'https://example.com/notice',
      days: [
        { date: '2026-01-01', name: '元旦', type: 'holiday', isStatutory: true },
        { date: '2026-03-09', name: '公司年假', type: 'holiday' },
      ],
    }),
  )
  // 用户目录文件整年覆盖内置数据（D10：远端缓存语义，不做条目合并）。
  assert.equal(service.getDayInfo('2026-03-09').type, 'holiday')
  assert.equal(service.getDayInfo('2026-03-09').name, '公司年假')
  assert.equal(service.getDayInfo('2026-01-01').type, 'holiday')
  // 未声明的日期回落纯星期判断。
  assert.equal(service.getDayInfo('2026-02-21').type, 'weekend')
  cleanup()
})

test('corrupt user files fall back to the builtin calendar', () => {
  const { service, writeUserYear, cleanup } = setup()
  writeUserYear(2026, 'not json at all {{{')
  assert.equal(service.getDayInfo('2026-01-01').type, 'holiday')
  writeUserYear(2026, JSON.stringify({ schemaVersion: 1, year: 2025, region: 'CN', days: [] }))
  assert.equal(service.getDayInfo('2026-01-01').type, 'holiday')
  cleanup()
})

test('getUpcomingHolidays returns holiday entries inside the window', () => {
  const { service, cleanup } = setup()
  const midAutumn = service.getUpcomingHolidays('2026-09-24', 5)
  assert.deepEqual(
    midAutumn.map((day) => day.date),
    ['2026-09-25', '2026-09-26', '2026-09-27'],
  )
  assert.equal(midAutumn[0].name, '中秋')
  // 国庆 7 天全覆盖，且不含窗口外的中秋。
  const national = service.getUpcomingHolidays('2026-10-01', 7)
  assert.equal(national.length, 7)
  assert.equal(national[0].date, '2026-10-01')
  // 边界：零/负窗口与非法起点返回空。
  assert.deepEqual(service.getUpcomingHolidays('2026-10-01', 0), [])
  assert.deepEqual(service.getUpcomingHolidays('2026-10-01', -3), [])
  assert.deepEqual(service.getUpcomingHolidays('garbage', 10), [])
  cleanup()
})

test('reload refreshes the cache after the updater replaces the file', () => {
  const { service, writeUserYear, cleanup } = setup()
  // 先查询一次，把内置数据写入进程内缓存。
  assert.equal(service.getDayInfo('2026-03-09').type, 'workday')
  writeUserYear(
    2026,
    JSON.stringify({
      schemaVersion: 1,
      year: 2026,
      region: 'CN',
      days: [{ date: '2026-03-09', name: '公司年假', type: 'holiday' }],
    }),
  )
  // 未 reload 前仍是缓存中的旧数据。
  assert.equal(service.getDayInfo('2026-03-09').type, 'workday')
  service.reload()
  assert.equal(service.getDayInfo('2026-03-09').type, 'holiday')
  cleanup()
})
