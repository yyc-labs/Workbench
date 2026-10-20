/**
 * WorkspacePersistenceCoordinator —— project-launcher-config.json 的统一写入协调者。
 *
 * 设计原则（见 docs/todo/15-工作区持久化协调器-plan.md）：
 * - 内存即时更新为唯一可信来源；本协调器只决定「何时、以什么顺序」把最新快照写盘。
 * - Latest-wins：全量序列化下前序未写版本无意义，只写最新快照。
 * - 同一时刻最多一个写入任务（writeInFlight）；多来源 flush 共享同一调度循环（flushPromise）。
 * - 写失败保留脏状态（revision !== persistedRevision），不自动重试，等下一次 markDirty / flush。
 * - 本模块不 import electron，依赖全部注入，可被 test/helpers/load-ts-module.mjs 直接单测。
 */

export type WorkspacePersistencePhase = 'idle' | 'scheduled' | 'writing' | 'failed'

export type WorkspacePersistenceFlushOutcome = { status: 'saved' } | { status: 'failed'; error: unknown } | { status: 'timeout' }

export interface WorkspacePersistenceStatus {
  /** 当前内存状态版本号，每次有效修改递增 */
  revision: number
  /** 最近成功写入磁盘的版本号 */
  persistedRevision: number
  phase: WorkspacePersistencePhase
  /** 本轮首次变脏时间戳（maxWait 计算基准），无待写数据时为 null */
  firstDirtyAt: number | null
  /** 最近一次写入失败原因；成功后清除 */
  lastError: string | null
}

export type TimerHandle = unknown

export interface WorkspacePersistenceOptions {
  debounceMs?: number
  maxWaitMs?: number
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => TimerHandle
  clearTimer?: (handle: TimerHandle) => void
  /** 调试日志出口，默认 console.debug；测试可注入静默实现 */
  log?: (message: string) => void
}

export interface WorkspacePersistenceCoordinator {
  /** 标记数据已变更并安排延迟写入；同步返回 */
  markDirty(reason?: string): void
  /**
   * 清除等待中的定时器，立即提交最新状态，并等待所有已发生的修改写入成功。
   * 多来源并发调用共享同一调度循环（flushPromise）；写失败时 reject 且保留脏状态。
   */
  flush(): Promise<void>
  getStatus(): WorkspacePersistenceStatus
}

/** 单一事实源常量（测试与 config.ts 接线共同引用） */
export const WORKSPACE_PERSISTENCE_DEBOUNCE_MS = 300
export const WORKSPACE_PERSISTENCE_MAX_WAIT_MS = 2000
/** 退出 flush 超时护栏 */
export const WORKSPACE_PERSISTENCE_FLUSH_TIMEOUT_MS = 3000

const noop = (): void => undefined

const defaultSetTimer: NonNullable<WorkspacePersistenceOptions['setTimer']> = (fn, ms) => setTimeout(fn, ms)
const defaultClearTimer: NonNullable<WorkspacePersistenceOptions['clearTimer']> = (handle) => {
  clearTimeout(handle as ReturnType<typeof setTimeout>)
}

