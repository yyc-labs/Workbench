import * as fs from 'fs'
import * as path from 'path'
import type { RunTask, RunTaskConfigFile, RunTaskConfigReadResult } from '../../../shared/runTasks'
import { RUN_TASK_CONFIG_DIR_NAME, RUN_TASK_CONFIG_FILE_NAME, RUN_TASK_LEGACY_CONFIG_FILE_NAME, RunTaskCycleError, runTaskConfigFilePath, topoSortRunTasks } from '../../../shared/runTasks'

const MAX_TASKS = 32
const MAX_SCAN_DIRECTORIES = 16

/**
 * Read + write the per-project `.yworkbench/run-tasks.json` run task config.
 * The file is the single source of truth for multi-task projects; it is only
 * written when the user explicitly saves (detect dialog / edit dialog), never
 * by the scheduler. Legacy projects with a root `.yworkbench.json` keep
 * working: that file is read as a fallback and never written again.
 */
export class RunTaskConfigStore {
  readConfig(projectPath: string): RunTaskConfigReadResult {
    const current = this.readFile(runTaskConfigFilePath(projectPath))
    if (!current.missing) return current.result

    // Fall back to the legacy root `.yworkbench.json` when the new file is absent.
    const legacyPath = path.join(projectPath, RUN_TASK_LEGACY_CONFIG_FILE_NAME)
    if (fs.existsSync(legacyPath)) {
      const legacy = this.readFile(legacyPath)
      if (!legacy.missing) return legacy.result
    }
    return { config: null }
  }

  private readFile(filePath: string): { result: RunTaskConfigReadResult; missing: boolean } {
    let raw: string
    try {
      raw = fs.readFileSync(filePath, 'utf8')
    } catch {
      return { result: { config: null }, missing: true }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { result: { config: null, error: 'invalid-json' }, missing: false }
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { result: { config: null, error: 'invalid-structure' }, missing: false }
    }

    const record = parsed as Record<string, unknown>
    const tasks = normalizeRunTasks(record.tasks)
    const scanDirectories = normalizeScanDirectories(record.scanDirectories)
    const config: RunTaskConfigFile = { version: 1, updatedAt: readUpdatedAt(record.updatedAt), tasks }
    if (scanDirectories.length > 0) config.scanDirectories = scanDirectories
    return { result: { config }, missing: false }
  }

  /**
   * Write tasks (+ optional scan directories) via an atomic tmp + rename into
   * `.yworkbench/run-tasks.json`. Throws RunTaskCycleError on invalid
   * dependency graphs.
   */
  writeConfig(projectPath: string, tasks: RunTask[], scanDirectories?: string[]): RunTaskConfigReadResult {
    const normalized = normalizeRunTasks(tasks)
    if (normalized.length === 0) {
      throw new Error('Run task config must contain at least one task.')
    }
    if (normalized.length > MAX_TASKS) {
      throw new Error(`Run task config must not contain more than ${MAX_TASKS} tasks.`)
    }
    topoSortRunTasks(normalized) // validates ids/dependsOn and rejects cycles

    const filePath = runTaskConfigFilePath(projectPath)
    const payload: RunTaskConfigFile = {
      version: 1,
      updatedAt: Date.now(),
      tasks: normalized,
    }
    const normalizedScanDirectories = normalizeScanDirectories(scanDirectories)
    if (normalizedScanDirectories.length > 0) payload.scanDirectories = normalizedScanDirectories

    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const tmpPath = `${filePath}.tmp`
    fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    fs.renameSync(tmpPath, filePath)
    return { config: payload }
  }
}

function readUpdatedAt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Keep project-relative, escape-free, de-duplicated scan directories. */
export function normalizeScanDirectories(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (!trimmed) continue
    // Reject absolute paths (POSIX root, UNC, or Windows drive letter).
    if (/^[/\\]/.test(trimmed) || /^[a-z]:/i.test(trimmed)) continue
    const normalized = trimmed.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    if (!normalized || normalized === '.') continue
    const segments = normalized.split('/')
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) continue
    if (!result.includes(normalized)) result.push(normalized)
    if (result.length >= MAX_SCAN_DIRECTORIES) break
  }
  return result
}

/** Drop invalid task entries instead of failing the whole file. */
export function normalizeRunTasks(value: unknown): RunTask[] {
  if (!Array.isArray(value)) return []
  const tasks: RunTask[] = []
  const seenIds = new Set<string>()
  const pendingTasks: Array<{ task: RunTask; rawDeps?: string[] }> = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    const command = typeof record.command === 'string' ? record.command.trim() : ''
    if (!id || !command || seenIds.has(id)) continue
    seenIds.add(id)

    const task: RunTask = {
      id,
      name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : id,
      command,
    }
    if (typeof record.cwd === 'string' && record.cwd.trim()) task.cwd = record.cwd.trim()
    if (typeof record.stopCommand === 'string' && record.stopCommand.trim()) task.stopCommand = record.stopCommand.trim()
    if (Array.isArray(record.dependsOn)) {
      const deps = record.dependsOn.filter((dep): dep is string => typeof dep === 'string' && dep.length > 0 && dep !== id)
      if (deps.length > 0) task.dependsOn = [...new Set(deps)]
    }
    const readiness = normalizeReadiness(record.readiness)
    if (readiness) task.readiness = readiness
    if (record.isDefault === true) task.isDefault = true
    if (record.enabled === false) task.enabled = false
    if (record.primaryUrl === true) task.primaryUrl = true
    if (typeof record.useWsl === 'boolean') task.useWsl = record.useWsl
    if (record.startupMode === 'silent' || record.startupMode === 'terminal') {
      task.startupMode = record.startupMode
    }
    tasks.push(task)
    pendingTasks.push({ task, rawDeps: task.dependsOn })
  }
  // Second pass: drop dependency references pointing at unknown tasks.
  for (const { task, rawDeps } of pendingTasks) {
    if (!rawDeps) continue
    const resolved = rawDeps.filter((dep) => seenIds.has(dep))
    if (resolved.length > 0) task.dependsOn = resolved
    else delete task.dependsOn
  }
  return tasks
}

function normalizeReadiness(value: unknown): RunTask['readiness'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const strategy = record.strategy
  if (strategy !== 'url' && strategy !== 'http' && strategy !== 'port' && strategy !== 'delay' && strategy !== 'exit') {
    return undefined
  }
  const readiness: NonNullable<RunTask['readiness']> = { strategy }
  if (typeof record.urlPattern === 'string' && record.urlPattern.trim()) readiness.urlPattern = record.urlPattern
  if (typeof record.httpUrl === 'string' && record.httpUrl.trim()) readiness.httpUrl = record.httpUrl
  if (typeof record.port === 'number' && Number.isInteger(record.port) && record.port > 0 && record.port < 65536) {
    readiness.port = record.port
  }
  if (typeof record.delayMs === 'number' && Number.isFinite(record.delayMs) && record.delayMs >= 0) {
    readiness.delayMs = record.delayMs
  }
  if (typeof record.timeoutMs === 'number' && Number.isFinite(record.timeoutMs) && record.timeoutMs > 0) {
    readiness.timeoutMs = record.timeoutMs
  }
  if (strategy === 'http' && !readiness.httpUrl) return undefined
  if (strategy === 'port' && !readiness.port) return undefined
  if (strategy === 'delay' && readiness.delayMs === undefined) return undefined
  return readiness
}

export { RunTaskCycleError }
