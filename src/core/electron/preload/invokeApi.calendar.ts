import { ipcRenderer } from 'electron'
import type { CalendarCheckResult, CalendarDay, DayInfo } from '../../shared/calendar'
import { IPC } from '../main/ipc'

export function createCalendarInvokeApi() {
  return {
    getCalendarDayInfo: (date: string) => ipcRenderer.invoke(IPC.CALENDAR_GET_DAY_INFO, date) as Promise<DayInfo>,

    isCalendarWorkday: (date: string) => ipcRenderer.invoke(IPC.CALENDAR_IS_WORKDAY, date) as Promise<boolean>,

    isCalendarHoliday: (date: string) => ipcRenderer.invoke(IPC.CALENDAR_IS_HOLIDAY, date) as Promise<boolean>,

    isCalendarMakeupWorkday: (date: string) => ipcRenderer.invoke(IPC.CALENDAR_IS_MAKEUP_WORKDAY, date) as Promise<boolean>,

    getUpcomingHolidays: (from: string, days: number) => ipcRenderer.invoke(IPC.CALENDAR_GET_UPCOMING_HOLIDAYS, { from, days }) as Promise<CalendarDay[]>,

    checkCalendarUpdate: (options?: { year?: number; force?: boolean }) => ipcRenderer.invoke(IPC.CALENDAR_CHECK_UPDATE, options ?? {}) as Promise<CalendarCheckResult[]>,
  }
}
