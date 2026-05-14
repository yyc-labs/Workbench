import { spawn } from 'child_process'
import type { Capability } from '../shared/types'

interface TerminalHost {
  pid: number
  startedAt: number
}

let host: TerminalHost | null = null

function isAlive(): boolean {
  if (!host) return false
  try {
    process.kill(host.pid, 0)
    return true
  } catch {
    host = null
    return false
  }
}

function spawnHost(capability: Capability): Promise<TerminalHost | null> {
  const distro = capability.wslDistro || 'Ubuntu'

  return new Promise((resolve) => {
    const child = spawn('wt.exe', [
      'wsl', '-d', distro,
      '--', 'bash', '-lc',
      'exec tmux'
    ], {
      detached: true,
      stdio: 'ignore',
    })

    child.on('error', (err) => {
      console.error('[terminal-host] spawn failed:', err.message)
      resolve(null)
    })

    child.on('spawn', () => {
      host = {
        pid: child.pid!,
        startedAt: Date.now(),
      }
      resolve(host)
    })

    child.unref()
  })
}

async function ensureHost(capability: Capability): Promise<boolean> {
  if (isAlive()) return true
  host = null
  const result = await spawnHost(capability)
  if (!result) return false
  // Give tmux a moment to initialise inside wt.exe
  await new Promise(r => setTimeout(r, 1000))
  return true
}

function switchSession(sessionName: string, distro: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('wsl.exe', [
      '-d', distro,
      '--', 'bash', '-lc',
      `tmux switch-client -t '${sessionName}' 2>/dev/null || tmux attach -t '${sessionName}'`
    ], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    })

    child.on('error', (err) => {
      console.error('[terminal-host] switch failed:', err.message)
      resolve(false)
    })

    child.on('close', (code) => {
      resolve(code === 0)
    })

    child.unref()
  })
}

export const terminalHost = {
  isAlive,
  ensureHost,
  switchSession,
}
