import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import type { RunTask } from '../../../shared/runTasks'

const DAEMON_CHECK_TIMEOUT_MS = 8_000
const DAEMON_READY_TIMEOUT_MS = 90_000
const DAEMON_READY_POLL_INTERVAL_MS = 2_000
const DOCKER_COMMAND_PATTERN = /\bdocker\b/i

export interface DockerCheckResult {
  required: boolean
  running: boolean
}

/** True when the command actually invokes the docker CLI. */
export function taskRequiresDocker(task: RunTask): boolean {
  return DOCKER_COMMAND_PATTERN.test(task.command)
}

function spawnOnce(command: string, args: string[], timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, args, { windowsHide: true, stdio: 'ignore' })
    } catch {
      resolve(false)
      return
    }
    const timer = setTimeout(() => {
      child.kill()
      resolve(false)
    }, timeoutMs)
    child.once('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolve(code === 0)
    })
  })
}

/** One-shot `docker info` probe; exit 0 means the daemon answers. */
export function isDockerDaemonRunning(useWsl: boolean, wslDistro: string): Promise<boolean> {
  if (useWsl && process.platform === 'win32') {
    // Login shell so the distro's PATH includes the docker CLI.
    return spawnOnce('wsl.exe', ['--distribution', wslDistro, '--exec', 'sh', '-lc', 'command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1'], DAEMON_CHECK_TIMEOUT_MS)
  }
  return spawnOnce('docker', ['info'], DAEMON_CHECK_TIMEOUT_MS)
}

function findDockerDesktopExe(): string | null {
  if (process.platform !== 'win32') return null
  const candidates = [path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Docker', 'Docker', 'Docker Desktop.exe'), path.join(process.env['LOCALAPPDATA'] ?? '', 'Docker', 'Docker Desktop.exe')]
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate
  }
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Make sure the daemon answers in every required environment (Windows host
 * and/or the WSL distro). Docker Desktop is launched when present; its engine
 * serves both the host and the WSL integrations.
 */
export async function ensureDockerDaemonRunning(needsWsl: boolean, needsNative: boolean, wslDistro: string): Promise<{ ready: boolean; error?: string }> {
  const check = async (): Promise<boolean> => {
    const [wsl, native] = await Promise.all([needsWsl ? isDockerDaemonRunning(true, wslDistro) : Promise.resolve(true), needsNative ? isDockerDaemonRunning(false, wslDistro) : Promise.resolve(true)])
    return wsl && native
  }

  if (await check()) return { ready: true }

  const exe = findDockerDesktopExe()
  if (exe) {
    try {
      spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    } catch {
      // fall through to the polling loop; it will report the timeout
    }
  }

  const deadline = Date.now() + DAEMON_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(DAEMON_READY_POLL_INTERVAL_MS)
    if (await check()) return { ready: true }
  }

  return {
    ready: false,
    error: exe ? 'Docker daemon did not become ready within 90 seconds.' : 'Docker Desktop was not found. Please start Docker manually and try again.',
  }
}
