import type { ManagedProcessSnapshot, TerminalInventoryEvent, TerminalInventorySnapshot } from '../../shared/types'

/**
 * 终端清单（terminalInventory）增量更新纯函数。
 *
 * 主进程进程 Map 变化时推送 upsert/remove 事件（带单调递增 revision），
 * renderer store 只应用比当前更新的版本；旧快照不得覆盖较新事件状态。
 * 这里是数组级纯操作，便于单测，store 只负责装配。
 *
 * 乐观关闭竞态：用户点 × 后 renderer 立即把 key 放进 closingKeys 并从清单移除，
 * 主进程 stop 入口同步推 remove 事件确认。confirm 前该 key 对快照与 upsert 均不可见，
 * 防止「停止窗口内的快照把正在关闭的终端复活」。
 */

/** 版本守卫：只有比当前更新的快照/事件才允许应用。 */
export function shouldApplyInventoryUpdate(currentRevision: number, incomingRevision: number): boolean {
  return incomingRevision > currentRevision
}

/** upsert：同 key 原地替换（保持既有顺序），新 key 追加到末尾。 */
export function applyInventoryUpsert(inventory: readonly ManagedProcessSnapshot[], process: ManagedProcessSnapshot): ManagedProcessSnapshot[] {
  const index = inventory.findIndex((item) => item.processId === process.processId)
  if (index === -1) return [...inventory, process]
  const next = inventory.slice()
  next[index] = process
  return next
}

/** remove：按 processKey 移除；key 不存在时返回原引用（避免无意义的状态更新）。 */
export function applyInventoryRemove(inventory: readonly ManagedProcessSnapshot[], processKey: string): ManagedProcessSnapshot[] {
  if (!inventory.some((item) => item.processId === processKey)) return inventory as ManagedProcessSnapshot[]
  return inventory.filter((item) => item.processId !== processKey)
}

/**
 * 启动中占位清理：清单已收录的 key 退出占位（事件追上后 pending 让位真实终端）。
 * 无需移除时返回原引用。
 */
export function filterPendingTerminals<T extends { processKey: string }>(pending: readonly T[], inventory: readonly ManagedProcessSnapshot[]): T[] {
  if (pending.length === 0) return pending as T[]
  const liveKeys = new Set(inventory.map((item) => item.processId))
  const next = pending.filter((item) => !liveKeys.has(item.processKey))
  return next.length === pending.length ? (pending as T[]) : next
}

/**
 * 应用增量事件（含 closing 竞态防护）。
 * - upsert：closing 中的 key 不收录（等 remove 确认；迟到注册的进程由 store 补发停止）；
 * - remove：按 key 移除并退出 closing 组（确认关闭）。
 * 入参不会被修改。
 */
export function reduceTerminalInventoryEvent(inventory: readonly ManagedProcessSnapshot[], closingKeys: readonly string[], event: TerminalInventoryEvent): { inventory: ManagedProcessSnapshot[]; closingKeys: string[] } {
  if (event.type === 'upsert') {
    if (closingKeys.includes(event.process.processId)) {
      return { inventory: inventory.slice(), closingKeys: closingKeys.slice() }
    }
    return { inventory: applyInventoryUpsert(inventory, event.process), closingKeys: closingKeys.slice() }
  }
  return {
    inventory: applyInventoryRemove(inventory, event.processKey),
    closingKeys: closingKeys.filter((key) => key !== event.processKey),
  }
}

/**
 * 应用整份快照：closing 中的 key 过滤掉（停止窗口内主进程 Map 可能仍有该进程，
 * 不过滤会把正在关闭的终端复活）。入参不会被修改。
 */
export function reduceTerminalInventorySnapshot(managedProcesses: readonly ManagedProcessSnapshot[], closingKeys: readonly string[]): ManagedProcessSnapshot[] {
  if (closingKeys.length === 0) return managedProcesses.slice()
  return managedProcesses.filter((item) => !closingKeys.includes(item.processId))
}
