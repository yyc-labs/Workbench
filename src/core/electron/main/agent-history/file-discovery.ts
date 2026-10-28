/**
 * Generic directory traversal for agent history providers (plan 20 §3.1).
 * Layered ON a data source (never node:fs directly) so local, WSL and future
 * SSH sources share one traversal. Enumerate + stat only — no content is read
 * here. Symlinks are skipped so a planted link can never pull the scan outside
 * the expected root.
 */
import type { AgentHistoryDataSource } from './datasource/types'
export interface SessionFileStat {
  filePath: string
  mtimeMs: number
  sizeBytes: number
}

export interface DiscoveryListing {
  files: SessionFileStat[]
  truncated: boolean
}

interface ListOptions {
  maxFiles: number
  recursive?: boolean
  signal?: AbortSignal
  /** Extra file-name filter (dynamic providers' declared pattern). */
  fileFilter?: (name: string) => boolean
}

/**
 * POSIX-style join for LOGICAL paths in any namespace: '/'-connected, double
 * slashes collapsed. Windows accepts mixed separators; the WSL source's
 * toNativePath translates all separators back. Never use path.join here —
 * win32 semantics would corrupt posix logical paths with a leading backslash.
 */
export function joinLogicPath(...parts: string[]): string {
  return parts
    .filter((part) => part !== '' && part !== '.')
    .join('/')
    .replace(/\/{2,}/g, '/')
}

/** List *.jsonl session files under dir (via the data source). Missing dir yields an empty listing. */
export async function listJsonlSessionFiles(dataSource: AgentHistoryDataSource, dir: string, options: ListOptions): Promise<DiscoveryListing> {
  const collected: SessionFileStat[] = []
  const queue: string[] = [dir]
  let truncated = false

  while (queue.length > 0) {
    if (options.signal?.aborted) return { files: collected, truncated: true }
    const current = queue.shift() as string
    let entries
    try {
      entries = await dataSource.list(current, options.signal)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink) continue
      const full = joinLogicPath(current, entry.name)
      if (entry.isDirectory) {
        if (options.recursive) queue.push(full)
        continue
      }
      if (!entry.isFile || !entry.name.endsWith('.jsonl')) continue
      if (options.fileFilter && !options.fileFilter(entry.name)) continue
      if (collected.length >= options.maxFiles) {
        truncated = true
        return { files: collected, truncated }
      }
      // Stage 0 calibration: skip zero-byte files outright (observed in real corpora).
      const s = await dataSource.stat(full, options.signal)
      if (s && s.sizeBytes > 0) collected.push({ filePath: full, mtimeMs: s.mtimeMs, sizeBytes: s.sizeBytes })
    }
  }

  return { files: collected, truncated }
}
