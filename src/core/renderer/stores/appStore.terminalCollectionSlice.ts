import type { StateCreator } from 'zustand'
import type { FloatingTerminalDock, FloatingTerminalPanelState } from '../../shared/types'
import { parseTerminalProcessKey } from '../../shared/terminals'
import { persistWorkspace } from './appStore.helpers'
import { resolveProcessUseWsl } from '../lib/processEnvironmentResolution'
import { projectDisplayName } from '../lib/projectDisplay'
import type { AppState } from './appStore.types'

/**
 * 终端集合面板（Ctrl+J）：跨项目「项目 tab + 项目内终端」两级面板，取代原项目坞与平铺浮动终端。
 *
 * 进程运行态以主进程清单（terminal:list-all）为准，本 slice 只持有面板显隐/几何/激活态，
 * 以及 ::float:: 交互 shell 的启动与 title 覆盖持久化。
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

/** 模块级 float key 高水位：进程 key 只递增不复用，避免与主进程保活会话撞 key 导致 start 失败。 */
let floatKeyHighWater = -1

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
  | 'collectionActiveProjectId'
  | 'collectionActiveKey'
  | 'collectionPendingTerminals'
  | 'collectionShowToolbox'
  | 'pendingTerminalFocus'
  | 'setTerminalInventory'
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
  floatingPanel: { dock: 'bottom', sizeRatio: 0.35, hidden: true },
  terminalInventory: [],
  collectionActiveProjectId: null,
  collectionActiveKey: null,
  collectionPendingTerminals: [],
  collectionShowToolbox: false,
  pendingTerminalFocus: null,

  setTerminalInventory: (inventory) => {
    // 清单已收录的 key 退出占位：轮询追上后 pending 让位给真实终端。
    const liveKeys = new Set(inventory.map((snapshot) => snapshot.processId))
    set((state) => ({
      terminalInventory: inventory,
      collectionPendingTerminals: state.collectionPendingTerminals.filter((pending) => !liveKeys.has(pending.processKey)),
    }))
  },

  /** 开关：可见 → 整体隐藏（会话保活）；隐藏 → 唤醒并定位到上下文项目。 */
  toggleTerminalCollection: async (contextProjectId?: string) => {
    const panel = get().floatingPanel
    if (!panel.hidden) {
      const next = { ...panel, hidden: true }
      set({ floatingPanel: next })
      persistFloatingPanelNow(next)
      return
    }
    // 唤醒：上下文项目 ?? 上次激活项目 ?? 最近项目。
    const projects = [...get().projects].sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0))
    const targetProjectId = contextProjectId ?? get().collectionActiveProjectId ?? projects[0]?.id
    if (!targetProjectId) return
    const project = get().projects.find((item) => item.id === targetProjectId)
    if (!project) return
    // 该项目一个终端都没有（含启动中占位）：直接新建，保证「在项目里 Ctrl+J 就能看到该项目的终端」。
    const hasTerminals =
      get().collectionPendingTerminals.some((pending) => pending.projectId === targetProjectId) ||
      get().terminalInventory.some((snapshot) => {
        const parsed = parseTerminalProcessKey(snapshot.processId)
        return parsed?.projectId === targetProjectId && parsed.kind !== 'toolbox'
      })
    if (!hasTerminals) {
      await get().addCollectionTerminal(targetProjectId, project.path)
      return
    }
    const next = { ...panel, hidden: false }
    set({ floatingPanel: next, collectionActiveProjectId: targetProjectId, collectionActiveKey: null })
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
        if (parsed.token) void get().stopRunTask(projectId, parsed.token)
        return
      case 'primary':
      case 'script':
      case 'float':
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
