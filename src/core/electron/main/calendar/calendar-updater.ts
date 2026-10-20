import { join } from 'node:path'
import type { CalendarCheckOutcome, CalendarCheckResult, CalendarDay } from '../../../shared/calendar'
import { computeYearContentHash, mapUpstreamYear, normalizeYearCalendar } from './calendar-data'

/**
 * CalendarUpdater v1（§7）：低频检查、下载、上游格式映射、校验、哈希比较、
 * 原子替换、刷新 CalendarService 缓存、维护限频状态。
 *
 * 边界：不参与日期查询；失败（超时/404/校验失败/写盘失败）不影响
 * CalendarService 与调度器，仅记录状态并按退避安排下次。
 * 上游固定为 chinese-days CDN 按年 JSON，地址由常量拼接，无用户输入注入面。
 */

/** 上游固定地址（CDN 按年 JSON）；year 为 number，拼接后只访问该 HTTPS 地址。 */
const UPSTREAM_BASE = 'https://cdn.jsdelivr.net/npm/chinese-days/dist/years'

const DAY_MS = 24 * 60 * 60 * 1_000
/** 频率档位（§7.3，维护者确认）。 */
const NEXT_CHECK_SUCCESS_MS = 30 * DAY_MS
const NEXT_CHECK_NOT_FOUND_MS = 14 * DAY_MS
const NEXT_CHECK_FAILURE_MS = 7 * DAY_MS
const NEXT_CHECK_FAILURE_MAX_MS = 14 * DAY_MS
/** consecutiveFailures 达到该值后失败档拉长为 14 天。 */
const FAILURE_BACKOFF_THRESHOLD = 3

const STATE_SCHEMA_VERSION = 1

export type TimerHandle = ReturnType<typeof setTimeout>

type YearUpdateState = {
  /** 最后一次完成检查（无论成败）的时间，诊断用。 */
  lastCheckedAt: number
  lastSuccessAt?: number
  /** 低频核心：早于该时间不允许联网（手动 force 除外）。 */
  nextCheckAt: number
  /** 上次应用的规范化内容哈希，判断数据是否真变（D12）。 */
  lastKnownHash?: string
  /** 连续网络/校验失败次数，用于退避。 */
  consecutiveFailures: number
}

type UpdateState = {
  schemaVersion: number
  years: Record<string, YearUpdateState>
}

export type CalendarUpdaterDeps = {
  /** <userData>/calendar/update-state.json */
  getStatePath: () => string
  /** <userData>/calendar/CN */
  getCacheDir: () => string
  now: () => Date
  /** 注入 HTTP：固定 URL、超时、响应体上限由 app-services 内的实现封装（§7.5）。 */
  fetchYear: (url: string) => Promise<{ status: number; text: string }>
  readTextFile: (path: string) => Promise<string | null>
  /** 同目录 tmp + rename 原子替换；失败保留旧文件。 */
  writeFileAtomic: (path: string, text: string) => Promise<void>
  /** 本地生效年度数据（用户目录优先、内置回退），用于哈希比较判断是否真变化。 */
  getLocalYearDays: (year: number) => CalendarDay[] | null
  /** 原子替换落盘后刷新 CalendarService 缓存。 */
  onYearApplied: (year: number) => void
  setTimer: (fn: () => void, ms: number) => TimerHandle
  clearTimer: (handle: TimerHandle) => void
  log?: (message: string, error?: unknown) => void
}

function emptyState(): UpdateState {
  return { schemaVersion: STATE_SCHEMA_VERSION, years: {} }
}

function yearEntry(state: UpdateState, year: number): YearUpdateState {
  return state.years[String(year)] ?? { lastCheckedAt: 0, nextCheckAt: 0, consecutiveFailures: 0 }
}

