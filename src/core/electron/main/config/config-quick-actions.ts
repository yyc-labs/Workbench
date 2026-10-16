import type { QuickAction, QuickActionGroup, QuickActionIcon, QuickActionSpec, QuickActionsConfig, QuickActionType } from '../../../shared/types'

/**
 * Quick Actions config domain constants and normalization.
 *
 * Pure functions only — config.ts imports electron `app` at module top, so the
 * normalize logic lives here to stay unit-testable (same split as
 * config/config-migrations.ts).
 */

export const DEFAULT_QUICK_ACTIONS: QuickActionsConfig = { actions: [] }

const QUICK_ACTION_GROUPS: readonly QuickActionGroup[] = ['project', 'task', 'other']
const QUICK_ACTION_ICONS: readonly QuickActionIcon[] = ['folder-open', 'play', 'terminal', 'globe']

const DEFAULT_GROUP_BY_TYPE: Record<QuickActionType, QuickActionGroup> = {
  'open-project': 'project',
  'run-task': 'task',
  'open-path': 'other',
  'open-url': 'other',
}

const DEFAULT_ICON_BY_TYPE: Record<QuickActionType, QuickActionIcon> = {
  'open-project': 'folder-open',
  'run-task': 'play',
  'open-path': 'terminal',
  'open-url': 'globe',
}

/** Default group for an action type (plan §2.3 derivation table). */
export function deriveQuickActionGroup(type: QuickActionType): QuickActionGroup {
  return DEFAULT_GROUP_BY_TYPE[type]
}

/** Default icon for an action type (plan §2.3 derivation table). */
export function deriveQuickActionIcon(type: QuickActionType): QuickActionIcon {
  return DEFAULT_ICON_BY_TYPE[type]
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const INVALID_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g
const UNTITLED_ACTION_NAME = 'Untitled action'

/** Strips characters illegal in `.lnk` file names; shared by storage and display. */
export function sanitizeQuickActionName(name: string): string {
  return name.replace(INVALID_NAME_CHARS, '').trim()
}

function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isAllowedQuickActionUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** Validates the spec shape per type; unknown types and invalid required fields fail. */
function normalizeSpec(value: unknown): QuickActionSpec | null {
  if (!value || typeof value !== 'object') return null
  const spec = value as { type?: unknown; projectPath?: unknown; taskId?: unknown; path?: unknown; url?: unknown }
  switch (spec.type) {
    case 'open-project':
      return nonEmptyString(spec.projectPath) ? { type: 'open-project', projectPath: spec.projectPath.trim() } : null
    case 'run-task': {
      if (!nonEmptyString(spec.projectPath)) return null
      const projectPath = spec.projectPath.trim()
      if (spec.taskId === undefined || spec.taskId === null) return { type: 'run-task', projectPath }
      return nonEmptyString(spec.taskId) ? { type: 'run-task', projectPath, taskId: spec.taskId.trim() } : null
    }
    case 'open-path':
      return nonEmptyString(spec.path) ? { type: 'open-path', path: spec.path.trim() } : null
    case 'open-url': {
      const url = spec.url
      if (typeof url !== 'string' || !isAllowedQuickActionUrl(url)) return null
      return { type: 'open-url', url: url.trim() }
    }
    default:
      return null
  }
}

function normalizeGroup(value: unknown, type: QuickActionType): QuickActionGroup {
  return typeof value === 'string' && (QUICK_ACTION_GROUPS as readonly string[]).includes(value) ? (value as QuickActionGroup) : deriveQuickActionGroup(type)
}

function normalizeIcon(value: unknown, type: QuickActionType): QuickActionIcon {
  return typeof value === 'string' && (QUICK_ACTION_ICONS as readonly string[]).includes(value) ? (value as QuickActionIcon) : deriveQuickActionIcon(type)
}

function finiteTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * Normalizes the persisted quick-actions array. Rules in order:
 * 1. non-array shape → default; 2. drop entries with unknown type or invalid
 * required fields; 3. dedupe/regenerate ids; 4. sanitize names; 5. derive
 * icon/group; 6. renumber order per group; 7. boolean enabled; 8. clean
 * desktopShortcutPath; 9. finite timestamps.
 */
export function normalizeQuickActions(value: unknown): QuickActionsConfig {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { actions?: unknown }).actions)) {
    return { actions: [] }
  }
  const rawActions = (value as { actions: unknown[] }).actions
  const seenIds = new Set<string>()
  const now = Date.now()
  const normalized: QuickAction[] = []

  for (const raw of rawActions) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Partial<QuickAction>
    const spec = normalizeSpec(item.action)
    if (!spec) continue

    let id = isValidUuid(item.id) ? item.id : ''
    if (seenIds.has(id)) id = ''
    if (!id) id = crypto.randomUUID()
    seenIds.add(id)

    const name = typeof item.name === 'string' ? sanitizeQuickActionName(item.name) : ''
    normalized.push({
      id,
      name: name || UNTITLED_ACTION_NAME,
      action: spec,
      icon: normalizeIcon(item.icon, spec.type),
      group: normalizeGroup(item.group, spec.type),
      enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
      order: typeof item.order === 'number' && Number.isFinite(item.order) ? item.order : 0,
      createdAt: finiteTimestamp(item.createdAt, now),
      updatedAt: finiteTimestamp(item.updatedAt, now),
      ...(nonEmptyString(item.desktopShortcutPath) ? { desktopShortcutPath: item.desktopShortcutPath.trim() } : {}),
    })
  }

  return { actions: renumberOrders(normalized) }
}

/** Stable-sorts each group by current order, then renumbers 0..n-1 within the group. */
function renumberOrders(actions: QuickAction[]): QuickAction[] {
  const groups = new Map<QuickActionGroup, QuickAction[]>()
  for (const action of actions) {
    const list = groups.get(action.group)
    if (list) list.push(action)
    else groups.set(action.group, [action])
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.order - b.order)
    list.forEach((action, index) => {
      action.order = index
    })
  }
  return actions
}
