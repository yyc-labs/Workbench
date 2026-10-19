import type { StateCreator } from 'zustand'
import type { FloatingTerminalDock, FloatingTerminalPanelState, TerminalInventoryEvent } from '../../shared/types'
import { parseTerminalProcessKey } from '../../shared/terminals'
import { resolveTerminalCollectionWake } from '../lib/terminalCollectionModel'
import { persistWorkspace } from './appStore.helpers'
import { resolveProcessUseWsl } from '../lib/processEnvironmentResolution'
import { projectDisplayName } from '../lib/projectDisplay'
import { applyInventoryRemove, applyInventoryUpsert, filterPendingTerminals, reduceTerminalInventoryEvent, reduceTerminalInventorySnapshot, shouldApplyInventoryUpdate } from '../lib/terminalInventory'
import type { AppState } from './appStore.types'

/**
 * 终端集合面板（Ctrl+J）：跨项目「项目 tab + 项目内终端」两级面板，取代原项目坞与平铺浮动终端。
 *
 * 进程运行态以主进程清单为准：初始走一次轻量快照（terminal:inventory-snapshot），
 * 之后由主进程 upsert/remove 增量事件（terminal:inventory-changed）维护，不再轮询。
 * 本 slice 只持有面板显隐/几何/激活态，以及 ::float:: 交互 shell 的启动与 title 覆盖持久化。
 */

/** 交互 shell 命令按 useWsl 记忆，避免每次开新终端都走 IPC。 */
let interactiveShellCache: { useWsl: boolean; command: string } | null = null

async function resolveInteractiveShell(useWsl: boolean): Promise<string> {
  if (interactiveShellCache?.useWsl === useWsl) return interactiveShellCache.command
  const result = await window.electronAPI.getInteractiveShellCommand(useWsl)
  interactiveShellCache = { useWsl, command: result.command }
  return result.command
}

/** 面板几何防抖合并：拖动 / resize 期间的高频变更只落一次 config。 */
let persistTimer: number | null = null

function persistFloatingPanel(panel: FloatingTerminalPanelState): void {
  if (persistTimer != null) window.clearTimeout(persistTimer)
  persistTimer = window.setTimeout(() => {
    persistTimer = null
    void window.electronAPI.setConfig({ floatingPanel: panel }).catch(() => undefined)
  }, 300)
}

/** 显隐切换立即落盘：防抖窗口内 renderer 刷新（Ctrl+R）会把刚收起的面板「复活」。 */
function persistFloatingPanelNow(panel: FloatingTerminalPanelState): void {
  if (persistTimer != null) {
    window.clearTimeout(persistTimer)
    persistTimer = null
  }
  void window.electronAPI.setConfig({ floatingPanel: panel }).catch(() => undefined)
}

function clampSizeRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.35
  return Math.min(0.8, Math.max(0.2, ratio))
}

/** 面板几何默认值。重启/renderer 刷新后 hidden 恒为 true（收起不打扰工作区）。 */
const DEFAULT_FLOATING_PANEL: FloatingTerminalPanelState = { dock: 'bottom', sizeRatio: 0.35, hidden: true }

/**
 * 从 config.floatingPanel 水合面板几何：dock/sizeRatio 恢复持久化值，hidden 强制 true。
 *
 * 主进程 loadConfig 不 normalize floatingPanel（只有 updateConfig 归一化），
 * 因此这里镜像 normalizeFloatingPanel 的规则做防御校验，容忍手改/旧版配置。
 */
export function hydrateFloatingPanel(saved: FloatingTerminalPanelState | undefined | null): FloatingTerminalPanelState {
  const dock = saved?.dock
  const sizeRatio = saved?.sizeRatio
  return {
    dock: dock === 'top' || dock === 'bottom' || dock === 'left' || dock === 'right' ? dock : DEFAULT_FLOATING_PANEL.dock,
    sizeRatio: typeof sizeRatio === 'number' && Number.isFinite(sizeRatio) ? clampSizeRatio(sizeRatio) : DEFAULT_FLOATING_PANEL.sizeRatio,
    hidden: true,
  }
}

/** 模块级 float key 高水位：进程 key 只递增不复用，避免与主进程保活会话撞 key 导致 start 失败。 */
let floatKeyHighWater = -1

/** 乐观关闭自愈定时器：停止请求异常（IPC 失败/主进程无响应）时放行 closing key，避免进程被无限隐藏。 */
const CLOSING_KEY_EXPIRY_MS = 5000
const closingKeyTimers = new Map<string, number>()