export function createCalendarUpdater(deps: CalendarUpdaterDeps) {
  const log = deps.log ?? ((message: string, error?: unknown) => console.warn(`[calendar-updater] ${message}`, error))
  /** 进程内状态缓存；所有写路径同时落盘，退出不丢状态。 */
  let stateCache: UpdateState | null = null
  let timer: TimerHandle | null = null
  let stopped = false

  /** 状态文件损坏 → 视为无状态（nextCheckAt = 0，允许立即检查一次）。 */
  async function readState(): Promise<UpdateState> {
    if (stateCache) return stateCache
    let text: string | null = null
    try {
      text = await deps.readTextFile(deps.getStatePath())
    } catch (error) {
      log('Failed to read update state; treating as empty.', error)
      stateCache = emptyState()
      return stateCache
    }
    if (text) {
      try {
        const parsed = JSON.parse(text) as UpdateState
        if (parsed && typeof parsed === 'object' && parsed.schemaVersion === STATE_SCHEMA_VERSION && parsed.years && typeof parsed.years === 'object') {
          stateCache = { schemaVersion: STATE_SCHEMA_VERSION, years: parsed.years }
        }
      } catch {
        // 损坏：落入空状态，下次检查后写回正常冷却。
      }
    }
    if (!stateCache) stateCache = emptyState()
    return stateCache
  }

  async function writeState(): Promise<void> {
    if (!stateCache) return
    try {
      await deps.writeFileAtomic(deps.getStatePath(), JSON.stringify(stateCache, null, 2))
    } catch (error) {
      log('Failed to persist update state.', error)
    }
  }

  /** 目标年度 = 当前年 + 下一年；过去的年份不检查（历史数据固定）。 */
  function targetYears(): number[] {
    const year = deps.now().getFullYear()
    return [year, year + 1]
  }

  function applySuccess(state: UpdateState, year: number, hash: string): void {
    const nowMs = deps.now().getTime()
    state.years[String(year)] = {
      lastCheckedAt: nowMs,
      lastSuccessAt: nowMs,
      nextCheckAt: nowMs + NEXT_CHECK_SUCCESS_MS,
      lastKnownHash: hash,
      consecutiveFailures: 0,
    }
  }

  /**
   * 失败路径统一：保留现有数据与缓存不动；lastCheckedAt 更新；
   * 按 §7.3 档位写 nextCheckAt 与 consecutiveFailures（404 不计入 failures）。
   */
  async function recordFailure(state: UpdateState, year: number, outcome: 'error' | 'invalid' | 'not-found', error?: unknown): Promise<CalendarCheckOutcome> {
    const current = yearEntry(state, year)
    const nowMs = deps.now().getTime()
    const next: YearUpdateState = {
      lastCheckedAt: nowMs,
      nextCheckAt: nowMs + NEXT_CHECK_FAILURE_MS,
      consecutiveFailures: current.consecutiveFailures,
    }
    if (outcome === 'not-found') {
      // 目标年度未公布：14 天档，不计入连续失败。
      next.nextCheckAt = nowMs + NEXT_CHECK_NOT_FOUND_MS
    } else {
      const failures = current.consecutiveFailures + 1
      next.consecutiveFailures = failures
      next.nextCheckAt = nowMs + (failures >= FAILURE_BACKOFF_THRESHOLD ? NEXT_CHECK_FAILURE_MAX_MS : NEXT_CHECK_FAILURE_MS)
    }
    if (current.lastSuccessAt !== undefined) next.lastSuccessAt = current.lastSuccessAt
    if (current.lastKnownHash !== undefined) next.lastKnownHash = current.lastKnownHash
    state.years[String(year)] = next
    await writeState()
    if (outcome === 'not-found') log(`Year ${year} is not published yet (404); next check in 14 days.`)
    else log(`Year ${year} check failed (${outcome}); backing off.`, error)
    return outcome
  }

  /**
   * 五步更新事务（§7.5，严格顺序）：
   * 1 冷却判定 → 2 获取 → 3 校验并转换 → 4 哈希比较 → 5 原子替换 + 刷新。
   * 任何一步失败：保留现有数据、记录失败、按退避安排下次。
   */
  async function checkYear(year: number, force: boolean): Promise<CalendarCheckOutcome> {
    const state = await readState()
    const current = yearEntry(state, year)
    const nowMs = deps.now().getTime()
    // 1. 冷却判定（定时器提前唤醒也必须重新校验该条件）。
    if (!force && nowMs < current.nextCheckAt) return 'skipped'

    // 2. 获取（固定 URL；超时/非 2xx/响应体超限 → error，404 单列 not-found）。
    const url = `${UPSTREAM_BASE}/${year}.json`
    let response: { status: number; text: string }
    try {
      response = await deps.fetchYear(url)
    } catch (error) {
      return recordFailure(state, year, 'error', error)
    }
    if (response.status === 404) return recordFailure(state, year, 'not-found')
    if (response.status < 200 || response.status >= 300) {
      return recordFailure(state, year, 'error', new Error(`Upstream responded with status ${response.status}.`))
    }

    // 3. 校验并转换：上游三段结构 → CalendarDay[]，再过全量归一化校验。
    let days: CalendarDay[]
    try {
      days = mapUpstreamYear(JSON.parse(response.text), year)
    } catch (error) {
      return recordFailure(state, year, 'invalid', error)
    }
    if (days.length === 0) {
      return recordFailure(state, year, 'invalid', new Error('Upstream year payload mapped to zero days.'))
    }
    const calendar = normalizeYearCalendar({ schemaVersion: 1, year, region: 'CN', days }, year)
    if (!calendar) {
      return recordFailure(state, year, 'invalid', new Error('Mapped year payload failed normalization.'))
    }

    // 4. 比较：与本地生效数据哈希一致 → unchanged，不写文件、不 reload。
    const newHash = computeYearContentHash(calendar.days)
    const localDays = deps.getLocalYearDays(year)
    const localHash = localDays && localDays.length > 0 ? computeYearContentHash(localDays) : null
    if (localHash !== null && newHash === localHash) {
      applySuccess(state, year, newHash)
      await writeState()
      log(`Year ${year} is unchanged (content hash match).`)
      return 'unchanged'
    }

    // 5. 原子替换 + 刷新：完整落盘后才 reload CalendarService。
    try {
      await deps.writeFileAtomic(join(deps.getCacheDir(), `${year}.json`), JSON.stringify(calendar, null, 2))
    } catch (error) {
      return recordFailure(state, year, 'error', error)
    }
    applySuccess(state, year, newHash)
    await writeState()
    deps.onYearApplied(year)
    log(`Year ${year} applied (content hash ${newHash.slice(0, 12)}).`)
    return 'applied'
  }

  /** 按最早的 nextCheckAt 安排一次性定时器（缺条目视为立即到期，自愈重启跨年漏检）。 */
  function scheduleNext(): void {
    if (stopped) return
    if (timer !== null) {
      deps.clearTimer(timer)
      timer = null
    }
    const state = stateCache
    if (!state) return
    const nowMs = deps.now().getTime()
    let earliest = Number.POSITIVE_INFINITY
    for (const year of targetYears()) {
      const entry = state.years[String(year)]
      earliest = Math.min(earliest, entry ? entry.nextCheckAt : 0)
    }
    if (!Number.isFinite(earliest)) return
    timer = deps.setTimer(
      () => {
        void onTimerFire()
      },
      Math.max(earliest - nowMs, 0),
    )
  }

  async function onTimerFire(): Promise<void> {
    if (stopped) return
    const nowMs = deps.now().getTime()
    for (const year of targetYears()) {
      const state = await readState()
      const entry = state.years[String(year)]
      // 定时器可能提前唤醒、状态可能已变：只检查真正到期的年度。
      if (entry && nowMs < entry.nextCheckAt) continue
      await checkYear(year, false)
    }
    scheduleNext()
  }

  return {
    /** 启动评估：对当前年 + 下一年逐个冷却判定，到期的才发起检查；随后安排一次性定时器。 */
    async evaluateOnStartup(): Promise<void> {
      for (const year of targetYears()) {
        await checkYear(year, false)
      }
      scheduleNext()
    },

    /** 手动检查更新（IPC）：force 跳过冷却立即检查；缺省 year = 当前年 + 下一年。 */
    async checkUpdates(options: { year?: number; force?: boolean } = {}): Promise<CalendarCheckResult[]> {
      const years = options.year !== undefined && Number.isInteger(options.year) ? [options.year] : targetYears()
      const results: CalendarCheckResult[] = []
      for (const year of years) {
        results.push({ year, outcome: await checkYear(year, options.force === true) })
      }
      scheduleNext()
      return results
    },

    /** 退出：不持久化定时器；下次启动从 update-state.json 继续判断。 */
    stop(): void {
      stopped = true
      if (timer !== null) {
        deps.clearTimer(timer)
        timer = null
      }
    },
  }
}

export type CalendarUpdater = ReturnType<typeof createCalendarUpdater>
