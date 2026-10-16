import { existsSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { projectIdFromPath } from '../../../shared/rules'
import type { AppConfig, QuickAction, QuickActionCreateInput, QuickActionExecuteRequest, QuickActionResult, QuickActionShortcutState, QuickActionSpec, QuickActionUpdateInput, QuickActionView } from '../../../shared/types'
import { deriveQuickActionGroup, deriveQuickActionIcon, normalizeQuickActions, sanitizeQuickActionName } from '../config/config-quick-actions'
import type { RunTaskService } from '../run-tasks/run-task-service'
import type { ShortcutLinkState } from './quickActionLinkFile'

export type QuickActionServiceDeps = {
  loadConfig: () => AppConfig
  updateConfig: (partial: Partial<AppConfig>) => Promise<AppConfig>
  /** RunTaskService is created after app-services; the getter defers the reference. */
  getRunTaskService: () => Pick<RunTaskService, 'start' | 'startAll' | 'getConfig'> | null
  /** True when the path belongs to a saved project and exists on disk. */
  validateProjectPath: (projectPath: string) => boolean
  navigateMainWindow: (pathname: string) => void
  ensureWindowVisible: () => void
  openPath: (path: string) => Promise<string>
  openExternal: (url: string) => Promise<void>
  randomUUID: () => string
  /** Desktop `.lnk` capability; absent on non-Windows platforms. */
  desktopShortcuts?: {
    createShortcutLink: (action: QuickAction) => Promise<string>
    removeShortcutLink: (shortcutPath: string) => Promise<boolean>
    checkShortcutState: (shortcutPath: string, exePath: string) => ShortcutLinkState
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

  /** Internal path for shortcut bookkeeping — not exposed via the update API. */
  async function setDesktopShortcutPath(id: string, shortcutPath: string | undefined): Promise<void> {
    const actions = readActions()
    const next = actions.map((item) => {
      if (item.id !== id) return item
      const updated: QuickAction = { ...item, updatedAt: Date.now() }
      if (shortcutPath) updated.desktopShortcutPath = shortcutPath
      else delete updated.desktopShortcutPath
      return updated
    })
    await writeActions(next)
  }

  function nextOrderInGroup(actions: QuickAction[], group: QuickAction['group']): number {
    const max = actions.reduce((current, item) => (item.group === group && item.order > current ? item.order : current), -1)
    return max + 1
  }

  async function executeSpec(spec: QuickActionSpec): Promise<QuickActionResult> {
    switch (spec.type) {
      case 'open-project': {
        if (!spec.projectPath || !deps.validateProjectPath(spec.projectPath)) {
          return { ok: false, code: 'invalid-project' }
        }
        deps.ensureWindowVisible()
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
        if (spec.taskId) {
          const task = config?.tasks.find((item) => item.id === spec.taskId)
          if (!task) return { ok: false, code: 'invalid-task' }
          const started = await runTaskService.start(projectId, spec.projectPath, task)
          if (!started) return { ok: false, code: 'exec-failed', error: `Failed to start task '${task.name}'.` }
          return { ok: true, kind: 'task-started', taskIds: [task.id] }
        }
        const result = await runTaskService.startAll(projectId, spec.projectPath, config)
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
    list(): QuickActionView[] {
      return readActions().map((action) => {
        let shortcutState: QuickActionShortcutState = 'none'
        if (action.desktopShortcutPath && deps.desktopShortcuts) {
          // 'drifted' (target moved, e.g. relocated install) reports as 'missing'
          // so the UI shows the "shortcut invalid" badge.
          shortcutState = deps.desktopShortcuts.checkShortcutState(action.desktopShortcutPath, process.execPath) === 'valid' ? 'valid' : 'missing'
        }
        return { ...action, shortcutState }
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

    async execute(request: QuickActionExecuteRequest): Promise<QuickActionResult> {
      if ('id' in request) {
        const action = readActions().find((item) => item.id === request.id)
        if (!action) return { ok: false, code: 'not-found' }
        if (!action.enabled) return { ok: false, code: 'disabled' }
        return executeSpec(action.action)
      }
      return executeSpec(request.spec)
    },

    async createDesktopShortcut(id: string): Promise<{ shortcutPath: string }> {
      const action = readActions().find((item) => item.id === id)
      if (!action) throw new QuickActionNotFoundError(id)
      if (!deps.desktopShortcuts) throw new Error('Desktop shortcuts are not available on this platform.')
      const shortcutPath = await deps.desktopShortcuts.createShortcutLink(action)
      await setDesktopShortcutPath(id, shortcutPath)
      return { shortcutPath }
    },

    async removeDesktopShortcut(id: string): Promise<boolean> {
      const action = readActions().find((item) => item.id === id)
      if (!action) throw new QuickActionNotFoundError(id)
      if (!action.desktopShortcutPath) return false
      if (deps.desktopShortcuts) {
        await deps.desktopShortcuts.removeShortcutLink(action.desktopShortcutPath)
      } else {
        await unlink(action.desktopShortcutPath).catch(() => undefined)
      }
      await setDesktopShortcutPath(id, undefined)
      return true
    },

    /**
     * Startup repair pass: silently rebuilds shortcuts whose file went missing
     * or whose target drifted (e.g. the app moved). Failures only log.
     */
    async repairDesktopShortcuts(): Promise<void> {
      if (!deps.desktopShortcuts) return
      for (const action of readActions()) {
        if (!action.desktopShortcutPath) continue
        if (deps.desktopShortcuts.checkShortcutState(action.desktopShortcutPath, process.execPath) === 'valid') continue
        try {
          const shortcutPath = await deps.desktopShortcuts.createShortcutLink(action)
          await setDesktopShortcutPath(action.id, shortcutPath)
        } catch (error) {
          console.warn('[quick-actions] Failed to rebuild desktop shortcut:', error)
        }
      }
    },
  }
}

export type QuickActionService = ReturnType<typeof createQuickActionService>
