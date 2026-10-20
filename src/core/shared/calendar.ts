/**
 * Calendar domain shared contract (main / preload / renderer).
 *
 * 节假日与调休识别的统一数据模型：只存储特殊日期（holiday / makeup_workday），
 * 普通工作日/周末按星期推算（D1）。跨进程类型与 IPC 契约复用本文件，
 * 与 shared/runTasks.ts 同模式。
 */

export type CalendarRegion = 'CN'

export type CalendarDayType = 'holiday' | 'makeup_workday'

export interface CalendarDay {
  /** 'YYYY-MM-DD' 本地日期串（D6：全链路只传本地日期串）。 */
  date: string
  /** 特殊日名称，如 '元旦' / '春节' / '元旦调休'。 */
  name: string
  type: CalendarDayType
  /** 法定节假日当天；仅展示注解，不参与任何判定逻辑（D12）。 */
  isStatutory?: boolean
}

export interface YearCalendar {
  schemaVersion: number
  year: number
  region: CalendarRegion
  /** 'YYYY-MM-DD'，数据版本追踪。 */
  updatedAt: string
  /** 上游数据地址（CDN/上游 JSON）。 */
  sourceUrl: string
  /** 官方公告来源原文链接（可追溯到具体年份通知）。 */
  officialNoticeUrl: string
  days: CalendarDay[]
}

/** getDayInfo 的统一返回：节假日/调休/周末/工作日四态。 */
export type DayType = 'holiday' | 'makeup_workday' | 'weekend' | 'workday'

export interface DayInfo {
  date: string
  /** 特殊日取数据名；普通日 '周末' / '工作日'。 */
  name: string
  type: DayType
  isStatutory: boolean
}

/** CalendarUpdater 单年度检查结果（IPC checkCalendarUpdate 返回）。 */
export type CalendarCheckOutcome =
  /** 数据有变化，已原子替换并刷新缓存 */
  | 'applied'
  /** 校验通过但内容哈希一致，未写文件 */
  | 'unchanged'
  /** 404，目标年度未公布 */
  | 'not-found'
  /** 上游数据映射/校验失败 */
  | 'invalid'
  /** 网络错误/超时/写盘失败 */
  | 'error'
  /** 冷却期内，零网络请求 */
  | 'skipped'

/** checkCalendarUpdate 的单项结果。 */
export interface CalendarCheckResult {
  year: number
  outcome: CalendarCheckOutcome
}
