import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { createCalendarUpdater } = loadTsModule('src/core/electron/main/calendar/calendar-updater.ts')
const { computeYearContentHash } = loadTsModule('src/core/electron/main/calendar/calendar-data.ts')

const STATE_PATH = 'C:/Users/me/AppData/Roaming/workbench/calendar/update-state.json'
const CACHE_DIR = 'C:/Users/me/AppData/Roaming/workbench/calendar/CN'
const DAY_MS = 24 * 60 * 60 * 1_000
const NOW = new Date(2026, 0, 15, 12, 0, 0)

function cacheFile(year) {
  // 与 updater 内部一致：经 node:path join 拼接（Windows 下为反斜杠）。
  return join(CACHE_DIR, String(year) + '.json')
}

/** 上游三段结构（holidays/workdays/inLieuDays 对象，值 "英文名,中文名,ID"）。 */
function upstreamPayload(year, { holidays = ['2026-01-01'], workdays = [] } = {}) {
  const holidays_ = {}
  for (const date of holidays) holidays_[date] = "New Year's Day,元旦,1"
  const workdays_ = {}
  for (const date of workdays) workdays_[date] = "New Year's Day,元旦,1"
  return JSON.stringify({ year, holidays: holidays_, workdays: workdays_, inLieuDays: {} })
}

function setup({ stateText = null, fetchImpl, localDays = null, writeError = null, cacheText = null } = {}) {
  let clock = new Date(NOW.getTime())
  const files = new Map()
  if (stateText !== null) files.set(STATE_PATH, stateText)
  if (cacheText !== null) files.set(cacheFile(2026), cacheText)
  const timers = []
  const fetchCalls = []
  const writes = []
  const reloads = []
  const updater = createCalendarUpdater({
    getStatePath: () => STATE_PATH,
    getCacheDir: () => CACHE_DIR,
    now: () => clock,
    fetchYear: async (url) => {
      fetchCalls.push(url)
      if (!fetchImpl) throw new Error('network down')
      return fetchImpl(url)
    },
    readTextFile: async (target) => (files.has(target) ? files.get(target) : null),
    writeFileAtomic: async (target, text) => {
      // writeError 只作用于年度缓存文件（状态文件照常落盘，与真实场景一致）。
      if (writeError && target !== STATE_PATH) throw writeError
      files.set(target, text)
      writes.push({ path: target, text })
    },
    getLocalYearDays: (year) => (year === 2026 ? localDays : null),
    onYearApplied: (year) => reloads.push(year),
    setTimer: (fn, ms) => {
      const handle = { fn, due: clock.getTime() + ms }
      timers.push(handle)
      return handle
    },
    clearTimer: (handle) => {
      const index = timers.indexOf(handle)
      if (index >= 0) timers.splice(index, 1)
    },
  })
  return {
    updater,
    timers,
    fetchCalls,
    writes,
    reloads,
    files,
    state() {
      return JSON.parse(files.get(STATE_PATH))
    },
    hasState() {
      return files.has(STATE_PATH)
    },
    advance(ms) {
      clock = new Date(clock.getTime() + ms)
    },
    /** 触发全部挂起定时器（含提前唤醒场景），并让异步链落定。 */
    async fireAll() {
      const pending = timers.splice(0, timers.length)
      for (const handle of pending) handle.fn()
      await new Promise((resolve) => setImmediate(resolve))
    },
  }
}

function okFetch(year, options) {
  return async () => ({ status: 200, text: upstreamPayload(year, options) })
}

