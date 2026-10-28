/**
 * Local Windows filesystem data source (plan 20 stage 1).
 * Also the implementation base for the WSL source: \\wsl$ / \\wsl.localhost UNC
 * paths are plain Windows filesystem semantics to node, so the WSL source is
 * this factory with a posix→UNC path translator and watch disabled.
 */
import { createReadStream, watch as watchCb } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import type { AgentHistoryDataSource, DataSourceEntry, DataSourceFileStat, DataSourceWatchEvent, DataSourceWatchHandle } from './types'

export interface CreateFsDataSourceOptions {
  namespaceId: string
  supportsWatch: boolean
  /** Maps logical (namespace) paths to native paths the node fs can open. */
  toNativePath: (logicalPath: string) => string
}

export function createFsDataSource(options: CreateFsDataSourceOptions): AgentHistoryDataSource {
  const native = (p: string) => options.toNativePath(p)
  return {
    id: options.supportsWatch ? 'local-fs' : 'wsl',
    namespaceId: options.namespaceId,
    supportsWatch: options.supportsWatch,

    join(...parts: string[]) {
      return join(...parts)
    },

    async list(dir: string, signal?: AbortSignal): Promise<DataSourceEntry[]> {
      signal?.throwIfAborted()
      const entries = await readdir(native(dir), { withFileTypes: true })
      return entries.map((entry) => ({
        name: entry.name,
        isFile: entry.isFile(),
        isDirectory: entry.isDirectory(),
        isSymbolicLink: entry.isSymbolicLink(),
      }))
    },

    async stat(file: string, _signal?: AbortSignal): Promise<DataSourceFileStat | null> {
      try {
        const s = await stat(native(file))
        return { sizeBytes: s.size, mtimeMs: s.mtimeMs }
      } catch {
        return null
      }
    },

    async readRange(file: string, offset: number, length: number, signal?: AbortSignal): Promise<Buffer> {
      signal?.throwIfAborted()
      const handle = await open(native(file), 'r')
      try {
        const size = (await handle.stat()).size
        const start = Math.max(0, Math.min(offset, size))
        const len = Math.max(0, Math.min(length, size - start))
        const buf = Buffer.alloc(len)
        if (len > 0) {
          const { bytesRead } = await handle.read(buf, 0, len, start)
          return buf.subarray(0, bytesRead)
        }
        return buf
      } finally {
        await handle.close()
      }
    },

    async openRead(file: string, _signal?: AbortSignal): Promise<Readable> {
      return createReadStream(native(file), { encoding: 'utf8' })
    },

    watch(dir: string, listener: (event: DataSourceWatchEvent) => void): DataSourceWatchHandle {
      const w = watchCb(native(dir), { recursive: true }, (eventType, filename) => {
        listener({ eventType, filename })
      })
      return { close: () => w.close() }
    },
  }
}

export function createLocalFsDataSource(): AgentHistoryDataSource {
  return createFsDataSource({ namespaceId: 'win32', supportsWatch: true, toNativePath: (p) => p })
}
