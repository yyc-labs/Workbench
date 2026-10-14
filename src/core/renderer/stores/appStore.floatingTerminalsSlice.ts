import type { StateCreator } from 'zustand'
import type { FloatingTerminalDock, FloatingTerminalInstance } from '../../shared/types'
import { projectDisplayName } from '../lib/projectDisplay'
import { resolveProcessUseWsl } from '../lib/processEnvironmentResolution'
import type { AppState } from './appStore.types'

/** 交互 shell 命令按 useWsl 记忆，避免每次开新实例都走 IPC。 */
let interactiveShellCache: { useWsl: boolean; command: string } | null = null

async function resolveInteractiveShell(useWsl: boolean): Promise<string> {
  if (interactiveShellCache?.useWsl === useWsl) return interactiveShellCache.command
  const result = await window.electronAPI.getInteractiveShellCommand(useWsl)
  interactiveShellCache = { useWsl, command: result.command }
  return result.command
}

/** 几何持久化防抖合并：拖动 / resize 期间的高频变更只落一次 config。 */
let persistTimer: number | null = null

function persistFloatingTerminals(instances: FloatingTerminalInstance[]): void {
  if (persistTimer != null) {
    window.clearTimeout(persistTimer)
  }
  persistTimer = window.setTimeout(() => {
    persistTimer = null
    void window.electronAPI.setConfig({ floatingTerminals: instances }).catch(() => undefined)
  }, 300)
}

/** 关闭类操作专用：立即落盘。防抖的 300ms 窗口内若发生 renderer 刷新（Ctrl+R），定时器随旧进程死亡，关闭会被「复活」。 */
function persistFloatingTerminalsNow(instances: FloatingTerminalInstance[]): void {
  if (persistTimer != null) {
    window.clearTimeout(persistTimer)
    persistTimer = null
  }
  void window.electronAPI.setConfig({ floatingTerminals: instances }).catch(() => undefined)
}

function clampSizeRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.35
  return Math.min(0.8, Math.max(0.2, ratio))
}

const FLOATING_Z_INDEX_BASE = 9000
const FLOATING_Z_INDEX_MAX = 9997

/** 模块级 zIndex 计数器；hydrate 时从已恢复实例的最大值继续。 */
let floatingZIndexCounter = FLOATING_Z_INDEX_BASE

function nextFloatingZIndex(): number {
  floatingZIndexCounter = Math.min(FLOATING_Z_INDEX_MAX, floatingZIndexCounter + 1)
  return floatingZIndexCounter
}

/** 模块级 float key 高水位：进程 key 只递增不复用，避免关闭后主进程条目未清（≤3.5s 安全网）时重开撞 key 导致 start 失败。 */
let floatKeyHighWater = -1

function allocateFloatProcessKey(instances: FloatingTerminalInstance[], projectId: string): { processKey: string; n: number } {
  const prefix = `${projectId}::float::`
  let n = floatKeyHighWater
  for (const instance of instances) {
    if (!instance.processKey.startsWith(prefix)) continue
    const parsed = Number.parseInt(instance.processKey.slice(prefix.length), 10)
    if (Number.isInteger(parsed) && parsed > n) n = parsed
  }
  n += 1
  floatKeyHighWater = n
  return { processKey: `${prefix}${n}`, n }
}

function basenameOfPath(pathValue: string): string {
  const normalized = pathValue.replace(/[\\/]+$/, '')
  const segments = normalized.split(/[\\/]/)
  return segments[segments.length - 1] || normalized
}

export type FloatingTerminalActionsSlice = Pick<
  AppState,
  | 'floatingTerminals'
  | 'activeFloatingTerminalId'
  | 'setActiveFloatingTerminal'
  | 'attachFloatingTerminal'
  | 'addFloatingTerminal'
  | 'closeFloatingTerminal'
  | 'closeAllFloatingTerminals'
  | 'hideAllFloatingTerminals'
  | 'setFloatingTerminalDock'
  | 'setFloatingTerminalSizeRatio'
  | 'focusFloatingTerminal'
  | 'toggleFloatingTerminals'
  | 'reconnectFloatingTerminal'
  | 'hydrateFloatingTerminals'
>

/** 模块级 hydrate 守卫：persist 会触发 config 变化使 Layer 的 effect 重跑，防止死循环/重复恢复。缓存 promise 让 toggle 等待同一次清理完成。 */
let floatingTerminalsHydratePromise: Promise<void> | null = null

