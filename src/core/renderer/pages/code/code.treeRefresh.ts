export const ROOT_REFRESH_TTL_MS = 15_000
export const DIRECTORY_REFRESH_TTL_MS = 15_000
export const ROOT_REFRESH_RETRY_COOLDOWN_MS = 1_000

export type RootLoadReason = 'initial-load' | 'manual-refresh' | 'sidebar-reveal'
export type DirectoryLoadReason = 'initial-open' | 'locate-path' | 'directory-refresh' | 'manual-refresh'

export function shouldRefreshRootOnSidebarReveal(options: {
  autoLoadBlocked: boolean
  hasLoadedRoot: boolean
  isRefreshingRoot: boolean
  lastRootLoadedAtMs: number | null
  lastRootRefreshStartedAtMs: number | null
  nowMs?: number
  ttlMs?: number
  retryCooldownMs?: number
}): boolean {
  if (options.autoLoadBlocked) return false
  if (!options.hasLoadedRoot) return false
  if (options.isRefreshingRoot) return false

  const nowMs = options.nowMs ?? Date.now()
  const retryCooldownMs = options.retryCooldownMs ?? ROOT_REFRESH_RETRY_COOLDOWN_MS
  if (
    options.lastRootRefreshStartedAtMs != null
    && nowMs - options.lastRootRefreshStartedAtMs < retryCooldownMs
  ) {
    return false
  }

  if (options.lastRootLoadedAtMs == null) return true
  return nowMs - options.lastRootLoadedAtMs > (options.ttlMs ?? ROOT_REFRESH_TTL_MS)
}

export function shouldRefreshLoadedDirectory(options: {
  force?: boolean
  isLoaded: boolean
  lastLoadedAtMs: number | null
  nowMs?: number
  reason: DirectoryLoadReason
  ttlMs?: number
}): boolean {
  if (!options.isLoaded) return true
  if (options.force) return true
  if (options.reason === 'manual-refresh' || options.reason === 'directory-refresh') return true
  if (options.reason !== 'initial-open') return false

  if (options.lastLoadedAtMs == null) return true
  return (options.nowMs ?? Date.now()) - options.lastLoadedAtMs > (options.ttlMs ?? DIRECTORY_REFRESH_TTL_MS)
}
