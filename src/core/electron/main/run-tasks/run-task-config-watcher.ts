import * as fs from 'fs'
import * as path from 'path'
import { RUN_TASK_CONFIG_DIR_NAME, RUN_TASK_CONFIG_FILE_NAME, RUN_TASK_LEGACY_CONFIG_FILE_NAME, runTaskConfigFilePath } from '../../../shared/runTasks'

/** Editors write a config in several chunks — debounce before notifying. */
const CONFIG_WATCH_DEBOUNCE_MS = 300

/**
 * Watches a project's run-task config files (`​.yworkbench/run-tasks.json`
 * and the legacy root `.yworkbench.json`) so external edits (editor, agent,
 * hand-written) can refresh the renderer's cached config. Watching is
 * best-effort: failures (unsupported filesystem, WSL UNC quirks, missing
 * directory) are swallowed — the fallback remains reloading via the
 * run-tasks dialog.
 */
export class RunTaskConfigWatcher {
  private readonly watchers = new Map<string, Array<fs.FSWatcher>>()
  private readonly timers = new Map<string, NodeJS.Timeout>()

  constructor(private readonly onConfigChanged: (projectPath: string) => void) {}

  /** Ensure the project's config files are watched (idempotent per path). */
  ensureWatch(projectPath: string): void {
    if (this.watchers.has(projectPath)) return

    const candidates = [runTaskConfigFilePath(projectPath), path.join(projectPath, RUN_TASK_LEGACY_CONFIG_FILE_NAME)]
    const watchers: Array<fs.FSWatcher> = []
    for (const filePath of candidates) {
      try {
        if (!fs.existsSync(filePath)) continue
        const watcher = fs.watch(filePath, () => this.scheduleNotify(projectPath))
        watcher.on('error', () => watcher.close())
        watchers.push(watcher)
      } catch {
        // Watching is best-effort — skip this file.
      }
    }

    // A project without a config file yet is not marked as watched — the
    // next getConfig() call retries once the file has been created.
    if (watchers.length > 0) this.watchers.set(projectPath, watchers)
  }

  /** Stop all watchers (app shutdown / service disposal). */
  dispose(): void {
    for (const timers of this.timers.values()) clearTimeout(timers)
    this.timers.clear()
    for (const watchers of this.watchers.values()) {
      for (const watcher of watchers) {
        try {
          watcher.close()
        } catch {
          /* already gone */
        }
      }
    }
    this.watchers.clear()
  }

  private scheduleNotify(projectPath: string): void {
    const existing = this.timers.get(projectPath)
    if (existing) clearTimeout(existing)
    this.timers.set(
      projectPath,
      setTimeout(() => {
        this.timers.delete(projectPath)
        try {
          this.onConfigChanged(projectPath)
        } catch {
          /* listener failure must not break the watcher */
        }
      }, CONFIG_WATCH_DEBOUNCE_MS),
    )
  }
}
