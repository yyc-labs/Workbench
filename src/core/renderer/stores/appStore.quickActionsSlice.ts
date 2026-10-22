import type { StateCreator } from 'zustand'
import type { QuickActionCreateInput, QuickActionUpdateInput, QuickActionView } from '../../shared/types'
import type { AppState } from './appStore.types'

export type QuickActionsSlice = Pick<AppState, 'quickActions' | 'quickActionsLoading' | 'loadQuickActions' | 'createQuickAction' | 'updateQuickAction' | 'deleteQuickAction' | 'executeQuickAction' | 'reorderQuickActionGroup' | 'createQuickActionDesktopShortcut' | 'removeQuickActionDesktopShortcut'>

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
  // 组内拖拽排序：本地先按目标序列落 0..n-1 的 order（与主进程 normalize 规则一致），
  // 再仅对位置变化的项逐条 updateQuickAction 落盘；失败时重载回滚。
  reorderQuickActionGroup: async (group, orderedIds) => {
    const previous = sortQuickActions(get().quickActions).filter((item) => item.group === group)
    // 集合不一致时直接重载，避免写入错误的 order。
    if (orderedIds.length !== previous.length || previous.some((item) => !orderedIds.includes(item.id))) {
      await get().loadQuickActions()
      return
    }
    const rank = new Map(orderedIds.map((id, index) => [id, index]))
    const changedIds = orderedIds.filter((id, index) => previous[index]?.id !== id)
    if (changedIds.length === 0) return

    set((state) => ({
      quickActions: sortQuickActions(
        state.quickActions.map((item) => {
          const nextOrder = item.group === group ? rank.get(item.id) : undefined
          return nextOrder === undefined ? item : { ...item, order: nextOrder }
        }),
      ),
    }))

    try {
      for (const id of changedIds) {
        await window.electronAPI.updateQuickAction(id, { order: rank.get(id) as number })
      }
    } catch (error) {
      console.warn('[quickActions] reorder failed, reloading:', errorMessage(error))
      await get().loadQuickActions()
    }
  },
})
