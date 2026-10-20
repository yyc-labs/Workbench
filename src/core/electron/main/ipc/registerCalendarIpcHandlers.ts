import { ipcMain } from 'electron'
import { isValidDateString } from '../calendar/calendar-data'
import { IPC } from '../ipc'
import type { RegisterIpcHandlersDependencies } from './registerIpcHandlers.shared'

function parseDate(value: unknown): string | null {
  return isValidDateString(value) ? value : null
}

function parseUpcomingRequest(value: unknown): { from: string; days: number } | null {
  if (!value || typeof value !== 'object') return null
  const request = value as { from?: unknown; days?: unknown }
  const from = parseDate(request.from)
  if (!from) return null
  if (typeof request.days !== 'number' || !Number.isFinite(request.days)) return null
  return { from, days: request.days }
}

/**
 * Calendar query IPC. 同步查询链路：handler 直接返回 CalendarService 的内存结果，
 * 不涉及网络；手动检查更新（CALENDAR_CHECK_UPDATE）由 CalendarUpdater 承接。
 */
export function registerCalendarIpcHandlers(deps: RegisterIpcHandlersDependencies): void {
  ipcMain.handle(IPC.CALENDAR_GET_DAY_INFO, (_event, payload: unknown) => {
    const date = parseDate(payload)
    if (!date) throw new Error('Invalid calendar date payload.')
    return deps.calendarService.getDayInfo(date)
  })

  ipcMain.handle(IPC.CALENDAR_IS_WORKDAY, (_event, payload: unknown) => {
    const date = parseDate(payload)
    if (!date) throw new Error('Invalid calendar date payload.')
    return deps.calendarService.isWorkday(date)
  })

  ipcMain.handle(IPC.CALENDAR_IS_HOLIDAY, (_event, payload: unknown) => {
    const date = parseDate(payload)
    if (!date) throw new Error('Invalid calendar date payload.')
    return deps.calendarService.isHoliday(date)
  })

  ipcMain.handle(IPC.CALENDAR_IS_MAKEUP_WORKDAY, (_event, payload: unknown) => {
    const date = parseDate(payload)
    if (!date) throw new Error('Invalid calendar date payload.')
    return deps.calendarService.isMakeupWorkday(date)
  })

  ipcMain.handle(IPC.CALENDAR_GET_UPCOMING_HOLIDAYS, (_event, payload: unknown) => {
    const request = parseUpcomingRequest(payload)
    if (!request) throw new Error('Invalid calendar upcoming-holidays payload.')
    return deps.calendarService.getUpcomingHolidays(request.from, request.days)
  })

  // 手动检查更新：force 跳过冷却立即检查；缺省 year = 当前年 + 下一年。
  ipcMain.handle(IPC.CALENDAR_CHECK_UPDATE, (_event, payload: unknown) => {
    const request = payload && typeof payload === 'object' ? (payload as { year?: unknown; force?: unknown }) : {}
    return deps.calendarUpdater.checkUpdates({
      ...(typeof request.year === 'number' && Number.isInteger(request.year) ? { year: request.year } : {}),
      force: request.force === true,
    })
  })
}