export const createFloatingTerminalsSlice: StateCreator<AppState, [], [], FloatingTerminalActionsSlice> = (set, get) => ({
  floatingTerminals: [],
  activeFloatingTerminalId: null,

  setActiveFloatingTerminal: (id) => {
    set({ activeFloatingTerminalId: id })
  },

  /** 一键关闭：终止全部会话并清空面板（含已结束的死会话）。 */
  closeAllFloatingTerminals: () => {
    const instances = [...get().floatingTerminals]
    for (const instance of instances) {
      void get().stopProject(instance.processKey)
    }
    set({ floatingTerminals: [], activeFloatingTerminalId: null })
    persistFloatingTerminalsNow([])
  },

  /** 把已在运行的进程（如 ::script:: 脚本）挂进面板显示：同 key 已挂过则激活，否则新增标签。 */
  attachFloatingTerminal: (input) => {
    const existing = get().floatingTerminals.find((instance) => instance.processKey === input.processKey)
    if (existing) {
      set((state) => ({
        floatingTerminals: state.floatingTerminals.map((instance) => (instance.id === existing.id ? { ...instance, hidden: false, zIndex: nextFloatingZIndex() } : instance)),
        activeFloatingTerminalId: existing.id,
      }))
      persistFloatingTerminals(get().floatingTerminals)
      return
    }
    const existingAll = get().floatingTerminals
    const instance: FloatingTerminalInstance = {
      id: input.processKey,
      processKey: input.processKey,
      projectId: input.projectId,
      cwd: input.cwd,
      useWsl: input.useWsl,
      title: input.title,
      dock: existingAll[0]?.dock ?? 'bottom',
      sizeRatio: existingAll[0]?.sizeRatio ?? 0.35,
      zIndex: nextFloatingZIndex(),
    }
    set((state) => ({ floatingTerminals: [...state.floatingTerminals, instance], activeFloatingTerminalId: instance.id }))
    persistFloatingTerminals(get().floatingTerminals)
  },

  addFloatingTerminal: async (projectId, cwd) => {
    const existing = get().floatingTerminals
    const { processKey } = allocateFloatProcessKey(existing, projectId)
    const useWsl = resolveProcessUseWsl(cwd) ?? false
    const project = get().projects.find((p) => p.id === projectId)
    const title = project ? projectDisplayName(project) : basenameOfPath(cwd)

    // 单面板多标签：新标签继承面板现有几何（全部实例共享 dock/sizeRatio）。
    const instance: FloatingTerminalInstance = {
      id: processKey,
      processKey,
      projectId,
      cwd,
      useWsl,
      title,
      dock: existing[0]?.dock ?? 'bottom',
      sizeRatio: existing[0]?.sizeRatio ?? 0.35,
      zIndex: nextFloatingZIndex(),
    }

    const removeInstance = () => {
      const rest = get().floatingTerminals.filter((item) => item.id !== instance.id)
      set((state) => ({
        floatingTerminals: rest,
        activeFloatingTerminalId: state.activeFloatingTerminalId === instance.id ? (rest[rest.length - 1]?.id ?? null) : state.activeFloatingTerminalId,
      }))
      persistFloatingTerminalsNow(get().floatingTerminals)
    }

    // 先出 UI：面板与标签立即可见，shell 解析与 pty 启动随后异步进行，避免用户以为卡住。
    set((state) => ({ floatingTerminals: [...state.floatingTerminals, instance], activeFloatingTerminalId: instance.id }))
    persistFloatingTerminals(get().floatingTerminals)

    let shellCommand: string
    try {
      shellCommand = await resolveInteractiveShell(useWsl)
    } catch {
      removeInstance()
      return false
    }

    // 显式传 'silent' 启动模式：浮动终端永远走托管 pty，不跟随项目 runStartupMode。
    const started = await get().startProject(projectId, shellCommand, processKey, useWsl, cwd, 'silent')
    if (!started) {
      removeInstance()
      return false
    }
    return true
  },

  /** 标签 ×：真关闭——终止该终端会话并移除标签（与隐藏面板保活语义相对）。 */
  closeFloatingTerminal: (id) => {
    const target = get().floatingTerminals.find((item) => item.id === id)
    set((state) => {
      const next = state.floatingTerminals.filter((item) => item.id !== id)
      return {
        floatingTerminals: next,
        activeFloatingTerminalId: state.activeFloatingTerminalId === id ? (next[next.length - 1]?.id ?? null) : state.activeFloatingTerminalId,
      }
    })
    persistFloatingTerminalsNow(get().floatingTerminals)
    if (target) {
      void get().stopProject(target.processKey)
    }
  },

  /** 隐藏整个面板但保留所有会话：进程继续在主进程运行，可在 /settings/logs 查看，Ctrl+J 重新唤起。 */
  hideAllFloatingTerminals: () => {
    set((state) => ({ floatingTerminals: state.floatingTerminals.map((instance) => ({ ...instance, hidden: true })) }))
    persistFloatingTerminals(get().floatingTerminals)
  },

  // 单面板多标签：dock / sizeRatio 是面板级几何，应用到全部实例保持一致。
  setFloatingTerminalDock: (id, dock, sizeRatio) => {
    set((state) => ({
      floatingTerminals: state.floatingTerminals.map((instance) => ({
        ...instance,
        dock,
        sizeRatio: clampSizeRatio(sizeRatio ?? instance.sizeRatio),
      })),
    }))
    persistFloatingTerminals(get().floatingTerminals)
    get().focusFloatingTerminal(id)
  },

  setFloatingTerminalSizeRatio: (_id, sizeRatio) => {
    set((state) => ({
      floatingTerminals: state.floatingTerminals.map((instance) => ({ ...instance, sizeRatio: clampSizeRatio(sizeRatio) })),
    }))
    persistFloatingTerminals(get().floatingTerminals)
  },

  focusFloatingTerminal: (id) => {
    set((state) => ({
      floatingTerminals: state.floatingTerminals.map((instance) => (instance.id === id ? { ...instance, zIndex: nextFloatingZIndex() } : instance)),
    }))
    persistFloatingTerminals(get().floatingTerminals)
  },

  toggleFloatingTerminals: async () => {
    // 先等 hydrate 完成：Ctrl+R 重载后死会话清理/存活恢复是异步的，
    // 不等的话「无实例→新开」会与旧会话撞 processKey（start 失败 → 面板闪现即消失）。
    await get().hydrateFloatingTerminals()
    const instances = get().floatingTerminals
    if (instances.length > 0) {
      const anyVisible = instances.some((item) => !item.hidden)
      if (anyVisible) {
        // 有可见面板：整体隐藏（会话不终止，继续保活，可在 /settings/logs 查看）。
        get().hideAllFloatingTerminals()
        return
      }
      // 全部隐藏：恢复显示并聚焦最上层标签。
      const top = instances.reduce((best, item) => (item.zIndex > best.zIndex ? item : best), instances[0])
      set((state) => ({
        floatingTerminals: state.floatingTerminals.map((instance) => ({ ...instance, hidden: false, zIndex: instance.id === top.id ? nextFloatingZIndex() : instance.zIndex })),
        activeFloatingTerminalId: top.id,
      }))
      persistFloatingTerminals(get().floatingTerminals)
      return
    }
    // 无实例：取最近打开的项目新开一个。
    const projects = [...get().projects].sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0))
    const target = projects[0]
    if (!target) return
    await get().addFloatingTerminal(target.id, target.path)
  },

  reconnectFloatingTerminal: async (id) => {
    const instance = get().floatingTerminals.find((item) => item.id === id)
    if (!instance) return false
    const shellCommand = await resolveInteractiveShell(instance.useWsl)
    // 重连复用原 processKey 与几何；不静默复活其它实例。
    return get().startProject(instance.projectId, shellCommand, instance.processKey, instance.useWsl, instance.cwd, 'silent')
  },

  hydrateFloatingTerminals: () => {
    // 幂等 + 并发安全：多次调用共享同一次清理。
    if (!floatingTerminalsHydratePromise) {
      floatingTerminalsHydratePromise = (async () => {
        const persisted = get().config.floatingTerminals
        if (!Array.isArray(persisted)) return
        if (get().floatingTerminals.length > 0) return

        // 【自动清理已注释】原逻辑：查 listManagedProcesses 快照，只恢复仍存活的会话、死会话直接清空。
        // 现改为恢复全部持久化实例：死会话显示「会话已结束/重新连接」遮罩，由标签条的「一键关闭会话」按钮手动清理。
        // const liveKeys = new Set<string>()
        // try {
        //   const managed = await window.electronAPI.listManagedProcesses()
        //   for (const item of managed ?? []) liveKeys.add(item.processId)
        // } catch {
        //   /* 查询失败视为全部已结束 */
        // }
        // const alive = persisted.filter((item) => liveKeys.has(item.processKey))
        const liveKeys = new Set<string>()
        try {
          const managed = await window.electronAPI.listManagedProcesses()
          for (const item of managed ?? []) liveKeys.add(item.processId)
        } catch {
          /* 查询失败：全部按已结束处理，靠重连遮罩呈现 */
        }
        floatingZIndexCounter = Math.max(FLOATING_Z_INDEX_BASE, ...persisted.map((item) => item.zIndex))
        // 高水位顶过所有持久化 key：renderer 重载会重置模块计数器，
        // 不顶的话新开终端会复用仍在主进程存活的旧 key（start 失败 → 面板闪现即消失）。
        for (const item of persisted) {
          const match = /::float::(\d+)$/.exec(item.processKey)
          const parsed = match ? Number.parseInt(match[1], 10) : Number.NaN
          if (Number.isInteger(parsed) && parsed > floatKeyHighWater) floatKeyHighWater = parsed
        }
        set((state) => ({
          floatingTerminals: persisted,
          activeFloatingTerminalId: persisted[0]?.id ?? null,
          // 存活会话同步为 running（syncManagedProcesses 跳过 ::float:: 键）；死会话走重连遮罩。
          processes: {
            ...state.processes,
            ...Object.fromEntries(persisted.filter((item) => liveKeys.has(item.processKey)).map((item) => [item.processKey, { pid: null, status: 'running' as const }])),
          },
        }))
      })()
    }
    return floatingTerminalsHydratePromise
  },
})
