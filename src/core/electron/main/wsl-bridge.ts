import { spawn, execSync } from 'child_process'

export interface WslStatus {
  available: boolean
  distro: string
}

class WslBridge {
  private _available: boolean | null = null
  private _distro: string | null = null
  private _shell: string | null = null

  private execWithArgs(args: string[], cmdLabel: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('wsl.exe', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let out = ''
      let err = ''

      child.stdout?.on('data', (d: Buffer) => { out += d.toString() })
      child.stderr?.on('data', (d: Buffer) => { err += d.toString() })

      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        reject(new Error(`WSL command timed out after ${timeoutMs}ms: ${cmdLabel}`))
      }, timeoutMs)

      child.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) {
          resolve(out.trim())
        } else {
          reject(new Error(err.trim() || `WSL command exited with code ${code}: ${cmdLabel}`))
        }
      })

      child.on('error', (e) => {
        clearTimeout(timer)
        reject(new Error(`Failed to spawn wsl.exe: ${e.message}`))
      })
    })
  }

  private parseDistroLines(raw: Buffer, encoding: BufferEncoding): string[] {
    return raw
      .toString(encoding)
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .map((line) => line.replace(/\u0000/g, '').trim())
      .filter(Boolean)
  }

  private scoreDistroLines(lines: string[]): number {
    if (lines.length === 0) return -1
    let score = 0
    for (const line of lines) {
      if (/[\uFFFD]/.test(line)) score -= 5
      if (/[A-Za-z0-9._ -]/.test(line)) score += 2
      if (/ubuntu/i.test(line)) score += 3
      if (/^[\w.\- ]+$/.test(line)) score += 1
      if (line.length > 64) score -= 2
    }
    return score
  }

  private resolveDistros(raw: Buffer): string[] {
    const utf16 = this.parseDistroLines(raw, 'utf16le')
    const utf8 = this.parseDistroLines(raw, 'utf8')
    return this.scoreDistroLines(utf16) >= this.scoreDistroLines(utf8)
      ? utf16
      : utf8
  }

  /** One-shot check: is WSL installed? Uses execSync because it's only called at boot. */
  isAvailable(): boolean {
    if (this._available !== null) return this._available
    try {
      execSync('wsl.exe --status', { stdio: 'pipe', timeout: 5000 })
      this._available = true

      // wsl.exe output encoding varies by environment/version (UTF-16LE by default,
      // UTF-8 when WSL_UTF8=1). Parse both, then pick the most plausible lines.
      const distroBuf = execSync('wsl.exe -l -q', { timeout: 5000 })
      const distros = this.resolveDistros(distroBuf)
      // Prefer Ubuntu, fall back to first listed
      this._distro = distros.find((d) => d.toLowerCase().includes('ubuntu')) || distros[0] || 'Ubuntu'

      // Detect available shell inside the target distro
      try {
        execSync(`wsl.exe -d "${this._distro}" -e bash -c "echo ok"`, { stdio: 'pipe', timeout: 5000 })
        this._shell = 'bash'
      } catch {
        this._shell = 'sh'
      }

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

  /** Returns the detected shell: 'bash' or 'sh'. Call after isAvailable() returns true. */
  getShell(): string {
    this.isAvailable()
    return this._shell ?? 'sh'
  }

  /** Convert Windows path to WSL path. C:\Users\me\proj → /mnt/c/Users/me/proj */
  toWslPath(windowsPath: string): string {
    const normalized = windowsPath.replace(/\\/g, '/')

    // UNC for WSL share:
    //   \\wsl.localhost\Ubuntu\home\ubuntu\proj
    //   \\wsl$\Ubuntu\home\ubuntu\proj
    // -> /home/ubuntu/proj
    const uncWsl = normalized.match(/^\/\/(?:wsl\.localhost|wsl\$)\/[^/]+\/?(.*)$/i)
    if (uncWsl) {
      const rest = uncWsl[1] ?? ''
      return rest ? `/${rest.replace(/^\/+/, '')}` : '/'
    }

    const drive = normalized.match(/^([A-Za-z]):\/(.*)$/)
    if (drive) {
      return `/mnt/${drive[1].toLowerCase()}/${drive[2]}`
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
    const distro = this.getDistro()
    const shell = this.getShell()
    const shellFlag = shell === 'bash' ? '-lc' : '-c'
    return this.execWithArgs(['-d', distro, '-e', shell, shellFlag, cmd], cmd, timeoutMs)
  }

  /** Execute a command in interactive login bash so ~/.bashrc is loaded exactly like a terminal session. */
  execBashInteractiveLogin(cmd: string, timeoutMs = 15000): Promise<string> {
    const distro = this.getDistro()
    return this.execWithArgs(['-d', distro, '-e', 'bash', '-ilc', cmd], `bash -ilc ${cmd}`, timeoutMs)
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
