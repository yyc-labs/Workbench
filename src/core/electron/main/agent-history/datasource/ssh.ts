/**
 * SSH data source (plan 20 stage 9): a remote host is just another data
 * source. Security rules locked by review: system OpenSSH with the user's own
 * agent/keys (no passwords stored), ALL remote commands come from whitelist
 * templates (never user input concatenated into a shell string), spawn uses
 * argv arrays without a shell, single-command timeout 10s, and watch is
 * unsupported (degrades to open-time scans like WSL).
 */
import { spawn } from 'node:child_process'
import type { Readable } from 'node:stream'
import type { AgentHistoryDataSource, DataSourceEntry, DataSourceFileStat } from './types'

const CONNECT_TIMEOUT_SECONDS = 10
const COMMAND_TIMEOUT_MS = 10_000

/** Remote paths are single-quote wrapped with internal quotes escaped — the ONLY sanctioned interpolation. */
export function quoteRemotePath(path: string): string {
  const safe = path.trim().replace(/\/{2,}/g, '/')
  if (!safe.startsWith('/')) throw new Error('remote path must be absolute')
  return "'" + safe.split("'").join("'\\''") + "'"
}

export interface SshTarget {
  host: string
  user?: string
  port?: number
}

function targetOf(target: SshTarget): string {
  const user = target.user?.trim() ? target.user.trim() + '@' : ''
  return user + target.host.trim()
}

function sshArgv(target: SshTarget, remoteCommand: string): string[] {
  const argv = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=' + CONNECT_TIMEOUT_SECONDS]
  if (target.port && target.port !== 22) argv.push('-p', String(target.port))
  argv.push(targetOf(target), remoteCommand)
  return argv
}

function runRemote(target: SshTarget, remoteCommand: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', sshArgv(target, remoteCommand), { shell: false, windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('ssh command timed out'))
    }, COMMAND_TIMEOUT_MS)
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, code })
    })
  })
}

/** Whitelist templates — the only remote commands this source will ever run. */
const TEMPLATES = {
  list: (dir: string) => 'ls -1ap ' + quoteRemotePath(dir) + ' 2>/dev/null',
  stat: (file: string) => 'stat -c %s\\ %Y ' + quoteRemotePath(file) + ' 2>/dev/null',
  readRange: (file: string, offset: number, length: number) => 'dd if=' + quoteRemotePath(file) + ' ibs=1 skip=' + String(offset) + ' count=' + String(length) + ' 2>/dev/null',
  home: () => 'echo $HOME',
}

export function createSshDataSource(deps: { target: SshTarget }): AgentHistoryDataSource {
  const namespace = 'ssh:' + (deps.target.user ? deps.target.user + '@' : '') + deps.target.host.toLowerCase()
  return {
    id: 'wsl', // stage 9: reuses the non-watch id space; namespace carries the host identity
    namespaceId: namespace,
    supportsWatch: false,

    join(...parts: string[]) {
      return parts
        .filter((part) => part !== '' && part !== '.')
        .join('/')
        .replace(/\/{2,}/g, '/')
    },

    async list(dir: string, signal?: AbortSignal): Promise<DataSourceEntry[]> {
      signal?.throwIfAborted()
      const { stdout } = await runRemote(deps.target, TEMPLATES.list(dir))
      return stdout
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          const isDirectory = line.endsWith('/')
          return { name: line.replace(/\/$/, ''), isFile: !isDirectory, isDirectory, isSymbolicLink: false }
        })
    },

    async stat(file: string, signal?: AbortSignal): Promise<DataSourceFileStat | null> {
      signal?.throwIfAborted()
      const { stdout } = await runRemote(deps.target, TEMPLATES.stat(file))
      const [size, mtime] = stdout.trim().split(' ')
      if (!size || !mtime) return null
      const mtimeMs = Number(mtime) * 1000
      if (!Number.isFinite(mtimeMs)) return null
      return { sizeBytes: Number(size), mtimeMs }
    },

    async readRange(file: string, offset: number, length: number, signal?: AbortSignal): Promise<Buffer> {
      signal?.throwIfAborted()
      const { stdout, code } = await runRemote(deps.target, TEMPLATES.readRange(file, offset, length))
      if (code !== 0 && code !== null) return Buffer.alloc(0)
      return Buffer.from(stdout, 'utf8')
    },

    async openRead(file: string, signal?: AbortSignal): Promise<Readable> {
      signal?.throwIfAborted()
      const child = spawn('ssh', sshArgv(deps.target, 'cat ' + quoteRemotePath(file)), { shell: false, windowsHide: true })
      return child.stdout
    },

    async homeDir(signal?: AbortSignal): Promise<string | null> {
      try {
        const { stdout } = await runRemote(deps.target, TEMPLATES.home())
        return stdout.trim() || null
      } catch {
        return null
      }
    },
  }
}
