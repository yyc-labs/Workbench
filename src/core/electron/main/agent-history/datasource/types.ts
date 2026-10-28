/**
 * Data source abstraction for agent history (plan 20 §3.1, D7).
 *
 * Ownership boundary: a Provider knows session formats and fields; a
 * DataSource knows how to reach files on Windows, WSL or (later) SSH hosts.
 * Providers must never touch node:fs directly — all IO goes through here.
 * Directory traversal helpers live in file-discovery.ts, layered on this
 * interface, so every provider shares one traversal implementation.
 */
import type { Readable } from 'node:stream'

export type AgentHistoryDataSourceId = 'local-fs' | 'wsl'

export interface DataSourceEntry {
  name: string
  isFile: boolean
  isDirectory: boolean
  isSymbolicLink: boolean
}

export interface DataSourceFileStat {
  sizeBytes: number
  mtimeMs: number
}

export interface DataSourceWatchEvent {
  eventType: string
  filename: string | null
}

export interface DataSourceWatchHandle {
  close(): void
}

export class DataSourceError extends Error {
  readonly code: 'SOURCE_UNAVAILABLE' | 'PERMISSION_DENIED'
  constructor(code: 'SOURCE_UNAVAILABLE' | 'PERMISSION_DENIED', message: string) {
    super(message)
    this.name = 'DataSourceError'
    this.code = code
  }
}

export interface AgentHistoryDataSource {
  readonly id: AgentHistoryDataSourceId
  /** Path namespace identity (e.g. "win32", "wsl:ubuntu") — feeds session keys via AgentHistoryProjectContext. */
  readonly namespaceId: string
  /** WSL 9P does not support fs.watch (plan 20 stage 0: EISDIR); unsupported sources set this false and omit watch(). */
  readonly supportsWatch: boolean
  /** Resolve and join path segments in the source's own namespace (posix-style for WSL, win32 for local). */
  join(...parts: string[]): string
  list(dir: string, signal?: AbortSignal): Promise<DataSourceEntry[]>
  /** null when the target is missing/unreachable — callers decide the issue semantics. */
  stat(file: string, signal?: AbortSignal): Promise<DataSourceFileStat | null>
  /** Byte-range read; the implementation clamps offset/length to the file size. */
  readRange(file: string, offset: number, length: number, signal?: AbortSignal): Promise<Buffer>
  /** Full-file stream for the line reader (jsonl-parser). */
  openRead(file: string, signal?: AbortSignal): Promise<Readable>
  watch?(dir: string, listener: (event: DataSourceWatchEvent) => void): DataSourceWatchHandle
  /** WSL sources only: resolve the distro default-user home (null = unresolvable, providers must not guess). */
  homeDir?(signal?: AbortSignal): Promise<string | null>
}
