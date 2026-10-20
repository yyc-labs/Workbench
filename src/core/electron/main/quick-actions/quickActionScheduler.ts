import type { QuickAction, QuickActionResult, QuickActionSchedule, QuickActionScheduleStamp } from '../../../shared/types'
import { formatLocalDate, parseLocalDate, weekdayOf } from '../calendar/calendar-data'

/**
 * 定时启动调度器（§8.1）。分钟级 tick（对齐系统分钟边界后每 60s），
 * 不引 cron/第三方依赖。
 *
 * 多时间点语义：schedule.times 中每个时间点按天独立评估——各自最多成功
 * 执行一次（runSlots 幂等），重试退避与宽限窗口互不影响；频率与日历模式
 * 是按天层判定，对所有时间点一致。
 *
 * 补跑语义（D5）：不错过即不补跑，唯一例外是启动/休眠恢复后的 5 分钟
 * 宽限窗口。重试语义（D14）：单时间点同日最多 3 次尝试，线性退避 1min/2min。
 */

export type TimerHandle = ReturnType<typeof setTimeout>

/** 执行结果通知事件；文案与 Notification 由 app-services 落地（§7.7）。 */
export type QuickActionScheduleNotifyEvent = {
  kind: 'success' | 'failed'
  actionName: string
  /** 本次触发的时间点 'HH:mm'（多时间点日程中区分是哪一条）。 */
  time: string
  error?: string
}

export type QuickActionSchedulerDeps = {
  /** service 内部 readActions（不算 shortcutState）。 */
  getScheduledActions: () => QuickAction[]
  /** 内部 silent 执行（D4：不抢焦点）。 */
  execute: (id: string) => Promise<QuickActionResult>
  /** 内部写：lastRun / runSlots / attempt / nextRetryAt / enabled。 */
  setScheduleRunStamp: (id: string, stamp: QuickActionScheduleStamp) => Promise<void>
  /** CalendarService 工作日判定（仅工作日模式）。 */
  isWorkday: (date: string) => boolean
  notify: (event: QuickActionScheduleNotifyEvent) => void
  now: () => Date
  setTimer: (fn: () => void, ms: number) => TimerHandle
  clearTimer: (handle: TimerHandle) => void
}

/** 分钟级 tick 对齐间隔（D3）。 */
const TICK_INTERVAL_MS = 60_000
/** 与上一 tick 间隔超过该值视为休眠恢复，按追赶 tick 处理（D5）。 */
const CATCHUP_GAP_MS = 90_000
/** 启动/休眠恢复后的补跑宽限窗口（D5）。 */
const GRACE_WINDOW_MS = 5 * 60_000
/** 单时间点同日最大尝试次数（D14）。 */
const MAX_DAILY_ATTEMPTS = 3