test('cooldown skips network entirely on startup and early timer wakeups', async () => {
  const stateText = JSON.stringify({
    schemaVersion: 1,
    years: {
      2026: { lastCheckedAt: NOW.getTime() - DAY_MS, lastSuccessAt: NOW.getTime() - DAY_MS, nextCheckAt: NOW.getTime() + 30 * DAY_MS, lastKnownHash: 'sha256:x', consecutiveFailures: 0 },
      2027: { lastCheckedAt: NOW.getTime() - DAY_MS, nextCheckAt: NOW.getTime() + 30 * DAY_MS, consecutiveFailures: 0 },
    },
  })
  const ctx = setup({ stateText, fetchImpl: okFetch(2026) })
  await ctx.updater.evaluateOnStartup()
  // 冷却期内零网络请求。
  assert.equal(ctx.fetchCalls.length, 0)
  // 定时器按最早 nextCheckAt（30 天后）安排。
  assert.equal(ctx.timers.length, 1)

  // 定时器提前唤醒（只过 10 天）：重新逐校 nextCheckAt，仍不请求。
  ctx.advance(10 * DAY_MS)
  await ctx.fireAll()
  assert.equal(ctx.fetchCalls.length, 0)
  assert.equal(ctx.timers.length, 1)
  ctx.updater.stop()
})

test('first 404 sets a 14-day cooldown that survives restarts', async () => {
  const notFound = async () => ({ status: 404, text: 'Not Found' })
  const first = setup({ fetchImpl: notFound })
  const outcomes = await first.updater.checkUpdates({})
  assert.deepEqual(
    outcomes.map((item) => item.outcome),
    ['not-found', 'not-found'],
  )
  assert.deepEqual(first.fetchCalls, [UPSTREAM(2026), UPSTREAM(2027)])
  const state = first.state()
  assert.equal(state.years['2026'].nextCheckAt, NOW.getTime() + 14 * DAY_MS)
  assert.equal(state.years['2026'].consecutiveFailures, 0)
  first.updater.stop()

  // 重启（共享同一状态文件）：14 天内不再请求。
  const second = setup({ stateText: JSON.stringify(state), fetchImpl: notFound })
  await second.updater.evaluateOnStartup()
  assert.equal(second.fetchCalls.length, 0)
  second.updater.stop()
})

test('matching content hash leaves files untouched and reports unchanged', async () => {
  const localDays = [{ date: '2026-01-01', name: '元旦', type: 'holiday' }]
  const ctx = setup({ fetchImpl: okFetch(2026), localDays })
  const outcomes = await ctx.updater.checkUpdates({ year: 2026 })
  assert.equal(outcomes[0].outcome, 'unchanged')
  // 不写年度缓存文件、不 reload。
  assert.equal(ctx.writes.length, 1)
  assert.equal(ctx.writes[0].path, STATE_PATH)
  assert.deepEqual(ctx.reloads, [])
  assert.equal(ctx.files.has(cacheFile(2026)), false)
  // 状态照常更新（30 天档 + lastKnownHash）。
  const state = ctx.state()
  assert.equal(state.years['2026'].nextCheckAt, NOW.getTime() + 30 * DAY_MS)
  assert.equal(state.years['2026'].lastSuccessAt, NOW.getTime())
  assert.equal(typeof state.years['2026'].lastKnownHash, 'string')
  ctx.updater.stop()
})

test('changed content hash is applied atomically and refreshes the cache', async () => {
  const localDays = [{ date: '2026-01-01', name: '元旦', type: 'holiday' }]
  const ctx = setup({
    fetchImpl: okFetch(2026, { holidays: ['2026-01-01', '2026-01-02'], workdays: ['2026-01-04'] }),
    localDays,
  })
  const outcomes = await ctx.updater.checkUpdates({ year: 2026 })
  assert.equal(outcomes[0].outcome, 'applied')
  assert.equal(ctx.writes.length, 2)
  assert.equal(ctx.writes[0].path, cacheFile(2026))
  const written = JSON.parse(ctx.writes[0].text)
  assert.equal(written.year, 2026)
  assert.deepEqual(
    written.days.map((day) => [day.date, day.name, day.type]),
    [
      ['2026-01-01', '元旦', 'holiday'],
      ['2026-01-02', '元旦', 'holiday'],
      ['2026-01-04', '元旦调休', 'makeup_workday'],
    ],
  )
  assert.deepEqual(ctx.reloads, [2026])
  // lastKnownHash 与落盘内容的内容哈希一致。
  const state = ctx.state()
  assert.equal(state.years['2026'].lastKnownHash, computeYearContentHash(written.days))
  ctx.updater.stop()
})

