import { createHash } from 'node:crypto'
import type { CalendarDay, CalendarRegion, YearCalendar } from '../../../shared/calendar'
import type { QuickActionSchedule } from '../../../shared/types'

/**
 * Calendar pure functions: normalization, upstream mapping, content hashing,
 * local-date helpers and next-run computation. No electron or fs dependencies —
 * everything I/O related lives in calendar-service.ts / calendar-updater.ts.
 */

export const CALENDAR_SCHEMA_VERSION = 1

const CALENDAR_REGIONS: readonly CalendarRegion[] = ['CN']
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/
/** computeNextRunAt 向前有界扫描上限（天），防止无数据年度无限循环。 */
const NEXT_RUN_SCAN_LIMIT_DAYS = 400

/** Valid 'YYYY-MM-DD' local date string with a real calendar day. */
export function isValidDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (month < 1 || month > 12 || day < 1) return false
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day <= daysInMonth
}

/** Valid local 'HH:mm' time string (24h). */
export function isValidTimeString(value: unknown): value is string {
  return typeof value === 'string' && TIME_PATTERN.test(value)
}

/** 'HH:mm' → minutes since midnight; null when invalid. */
export function parseTimeMinutes(value: unknown): number | null {
  if (!isValidTimeString(value)) return null
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

/** Local-timezone 'YYYY-MM-DD' (D6: storage and comparison are local-date strings). */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 'YYYY-MM-DD' → local midnight Date. */
export function parseLocalDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/**
 * Weekday 0=Sunday..6=Saturday, parsed via UTC so the pure date string is not
 * affected by local timezone or time-of-day (D6).
 */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

function yearOf(date: string): number {
  return Number(date.slice(0, 4))
}

function compareByDate(a: CalendarDay, b: CalendarDay): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : 0
}

function normalizeDay(value: unknown, year: number): CalendarDay | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (!isValidDateString(raw.date)) return null
  if (yearOf(raw.date) !== year) return null
  if (typeof raw.name !== 'string' || !raw.name.trim()) return null
  if (raw.type !== 'holiday' && raw.type !== 'makeup_workday') return null
  const day: CalendarDay = { date: raw.date, name: raw.name.trim(), type: raw.type }
  if (typeof raw.isStatutory === 'boolean') day.isStatutory = raw.isStatutory
  return day
}

/**
 * Normalizes a year calendar payload. Returns null when the shape is unusable
 * (schemaVersion / region / year mismatch); invalid day entries are dropped.
 * expectedYear rejects files whose declared year differs from the file name.
 */
export function normalizeYearCalendar(value: unknown, expectedYear?: number): YearCalendar | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (raw.schemaVersion !== CALENDAR_SCHEMA_VERSION) return null
  if (typeof raw.region !== 'string' || !CALENDAR_REGIONS.includes(raw.region as CalendarRegion)) return null
  const region = raw.region as CalendarRegion
  if (typeof raw.year !== 'number' || !Number.isInteger(raw.year) || raw.year < 2000 || raw.year > 2100) return null
  const year = raw.year
  if (expectedYear !== undefined && expectedYear !== year) return null
  if (!Array.isArray(raw.days)) return null
  const days: CalendarDay[] = []
  for (const entry of raw.days) {
    const day = normalizeDay(entry, year)
    if (day) days.push(day)
  }
  days.sort(compareByDate)
  return {
    schemaVersion: CALENDAR_SCHEMA_VERSION,
    year,
    region,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    sourceUrl: typeof raw.sourceUrl === 'string' ? raw.sourceUrl : '',
    officialNoticeUrl: typeof raw.officialNoticeUrl === 'string' ? raw.officialNoticeUrl : '',
    days,
  }
}