/** 基于主进程清单 + 高水位分配下一个 `::float::<n>` key。 */
function allocateFloatProcessKey(liveKeys: readonly string[], projectId: string): string {
  const prefix = `${projectId}::float::`
  let n = floatKeyHighWater
  for (const key of liveKeys) {
    if (!key.startsWith(prefix)) continue
    const parsed = Number.parseInt(key.slice(prefix.length), 10)
    if (Number.isInteger(parsed) && parsed > n) n = parsed
  }
  n += 1
  floatKeyHighWater = n
  return `${prefix}${n}`
}

/** 项目 titles 覆盖表防抖持久化（复用既有 persistWorkspace 链路）。 */
const titlePersistTimers = new Map<string, number>()

function scheduleTitlePersist(projectId: string, get: () => AppState): void {
  const existing = titlePersistTimers.get(projectId)
  if (existing != null) window.clearTimeout(existing)
  titlePersistTimers.set(
    projectId,
    window.setTimeout(() => {
      titlePersistTimers.delete(projectId)
      void persistWorkspace(get().projects, get().folders, get().tags, get().config.removedProjects)
    }, 300),
  )
}

export type TerminalCollectionActionsSlice = Pick<
  AppState,
  | 'floatingPanel'
  | 'terminalInventory'
  | 'terminalInventoryRevision'
  | 'closingTerminalKeys'
  | 'collectionActiveProjectId'
  | 'collectionActiveKey'
  | 'collectionPendingTerminals'
  | 'collectionShowToolbox'
  | 'pendingTerminalFocus'
  | 'applyTerminalInventorySnapshot'
  | 'applyTerminalInventoryEvent'
  | 'requestTerminalClose'
  | 'releaseClosingKey'
  | 'toggleTerminalCollection'
  | 'revealTerminal'
  | 'setCollectionActiveProject'
  | 'setCollectionActiveKey'
  | 'setCollectionShowToolbox'
  | 'addCollectionTerminal'
  | 'renameTerminal'
  | 'stopCollectionTerminal'
  | 'stopAllCollectionTerminals'
  | 'stopProjectTerminals'
  | 'setFloatingPanelDock'
  | 'setFloatingPanelSizeRatio'
  | 'requestProjectTerminalFocus'
  | 'consumePendingTerminalFocus'
>

