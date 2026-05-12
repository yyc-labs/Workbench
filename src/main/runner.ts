import { spawn, type ChildProcess } from 'child_process'
import type { BrowserWindow } from 'electron'

export const IPC_CHANNELS = {
  PROCESS_OUTPUT: 'process:output',
  PROCESS_STATUS: 'process:status',
  PROCESS_EXIT: 'process:exit',
} as const

interface ManagedProcess {
  child: ChildProcess
  projectId: string
  startTime: number
}

class ProcessManager {
  private processes = new Map<string, ManagedProcess>()
  private outputWindow: BrowserWindow | null = null

  setOutputWindow(win: BrowserWindow): void {
    this.outputWindow = win
  }

  start(projectId: string, command: string, cwd: string): boolean {
    if (this.processes.has(projectId)) return false

    // Split "npm run dev" → ["npm", "run", "dev"] so we can avoid shell:true.
    // Without the shell wrapper, the spawned command IS the process tree root,
    // making taskkill /t reliable (no extra cmd.exe parent).
    const [cmd, ...args] = command.split(' ')

    const child = spawn(cmd, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    const managed: ManagedProcess = { child, projectId, startTime: Date.now() }
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
      this.send(IPC_CHANNELS.PROCESS_OUTPUT, {
        projectId,
        data: `Error: ${err.message}\n`,
      })
      this.send(IPC_CHANNELS.PROCESS_STATUS, { projectId, status: 'error' })
    })

    this.send(IPC_CHANNELS.PROCESS_STATUS, { projectId, status: 'running' })
    return true
  }

  stop(projectId: string): boolean {
    const managed = this.processes.get(projectId)
    if (!managed) return false

    const pid = managed.child.pid
    if (pid == null) {
      this.processes.delete(projectId)
      return true
    }

    try {
      if (process.platform === 'win32') {
        // /T kills the entire process tree (shell → dev server → node → vite)
        // /F forces termination, no graceful shutdown prompt
        const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
          stdio: 'ignore',
        })
        // If taskkill itself fails, fall back to direct kill
        killer.on('error', () => {
          try { managed.child.kill() } catch { /* dead */ }
        })
      } else {
        // Negative PID = kill entire process group (Unix)
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

  /** Kill all running processes — called on app quit. Delegates to stop() so exit events handle cleanup. */
  stopAll(): void {
    for (const projectId of this.processes.keys()) {
      this.stop(projectId)
    }
  }

  sendInput(projectId: string, data: string): void {
    const managed = this.processes.get(projectId)
    managed?.child.stdin?.write(data)
  }

  isRunning(projectId: string): boolean {
    return this.processes.has(projectId)
  }

  private send(channel: string, data: unknown): void {
    this.outputWindow?.webContents.send(channel, data)
  }
}

export const processManager = new ProcessManager()