test('invalid upstream data keeps the old cache and backs off 7 days', async () => {
  // 映射后零条目（日期全部非法）→ invalid。
  const bad = async () => ({ status: 200, text: JSON.stringify({ year: 2026, holidays: { 'bad-date': '元旦,元旦,1' }, workdays: {}, inLieuDays: {} }) })
  const oldCache = JSON.stringify({ schemaVersion: 1, year: 2026, region: 'CN', days: [{ date: '2026-01-01', name: '元旦', type: 'holiday' }] })
  const ctx = setup({ fetchImpl: bad, cacheText: oldCache, localDays: [{ date: '2026-01-01', name: '元旦', type: 'holiday' }] })
  const outcomes = await ctx.updater.checkUpdates({})
  assert.equal(outcomes[0].outcome, 'invalid')
  // 旧文件完整、未 reload。
  assert.equal(ctx.files.get(cacheFile(2026)), oldCache)
  assert.deepEqual(ctx.reloads, [])
  assert.equal(ctx.state().years['2026'].nextCheckAt, NOW.getTime() + 7 * DAY_MS)
  assert.equal(ctx.state().years['2026'].consecutiveFailures, 1)

  // schema 非法同样判 invalid。
  const badSchema = async () => ({ status: 200, text: JSON.stringify({ nope: true }) })
  const ctx2 = setup({ fetchImpl: badSchema })
  const outcomes2 = await ctx2.updater.checkUpdates({})
  assert.equal(outcomes2[0].outcome, 'invalid')
  ctx.updater.stop()
  ctx2.updater.stop()
})

test('write failures keep the old file, skip reload and report error', async () => {
  const localDays = [{ date: '2026-01-01', name: '元旦', type: 'holiday' }]
  const oldCache = JSON.stringify({ schemaVersion: 1, year: 2026, region: 'CN', days: localDays })
  const ctx = setup({
    fetchImpl: okFetch(2026, { holidays: ['2026-01-01', '2026-01-02'] }),
    localDays,
    cacheText: oldCache,
    writeError: new Error('EBUSY'),
  })
  const outcomes = await ctx.updater.checkUpdates({})
  assert.equal(outcomes[0].outcome, 'error')
  // rename 抛错时旧文件完整（writeFileAtomic 未落盘即抛）。
  assert.equal(ctx.files.get(cacheFile(2026)), oldCache)
  assert.deepEqual(ctx.reloads, [])
  assert.equal(ctx.state().years['2026'].nextCheckAt, NOW.getTime() + 7 * DAY_MS)
  ctx.updater.stop()
})

test('three consecutive failures stretch the cooldown to 14 days', async () => {
  const offline = async () => {
    throw new Error('ETIMEDOUT')
  }
  const ctx = setup({ fetchImpl: offline })
  await ctx.updater.checkUpdates({ force: true })
  assert.equal(ctx.state().years['2026'].consecutiveFailures, 1)
  assert.equal(ctx.state().years['2026'].nextCheckAt, NOW.getTime() + 7 * DAY_MS)
  await ctx.updater.checkUpdates({ force: true })
  assert.equal(ctx.state().years['2026'].consecutiveFailures, 2)
  assert.equal(ctx.state().years['2026'].nextCheckAt, NOW.getTime() + 7 * DAY_MS)
  await ctx.updater.checkUpdates({ force: true })
  assert.equal(ctx.state().years['2026'].consecutiveFailures, 3)
  assert.equal(ctx.state().years['2026'].nextCheckAt, NOW.getTime() + 14 * DAY_MS)
  ctx.updater.stop()
})

