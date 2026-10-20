import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CalendarDay, DayInfo, YearCalendar } from '../../../shared/calendar'
import { formatLocalDate, isValidDateString, normalizeYearCalendar, parseYearCalendarJson, weekdayOf } from './calendar-data'
import builtin2026 from './data/CN/2026.json'

/**
 * CalendarService: the single synchronous query entry for holiday / makeup
 * workday recognition.
 *
 * 边界原则：只做同步查询、内存缓存、数据校验与内置回退；不依赖网络、不知道
 * CalendarUpdater 的存在。查询链路在任何网络状态下行为一致。
 *
 * 加载优先级：<userData>/calendar/CN/<year>.json 覆盖内置 data/CN/<year>.json；
 * 用户文件解析/校验失败 → 回落内置；内置也没有 → null（纯星期模式）。
 */

const BUILTIN_YEAR_CALENDARS: readonly YearCalendar[] = (() => {
  const calendar = normalizeYearCalendar(builtin2026, 2026)
  return calendar ? [calendar] : []
})()

/** Bundled year calendars, normalized once at module load. */
export function readBuiltinYearCalendar(year: number): YearCalendar | null {
  return BUILTIN_YEAR_CALENDARS.find((calendar) => calendar.year === year) ?? null
}

export type CalendarServiceDeps = {
  getUserDataDir: () => string
  /** Injected clock (tests use a fixed date); reserved for cache policies. */
  now: () => Date
  /** Built-in year lookup table (imported JSON); injected for tests. */
  readBuiltin: (year: number) => YearCalendar | null
}

export function createCalendarService(deps: CalendarServiceDeps) {
  /** year → date → CalendarDay; lazily loaded, process-lifetime cache. */
  const yearMaps = new Map<number, Map<string, CalendarDay>>()

  function userYearFile(year: number): string {
    return join(deps.getUserDataDir(), 'calendar', 'CN', String(year) + '.json')
  }

  /** User-directory cache; any parse/validation failure falls back to builtin. */
  function loadUserYear(year: number): YearCalendar | null {
    const file = userYearFile(year)
    if (!existsSync(file)) return null
    try {
      const calendar = parseYearCalendarJson(readFileSync(file, 'utf8'), year)
      if (!calendar || calendar.year !== year) return null
      return calendar
    } catch (error) {
      console.warn('[calendar] Ignoring invalid user year file for ' + year + ':', error)
      return null
    }
  }

  function loadYear(year: number): YearCalendar | null {
    return loadUserYear(year) ?? deps.readBuiltin(year)
  }

  function daysForYear(year: number): Map<string, CalendarDay> | null {
    const cached = yearMaps.get(year)
    if (cached) return cached
    const calendar = loadYear(year)
    if (!calendar) return null
    const map = new Map<string, CalendarDay>()
    for (const day of calendar.days) map.set(day.date, day)
    yearMaps.set(year, map)
    return map
  }

  /** 节假日/调休/周末/工作日四态查询；无数据年度降级为纯星期判断。 */
  function getDayInfo(date: string): DayInfo {
    if (!isValidDateString(date)) {
      return { date, name: '工作日', type: 'workday', isStatutory: false }
    }
    const day = daysForYear(Number(date.slice(0, 4)))?.get(date)
    if (day) {
      return { date, name: day.name, type: day.type, isStatutory: day.isStatutory === true }
    }
    const weekday = weekdayOf(date)
    const weekend = weekday === 0 || weekday === 6
    return { date, name: weekend ? '周末' : '工作日', type: weekend ? 'weekend' : 'workday', isStatutory: false }
  }

  /** 向前 days 天内的 holiday 条目（含假期中的普通周末，D1）。 */
  function getUpcomingHolidays(from: string, days: number): CalendarDay[] {
    if (!isValidDateString(from) || !Number.isFinite(days) || days <= 0) return []
    const limit = Math.min(Math.floor(days), 730)
    const result: CalendarDay[] = []
    let cursor = new Date(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)))
    for (let index = 0; index < limit; index++) {
      const date = formatLocalDate(cursor)
      const day = daysForYear(Number(date.slice(0, 4)))?.get(date)
      if (day && day.type === 'holiday') result.push({ ...day })
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)
    }
    return result
  }

  return {
    getDayInfo,
    /** 特殊日 makeup_workday → true；holiday → false；其余按星期（周一~五 true）。 */
    isWorkday(date: string): boolean {
      const type = getDayInfo(date).type
      return type === 'workday' || type === 'makeup_workday'
    },
    isHoliday(date: string): boolean {
      return getDayInfo(date).type === 'holiday'
    },
    isMakeupWorkday(date: string): boolean {
      return getDayInfo(date).type === 'makeup_workday'
    },
    getUpcomingHolidays,
    /** 生效年度数据（用户目录优先、回落内置）；供 Updater 做哈希比较。 */
    getYearCalendar(year: number): YearCalendar | null {
      return loadYear(year)
    },
    hasYearData(year: number): boolean {
      return daysForYear(year) !== null
    },
    /** Updater 原子替换落盘后调用：清空缓存，下次查询重新加载。 */
    reload(): void {
      yearMaps.clear()
    },
  }
}

export type CalendarService = ReturnType<typeof createCalendarService>
