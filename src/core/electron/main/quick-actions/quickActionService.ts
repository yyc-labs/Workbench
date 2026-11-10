import { existsSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { projectIdFromPath } from '../../../shared/rules'
import type { AppConfig, QuickAction, QuickActionCreateInput, QuickActionExecuteRequest, QuickActionResult, QuickActionScheduleStamp, QuickActionShortcutState, QuickActionSpec, QuickActionUpdateInput, QuickActionView } from '../../../shared/types'
import { computeNextRunAt } from '../calendar/calendar-data'
import { deriveQuickActionGroup, deriveQuickActionIcon, normalizeQuickActions, sanitizeQuickActionName } from '../config/config-quick-actions'
import type { RunTaskService } from '../run-tasks/run-task-service'
import type { ShortcutLinkState } from './quickActionLinkFile'

export type QuickActionServiceDeps = {
  loadConfig: () => AppConfig
  updateConfig: (partial: Partial<AppConfig>) => Promise<AppConfig>
  /** RunTaskService is created after app-services; the getter defers the reference. */
  getRunTaskService: () => Pick<RunTaskService, 'restart' | 'restartAll' | 'getConfig'> | null
  /** True when the path belongs to a saved project and exists on disk. */
  validateProjectPath: (projectPath: string) => boolean
  navigateMainWindow: (pathname: string) => void
  ensureWindowVisible: () => void
  /** 主窗口是否存在；silent open-project 无窗口时跳过执行（D4）。 */
  hasMainWindow: () => boolean
  openPath: (path: string) => Promise<string>
  openExternal: (url: string) => Promise<void>
  randomUUID: () => string
  /** CalendarService 工作日判定：仅工作日定时与 scheduleNextRunAt 计算。 */
  isWorkday: (date: string) => boolean
  /** 可注入时钟；list() 计算 scheduleNextRunAt 使用。 */
  now: () => Date
  /** Desktop `.lnk` capability; absent on non-Windows platforms. */
  desktopShortcuts?: {
    createShortcutLink: (action: QuickAction) => Promise<string>
    /** Rewrites the `.lnk` at a recorded path (drift repair during reconcile). */
    rewriteShortcutLink: (action: QuickAction, shortcutPath: string) => Promise<string>
    removeShortcutLink: (shortcutPath: string) => Promise<boolean>
    checkShortcutState: (shortcutPath: string, expected: { quickActionId: string }) => ShortcutLinkState
  }
}

export class QuickActionNotFoundError extends Error {
  constructor(id: string) {
    super(`Quick action not found: ${id}`)
    this.name = 'QuickActionNotFoundError'
  }
}

function isAllowedQuickActionUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Desired shortcut state: explicit intent wins; legacy configs without the
 * field derive it from the recorded path (path present = the user created one).
 */
function wantsDesktopShortcut(action: QuickAction): boolean {
  return action.desktopShortcutEnabled ?? action.desktopShortcutPath !== undefined
}

/**
 * Quick Actions domain: CRUD over the persisted config table, execution
 * dispatch, and desktop shortcut lifecycle. WSL/environment decisions for
 * run-task actions are fully delegated to RunTaskService — this domain adds no
 * environment branches.
 */
export function createQuickActionService(deps: QuickActionServiceDeps) {
  function readActions(): QuickAction[] {
    return normalizeQuickActions(deps.loadConfig().quickActions).actions
  }

  /** Whole-table write path: normalize once, persist once (no intermediate single-item writes). */
  async function writeActions(actions: QuickAction[]): Promise<QuickAction[]> {
    const saved = await deps.updateConfig({ quickActions: { actions } })
    return normalizeQuickActions(saved.quickActions).actions
  }

  /**
   * Internal write path for shortcut bookkeeping — not exposed via the update
   * API. `path` records the last-known `.lnk` location (kept after a failed
   * file removal so reconcile can clean the leftover); `enabled` records the
   * desired state.
   */
  async function setDesktopShortcutState(id: string, patch: { path?: string; enabled?: boolean }): Promise<void> {
    const actions = readActions()
    const next = actions.map((item) => {
      if (item.id !== id) return item
      const updated: QuickAction = { ...item, updatedAt: Date.now() }
      // 'in' 语义：显式 undefined = 清空；字段缺省 = 不动。
      if ('path' in patch) {
        if (patch.path) updated.desktopShortcutPath = patch.path
        else delete updated.desktopShortcutPath
      }
      // 期望状态显式落布尔值：false 必须持久化（否则按路径推导会翻回 true，
      // 导致“用户删过又被重建”）。
      if ('enabled' in patch && patch.enabled !== undefined) {
        updated.desktopShortcutEnabled = patch.enabled
      }
      return updated
    })
    await writeActions(next)
  }

  function nextOrderInGroup(actions: QuickAction[], group: QuickAction['group']): number {
    const max = actions.reduce((current, item) => (item.group === group && item.order > current ? item.order : current), -1)
    return max + 1
  }

  /**
   * Internal write path for scheduler run stamps (lastRun / attempt / nextRetryAt /
   * enabled). Same whole-table pattern as setDesktopShortcutPath: readActions +
   * writeActions, no intermediate single-item writes. undefined clears a field.
   */
  async function setScheduleRunStamp(id: string, stamp: QuickActionScheduleStamp): Promise<void> {
    const actions = readActions()
    const index = actions.findIndex((item) => item.id === id)
    if (index < 0) return
    const current = actions[index]
    if (!current.schedule) return
    const schedule = { ...current.schedule }
    // 语义：stamp 未包含的字段保持不动；显式 undefined = 清除该字段。
    const target = schedule as Record<string, unknown>
    const assign = <K extends keyof QuickActionScheduleStamp>(key: K) => {
      if (!(key in stamp)) return
      const value = stamp[key]
      if (value === undefined) delete target[key]
      else target[key] = value
    }
    assign('lastRunAt')
    assign('lastRunDate')
    assign('runSlots')
    assign('lastAttemptAt')
    assign('attemptTime')
    assign('attemptCount')
    assign('nextRetryAt')
    assign('enabled')
    const updated: QuickAction = { ...current, schedule, updatedAt: Date.now() }
    await writeActions([...actions.slice(0, index), updated, ...actions.slice(index + 1)])
  }

  /**
   * silent 语义（D4）仅改 open-project 分支：定时执行不抢焦点——无窗口跳过，
   * 有窗口只导航不 ensureWindowVisible。其余三类 silent 与手动完全相同。
   */
  async function executeSpec(spec: QuickActionSpec, silent = false): Promise<QuickActionResult> {
    switch (spec.type) {
      case 'open-project': {
        if (!spec.projectPath || !deps.validateProjectPath(spec.projectPath)) {
          return { ok: false, code: 'invalid-project' }
        }
        if (silent && !deps.hasMainWindow()) {
          console.warn('[quick-actions] Scheduled open-project skipped: no main window.')
          return { ok: false, code: 'no-window' }
        }
        if (!silent) deps.ensureWindowVisible()
        deps.navigateMainWindow(`/project/${projectIdFromPath(spec.projectPath)}/code`)
        return { ok: true, kind: 'navigated' }
      }
      case 'run-task': {
        if (!spec.projectPath || !deps.validateProjectPath(spec.projectPath)) {
          return { ok: false, code: 'invalid-project' }
        }
        const runTaskService = deps.getRunTaskService()
        if (!runTaskService) {
          return { ok: false, code: 'exec-failed', error: 'Run task service is not available.' }
        }
        const projectId = projectIdFromPath(spec.projectPath)
        const { config, error } = runTaskService.getConfig(spec.projectPath)
        if (error) {
          return { ok: false, code: 'exec-failed', error: `Failed to read run task config: ${error}` }
        }
        // 快捷操作（桌面 .lnk 双击 / 卡片 / 定时）的 run-task 语义 = 重启：
        // 交互 shell 保活后，旧终端空壳会占住进程 key，普通 start 会把它误判
        // 为「已在运行」而永远起不来新实例——先停旧实例并等释放，再启动。
        if (spec.taskId) {
          const task = config?.tasks.find((item) => item.id === spec.taskId)
          if (!task) return { ok: false, code: 'invalid-task' }
          const started = await runTaskService.restart(projectId, spec.projectPath, task)
          if (!started) return { ok: false, code: 'exec-failed', error: `Failed to start task '${task.name}'.` }
          return { ok: true, kind: 'task-started', taskIds: [task.id] }
        }
        const result = await runTaskService.restartAll(projectId, spec.projectPath, config)
        if (!result.started) {
          return { ok: false, code: 'exec-failed', error: result.error ?? 'Failed to start run tasks.' }
        }
        return { ok: true, kind: 'task-started', taskIds: (config?.tasks ?? []).map((task) => task.id) }
      }
      case 'open-path': {
        if (!spec.path || !existsSync(spec.path)) {
          return { ok: false, code: 'invalid-project' }
        }
        const error = await deps.openPath(spec.path)
        if (error) return { ok: false, code: 'exec-failed', error }
        return { ok: true, kind: 'opened' }
      }
      case 'open-url': {
        if (!spec.url || !isAllowedQuickActionUrl(spec.url)) {
          return { ok: false, code: 'invalid-spec' }
        }
        try {
          await deps.openExternal(spec.url)
          return { ok: true, kind: 'opened' }
        } catch (error) {
          return { ok: false, code: 'exec-failed', error: errorText(error) }
        }
      }
    }
  }

  return {
    /** 调度器读取入口（不算 shortcutState，不做视图增强）。 */
    readActions(): QuickAction[] {
      return readActions()
    },

    list(): QuickActionView[] {
      const now = deps.now()
      return readActions().map((action) => {
        let shortcutState: QuickActionShortcutState = 'none'
        if (action.desktopShortcutPath && deps.desktopShortcuts) {
          // drifted / unreadable both report as 'missing' so the UI shows the
          // "shortcut invalid" badge; the detailed cause is logged at reconcile
          // and verification time, not flattened here.
          shortcutState = deps.desktopShortcuts.checkShortcutState(action.desktopShortcutPath, { quickActionId: action.id }) === 'valid' ? 'valid' : 'missing'
        }
        const view: QuickActionView = { ...action, shortcutState }
        // scheduleNextRunAt 由主进程计算（仅 schedule.enabled 时存在），renderer 直接展示。
        if (action.schedule?.enabled) {
          const nextRunAt = computeNextRunAt(action.schedule, deps.isWorkday, now)
          if (nextRunAt !== undefined) view.scheduleNextRunAt = nextRunAt
        }
        return view
      })
    },

    async create(input: QuickActionCreateInput): Promise<QuickAction> {
      const actions = readActions()
      const group = input.group ?? deriveQuickActionGroup(input.action.type)
      const now = Date.now()
      const created: QuickAction = {
        id: deps.randomUUID(),
        name: sanitizeQuickActionName(input.name) || 'Untitled action',
        action: input.action,
        icon: input.icon ?? deriveQuickActionIcon(input.action.type),
        group,
        enabled: input.enabled ?? true,
        order: nextOrderInGroup(actions, group),
        createdAt: now,
        updatedAt: now,
        ...(input.schedule ? { schedule: input.schedule } : {}),
      }
      const saved = await writeActions([...actions, created])
      return saved.find((item) => item.id === created.id) ?? created
    },

    async update(id: string, input: QuickActionUpdateInput): Promise<QuickAction> {
      const actions = readActions()
      const index = actions.findIndex((item) => item.id === id)
      if (index < 0) throw new QuickActionNotFoundError(id)
      const current = actions[index]
      const updated: QuickAction = {
        ...current,
        ...(input.name === undefined ? {} : { name: sanitizeQuickActionName(input.name) || 'Untitled action' }),
        ...(input.action === undefined ? {} : { action: input.action }),
        ...(input.icon === undefined ? {} : { icon: input.icon }),
        ...(input.group === undefined ? {} : { group: input.group }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(input.order === undefined ? {} : { order: input.order }),
        updatedAt: Date.now(),
      }
      // schedule：整组替换语义；null = 清除定时（同 action 字段语义）。
      if (input.schedule === null) delete updated.schedule
      else if (input.schedule) updated.schedule = input.schedule
      // Group switch appends to the end of the new group to keep orders dense.
      if (input.group !== undefined && input.group !== current.group) {
        updated.order = nextOrderInGroup(actions, updated.group)
      }
      const saved = await writeActions([...actions.slice(0, index), updated, ...actions.slice(index + 1)])
      return saved.find((item) => item.id === id) ?? updated
    },

    async delete(id: string): Promise<boolean> {
      const actions = readActions()
      const target = actions.find((item) => item.id === id)
      if (!target) return false
      // Best effort: a stale shortcut file must not block deletion.
      if (target.desktopShortcutPath) {
        await unlink(target.desktopShortcutPath).catch(() => undefined)
      }
      await writeActions(actions.filter((item) => item.id !== id))
      return true
    },

    /**
     * options.silent 仅供调度器内部使用（D4 定时执行不抢焦点）；
     * IPC handler 的 renderer 手动触发恒不传 silent。
     */
    async execute(request: QuickActionExecuteRequest, options?: { silent?: boolean }): Promise<QuickActionResult> {
      const silent = options?.silent === true
      if ('id' in request) {
        const action = readActions().find((item) => item.id === request.id)
        if (!action) return { ok: false, code: 'not-found' }
        if (!action.enabled) return { ok: false, code: 'disabled' }
        return executeSpec(action.action, silent)
      }
      return executeSpec(request.spec, silent)
    },

    async createDesktopShortcut(id: string): Promise<{ shortcutPath: string }> {
      const action = readActions().find((item) => item.id === id)
      if (!action) throw new QuickActionNotFoundError(id)
      if (!deps.desktopShortcuts) throw new Error('Desktop shortcuts are not available on this platform.')
      const shortcutPath = await deps.desktopShortcuts.createShortcutLink(action)
      try {
        await setDesktopShortcutState(id, { path: shortcutPath, enabled: true })
      } catch (error) {
        // 补偿：文件已创建但配置写入失败时，删掉孤儿文件，避免“用户看得见、
        // 配置不知道”的快捷方式。补偿本身失败只记日志（下次对账按期望状态处理）。
        await deps.desktopShortcuts.removeShortcutLink(shortcutPath).catch((cleanupError) => {
          console.warn('[quick-actions] Failed to remove orphan shortcut after config write failure:', cleanupError)
        })
        throw error
      }
      return { shortcutPath }
    },

    async removeDesktopShortcut(id: string): Promise<boolean> {
      const action = readActions().find((item) => item.id === id)
      if (!action) throw new QuickActionNotFoundError(id)
      if (!action.desktopShortcutPath) return false
      // 先落“不再期望”再删文件：即使文件删除失败，重启对账也会按期望状态补删，
      // 绝不会出现“用户删过又被自动重建”的倒退。
      await setDesktopShortcutState(id, { enabled: false })
      const removed = deps.desktopShortcuts
        ? await deps.desktopShortcuts.removeShortcutLink(action.desktopShortcutPath)
        : await unlink(action.desktopShortcutPath)
            .then(() => true)
            .catch(() => false)
      // 删除成功才清路径；失败时保留 last-known 路径供 reconcile 清理残留。
      if (removed) await setDesktopShortcutState(id, { path: undefined })
      return true
    },

    /** 调度器运行状态回写（内部写路径，不进外部 update API）。 */
    setScheduleRunStamp,

    /**
     * Startup reconciliation: restores the *desired* shortcut state rather than
     * unconditionally rebuilding missing files. Per action:
     * - desired falsy (removed in-app): leftover files are deleted and the
     *   recorded path tidied — a desktop file loss is NOT an expression of
     *   intent, but an in-app removal is.
     * - desired truthy + valid: untouched.
     * - desired truthy + missing / drifted / unreadable: rewritten in place at
     *   the recorded path (stable name); unreadable files keep their real cause
     *   in the log instead of being flattened into 'missing'.
     * - desired truthy without a recorded path (legacy config): created at a
     *   fresh candidate name.
     * All failures are logged, never thrown — reconcile must not block startup.
     */
    async reconcileDesktopShortcuts(): Promise<void> {
      if (!deps.desktopShortcuts) return
      const actions = readActions()
      /** id → new last-known path (undefined = clear). Applied in one write. */
      const pathUpdates = new Map<string, string | undefined>()
      for (const action of actions) {
        try {
          if (!wantsDesktopShortcut(action)) {
            if (!action.desktopShortcutPath) continue
            const state = deps.desktopShortcuts.checkShortcutState(action.desktopShortcutPath, { quickActionId: action.id })
            // missing = 文件已不在，只需整理配置；其余状态 = 残留文件，补删。
            if (state !== 'missing') await deps.desktopShortcuts.removeShortcutLink(action.desktopShortcutPath)
            pathUpdates.set(action.id, undefined)
            continue
          }
          if (!action.desktopShortcutPath) {
            const shortcutPath = await deps.desktopShortcuts.createShortcutLink(action)
            pathUpdates.set(action.id, shortcutPath)
            continue
          }
          const state = deps.desktopShortcuts.checkShortcutState(action.desktopShortcutPath, { quickActionId: action.id })
          if (state === 'valid') continue
          if (state === 'unreadable') {
            console.warn(`[quick-actions] Shortcut for '${action.name}' is unreadable (corrupt or permission-denied); rebuilding.`)
          }
          // missing / drifted / unreadable → 原地重写，保留稳定文件名。
          const shortcutPath = await deps.desktopShortcuts.rewriteShortcutLink(action, action.desktopShortcutPath)
          pathUpdates.set(action.id, shortcutPath)
        } catch (error) {
          console.warn(`[quick-actions] Failed to reconcile desktop shortcut for '${action.name}':`, error)
        }
      }
      if (pathUpdates.size === 0) return
      await writeActions(
        actions.map((item) => {
          if (!pathUpdates.has(item.id)) return item
          const updated: QuickAction = { ...item, updatedAt: Date.now() }
          const path = pathUpdates.get(item.id)
          if (path) updated.desktopShortcutPath = path
          else delete updated.desktopShortcutPath
          return updated
        }),
      )
    },
  }
}

export type QuickActionService = ReturnType<typeof createQuickActionService>
