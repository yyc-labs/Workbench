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

    const child = spawn(command, [], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
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
    if (pid != null) {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(pid), '/f', '/t'])
        } else {
          process.kill(-pid, 'SIGTERM')
          setTimeout(() => {
            try { process.kill(pid, 'SIGKILL') } catch { /* already dead */ }
          }, 3000)
        }
      } catch {
        // Process may already be dead
      }
    }
    return true
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
