import type { QuickAction, QuickActionGroup, QuickActionIcon, QuickActionSchedule, QuickActionSpec, QuickActionsConfig, QuickActionType } from '../../../shared/types'
import { formatLocalDate, isValidDateString, isValidTimeString } from '../calendar/calendar-data'

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

const SCHEDULE_KINDS: readonly QuickActionSchedule['kind'][] = ['once', 'daily', 'weekly']
/** 同日最多尝试次数（D14）；超过视为脏数据移除。 */
const MAX_SCHEDULE_ATTEMPTS = 3
/** 单日时间点数量上限（多时间点特性的防滥用边界）。 */
const MAX_SCHEDULE_TIMES = 8

/** 'HH:mm' 列表：过滤非法、去重、升序、截断上限；空数组表示无有效值。 */
function normalizeTimeList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const times = Array.from(new Set(value.filter((time): time is string => isValidTimeString(time)))).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return times.slice(0, MAX_SCHEDULE_TIMES)
}

/**
 * schedule 归一化（§5.2）。整条丢弃仅限：kind 未知、times 无有效值、
 * once 的 date 非法。字段级降级：once 过去日期 enabled 强制 false、
 * calendarMode 缺省 every-day、weekdays 去重排序并过滤 0-6 之外值、
 * 有限性/日期合法性不满足的运行时字段移除。
 */
export function normalizeSchedule(value: unknown): QuickActionSchedule | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.kind !== 'string' || !SCHEDULE_KINDS.includes(raw.kind as QuickActionSchedule['kind'])) return null
  const kind = raw.kind as QuickActionSchedule['kind']

  // 多时间点：times 为唯一事实源；遗留单值 time 迁移为单元素列表（兼容旧配置）。
  const times = normalizeTimeList(raw.times)
  if (times.length === 0) {
    if (!isValidTimeString(raw.time)) return null
    times.push(raw.time)
  }

  const schedule: QuickActionSchedule = {
    kind,
    times,
    calendarMode: raw.calendarMode === 'workdays-only' ? 'workdays-only' : 'every-day',
    // 缺省 false：配置缺失 enabled 时不自动运行（安全侧默认）。
    enabled: raw.enabled === true,
  }

  if (kind === 'weekly' && Array.isArray(raw.weekdays)) {
    const weekdays = Array.from(new Set(raw.weekdays.filter((day): day is number => typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6))).sort((a, b) => a - b)
    // 空数组 = 每天（与类型注释一致）；不落空字段。
    if (weekdays.length > 0) schedule.weekdays = weekdays
  }

  if (kind === 'once') {
    if (!isValidDateString(raw.date)) return null
    schedule.date = raw.date
    // 已过的一次性任务强制禁用兜底（表单层先行拒绝过去日期）。
    if (raw.date < formatLocalDate(new Date())) schedule.enabled = false
  }

  if (typeof raw.lastRunAt === 'number' && Number.isFinite(raw.lastRunAt)) schedule.lastRunAt = raw.lastRunAt
  if (typeof raw.lastAttemptAt === 'number' && Number.isFinite(raw.lastAttemptAt)) schedule.lastAttemptAt = raw.lastAttemptAt
  if (typeof raw.nextRetryAt === 'number' && Number.isFinite(raw.nextRetryAt)) schedule.nextRetryAt = raw.nextRetryAt
  if (isValidTimeString(raw.attemptTime)) schedule.attemptTime = raw.attemptTime
  if (isValidDateString(raw.lastRunDate)) {
    schedule.lastRunDate = raw.lastRunDate
    const runSlots = normalizeTimeList(raw.runSlots)
    if (runSlots.length > 0) schedule.runSlots = runSlots
  }
  if (typeof raw.attemptCount === 'number' && Number.isInteger(raw.attemptCount) && raw.attemptCount >= 0 && raw.attemptCount <= MAX_SCHEDULE_ATTEMPTS) {
    schedule.attemptCount = raw.attemptCount
  }

  return schedule
}

/**
 * Normalizes the persisted quick-actions array. Rules in order:
 * 1. non-array shape → default; 2. drop entries with unknown type or invalid
 * required fields; 3. dedupe/regenerate ids; 4. sanitize names; 5. derive
 * icon/group; 6. renumber order per group; 7. boolean enabled; 8. clean
 * desktopShortcutPath; 9. finite timestamps; 10. normalize schedule
 * (invalid schedule shapes drop the whole schedule).
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
    const schedule = normalizeSchedule(item.schedule)
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
      ...(schedule ? { schedule } : {}),
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
