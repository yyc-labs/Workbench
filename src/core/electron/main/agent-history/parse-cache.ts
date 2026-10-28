/**
 * In-memory parse cache for agent history sessions (docs/todo/19 §2.1).
 *
 * Invalidation: mtimeMs, sizeBytes or parserVersion — any change forces a full
 * re-parse. There is deliberately no "same size means unchanged" shortcut
 * (files can be rewritten or rebuilt in place); same-size rewrite coverage is
 * tested. Incremental byte-offset continuation is reserved (layer C byteOffset)
 * and must only be enabled per provider after append-only behavior is verified.
 */

export interface ParseCacheStat {
  mtimeMs: number
  sizeBytes: number
}

export interface ParseCacheCounters {
  hits: number
  misses: number
  invalidations: number
}

export interface ParseCache<T> {
  get(key: string, stat: ParseCacheStat, parserVersion: number): T | null
  set(key: string, stat: ParseCacheStat, parserVersion: number, parsed: T): void
  remove(key: string): void
  clear(): void
  size(): number
  counters(): ParseCacheCounters
}

interface CacheEntry<T> {
  mtimeMs: number
  sizeBytes: number
  parserVersion: number
  parsed: T
}

export function createParseCache<T>(): ParseCache<T> {
  const entries = new Map<string, CacheEntry<T>>()
  const counters: ParseCacheCounters = { hits: 0, misses: 0, invalidations: 0 }

  return {
    get(key, stat, parserVersion) {
      const entry = entries.get(key)
      if (!entry) {
        counters.misses += 1
        return null
      }
      if (entry.mtimeMs !== stat.mtimeMs || entry.sizeBytes !== stat.sizeBytes || entry.parserVersion !== parserVersion) {
        entries.delete(key)
        counters.invalidations += 1
        return null
      }
      counters.hits += 1
      return entry.parsed
    },
    set(key, stat, parserVersion, parsed) {
      entries.set(key, {
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.sizeBytes,
        parserVersion,
        parsed,
      })
    },
    remove(key) {
      entries.delete(key)
    },
    clear() {
      entries.clear()
    },
    size() {
      return entries.size
    },
    counters() {
      return { ...counters }
    },
  }
}
