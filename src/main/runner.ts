import { spawn as spawnChild, type ChildProcess } from 'child_process'
import type { BrowserWindow } from 'electron'
import type { IPty } from 'node-pty'
import type { BackendMode, Capability, PtySize } from '../shared/types'
import { wslBridge } from './wsl-bridge'
import { tmuxManager, getSessionName } from './tmux-manager'
import { ResizeController } from './resize-controller'

export const IPC_CHANNELS = {
  PROCESS_OUTPUT: 'process:output',
  PROCESS_STATUS: 'process:status',
  PROCESS_EXIT: 'process:exit',
} as const

interface PtyManagedProcess {
  pty: IPty
  projectId: string
  startTime: number
  backend: 'tmux' | 'wsl-pty' | 'direct-pty'
}

interface SpawnManagedProcess {
  child: ChildProcess
  projectId: string
  startTime: number
  backend: 'spawn'
}

class ProcessManager {
  private processes = new Map<string, PtyManagedProcess | SpawnManagedProcess>()
  private resizeCtrls = new Map<string, ResizeController>()
  private outputWindow: BrowserWindow | null = null
  private capability: Capability

  constructor(capability: Capability) {
    this.capability = capability
  }

  get backend(): BackendMode {
    return this.capability.backend
  }

  setOutputWindow(win: BrowserWindow): void {
    this.outputWindow = win
  }

  // ── public API ──────────────────────────────────────────

  start(projectId: string, command: string, cwd: string): boolean {
    if (this.processes.has(projectId)) return false

    switch (this.capability.backend) {
      case 'tmux':
        return this.startWithTmux(projectId, command, cwd)
      case 'wsl-pty':
      case 'direct-pty':
        return this.startWithPty(projectId, command, cwd)
      default:
        return this.startWithSpawn(projectId, command, cwd)
    }
  }

  stop(projectId: string): boolean {
    const managed = this.processes.get(projectId)
    if (!managed) return false

    // Clean up resize controller
    this.resizeCtrls.get(projectId)?.dispose()
    this.resizeCtrls.delete(projectId)

    if (managed.backend === 'spawn') {
      return this.stopSpawn(managed as SpawnManagedProcess)
    }

    return this.stopPty(managed as PtyManagedProcess)
  }

  stopAll(): void {
    for (const projectId of this.processes.keys()) {
      this.stop(projectId)
    }
  }

  sendInput(projectId: string, data: string): void {
    const managed = this.processes.get(projectId)
    if (!managed) return

    if (managed.backend === 'spawn') {
      ;(managed as SpawnManagedProcess).child.stdin?.write(data)
    } else {
      ;(managed as PtyManagedProcess).pty.write(data)
    }
  }

  resize(projectId: string, cols: number, rows: number): void {
    const ctrl = this.resizeCtrls.get(projectId)
    if (ctrl) {
      ctrl.emit({ cols, rows })
    }
  }

  isRunning(projectId: string): boolean {
    return this.processes.has(projectId)
  }

  // ── PTY helpers ─────────────────────────────────────────

  private getPtySpawn(): (cmd: string, args: string[], opts: Record<string, unknown>) => IPty {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('node-pty').spawn
  }

  // ── backend: tmux ───────────────────────────────────────

  private startWithTmux(projectId: string, command: string, cwd: string): boolean {
    const sessionName = getSessionName(projectId)
    const wslPath = wslBridge.toWslPath(cwd)
    const ptySpawn = this.getPtySpawn()

    // Create detached tmux session (fire-and-forget; if it fails pty attach will show the error)
    tmuxManager.createSession(sessionName, command, wslPath)

    const attachCmd = tmuxManager.attachCommand(sessionName)
    const pty = ptySpawn('wsl.exe', ['-e', 'bash', '-lc', attachCmd], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
    })