export function createWorkspacePersistenceCoordinator(write: (serialized: string) => Promise<void>, getSnapshot: () => string, options: WorkspacePersistenceOptions = {}): WorkspacePersistenceCoordinator {
  const debounceMs = options.debounceMs ?? WORKSPACE_PERSISTENCE_DEBOUNCE_MS
  const maxWaitMs = options.maxWaitMs ?? WORKSPACE_PERSISTENCE_MAX_WAIT_MS
  const now = options.now ?? (() => Date.now())
  const setTimer = options.setTimer ?? defaultSetTimer
  const clearTimer = options.clearTimer ?? defaultClearTimer
  const log = options.log ?? ((message: string) => console.debug(`[workspace-persistence] ${message}`))

  let revision = 0
  let persistedRevision = 0
  let phase: WorkspacePersistencePhase = 'idle'
  let firstDirtyAt: number | null = null
  let lastError: string | null = null
  let debounceTimer: TimerHandle | null = null
  let maxWaitTimer: TimerHandle | null = null
  let writeInFlight: Promise<void> | null = null
  let flushPromise: Promise<void> | null = null

  const clearTimerSafe = (handle: TimerHandle | null): void => {
    if (handle === null || handle === undefined) return
    clearTimer(handle)
  }

  const flush = (): Promise<void> => {
    // D19：多来源 flush 共享同一调度循环；未结束则返回同一 Promise。
    if (flushPromise) return flushPromise
    flushPromise = runFlushLoop().finally(() => {
      flushPromise = null
    })
    return flushPromise
  }

  const onTimerFire = (): void => {
    void flush().catch((error) => {
      log(`flush from timer failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  async function runFlushLoop(): Promise<void> {
    clearTimerSafe(debounceTimer)
    debounceTimer = null
    clearTimerSafe(maxWaitTimer)
    maxWaitTimer = null
    firstDirtyAt = null
    while (revision !== persistedRevision) {
      if (writeInFlight) {
        // 等待当前在途写入完成（失败也吞掉后继续判定），保证串行。
        await writeInFlight.catch(noop)
        continue
      }
      const target = revision
      phase = 'writing'
      // 同步序列化发生在 getSnapshot 内、首个 await 之前，保证快照原子性。
      const inFlight = (async () => {
        const serialized = getSnapshot()
        await write(serialized)
      })()
      writeInFlight = inFlight
      try {
        await inFlight
        persistedRevision = target
        phase = 'idle'
        lastError = null
        log(`write ok revision=${target} persistedRevision=${persistedRevision}`)
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        phase = 'failed'
        writeInFlight = null
        log(`write failed revision=${target}: ${lastError}`)
        // 保留脏状态（revision !== persistedRevision），共享 flushPromise 的调用方收到同一 rejection；
        // 重试由下一次 markDirty / flush 触发，不在本循环内自动重试。
        throw error
      }
      writeInFlight = null
      // 循环继续：若写期间又来修改，用最新快照再写一轮（latest-wins）。
    }
    // 循环退出：清理期间可能被 markDirty 重建的定时器，并做最终复检。
    // 退出判定与上次写入完成之间无 await，markDirty 无法插入，复检理论上不可达。
    clearTimerSafe(debounceTimer)
    debounceTimer = null
    clearTimerSafe(maxWaitTimer)
    maxWaitTimer = null
    if (revision !== persistedRevision) {
      return runFlushLoop()
    }
    phase = 'idle'
  }

  return {
    markDirty(reason?: string): void {
      revision += 1
      if (firstDirtyAt === null) firstDirtyAt = now()
      if (phase !== 'writing') phase = 'scheduled'
      clearTimerSafe(debounceTimer)
      debounceTimer = setTimer(onTimerFire, debounceMs)
      if (maxWaitTimer === null) {
        maxWaitTimer = setTimer(onTimerFire, maxWaitMs)
      }
      log(`markDirty(${reason ?? 'unspecified'}) revision=${revision}`)
    },
    flush,
    getStatus(): WorkspacePersistenceStatus {
      return { revision, persistedRevision, phase, firstDirtyAt, lastError }
    },
  }
}

/**
 * 带超时护栏的 flush，区分 saved / failed / timeout（D22）。
 * 注意：timeout 不取消在途写入——返回 timeout 只表示「退出不再等待」，
 * 绝不代表保存成功；协调器只在真实写成功时推进 persistedRevision。
 */
export async function flushWithOutcome(flush: () => Promise<void>, timeoutMs: number, setTimer: NonNullable<WorkspacePersistenceOptions['setTimer']> = defaultSetTimer, clearTimer: NonNullable<WorkspacePersistenceOptions['clearTimer']> = defaultClearTimer): Promise<WorkspacePersistenceFlushOutcome> {
  let timeoutHandle: TimerHandle | undefined
  // flush 的 rejection 在此转换为 failed outcome，避免 race 胜出方为 timeout 时产生 unhandled rejection。
  const flushOutcome = flush().then(
    () => ({ status: 'saved' as const }),
    (error: unknown) => ({ status: 'failed' as const, error }),
  )
  const outcome = await Promise.race([
    flushOutcome,
    new Promise<{ status: 'timeout' }>((resolve) => {
      timeoutHandle = setTimer(() => resolve({ status: 'timeout' }), timeoutMs)
    }),
  ])
  if (timeoutHandle !== undefined) clearTimer(timeoutHandle)
  return outcome
}
