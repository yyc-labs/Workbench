import { spawn, execSync } from 'child_process'

export interface WslStatus {
  available: boolean
  distro: string
}

class WslBridge {
  private _available: boolean | null = null
  private _distro: string | null = null

  /** One-shot check: is WSL installed? Uses execSync because it's only called at boot. */
  isAvailable(): boolean {
    if (this._available !== null) return this._available
    try {
      const out = execSync('wsl.exe --status', { stdio: 'pipe', timeout: 5000 })
      this._available = true

      const distroOut = execSync('wsl.exe -l -q', { encoding: 'utf-8', timeout: 5000 })
      const distros = distroOut.trim().split('\n').filter(Boolean)
      this._distro = distros[0] || 'Ubuntu'
      return true
    } catch {
      this._available = false
      return false
    }
  }

  getDistro(): string {
    this.isAvailable()
    return this._distro ?? 'Ubuntu'
  }

  /** Convert Windows path to WSL path. C:\Users\me\proj → /mnt/c/Users/me/proj */
  toWslPath(windowsPath: string): string {
    const normalized = windowsPath.replace(/\\/g, '/')
    const match = normalized.match(/^([A-Za-z]):\/(.*)$/)
    if (match) {
      return `/mnt/${match[1].toLowerCase()}/${match[2]}`
    }
    return normalized
  }

  /** Convert WSL path to Windows path. /mnt/c/Users/me → C:\Users\me */
  toWindowsPath(wslPath: string): string {
    const match = wslPath.match(/^\/mnt\/([a-z])\/(.*)$/)
    if (match) {
      return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, '\\')}`
    }
    return wslPath
  }

  /** Execute a command inside WSL. Async, non-blocking. */
  exec(cmd: string, timeoutMs = 15000): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('wsl.exe', ['-e', 'bash', '-lc', cmd], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let out = ''
      let err = ''

      child.stdout?.on('data', (d: Buffer) => { out += d.toString() })
      child.stderr?.on('data', (d: Buffer) => { err += d.toString() })

      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        reject(new Error(`WSL command timed out after ${timeoutMs}ms: ${cmd}`))
      }, timeoutMs)

      child.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) {
          resolve(out.trim())
        } else {
          reject(new Error(err.trim() || `WSL command exited with code ${code}: ${cmd}`))
        }
      })

      child.on('error', (e) => {
        clearTimeout(timer)
        reject(new Error(`Failed to spawn wsl.exe: ${e.message}`))
      })
    })
  }

  async hasTmux(): Promise<boolean> {
    if (!this.isAvailable()) return false
    try {
      await this.exec('command -v tmux')
      return true
    } catch {
      return false
    }
  }
}

export const wslBridge = new WslBridge()
