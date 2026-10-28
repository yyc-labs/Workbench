/**
 * File watcher for agent history (plan 20 stage 4, D5/v2 ⑨).
 *
 * Rules locked by review: listeners are SHARED per data-source directory with
 * reference counting (never one recursive watcher per project), the watcher
 * only TRIGGERS verification (stat → stage-3 pipeline decides incremental vs
 * full), and it is never the sole source of correctness — watch degradation
 * falls back to open-time scans silently. WSL sources report
 * supportsWatch=false (stage 0: 9P has no fs.watch) so they simply degrade.
 */
export interface WatchChangeHint {
  projectId: string
  /** Number of debounced change bursts since the last notification. */
  bursts: number
}

interface WatchableSource {
  watch(dir: string, listener: (event: { eventType: string; filename: string | null }) => void): { close(): void }
}

interface SharedWatch {
  handle: { close(): void }
  refCount: number
  projectIds: Set<string>
  timer: ReturnType<typeof setTimeout> | null
  bursts: number
}

export interface AgentHistoryWatchService {
  /** Idempotent per project; degrades to a no-op when the source cannot watch. */
  watch(projectId: string): Promise<void>
  unwatch(projectId: string): void
  stopAll(): void
  watchedProjectCount(): number
}

export function createAgentHistoryWatchService(deps: {
  /** Resolves the watchable roots for a project (provider session roots) — null/empty degrades. */
  resolveWatchRoots: (projectId: string) => Promise<{ dirKey: string; dataSource: WatchableSource }[]>
  /** Debounced change burst → re-verify through the scan pipeline, then notify. */
  onBurst: (projectId: string) => Promise<void>
  notifyChanged: (hint: WatchChangeHint) => void
  debounceMs?: number
}): AgentHistoryWatchService {
  const debounceMs = deps.debounceMs ?? 500
  const byProject = new Map<string, string[]>()
  const shared = new Map<string, SharedWatch>()

  function fireBurst(dirKey: string) {
    const entry = shared.get(dirKey)
    if (!entry) return
    entry.bursts += 1
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      entry.timer = null
      const bursts = entry.bursts
      entry.bursts = 0
      for (const projectId of entry.projectIds) {
        void deps
          .onBurst(projectId)
          .then(() => deps.notifyChanged({ projectId, bursts }))
          .catch(() => {
            /* verification failure is non-fatal; next burst or open-time scan retries */
          })
      }
    }, debounceMs)
  }

  return {
    async watch(projectId) {
      if (byProject.has(projectId)) return
      const roots = await deps.resolveWatchRoots(projectId).catch(() => [])
      const dirKeys: string[] = []
      for (const root of roots) {
        const dirKey = root.dirKey
        dirKeys.push(dirKey)
        let entry = shared.get(dirKey)
        if (!entry) {
          try {
            const handle = root.dataSource.watch(dirKey, () => fireBurst(dirKey))
            entry = { handle, refCount: 0, projectIds: new Set(), timer: null, bursts: 0 }
            shared.set(dirKey, entry)
          } catch {
            // fs.watch threw (no privileges, 9P, …): degrade silently for this dir.
            continue
          }
        }
        entry.refCount += 1
        entry.projectIds.add(projectId)
      }
      byProject.set(projectId, dirKeys)
    },

    unwatch(projectId) {
      const dirKeys = byProject.get(projectId)
      if (!dirKeys) return
      byProject.delete(projectId)
      for (const dirKey of dirKeys) {
        const entry = shared.get(dirKey)
        if (!entry) continue
        entry.refCount -= 1
        if (entry.refCount <= 0) {
          if (entry.timer) clearTimeout(entry.timer)
          try {
            entry.handle.close()
          } catch {
            /* already closed */
          }
          shared.delete(dirKey)
        }
      }
    },

    stopAll() {
      for (const projectId of [...byProject.keys()]) this.unwatch(projectId)
    },

    watchedProjectCount: () => byProject.size,
  }
}