/** JSON.parse + normalize; null on parse failure or invalid shape. */
export function parseYearCalendarJson(text: string, expectedYear?: number): YearCalendar | null {
  try {
    return normalizeYearCalendar(JSON.parse(text), expectedYear)
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** Upstream entry value "EnglishName,中文名,ID" → the Chinese name. */
function parseUpstreamName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const separator = value.indexOf(',')
  if (separator < 0) return null
  const rest = value.slice(separator + 1)
  const nextSeparator = rest.indexOf(',')
  const name = (nextSeparator < 0 ? rest : rest.slice(0, nextSeparator)).trim()
  return name || null
}

/**
 * Maps the upstream chinese-days year payload (holidays / workdays /
 * inLieuDays objects keyed by date) to CalendarDay[]:
 * - holidays → holiday (inLieuDays are already covered by holidays);
 * - workdays → makeup_workday with name + '调休'.
 * isStatutory is never inferred upstream (D12); built-in人工标注 is preserved.
 */
export function mapUpstreamYear(raw: unknown, year: number): CalendarDay[] {
  const source = asRecord(raw)
  const days: CalendarDay[] = []
  for (const [date, value] of Object.entries(asRecord(source.holidays))) {
    const name = parseUpstreamName(value)
    if (!name || !isValidDateString(date) || yearOf(date) !== year) continue
    days.push({ date, name, type: 'holiday' })
  }
  for (const [date, value] of Object.entries(asRecord(source.workdays))) {
    const name = parseUpstreamName(value)
    if (!name || !isValidDateString(date) || yearOf(date) !== year) continue
    days.push({ date, name: `${name}调休`, type: 'makeup_workday' })
  }
  days.sort(compareByDate)
  return days
}

/**
 * sha256 over the normalized date/name/type semantic core (D12): isStatutory is
 * a display annotation and never changes the hash; entries are sorted so the
 * digest is stable regardless of input order.
 */
export function computeYearContentHash(days: readonly CalendarDay[]): string {
  const payload = days
    .map((day) => ({ date: day.date, name: day.name, type: day.type }))
    .sort(compareByDate)
    .map((day) => `${day.date}|${day.name}|${day.type}`)
    .join('\n')
  return createHash('sha256').update(payload, 'utf8').digest('hex')
}

function localTimeMs(date: string, minutes: number): number {
  return parseLocalDate(date).getTime() + minutes * 60_000
}

function startOfLocalDay(from: Date): Date {
  return new Date(from.getFullYear(), from.getMonth(), from.getDate())
}

function addLocalDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function matchesWeekday(schedule: QuickActionSchedule, weekday: number): boolean {
  const weekdays = schedule.weekdays
  if (!weekdays || weekdays.length === 0) return true
  return weekdays.includes(weekday)
}

function calendarAllows(schedule: QuickActionSchedule, isWorkday: (date: string) => boolean, date: string): boolean {
  return schedule.calendarMode !== 'workdays-only' || isWorkday(date)
}

/** 规范化时间点列表：过滤非法、去重、升序（normalize 已保证，这里防御性再过滤）。 */
function sortedScheduleTimes(times: readonly string[] | undefined): string[] {
  if (!times) return []
  return Array.from(new Set(times.filter((time) => parseTimeMinutes(time) !== null))).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/** 某日期上第一个不早于 fromMs 的时间点（times 需已升序）。 */
function earliestTimeOn(date: string, times: readonly string[], fromMs: number): number | undefined {
  for (const time of times) {
    const minutes = parseTimeMinutes(time)
    if (minutes === null) continue
    const at = localTimeMs(date, minutes)
    if (at >= fromMs) return at
  }
  return undefined
}

/**
 * Next run timestamp (ms) for a schedule, or undefined when there is none
 * (once already past / no weekday match within the bounded scan). Multiple
 * time points are supported: the earliest upcoming slot across the bounded
 * day scan wins. Forwards at most NEXT_RUN_SCAN_LIMIT_DAYS so missing year
 * data always terminates.
 */
export function computeNextRunAt(schedule: QuickActionSchedule, isWorkday: (date: string) => boolean, from: Date): number | undefined {
  if (!schedule.enabled) return undefined
  const times = sortedScheduleTimes(schedule.times)
  if (times.length === 0) return undefined
  const fromMs = from.getTime()

  if (schedule.kind === 'once') {
    if (!schedule.date || !isValidDateString(schedule.date)) return undefined
    return earliestTimeOn(schedule.date, times, fromMs)
  }

  let cursor = startOfLocalDay(from)
  for (let index = 0; index <= NEXT_RUN_SCAN_LIMIT_DAYS; index++) {
    const date = formatLocalDate(cursor)
    const dayMatches = schedule.kind === 'daily' || matchesWeekday(schedule, weekdayOf(date))
    if (dayMatches && calendarAllows(schedule, isWorkday, date)) {
      const at = earliestTimeOn(date, times, fromMs)
      if (at !== undefined) return at
    }
    cursor = addLocalDays(cursor, 1)
  }
  return undefined
}