    return this.finalizePtyStart(projectId, pty, 'tmux')
  }

  // ── backend: wsl-pty | direct-pty ──────────────────────

  private startWithPty(projectId: string, command: string, cwd: string): boolean {
    const ptySpawn = this.getPtySpawn()
    let pty: IPty

    if (this.capability.backend === 'wsl-pty') {
      const wslPath = wslBridge.toWslPath(cwd)
      const shellCmd = `cd '${wslPath}' && exec ${command}`
      pty = ptySpawn('wsl.exe', ['-e', 'bash', '-lc', shellCmd], {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
      })
    } else {
      // direct-pty (Linux/macOS)
      pty = ptySpawn('/bin/bash', ['-lc', command], {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd,
        env: process.env as Record<string, string>,
      })
    }

    return this.finalizePtyStart(projectId, pty, this.capability.backend as 'wsl-pty' | 'direct-pty')
  }

  private finalizePtyStart(
    projectId: string,
    pty: IPty,
    backend: 'tmux' | 'wsl-pty' | 'direct-pty',
  ): boolean {
    const managed: PtyManagedProcess = { pty, projectId, startTime: Date.now(), backend }
    this.processes.set(projectId, managed)

    // Resize controller
    const resizeCtrl = new ResizeController()
    resizeCtrl.onResize((size: PtySize) => {
      try { pty.resize(size.cols, size.rows) } catch { /* ignore */ }
    })
    this.resizeCtrls.set(projectId, resizeCtrl)

    pty.onData((data: string) => {
      this.send(IPC_CHANNELS.PROCESS_OUTPUT, { projectId, data })
    })

    pty.onExit(({ exitCode }: { exitCode: number }) => {
      this.resizeCtrls.get(projectId)?.dispose()
      this.resizeCtrls.delete(projectId)
      this.processes.delete(projectId)
      this.send(IPC_CHANNELS.PROCESS_STATUS, { projectId, status: 'stopped' })
      this.send(IPC_CHANNELS.PROCESS_EXIT, { projectId, code: exitCode })
    })

    this.send(IPC_CHANNELS.PROCESS_STATUS, { projectId, status: 'running' })
    return true
  }

  // ── backend: spawn fallback ─────────────────────────────

  private startWithSpawn(projectId: string, command: string, cwd: string): boolean {
    const child = spawnChild(command, [], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      env: { ...process.env },
    })

    const managed: SpawnManagedProcess = { child, projectId, startTime: Date.now(), backend: 'spawn' }
    this.processes.set(projectId, managed)

    child.stdout?.on('data', (data: Buffer) => {
      this.send(IPC_CHANNELS.PROCESS_OUTPUT, { projectId, data: data.toString() })
    })

    child.stderr?.on('data', (data: Buffer) => {
      this.send(IPC_CHANNELS.PROCESS_OUTPUT, { projectId, data: data.toString() })
    })

    child.on('exit', (code) => {
      this.processes.delete(projectId)
      this.send(IPC_CHANNELS.PROCESS_STATUS, { projectId, status: 'stopped' })
      this.send(IPC_CHANNELS.PROCESS_EXIT, { projectId, code })
    })

    child.on('error', (err) => {
      this.processes.delete(projectId)
      this.send(IPC_CHANNELS.PROCESS_OUTPUT, { projectId, data: `Error: ${err.message}\n` })
      this.send(IPC_CHANNELS.PROCESS_STATUS, { projectId, status: 'error' })
    })

    this.send(IPC_CHANNELS.PROCESS_STATUS, { projectId, status: 'running' })
    return true
  }

  // ── stop helpers ────────────────────────────────────────

  private stopSpawn(managed: SpawnManagedProcess): boolean {
    const pid = managed.child.pid
    if (pid == null) {
      this.processes.delete(managed.projectId)
      return true
    }

    try {
      if (process.platform === 'win32') {
        const killer = spawnChild('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' })
        killer.on('error', () => {
          try { managed.child.kill() } catch { /* dead */ }
        })
      } else {
        try { process.kill(-pid, 'SIGTERM') } catch { /* already dead */ }
        setTimeout(() => {
          try { process.kill(-pid, 'SIGKILL') } catch { /* already dead */ }
        }, 2000)
      }
    } catch {
      try { managed.child.kill() } catch { /* already dead */ }
    }
    return true
  }

  private stopPty(managed: PtyManagedProcess): boolean {
    const { pty, projectId, backend } = managed

    // Graceful Ctrl+C
    try { pty.write('\x03') } catch { /* dead */ }

    if (backend === 'tmux') {
      const sessionName = getSessionName(projectId)
      tmuxManager.killSession(sessionName)
    }

    // Force kill after grace period
    setTimeout(() => {
      try { pty.kill('SIGTERM') } catch { /* already dead */ }
    }, 1500)

    this.processes.delete(projectId)
    return true
  }

  // ── IPC ─────────────────────────────────────────────────

  private send(channel: string, data: unknown): void {
    this.outputWindow?.webContents.send(channel, data)
  }
}

export { ProcessManager }
