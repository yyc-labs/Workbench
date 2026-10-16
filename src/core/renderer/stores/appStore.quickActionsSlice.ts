import type { StateCreator } from 'zustand'
import type { QuickActionCreateInput, QuickActionUpdateInput, QuickActionView } from '../../shared/types'
import type { AppState } from './appStore.types'

export type QuickActionsSlice = Pick<AppState, 'quickActions' | 'quickActionsLoading' | 'loadQuickActions' | 'createQuickAction' | 'updateQuickAction' | 'deleteQuickAction' | 'executeQuickAction' | 'reorderQuickAction' | 'createQuickActionDesktopShortcut' | 'removeQuickActionDesktopShortcut'>

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Sorts by group (project → task → other) then by the stored per-group order. */
function sortQuickActions(actions: QuickActionView[]): QuickActionView[] {
  const groupRank: Record<QuickActionView['group'], number> = { project: 0, task: 1, other: 2 }
  return actions.slice().sort((a, b) => groupRank[a.group] - groupRank[b.group] || a.order - b.order)
}

/** 快捷操作镜像：数据本体在主进程 config，store 做读缓存与写后同步（create/update 以主进程返回实体为准）。 */
export const createQuickActionsSlice: StateCreator<AppState, [], [], QuickActionsSlice> = (set, get) => ({
  quickActions: [],
  quickActionsLoading: false,
  loadQuickActions: async () => {
    set({ quickActionsLoading: true })
    try {
      const actions = await window.electronAPI.listQuickActions()
      set({ quickActions: sortQuickActions(actions) })
    } catch (error) {
      // 失败 = 无可用快捷操作，不阻塞任何页面
      console.warn('[quickActions] load failed:', errorMessage(error))
      set({ quickActions: [] })
    } finally {
      set({ quickActionsLoading: false })
    }
  },
  createQuickAction: async (input: QuickActionCreateInput) => {
    const created = await window.electronAPI.createQuickAction(input)
    set((state) => ({ quickActions: sortQuickActions([...state.quickActions.filter((item) => item.id !== created.id), { ...created, shortcutState: 'none' }]) }))
    return created
  },
  updateQuickAction: async (id: string, input: QuickActionUpdateInput) => {
    const updated = await window.electronAPI.updateQuickAction(id, input)
    set((state) => ({ quickActions: sortQuickActions(state.quickActions.map((item) => (item.id === id ? { ...updated, shortcutState: item.shortcutState } : item))) }))
    return updated
  },
  deleteQuickAction: async (id: string) => {
    const deleted = await window.electronAPI.deleteQuickAction(id)
    if (deleted) {
      set((state) => ({ quickActions: state.quickActions.filter((item) => item.id !== id) }))
    }
    return deleted
  },
  executeQuickAction: async (request: { id: string } | { spec: QuickActionCreateInput['action'] }) => {
    return window.electronAPI.executeQuickAction(request)
  },
  createQuickActionDesktopShortcut: async (id: string) => {
    const { shortcutPath } = await window.electronAPI.createQuickActionDesktopShortcut(id)
    set((state) => ({
      quickActions: sortQuickActions(state.quickActions.map((item) => (item.id === id ? { ...item, shortcutState: 'valid' as const, desktopShortcutPath: shortcutPath } : item))),
    }))
    return shortcutPath
  },
  removeQuickActionDesktopShortcut: async (id: string) => {
    const removed = await window.electronAPI.removeQuickActionDesktopShortcut(id)
    if (removed) {
      set((state) => ({
        quickActions: sortQuickActions(state.quickActions.map((item) => (item.id === id ? { ...item, shortcutState: 'none' as const, desktopShortcutPath: undefined } : item))),
      }))
    }
    return removed
  },
  reorderQuickAction: async (id: string, direction: 'up' | 'down') => {
    const sorted = sortQuickActions(get().quickActions)
    const index = sorted.findIndex((item) => item.id === id)
    if (index < 0) return
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    // 跨组不移动：相邻判定限定在同组邻居内。
    if (targetIndex < 0 || targetIndex >= sorted.length) return
    const current = sorted[index]
    const target = sorted[targetIndex]
    if (current.group !== target.group) return

    // 本地先交换两条的 order 值，与随后落盘的主进程状态保持一致。
    set((state) => ({
      quickActions: sortQuickActions(
        state.quickActions.map((item) => {
          if (item.id === id) return { ...item, order: target.order }
          if (item.id === target.id) return { ...item, order: current.order }
          return item
        }),
      ),
    }))

    // 两条 order 互换走两次 update；service 每次均为整表读-改-写，最终状态一致，
    // 磁盘中间态仅在两次写之间崩溃时可能出现（恢复后重排即可）。
    try {
      await window.electronAPI.updateQuickAction(id, { order: target.order })
      await window.electronAPI.updateQuickAction(target.id, { order: current.order })
    } catch (error) {
      console.warn('[quickActions] reorder failed, reloading:', errorMessage(error))
      await get().loadQuickActions()
    }
  },
})