export const createTerminalCollectionSlice: StateCreator<AppState, [], [], TerminalCollectionActionsSlice> = (set, get) => ({
  floatingPanel: DEFAULT_FLOATING_PANEL,
  terminalInventory: [],
  terminalInventoryRevision: 0,
  closingTerminalKeys: [],
  collectionActiveProjectId: null,
  collectionActiveKey: null,
  collectionPendingTerminals: [],
  collectionShowToolbox: false,
  pendingTerminalFocus: null,

  applyTerminalInventorySnapshot: (snapshot) => {
    // 版本守卫：旧快照不得覆盖较新的增量事件状态（快照晚到场景）。
    if (!shouldApplyInventoryUpdate(get().terminalInventoryRevision, snapshot.revision)) return
    // closing 中的 key 过滤掉：停止窗口内主进程 Map 可能仍有该进程，不过滤会复活正在关闭的终端。
    const inventory = reduceTerminalInventorySnapshot(snapshot.managedProcesses, get().closingTerminalKeys)
    set((state) => ({
      terminalInventory: inventory,
      terminalInventoryRevision: snapshot.revision,
      // 清单已收录的 key 退出占位：事件追上后 pending 让位给真实终端。
      collectionPendingTerminals: filterPendingTerminals(state.collectionPendingTerminals, inventory),
    }))
  },

  applyTerminalInventoryEvent: (event) => {
    if (!shouldApplyInventoryUpdate(get().terminalInventoryRevision, event.revision)) return
    // 迟到注册：用户已请求关闭、但 start 刚刚才注册的进程，补发一次停止
    // （主进程 stopping 集合去重，重复 stop 无害）。
    const needsLateStop = event.type === 'upsert' && get().closingTerminalKeys.includes(event.process.processId)
    const reduced = reduceTerminalInventoryEvent(get().terminalInventory, get().closingTerminalKeys, event)
    set((state) => ({
      terminalInventory: reduced.inventory,
      terminalInventoryRevision: event.revision,
      closingTerminalKeys: reduced.closingKeys,
      collectionPendingTerminals: filterPendingTerminals(state.collectionPendingTerminals, reduced.inventory),
    }))
    if (event.type === 'remove') get().releaseClosingKey(event.processKey)
    if (needsLateStop) void get().stopProject(event.process.processId)
  },

  /**
   * 乐观关闭：点 × 立即从清单/占位消失，key 进入 closing 组等待主进程 remove 确认。
   * 真正的杀死按后端时序在主进程后台进行（见 runner.ts stopPty）。
   */
  requestTerminalClose: (processKey) => {
    set((state) => {
      if (state.closingTerminalKeys.includes(processKey)) return state
      return {
        terminalInventory: applyInventoryRemove(state.terminalInventory, processKey),
        collectionPendingTerminals: state.collectionPendingTerminals.filter((pending) => pending.processKey !== processKey),
        closingTerminalKeys: [...state.closingTerminalKeys, processKey],
        collectionActiveKey: state.collectionActiveKey === processKey ? null : state.collectionActiveKey,
      }
    })
    if (closingKeyTimers.has(processKey)) return
    closingKeyTimers.set(
      processKey,
      window.setTimeout(() => {
        closingKeyTimers.delete(processKey)
        get().releaseClosingKey(processKey)
      }, CLOSING_KEY_EXPIRY_MS),
    )
  },

  /** closing key 确认/过期放行：remove 事件确认或自愈定时器触发时调用。 */
  releaseClosingKey: (processKey) => {
    const timer = closingKeyTimers.get(processKey)
    if (timer != null) {
      window.clearTimeout(timer)
      closingKeyTimers.delete(processKey)
    }
    set((state) => (state.closingTerminalKeys.includes(processKey) ? { closingTerminalKeys: state.closingTerminalKeys.filter((key) => key !== processKey) } : state))
  },

  /** 开关：可见 → 整体隐藏（会话保活）；隐藏 → 按唤醒决策定位或新建。 */
  toggleTerminalCollection: async (contextProjectId?: string) => {
    const panel = get().floatingPanel
    if (!panel.hidden) {
      const next = { ...panel, hidden: true }
      set({ floatingPanel: next })
      persistFloatingPanelNow(next)
      return
    }
    // 唤醒决策（纯函数 resolveTerminalCollectionWake）：
    // 非项目路由且集合里已有任意会话 → 只唤醒不新建；项目路由该项目没有终端 → 新建。
    const decision = resolveTerminalCollectionWake({
      contextProjectId,
      activeProjectId: get().collectionActiveProjectId,
      recentProjectIds: [...get().projects].sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0)).map((project) => project.id),
      pendingProjectIds: get().collectionPendingTerminals.map((pending) => pending.projectId),
      inventoryProcessIds: get().terminalInventory.map((snapshot) => snapshot.processId),
    })
    if (decision.action === 'none') return
    if (decision.action === 'create') {
      const project = get().projects.find((item) => item.id === decision.projectId)
      if (!project) return
      await get().addCollectionTerminal(decision.projectId, project.path)
      return
    }
    const next = { ...panel, hidden: false }
    set({ floatingPanel: next, collectionActiveProjectId: decision.projectId, collectionActiveKey: null })
    persistFloatingPanel(next)
  },

  /** 显示面板并聚焦指定项目的指定进程（跨页面入口 / 脚本终端落地用）。 */
  revealTerminal: (projectId, processKey) => {
    const next = { ...get().floatingPanel, hidden: false }
    set({ floatingPanel: next, collectionActiveProjectId: projectId, collectionActiveKey: processKey ?? null })
    persistFloatingPanel(next)
  },

  setCollectionActiveProject: (projectId) => {
    // 切项目时清空激活 key，组件回落到该项目第一个终端。
    set({ collectionActiveProjectId: projectId, collectionActiveKey: null })
  },

  setCollectionActiveKey: (processKey) => {
    set({ collectionActiveKey: processKey })
  },

  setCollectionShowToolbox: (visible) => {
    set({ collectionShowToolbox: visible })
  },

  /** 给指定项目新建交互 shell 终端（`::float::<n>`），成功后聚焦。 */
  addCollectionTerminal: async (projectId, cwd) => {
    const project = get().projects.find((item) => item.id === projectId)
    if (!project) return false
    const useWsl = resolveProcessUseWsl(cwd) ?? false

    let shellCommand: string
    try {
      shellCommand = await resolveInteractiveShell(useWsl)
    } catch {
      return false
    }

    // 分配 key 前查主进程清单：顶过高水位，避免与保活会话撞 key。
    let liveKeys: string[] = []
    try {
      const managed = await window.electronAPI.listManagedProcesses()
      liveKeys = (managed ?? []).map((item) => item.processId)
    } catch {
      /* 查询失败：仅依赖高水位 */
    }
    const processKey = allocateFloatProcessKey(liveKeys, projectId)

    // 先出 UI：项目 tab 与「启动中」占位立即可见，pty 启动随后异步进行，避免用户以为卡住。
    const next = { ...get().floatingPanel, hidden: false }
    set((state) => ({
      floatingPanel: next,
      collectionActiveProjectId: projectId,
      collectionActiveKey: processKey,
      collectionPendingTerminals: [...state.collectionPendingTerminals, { processKey, projectId, title: projectDisplayName(project) }],
    }))
    persistFloatingPanelNow(next)

    // 显式传 'silent' 启动模式：集合终端永远走托管 pty，不跟随项目 runStartupMode。
    const started = await get().startProject(projectId, shellCommand, processKey, useWsl, cwd, 'silent')
    if (!started) {
      // 启动失败：移除占位，激活 key 回落（组件取该项目第一个或空态），面板保持可见。
      set((state) => ({
        collectionActiveKey: null,
        collectionPendingTerminals: state.collectionPendingTerminals.filter((pending) => pending.processKey !== processKey),
      }))
      return false
    }
    return true
  },

  /** 重命名终端；空标题删除覆盖条目并回落默认 title。 */
  renameTerminal: (projectId, processKey, title) => {
    const trimmed = title.trim()
    set((state) => ({
      projects: state.projects.map((project) => {
        if (project.id !== projectId) return project
        const titles = { ...(project.terminalDock?.titles ?? {}) }
        if (trimmed) titles[processKey] = trimmed.slice(0, 80)
        else delete titles[processKey]
        const hasTitles = Object.keys(titles).length > 0
        return { ...project, terminalDock: hasTitles ? { titles } : undefined }
      }),
    }))
    scheduleTitlePersist(projectId, get)
  },

  /** 按 kind 分发停止逻辑；toolbox 与解析失败忽略。 */
  stopCollectionTerminal: (projectId, processKey) => {
    const parsed = parseTerminalProcessKey(processKey)
    if (!parsed || parsed.projectId !== projectId) return
    switch (parsed.kind) {
      case 'run':
        // run 生命周期归 scheduler；token 即 taskId。
        // 不乐观关闭：等 scheduler 真正停进程时主进程推 remove，避免假装已关。
        if (parsed.token) void get().stopRunTask(projectId, parsed.token)
        return
      case 'primary':
      case 'script':
      case 'float':
        // 乐观关闭：立即从清单/占位消失；主进程 stop 入口同步推 remove 事件确认，
        // 真正的杀死按后端时序（runner.ts stopPty A/B）在后台进行。
        get().requestTerminalClose(processKey)
        void get().stopProject(processKey)
        return
      case 'toolbox':
        // toolbox 仅查看，不提供关闭。
        return
    }
  },

  /** 一键停止全部项目全部终端（当前清单内的非 toolbox 进程）。 */
  stopAllCollectionTerminals: () => {
    for (const snapshot of get().terminalInventory) {
      const parsed = parseTerminalProcessKey(snapshot.processId)
      if (!parsed || parsed.kind === 'toolbox') continue
      get().stopCollectionTerminal(parsed.projectId, snapshot.processId)
    }
  },

  /** 停止指定项目的全部终端（当前清单内非 toolbox + 启动中占位）。 */
  stopProjectTerminals: (projectId) => {
    for (const snapshot of get().terminalInventory) {
      const parsed = parseTerminalProcessKey(snapshot.processId)
      if (!parsed || parsed.projectId !== projectId || parsed.kind === 'toolbox') continue
      get().stopCollectionTerminal(projectId, snapshot.processId)
    }
    // 启动中占位：主进程可能尚未注册，补一次 stopProject 并直接移除占位。
    const pendingKeys = get()
      .collectionPendingTerminals.filter((pending) => pending.projectId === projectId)
      .map((pending) => pending.processKey)
    if (pendingKeys.length === 0) return
    for (const processKey of pendingKeys) {
      void get().stopProject(processKey)
    }
    set((state) => ({
      collectionPendingTerminals: state.collectionPendingTerminals.filter((pending) => pending.projectId !== projectId),
      collectionActiveKey: state.collectionActiveProjectId === projectId && pendingKeys.includes(state.collectionActiveKey ?? '') ? null : state.collectionActiveKey,
    }))
  },

  setFloatingPanelDock: (dock: FloatingTerminalDock) => {
    const next = { ...get().floatingPanel, dock }
    set({ floatingPanel: next })
    persistFloatingPanel(next)
  },

  setFloatingPanelSizeRatio: (sizeRatio) => {
    const next = { ...get().floatingPanel, sizeRatio: clampSizeRatio(sizeRatio) }
    set({ floatingPanel: next })
    persistFloatingPanel(next)
  },

  requestProjectTerminalFocus: (projectId, processKey) => {
    set({ pendingTerminalFocus: { projectId, processKey } })
  },

  consumePendingTerminalFocus: () => {
    const pending = get().pendingTerminalFocus
    if (pending) set({ pendingTerminalFocus: null })
    return pending
  },
})