test('force manual checks bypass the cooldown', async () => {
  const stateText = JSON.stringify({
    schemaVersion: 1,
    years: { 2026: { lastCheckedAt: NOW.getTime(), nextCheckAt: NOW.getTime() + 30 * DAY_MS, consecutiveFailures: 0 } },
  })
  const localDays = [{ date: '2026-01-01', name: '元旦', type: 'holiday' }]
  const ctx = setup({ stateText, fetchImpl: okFetch(2026), localDays })

  // 不 force：冷却期内 skipped，零请求。
  const skipped = await ctx.updater.checkUpdates({ year: 2026 })
  assert.deepEqual(skipped, [{ year: 2026, outcome: 'skipped' }])
  assert.equal(ctx.fetchCalls.length, 0)

  // force：跳过冷却立即检查。
  const forced = await ctx.updater.checkUpdates({ year: 2026, force: true })
  assert.deepEqual(forced, [{ year: 2026, outcome: 'unchanged' }])
  assert.deepEqual(ctx.fetchCalls, [UPSTREAM(2026)])
  ctx.updater.stop()
})

test('a corrupt state file allows exactly one immediate check', async () => {
  const ctx = setup({ stateText: 'not json at all {{{', fetchImpl: okFetch(2026) })
  await ctx.updater.evaluateOnStartup()
  assert.equal(ctx.fetchCalls.length, 2) // 两个目标年度各一次
  // 状态被写回为正常冷却。
  assert.equal(ctx.state().schemaVersion, 1)
  assert.equal(ctx.state().years['2026'].nextCheckAt, NOW.getTime() + 30 * DAY_MS)
  ctx.updater.stop()
})

test('timeouts and oversized bodies map to error with backoff', async () => {
  const timeout = async () => {
    throw new Error('The operation was aborted due to timeout')
  }
  const ctx = setup({ fetchImpl: timeout })
  const outcomes = await ctx.updater.checkUpdates({ year: 2026 })
  assert.deepEqual(outcomes, [{ year: 2026, outcome: 'error' }])
  assert.equal(ctx.state().years['2026'].nextCheckAt, NOW.getTime() + 7 * DAY_MS)
  ctx.updater.stop()
})

test('only the current and next year are checked; past years are never fetched', async () => {
  const notFound = async () => ({ status: 404, text: '' })
  const ctx = setup({ fetchImpl: notFound })
  await ctx.updater.evaluateOnStartup()
  assert.deepEqual(ctx.fetchCalls, [UPSTREAM(2026), UPSTREAM(2027)])
  // 定时器到期后再评估也只覆盖目标年度。
  ctx.advance(15 * DAY_MS)
  await ctx.fireAll()
  assert.deepEqual(ctx.fetchCalls, [UPSTREAM(2026), UPSTREAM(2027), UPSTREAM(2026), UPSTREAM(2027)])
  ctx.updater.stop()
})

test('a restart continues from the persisted nextCheckAt without recomputing earlier times', async () => {
  const localDays = [{ date: '2026-01-01', name: '元旦', type: 'holiday' }]
  const ctx = setup({ fetchImpl: okFetch(2026, { holidays: ['2026-01-01', '2026-01-02'] }), localDays })
  await ctx.updater.checkUpdates({ year: 2026 })
  assert.equal(ctx.fetchCalls.length, 1)
  const persistedNextCheckAt = ctx.state().years['2026'].nextCheckAt
  ctx.updater.stop()

  // 重启：冷却未到 → 零请求，且不把 nextCheckAt 重新计算成更早的时间。
  const restartedState = ctx.state()
  restartedState.years['2027'] = { lastCheckedAt: NOW.getTime(), nextCheckAt: NOW.getTime() + 30 * DAY_MS, consecutiveFailures: 0 }
  const restarted = setup({ stateText: JSON.stringify(restartedState), fetchImpl: okFetch(2026) })
  await restarted.updater.evaluateOnStartup()
  assert.equal(restarted.fetchCalls.length, 0)
  assert.equal(restarted.writes.length, 0) // skipped 不写状态
  assert.equal(JSON.parse(restarted.files.get(STATE_PATH)).years['2026'].nextCheckAt, persistedNextCheckAt)
  restarted.updater.stop()
})

function UPSTREAM(year) {
  return 'https://cdn.jsdelivr.net/npm/chinese-days/dist/years/' + year + '.json'
}
