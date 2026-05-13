import { spawn as spawnChild, type ChildProcess } from 'child_process'
import { basename } from 'path'
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
  sessionName?: string
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

  start(projectId: string, command: string, cwd: string, useWsl?: boolean): boolean {
    if (this.processes.has(projectId)) return false

    // Per-process environment override: Windows-native vs WSL
    if (useWsl === false && process.platform === 'win32') {
      return this.startHostNative(projectId, command, cwd)
    }
    if (useWsl === true) {
      if (!this.capability.hasWsl) return false
      return this.startWithPty(projectId, command, cwd)
    }

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

  /** Build WSL shell args: ['-d', <distro>, '-e', <shell>, <-lc|-c>, <cmd>] */
  private wslShellArgs(cmd: string): string[] {
    const distro = this.capability.wslDistro || 'Ubuntu'
    const shell = this.capability.wslShell || 'bash'
    const flag = shell === 'bash' ? '-lc' : '-c'
    return ['-d', distro, '-e', shell, flag, cmd]
  }

  /** Build shell export chain from captured WSL environment.
   *  Filters out shell-internal vars (_ , PWD, SHLVL, etc.) that are
   *  harmless to export but add noise.  Single quotes with escape. */
  private wslEnvPrefix(): string {
    const env = this.capability.wslEnv
    if (!env) return ''
    const parts: string[] = []
    for (const [k, v] of Object.entries(env)) {
      if (['_', 'PWD', 'OLDPWD', 'SHLVL', 'TERM'].includes(k)) continue
      parts.push(`export ${k}='${v.replace(/'/g, "'\\''")}'`)
    }
    return parts.join(' && ') + ' && '
  }

  // ── backend: host-native (Windows cmd.exe) ──────────────

  private startHostNative(projectId: string, command: string, cwd: string): boolean {
    if (!this.capability.hasPty) {
      return this.startWithSpawn(projectId, command, cwd)
    }
    const ptySpawn = this.getPtySpawn()
    const pty = ptySpawn('cmd.exe', ['/c', command], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd,
      env: process.env as Record<string, string>,
    })
    return this.finalizePtyStart(projectId, pty, 'direct-pty')
  }

  // ── backend: tmux ───────────────────────────────────────

  private startWithTmux(projectId: string, command: string, cwd: string): boolean {
    const projectName = basename(cwd)
    const sessionName = getSessionName(projectId, projectName)
    const wslPath = wslBridge.toWslPath(cwd)
    const ptySpawn = this.getPtySpawn()

    // Use tmux -A (attach-or-create): single step, no race condition.
    // When command is non-empty: creates new session if needed, then attaches.
    // When command is empty: only attaches to existing session (reattach flow).
    // Prepend captured WSL env so the tmux session inherits PATH, API keys,
    // proxy settings etc. even though the shell is non-interactive.
    const hasCommand = command && command.trim().length > 0
    const wrappedCommand = hasCommand ? this.wslEnvPrefix() + command : command
    const attachCmd = hasCommand
      ? tmuxManager.attachOrCreateCommand(sessionName, wrappedCommand, wslPath)
      : tmuxManager.attachOrCreateCommand(sessionName)

    const pty = ptySpawn('wsl.exe', this.wslShellArgs(attachCmd), {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
    })

    const result = this.finalizePtyStart(projectId, pty, 'tmux')
    if (result) {
      const managed = this.processes.get(projectId) as PtyManagedProcess
      managed.sessionName = sessionName
    }
    return result
  }

  // ── backend: wsl-pty | direct-pty ──────────────────────

  private startWithPty(projectId: string, command: string, cwd: string): boolean {
    const ptySpawn = this.getPtySpawn()
    let pty: IPty

    if (process.platform === 'win32' && this.capability.hasWsl) {
      // Route through WSL when available — used by Claude and other Linux tools.
      // Converts Windows paths to WSL paths on the fly.
      const wslPath = wslBridge.toWslPath(cwd)
      const escapedCmd = command.replace(/'/g, "'\\''")
      const shellCmd = `${this.wslEnvPrefix()}cd '${wslPath}' && exec bash -lc '${escapedCmd}'`
      pty = ptySpawn('wsl.exe', this.wslShellArgs(shellCmd), {
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

    const backendTag: 'wsl-pty' | 'direct-pty' =
      process.platform === 'win32' && this.capability.hasWsl ? 'wsl-pty' : 'direct-pty'
    return this.finalizePtyStart(projectId, pty, backendTag)
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
      const sessionName = managed.sessionName || getSessionName(projectId)
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
