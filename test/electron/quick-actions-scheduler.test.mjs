import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { createQuickActionScheduler } = loadTsModule('src/core/electron/main/quick-actions/quickActionScheduler.ts')

const flush = () => new Promise((resolve) => setImmediate(resolve))

function action(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Morning standup',
    action: { type: 'run-task', projectPath: 'D:/repos/app' },
    icon: 'play',
    group: 'task',
    enabled: true,
    order: 0,
    createdAt: 1000,
    updatedAt: 1000,
    schedule: {
      kind: 'daily',
      times: ['09:00'],
      calendarMode: 'every-day',
      enabled: true,
      ...overrides,
    },
  }
}

function setup({ actions = [action()], clock = new Date(2026, 0, 15, 8, 59, 30), isWorkday = () => true, executeResult } = {}) {
  const timers = []
  const notifyEvents = []
  const executeCalls = []
  const stamps = []
  const scheduler = createQuickActionScheduler({
    getScheduledActions: () => actions,
    execute: async (id) => {
      executeCalls.push(id)
      return executeResult ?? { ok: true, kind: 'task-started', taskIds: ['web'] }
    },
    setScheduleRunStamp: async (id, stamp) => {
      stamps.push({ id, stamp })
      // 镜像 service 语义：未包含的字段不动，显式 undefined 清除。
      const target = actions.find((item) => item.id === id)
      if (!target?.schedule) return
      const schedule = { ...target.schedule }
      for (const key of Object.keys(stamp)) {
        if (stamp[key] === undefined) delete schedule[key]
        else schedule[key] = stamp[key]
      }
      target.schedule = schedule
    },
    isWorkday,
    notify: (event) => notifyEvents.push(event),
    now: () => clock,
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
    scheduler,
    timers,
    notifyEvents,
    executeCalls,
    stamps,
    actions,
    advance(ms) {
      clock = new Date(clock.getTime() + ms)
    },
    async fireDue() {
      const due = timers.filter((handle) => handle.due <= clock.getTime())
      for (const handle of due) {
        const index = timers.indexOf(handle)
        if (index >= 0) timers.splice(index, 1)
      }
      for (const handle of due) handle.fn()
      await flush()
    },
  }
}

test('daily schedule runs once when the time arrives and stays idempotent', async () => {
  const ctx = setup()
  ctx.scheduler.start()
  await flush()
  // 启动首 tick：计划时间 09:00 未到，不执行。
  assert.equal(ctx.executeCalls.length, 0)

  // 推进到 09:00（timer 对齐到分钟边界）后触发。
  ctx.advance(30_000)
  await ctx.fireDue()
  assert.equal(ctx.executeCalls.length, 1)
  assert.deepEqual(ctx.notifyEvents, [{ kind: 'success', actionName: 'Morning standup', time: '09:00' }])
  assert.equal(ctx.stamps.length, 1)
  assert.equal(ctx.stamps[0].stamp.lastRunDate, '2026-01-15')
  assert.equal(ctx.stamps[0].stamp.attemptCount, 0)

  // 同日重复 tick 不再触发（幂等哨兵）。
  ctx.advance(120_000)
  await ctx.fireDue()
  assert.equal(ctx.executeCalls.length, 1)
  ctx.scheduler.stop()
})

test('weekly schedule only runs on matching weekdays', async () => {
  // 2026-01-15 是周四。
  const thursday = setup({ actions: [action({ kind: 'weekly', weekdays: [4] })] })
  thursday.scheduler.start()
  await flush()
  thursday.advance(30_000)
  await thursday.fireDue()
  assert.equal(thursday.executeCalls.length, 1)
  thursday.scheduler.stop()

  // 2026-01-16 是周五，weekdays=[4] 不匹配。
  const friday = setup({ actions: [action({ kind: 'weekly', weekdays: [4] })], clock: new Date(2026, 0, 16, 8, 59, 30) })
  friday.scheduler.start()
  await flush()
  friday.advance(30_000)
  await friday.fireDue()
  assert.equal(friday.executeCalls.length, 0)
  friday.scheduler.stop()

  // weekdays 缺省 = 每天。
  const everyDay = setup({ actions: [action({ kind: 'weekly' })], clock: new Date(2026, 0, 16, 8, 59, 30) })
  everyDay.scheduler.start()
  await flush()
  everyDay.advance(30_000)
  await everyDay.fireDue()
  assert.equal(everyDay.executeCalls.length, 1)
  everyDay.scheduler.stop()
})

test('once schedule consumes itself after running', async () => {
  const ctx = setup({ actions: [action({ kind: 'once', date: '2026-01-15' })] })
  ctx.scheduler.start()
  await flush()
  ctx.advance(30_000)
  await ctx.fireDue()
  assert.equal(ctx.executeCalls.length, 1)
  assert.equal(ctx.actions[0].schedule.enabled, false)
  assert.equal(ctx.actions[0].schedule.lastRunDate, '2026-01-15')

  // 消耗后即使再 tick 也不执行。
  ctx.advance(120_000)
  await ctx.fireDue()
  assert.equal(ctx.executeCalls.length, 1)
  ctx.scheduler.stop()
})

test('workdays-only skips New Year and plain weekends but runs on makeup workdays', async () => {
  const isWorkday = (date) => {
    if (date === '2026-01-01') return false // 元旦法定假日
    if (date === '2026-01-03') return false // 普通周六
    if (date === '2026-01-04') return true // 周日补班
    return true
  }
  const schedule = { calendarMode: 'workdays-only' }

  // 元旦（周四）跳过。
  const newYear = setup({ actions: [action(schedule)], clock: new Date(2026, 0, 1, 9, 0, 5), isWorkday })
  newYear.scheduler.start()
  await flush()
  assert.equal(newYear.executeCalls.length, 0)
  newYear.scheduler.stop()

  // 普通周六跳过。
  const saturday = setup({ actions: [action(schedule)], clock: new Date(2026, 0, 3, 9, 0, 5), isWorkday })
  saturday.scheduler.start()
  await flush()
  assert.equal(saturday.executeCalls.length, 0)
  saturday.scheduler.stop()

  // 补班周日执行。
  const makeup = setup({ actions: [action(schedule)], clock: new Date(2026, 0, 4, 9, 0, 5), isWorkday })
  makeup.scheduler.start()
  await flush()
  assert.equal(makeup.executeCalls.length, 1)
  makeup.scheduler.stop()

  // every-day 模式节假日也执行。
  const everyDay = setup({ actions: [action({ calendarMode: 'every-day' })], clock: new Date(2026, 0, 1, 9, 0, 5), isWorkday })
  everyDay.scheduler.start()
  await flush()
  assert.equal(everyDay.executeCalls.length, 1)
  everyDay.scheduler.stop()
})

test('a schedule created mid-day does not back-fill its earlier time point', async () => {
  // 复现用户场景：应用从早上就在运行，14:47 才创建「每天 09:00、18:00」日程。
  // 14:48 的普通 tick 不得补跑早已错过的 09:00（超过 5 分钟宽限窗口）。
  const ctx = setup({ actions: [action({ times: ['09:00', '18:00'] })], clock: new Date(2026, 0, 15, 8, 0, 0) })
  ctx.scheduler.start()
  await flush()
  // 推进到 14:48（模拟上午没有任何日程，用户在 14:47 保存）。
  ctx.advance(new Date(2026, 0, 15, 14, 48, 0).getTime() - new Date(2026, 0, 15, 8, 0, 0).getTime())
  await ctx.fireDue()
  assert.equal(ctx.executeCalls.length, 0)
  assert.equal(ctx.notifyEvents.length, 0)
  // 没有写入任何运行状态（卡片不会出现「上次执行 14:48」）。
  assert.equal(ctx.stamps.length, 0)
  assert.equal('lastRunAt' in ctx.actions[0].schedule, false)

  // 18:00 仍按计划触发。
  ctx.advance(new Date(2026, 0, 15, 18, 0, 0).getTime() - new Date(2026, 0, 15, 14, 48, 0).getTime())
  await ctx.fireDue()
  assert.equal(ctx.executeCalls.length, 1)
  assert.equal(ctx.notifyEvents[0].time, '18:00')
  ctx.scheduler.stop()
})

test('a normal tick slightly behind schedule still runs within the grace window', async () => {
  // tick 比计划时间晚 2 分钟（< 5 分钟宽限窗口）时照常触发。
  const ctx = setup({ clock: new Date(2026, 0, 15, 9, 2, 0) })
  ctx.scheduler.start()
  await flush()
  assert.equal(ctx.executeCalls.length, 1)
  assert.equal(ctx.stamps[0].stamp.lastRunDate, '2026-01-15')
  ctx.scheduler.stop()
})

test('grace window back-runs missed schedules within 5 minutes of startup', async () => {
  // 计划 09:00，启动于 09:03（3 分钟前）→ 补跑一次。
  const backfill = setup({ clock: new Date(2026, 0, 15, 9, 3, 0) })
  backfill.scheduler.start()
  await flush()
  assert.equal(backfill.executeCalls.length, 1)
  backfill.scheduler.stop()
})

test('grace window skips schedules missed by more than 5 minutes, including later ticks', async () => {
  // 计划 09:00，启动于 09:10（10 分钟前）→ 当天跳过。
  const missed = setup({ clock: new Date(2026, 0, 15, 9, 10, 0) })
  missed.scheduler.start()
  await flush()
  assert.equal(missed.executeCalls.length, 0)
  assert.equal(missed.notifyEvents.length, 0)

  // 后续普通 tick 也不补触发。
  missed.advance(120_000)
  await missed.fireDue()
  assert.equal(missed.executeCalls.length, 0)

  // 跨天后哨兵自然失效，次日正常触发。
  const nextDay = new Date(2026, 0, 16, 8, 59, 30)
  missed.advance(nextDay.getTime() - new Date(2026, 0, 15, 9, 12, 0).getTime())
  await missed.fireDue()
  assert.equal(missed.executeCalls.length, 0) // 16 日 09:00 未到
  missed.advance(30_000)
  await missed.fireDue()
  assert.equal(missed.executeCalls.length, 1)
  assert.equal(missed.stamps[missed.stamps.length - 1].stamp.lastRunDate, '2026-01-16')
  missed.scheduler.stop()
})

test('sleep resume follows the same grace rule', async () => {
  // 启动于 08:59:50（计划未到）；模拟休眠 10 分钟后恢复。
  const ctx = setup({ clock: new Date(2026, 0, 15, 8, 59, 50) })
  ctx.scheduler.start()
  await flush()
  assert.equal(ctx.executeCalls.length, 0)

  ctx.advance(10 * 60_000) // 09:09:50，与上一 tick 间隔 > 90s → 追赶 tick
  await ctx.fireDue()
  assert.equal(ctx.executeCalls.length, 0)

  // 休眠恢复但在宽限窗口内（间隔 3 分钟）→ 补跑。
  const resume = setup({ clock: new Date(2026, 0, 15, 8, 59, 50) })
  resume.scheduler.start()
  await flush()
  resume.advance(3 * 60_000 + 10_000) // 09:02:50
  await resume.fireDue()
  assert.equal(resume.executeCalls.length, 1)
  resume.scheduler.stop()
  ctx.scheduler.stop()
})

test('failed runs retry with linear backoff and notify only after exhaustion', async () => {
  const ctx = setup({ executeResult: { ok: false, code: 'exec-failed', error: 'boom' } })
  ctx.scheduler.start()
  await flush()

  ctx.advance(30_000) // 09:00:00 → 第 1 次失败
  await ctx.fireDue()
  assert.equal(ctx.executeCalls.length, 1)
  assert.equal(ctx.notifyEvents.length, 0) // 中间失败仅 warn 日志
  let schedule = ctx.actions[0].schedule
  assert.equal(schedule.attemptCount, 1)
  assert.equal(schedule.nextRetryAt, new Date(2026, 0, 15, 9, 0, 0).getTime() + 60_000)
  assert.equal('lastRunDate' in schedule, false) // 失败不写 lastRunDate

  ctx.advance(30_000) // 09:00:30 → 退避未到，跳过
  await ctx.fireDue()
  assert.equal(ctx.executeCalls.length, 1)

  ctx.advance(30_000) // 09:01:00 → 第 2 次失败，退避 2 分钟
  await ctx.fireDue()
  assert.equal(ctx.executeCalls.length, 2)
  assert.equal(ctx.notifyEvents.length, 0)
  schedule = ctx.actions[0].schedule
  assert.equal(schedule.attemptCount, 2)
  assert.equal(schedule.nextRetryAt, new Date(2026, 0, 15, 9, 1, 0).getTime() + 120_000)

  ctx.advance(120_000) // 09:03:00 → 第 3 次失败，当天耗尽，发失败通知
  await ctx.fireDue()
  assert.equal(ctx.executeCalls.length, 3)
  assert.deepEqual(ctx.notifyEvents, [{ kind: 'failed', actionName: 'Morning standup', time: '09:00', error: 'boom' }])

  ctx.advance(120_000) // 09:05:00 → 当天不再尝试
  await ctx.fireDue()
  assert.equal(ctx.executeCalls.length, 3)
  assert.equal(ctx.notifyEvents.length, 1)
  ctx.scheduler.stop()
})

test('a successful retry clears the backoff state', async () => {
  let failNext = true
  const ctx = setup({
    executeResult: undefined,
  })
  // 用可切换的执行结果重建 harness 不便，这里直接覆盖 execute 行为。
  ctx.scheduler.stop()

  const timers = []
  const notifyEvents = []
  const executeCalls = []
  const actions = [action()]
  let clock = new Date(2026, 0, 15, 8, 59, 30)
  const scheduler = createQuickActionScheduler({
    getScheduledActions: () => actions,
    execute: async (id) => {
      executeCalls.push(id)
      return failNext ? { ok: false, code: 'exec-failed', error: 'boom' } : { ok: true, kind: 'task-started', taskIds: [] }
    },
    setScheduleRunStamp: async (id, stamp) => {
      const target = actions.find((item) => item.id === id)
      const schedule = { ...target.schedule }
      for (const key of Object.keys(stamp)) {
        if (stamp[key] === undefined) delete schedule[key]
        else schedule[key] = stamp[key]
      }
      target.schedule = schedule
    },
    isWorkday: () => true,
    notify: (event) => notifyEvents.push(event),
    now: () => clock,
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
  const advance = (ms) => {
    clock = new Date(clock.getTime() + ms)
  }
  const fireDue = async () => {
    const due = timers.filter((handle) => handle.due <= clock.getTime())
    for (const handle of due) {
      const index = timers.indexOf(handle)
      if (index >= 0) timers.splice(index, 1)
    }
    for (const handle of due) handle.fn()
    await flush()
  }

  scheduler.start()
  await flush()
  advance(30_000) // 09:00:00 失败一次
  await fireDue()
  assert.equal(actions[0].schedule.attemptCount, 1)

  failNext = false
  advance(60_000) // 09:01:00 重试成功
  await fireDue()
  assert.equal(executeCalls.length, 2)
  const schedule = actions[0].schedule
  assert.equal(schedule.attemptCount, 0)
  assert.equal('nextRetryAt' in schedule, false)
  assert.equal(schedule.lastRunDate, '2026-01-15')
  assert.deepEqual(notifyEvents, [{ kind: 'success', actionName: 'Morning standup', time: '09:00' }])
  scheduler.stop()
})

test('multiple time points each fire once per day with independent state', async () => {
  const ctx = setup({ actions: [action({ times: ['09:00', '18:00'] })] })
  ctx.scheduler.start()
  await flush()

  // 09:00 触发。
  ctx.advance(30_000)
  await ctx.fireDue()
  assert.equal(ctx.executeCalls.length, 1)
  assert.deepEqual(ctx.notifyEvents, [{ kind: 'success', actionName: 'Morning standup', time: '09:00' }])
  assert.deepEqual(ctx.actions[0].schedule.runSlots, ['09:00'])
  assert.equal(ctx.actions[0].schedule.lastRunDate, '2026-01-15')

  // 09:00 已执行：临近中午再 tick 不重复触发。
  ctx.advance(3 * 60 * 60_000) // 12:00
  await ctx.fireDue()
  assert.equal(ctx.executeCalls.length, 1)

  // 18:00 触发（幂等按时间点独立）。
  ctx.advance(6 * 60 * 60_000) // 18:00
  await ctx.fireDue()
  assert.equal(ctx.executeCalls.length, 2)
  assert.deepEqual(ctx.actions[0].schedule.runSlots, ['09:00', '18:00'])
  assert.equal(ctx.notifyEvents.length, 2)
  assert.equal(ctx.notifyEvents[1].time, '18:00')

  // 当天全部完成后不再触发。
  ctx.advance(2 * 60 * 60_000) // 20:00
  await ctx.fireDue()
  assert.equal(ctx.executeCalls.length, 2)
  ctx.scheduler.stop()
})

test('retry state is isolated per time point', async () => {
  let failSlot = '09:00'
  const ctx = setup({ actions: [action({ times: ['09:00', '18:00'] })] })
  // 覆盖 execute：仅 09:00 失败。
  ctx.scheduler.stop()

  const timers = []
  const notifyEvents = []
  const executeCalls = []
  const actions = [action({ times: ['09:00', '18:00'] })]
  let clock = new Date(2026, 0, 15, 8, 59, 30)
  const scheduler = createQuickActionScheduler({
    getScheduledActions: () => actions,
    execute: async (id) => {
      executeCalls.push(id)
      return failSlot === '09:00' ? { ok: false, code: 'exec-failed', error: 'boom' } : { ok: true, kind: 'task-started', taskIds: [] }
    },
    setScheduleRunStamp: async (id, stamp) => {
      const target = actions.find((item) => item.id === id)
      const schedule = { ...target.schedule }
      for (const key of Object.keys(stamp)) {
        if (stamp[key] === undefined) delete schedule[key]
        else schedule[key] = stamp[key]
      }
      target.schedule = schedule
    },
    isWorkday: () => true,
    notify: (event) => notifyEvents.push(event),
    now: () => clock,
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
  const advance = (ms) => {
    clock = new Date(clock.getTime() + ms)
  }
  const fireDue = async () => {
    const due = timers.filter((handle) => handle.due <= clock.getTime())
    for (const handle of due) {
      const index = timers.indexOf(handle)
      if (index >= 0) timers.splice(index, 1)
    }
    for (const handle of due) handle.fn()
    await flush()
  }

  scheduler.start()
  await flush()
  // 09:00 连续失败 3 次，耗尽当天的 09:00（重试按时间点独立计数）。
  advance(30_000) // 09:00:00
  await fireDue()
  advance(60_000) // 09:01:00
  await fireDue()
  advance(120_000) // 09:03:00
  await fireDue()
  assert.equal(executeCalls.length, 3)
  assert.equal(notifyEvents.length, 1)
  assert.equal(notifyEvents[0].kind, 'failed')
  assert.equal(notifyEvents[0].time, '09:00')
  assert.equal(actions[0].schedule.attemptTime, '09:00')

  // 18:00 仍可执行，且拿到属于自己的尝试次数（attemptTime 切换后清零）。
  failSlot = 'none'
  advance(9 * 60 * 60_000) // 18:00:00
  await fireDue()
  assert.equal(executeCalls.length, 4)
  assert.equal(notifyEvents[1].kind, 'success')
  assert.equal(notifyEvents[1].time, '18:00')
  assert.deepEqual(actions[0].schedule.runSlots, ['18:00'])
  assert.equal(actions[0].schedule.attemptTime, undefined)
  scheduler.stop()
})

test('grace window is evaluated per time point', async () => {
  // 启动于 09:12：09:00 已错过 12 分钟（跳过），18:00 未到。
  const ctx = setup({ actions: [action({ times: ['09:00', '18:00'] })], clock: new Date(2026, 0, 15, 9, 12, 0) })
  ctx.scheduler.start()
  await flush()
  assert.equal(ctx.executeCalls.length, 0)
  // 18:00 正常触发（09:00 的跳过不影响它）。
  ctx.advance(new Date(2026, 0, 15, 18, 0, 0).getTime() - new Date(2026, 0, 15, 9, 12, 0).getTime())
  await ctx.fireDue()
  assert.equal(ctx.executeCalls.length, 1)
  assert.equal(ctx.notifyEvents[0].time, '18:00')
  // 被跳过的 09:00 在后续普通 tick 中也不补触发。
  ctx.advance(60_000)
  await ctx.fireDue()
  assert.equal(ctx.executeCalls.length, 1)
  ctx.scheduler.stop()
})

test('once with multiple time points consumes only after all slots run', async () => {
  const ctx = setup({ actions: [action({ kind: 'once', date: '2026-01-15', times: ['09:00', '18:00'] })] })
  ctx.scheduler.start()
  await flush()
  ctx.advance(30_000) // 09:00
  await ctx.fireDue()
  assert.equal(ctx.executeCalls.length, 1)
  assert.equal(ctx.actions[0].schedule.enabled, true) // 18:00 未跑，不消耗

  ctx.advance(new Date(2026, 0, 15, 18, 0, 0).getTime() - new Date(2026, 0, 15, 9, 0, 0).getTime())
  await ctx.fireDue()
  assert.equal(ctx.executeCalls.length, 2)
  assert.equal(ctx.actions[0].schedule.enabled, false) // 全部完成，消耗
  ctx.scheduler.stop()
})

test('disabled actions and entries without a schedule are ignored', async () => {
  const base = action()
  const ctx = setup({
    actions: [
      // schedule 禁用。
      { ...base, schedule: { ...base.schedule, enabled: false } },
      // 无 schedule。
      { ...base, id: '22222222-2222-4222-8222-222222222222', schedule: undefined },
      // action 总开关禁用。
      { ...base, id: '33333333-3333-4333-8333-333333333333', enabled: false },
    ],
  })
  ctx.scheduler.start()
  await flush()
  ctx.advance(30_000)
  await ctx.fireDue()
  assert.equal(ctx.executeCalls.length, 0)
  assert.equal(ctx.notifyEvents.length, 0)
  ctx.scheduler.stop()
})

test('stop prevents further evaluation', async () => {
  const ctx = setup()
  ctx.scheduler.start()
  await flush()
  ctx.scheduler.stop()
  assert.equal(ctx.timers.length, 0)
  ctx.advance(120_000)
  await ctx.fireDue()
  assert.equal(ctx.executeCalls.length, 0)
})
