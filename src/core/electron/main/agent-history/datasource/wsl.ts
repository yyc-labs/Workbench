/**
 * WSL data source (plan 20 stage 1, D7): UNC channel over \\wsl.localhost.
 * Stage 0 measurements settled the channel choice: UNC list/stat/read are
 * milliseconds-level (13.5MB read ≈ 94ms) while each wsl.exe invocation costs
 * a fixed ~4s (cold start 41.6s) — so UNC is the read path and wsl.exe is used
 * only to resolve the distro's default-user home (once, cached). fs.watch is
 * unsupported on the 9P provider (EISDIR, stage 0) — supportsWatch stays false
 * and watch-service degrades to open-time scans.
 */

import { createFsDataSource } from './local-fs'
import type { AgentHistoryDataSource } from './types'

const BS = String.fromCharCode(92) // single backslash, kept symbolic to avoid escape ambiguity
const UNC_PREFIX_LOCALHOST = BS + BS + 'wsl.localhost' + BS

/** UNC target for a distro + posix path: /home/u/p → \\wsl.localhost\Ubuntu\home\u\p. */
export function toWslUncPath(distro: string, posixPath: string): string {
  const d = distro.trim().split(BS).join('') || 'Ubuntu'
  const normalized = posixPath
    .trim()
    .split(BS)
    .join('/')
    .replace(/\/{2,}/g, '/')
  const rel = normalized.replace(/^\/+/, '').split('/').join(BS)
  return rel ? UNC_PREFIX_LOCALHOST + d + BS + rel : UNC_PREFIX_LOCALHOST + d
}

const homeCache = new Map<string, string>()

/** Resolve the distro's default-user home via wsl.exe (fixed ~4s cost, cached per distro). */
export async function resolveWslHomeDir(distro: string, signal?: AbortSignal): Promise<string> {
  const key = distro.toLowerCase()
  const cached = homeCache.get(key)
  if (cached) return cached
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  const { stdout } = await run('wsl.exe', ['-d', distro, 'sh', '-c', 'echo $HOME'], {
    timeout: 15_000,
    windowsHide: true,
    signal,
    encoding: 'utf8',
  })
  // wsl.exe output can carry stray NUL padding in some locales; strip control noise.
  const home = stdout.split('\0').join('').trim().split('\n').filter(Boolean).pop() ?? ''
  if (!home.startsWith('/')) throw new Error('wsl home probe failed: ' + JSON.stringify(home.slice(0, 40)))
  homeCache.set(key, home)
  return home
}

export function createWslDataSource(deps: { distro: string }): AgentHistoryDataSource {
  const distro = deps.distro.trim() || 'Ubuntu'
  const inner = createFsDataSource({
    namespaceId: 'wsl:' + distro.toLowerCase(),
    supportsWatch: false,
    toNativePath: (p) => toWslUncPath(distro, p),
  })
  const { watch: _unsupportedWatch, ...innerWithoutWatch } = inner
  void _unsupportedWatch
  return {
    ...innerWithoutWatch,
    id: 'wsl',
    /**
     * Home resolution via wsl.exe $HOME (cached). null = unresolvable —
     * providers must treat that as SOURCE_UNAVAILABLE, never guess paths.
     */
    homeDir: async (signal?: AbortSignal): Promise<string | null> => {
      try {
        return await resolveWslHomeDir(distro, signal)
      } catch {
        return null
      }
    },
  }
}