export function createQuickActionScheduler(deps: QuickActionSchedulerDeps) {
  let timer: TimerHandle | null = null
  let stopped = true
  let ticking = false
  let lastTickAt = 0
  /** 当天因宽限窗口跳过的时间点（内存按天保持；重启后时间判定天然一致）。 */
  const skippedSlots = new Set<string>()
  let skippedSlotsDate: string | null = null

  function plannedTimeMs(today: string, time: string): number {
    const [hours, minutes] = time.split(':').map(Number)
    return parseLocalDate(today).getTime() + (hours * 60 + minutes) * 60_000
  }

  function slotKey(today: string, time: string): string {
    return `${today} ${time}`
  }

  function compareTimes(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0
  }

  function matchesFrequency(schedule: QuickActionSchedule, today: string): boolean {
    switch (schedule.kind) {
      case 'once':
        return schedule.date === today
      case 'weekly': {
        const weekdays = schedule.weekdays
        // 空数组/缺省 = 每天。
        if (!weekdays || weekdays.length === 0) return true
        return weekdays.includes(weekdayOf(today))
      }
      case 'daily':
        return true
    }
  }

  /** 该时间点当天已尝试次数；跨天或切换到其他时间点自动清零。 */
  function attemptsForSlot(schedule: QuickActionSchedule, time: string, today: string): number {
    if (schedule.attemptTime !== time) return 0
    if (schedule.lastAttemptAt === undefined) return 0
    return formatLocalDate(new Date(schedule.lastAttemptAt)) === today ? (schedule.attemptCount ?? 0) : 0
  }

  /** lastRunDate 当天已成功执行的时间点；跨天视为空。 */
  function slotsRunOn(schedule: QuickActionSchedule, today: string): string[] {
    return schedule.lastRunDate === today ? (schedule.runSlots ?? []) : []
  }

  async function tick(): Promise<void> {
    const now = deps.now()
    const nowMs = now.getTime()
    // 启动后首次 tick 或与上一 tick 间隔过大（休眠恢复）按追赶 tick 处理（D5）。
    const catchUp = lastTickAt === 0 || nowMs - lastTickAt > CATCHUP_GAP_MS
    lastTickAt = nowMs
    const today = formatLocalDate(now)
    if (skippedSlotsDate !== today) {
      skippedSlots.clear()
      skippedSlotsDate = today
    }

    for (const action of deps.getScheduledActions()) {
      const schedule = action.schedule
      // action.enabled 是总开关；schedule.enabled 只控制定时。两者皆真才评估。
      if (!action.enabled || !schedule || !schedule.enabled) continue
      // 按天层判定：频率与日历模式对所有时间点一致。
      if (!matchesFrequency(schedule, today)) continue
      if (schedule.calendarMode === 'workdays-only' && !deps.isWorkday(today)) {
        console.debug(`[quick-actions] Schedule ${action.id} skipped: ${today} is not a workday.`)
        continue
      }
      const slotsToday = slotsRunOn(schedule, today)

      for (const time of schedule.times) {
        // 1. 幂等：该时间点今天已成功执行。
        if (slotsToday.includes(time)) continue
        // 2. 宽限跳过记忆：同一天内不再补触发该时间点。
        if (skippedSlots.has(slotKey(today, time))) continue
        // 3. 时间到达：当前本地 HH:mm >= 该时间点。
        const planned = plannedTimeMs(today, time)
        if (nowMs < planned) continue
        // 4. 重试判定（按时间点独立）：退避未到 / 该点当天次数耗尽。
        if (schedule.attemptTime === time && schedule.nextRetryAt !== undefined && nowMs < schedule.nextRetryAt) continue
        if (attemptsForSlot(schedule, time, today) >= MAX_DAILY_ATTEMPTS) continue
        // 5. 宽限窗口（D5）：追赶 tick 超过 5 分钟视为错过，当天不再补触发该时间点。
        if (catchUp && nowMs - planned > GRACE_WINDOW_MS) {
          skippedSlots.add(slotKey(today, time))
          console.info(`[quick-actions] Schedule ${action.id} slot ${time} missed the 5-minute grace window on ${today}; skipped for today.`)
          continue
        }
        // 6. 执行（silent 语义由 service 内部落地）。
        let result: QuickActionResult
        try {
          result = await deps.execute(action.id)
        } catch (error) {
          console.warn(`[quick-actions] Scheduled execute threw for ${action.id} (${time}):`, error)
          continue
        }
        if (result.ok) {
          const runSlots = [...slotsToday, time].sort(compareTimes)
          // once 的全部时间点都完成后消耗（禁用）。
          const consume = schedule.kind === 'once' && runSlots.length >= schedule.times.length
          await deps.setScheduleRunStamp(action.id, {
            lastRunAt: nowMs,
            lastRunDate: today,
            runSlots,
            attemptCount: 0,
            attemptTime: undefined,
            nextRetryAt: undefined,
            ...(consume ? { enabled: false } : {}),
          })
          // 同步本地视图，保证同一 tick 内后续时间点看到最新状态。
          slotsToday.push(time)
          slotsToday.sort(compareTimes)
          schedule.lastRunDate = today
          schedule.runSlots = runSlots
          schedule.attemptCount = 0
          schedule.attemptTime = undefined
          schedule.nextRetryAt = undefined
          deps.notify({ kind: 'success', actionName: action.name, time })
        } else {
          const attemptCount = attemptsForSlot(schedule, time, today) + 1
          const nextRetryAt = nowMs + attemptCount * 60_000
          // 失败不写 runSlots/lastRunDate（该时间点保持未成功状态，后续时刻可重试）。
          await deps.setScheduleRunStamp(action.id, { lastAttemptAt: nowMs, attemptTime: time, attemptCount, nextRetryAt })
          schedule.lastAttemptAt = nowMs
          schedule.attemptTime = time
          schedule.attemptCount = attemptCount
          schedule.nextRetryAt = nextRetryAt
          if (attemptCount >= MAX_DAILY_ATTEMPTS) {
            deps.notify({ kind: 'failed', actionName: action.name, time, error: result.error ?? result.code })
          } else {
            console.warn(`[quick-actions] Scheduled run failed for ${action.id} (${time}, attempt ${attemptCount}/${MAX_DAILY_ATTEMPTS}):`, result.error ?? result.code)
          }
        }
      }
    }
  }

  function scheduleNextTick(): void {
    if (stopped) return
    const now = deps.now()
    // 对齐到下一分钟边界，分钟级语义下执行耗时可容忍。
    const delay = TICK_INTERVAL_MS - (now.getSeconds() * 1_000 + now.getMilliseconds())
    timer = deps.setTimer(
      () => {
        void runTick()
      },
      Math.max(delay, 1_000),
    )
  }

  async function runTick(): Promise<void> {
    if (stopped || ticking) return
    ticking = true
    try {
      await tick()
    } catch (error) {
      console.warn('[quick-actions] Scheduler tick failed:', error)
    } finally {
      ticking = false
    }
    scheduleNextTick()
  }

  return {
    /** 立即评估一次 + 对齐下一分钟边界起每 60s tick。 */
    start(): void {
      if (!stopped) return
      stopped = false
      lastTickAt = 0
      void runTick()
    },
    stop(): void {
      stopped = true
      if (timer !== null) {
        deps.clearTimer(timer)
        timer = null
      }
    },
  }
}

export type QuickActionScheduler = ReturnType<typeof createQuickActionScheduler>
