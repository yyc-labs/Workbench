import type { QuickActionSchedule } from '../../../../shared/types'
import type { TranslateFn } from '../../../lib/quickActionFeedback'

// ── Schedule summary（定时启动徽标与备注，纯函数可测） ──────────────

/** 星期（0=周日）→ i18n 标签键；表单勾选组与徽标列表共用。 */
export const WEEKDAY_LABEL_KEYS: Record<number, string> = {
  0: 'quickActions.schedule.weekdays.sun',
  1: 'quickActions.schedule.weekdays.mon',
  2: 'quickActions.schedule.weekdays.tue',
  3: 'quickActions.schedule.weekdays.wed',
  4: 'quickActions.schedule.weekdays.thu',
  5: 'quickActions.schedule.weekdays.fri',
  6: 'quickActions.schedule.weekdays.sat',
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function formatDateString(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function formatTimeString(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** 本地日历日差（不受时刻影响）。 */
function dayDiff(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b - a) / 86_400_000)
}

/** 时间点列表展示：'09:00、18:00'（去重升序；分隔符走 i18n，中英分别为 '、' / ', '）。 */
function formatTimes(t: TranslateFn, times: readonly string[]): string {
  return Array.from(new Set(times))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .join(t('quickActions.schedule.timeJoin'))
}

function describeWhen(t: TranslateFn, target: Date, now: Date): string {
  const time = formatTimeString(target)
  const diff = dayDiff(now, target)
  if (diff === 0) return t('quickActions.schedule.whenToday', { time })
  if (diff === 1) return t('quickActions.schedule.whenTomorrow', { time })
  if (diff === -1) return t('quickActions.schedule.whenYesterday', { time })
  const date = target.getFullYear() === now.getFullYear() ? formatDateString(target).slice(5) : formatDateString(target)
  return t('quickActions.schedule.whenDate', { date, time })
}

/**
 * 定时徽标：每天 09:00 · 仅工作日 / 每周一、三 09:00 / 2026-11-05 09:00（一次性）。
 * schedule 缺省或未启用时返回 null。
 */
export function describeQuickActionScheduleBadge(t: TranslateFn, schedule: QuickActionSchedule | undefined): string | null {
  if (!schedule || !schedule.enabled) return null
  const workdaysSuffix = schedule.calendarMode === 'workdays-only' ? ` · ${t('quickActions.schedule.badgeWorkdaysOnly')}` : ''
  const times = formatTimes(t, schedule.times)
  switch (schedule.kind) {
    case 'once':
      return schedule.date ? `${schedule.date} ${times}${workdaysSuffix}` : `${times}${workdaysSuffix}`
    case 'weekly': {
      const weekdays = schedule.weekdays ?? []
      const list = Array.from(new Set(weekdays))
        .sort((a, b) => a - b)
        .map((day) => t(WEEKDAY_LABEL_KEYS[day] ?? WEEKDAY_LABEL_KEYS[0]))
        .join(t('quickActions.schedule.weekdayJoin'))
      const badge = list ? t('quickActions.schedule.badgeWeekly', { weekdays: list, time: times }) : t('quickActions.schedule.badgeEveryDay', { time: times })
      return `${badge}${workdaysSuffix}`
    }
    case 'daily':
      return `${t('quickActions.schedule.badgeEveryDay', { time: times })}${workdaysSuffix}`
  }
}

/** 下次运行相对时间（「下次 明天 09:00」）；nextRunAt 缺省返回 null。 */
export function describeQuickActionNextRun(t: TranslateFn, nextRunAt: number | undefined, now: Date): string | null {
  if (nextRunAt === undefined || !Number.isFinite(nextRunAt)) return null
  return t('quickActions.schedule.nextRun', { when: describeWhen(t, new Date(nextRunAt), now) })
}

/** 上次执行相对时间；lastRunAt 缺省返回 null。 */
export function describeQuickActionLastRun(t: TranslateFn, lastRunAt: number | undefined, now: Date): string | null {
  if (lastRunAt === undefined || !Number.isFinite(lastRunAt)) return null
  return t('quickActions.schedule.lastRun', { when: describeWhen(t, new Date(lastRunAt), now) })
}

/** 今天已失败 N 次弱提示；count <= 0 返回 null。 */
export function describeQuickActionFailedToday(t: TranslateFn, count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null
  return t('quickActions.schedule.failedToday', { count })
}

/** 卡片定时备注：下次 / 上次执行 / 今天已失败 N 次，' · ' 连接；无内容返回 null。 */
export function describeQuickActionScheduleNotes(t: TranslateFn, schedule: QuickActionSchedule | undefined, scheduleNextRunAt: number | undefined, now: Date): string | null {
  if (!schedule) return null
  const parts: string[] = []
  const nextRun = schedule.enabled ? describeQuickActionNextRun(t, scheduleNextRunAt, now) : null
  if (nextRun) parts.push(nextRun)
  const lastRun = describeQuickActionLastRun(t, schedule.lastRunAt, now)
  if (lastRun) parts.push(lastRun)
  const failed = describeQuickActionFailedToday(t, schedule.attemptCount ?? 0)
  if (failed) parts.push(failed)
  return parts.length > 0 ? parts.join(' · ') : null
}
