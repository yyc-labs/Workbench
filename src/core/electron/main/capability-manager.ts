import { execFileSync, execSync } from 'child_process'
import type { BackendMode, Capability } from '../../shared/types'

type HostWslInstallInfo = {
  installed: boolean
  distro?: string
}

class CapabilityManager {
  private cache: Capability | null = null

  /** One-time boot probe. Must be called before get() / getBackend(). */
  async init(): Promise<void> {
    if (this.cache) return

    const hasPty = this.tryLoadNodePty()
    const hostPlatform = this.resolveHostPlatform()
    const wslInstallInfo = this.detectHostWslInstallInfo(hostPlatform)
    const hasWsl = false
    const hasTmux = this.detectBootTmuxAvailability()

    let backend: BackendMode
    if (hasTmux) {
      backend = 'tmux'
    } else if (hasPty) {
      backend = 'direct-pty'
    } else {
      backend = 'spawn'
    }

    this.cache = {
      hostPlatform,
      backend,
      hasPty,
      hasWslInstalled: wslInstallInfo.installed,
      hasWsl,
      hasTmux,
      wslDistro: wslInstallInfo.distro,
      wslShell: 'bash',
      // Avoid waking WSL with an interactive login shell during app boot.
      wslEnv: undefined,
    }
  }

  /** Read cached capability. Throws if init() was never called. */
  get(): Capability {
    if (!this.cache) {
      throw new Error('CapabilityManager not initialized — call init() first')
    }
    return this.cache
  }

  getBackend(): BackendMode {
    return this.get().backend
  }

  merge(next: Partial<Capability>): Capability {
    const current = this.get()
    const merged: Capability = {
      ...current,
      ...next,
      hostPlatform: next.hostPlatform ?? current.hostPlatform,
      backend: next.backend ?? current.backend,
      hasPty: next.hasPty ?? current.hasPty,
      hasWslInstalled: next.hasWslInstalled ?? current.hasWslInstalled,
      hasWsl: next.hasWsl ?? current.hasWsl,
      hasTmux: next.hasTmux ?? current.hasTmux,
      wslDistro: next.wslDistro ?? current.wslDistro,
      wslShell: next.wslShell ?? current.wslShell,
      wslEnv: next.wslEnv ?? current.wslEnv,
    }
    this.cache = merged
    return merged
  }

  private tryLoadNodePty(): boolean {
    try {
      require('node-pty')
      return true
    } catch {
      return false
    }
  }

  private resolveHostPlatform(): Capability['hostPlatform'] {
    if (process.platform === 'win32') return 'windows'
    if (process.platform === 'darwin') return 'macos'
    return 'linux'
  }

  private detectBootTmuxAvailability(): boolean {
    if (process.platform === 'win32') return false
    try {
      execSync('tmux -V', { stdio: 'pipe', timeout: 5000 })
      return true
    } catch {
      return false
    }
  }

  private detectHostWslInstallInfo(hostPlatform: Capability['hostPlatform']): HostWslInstallInfo {
    if (hostPlatform !== 'windows') return { installed: false }
    try {
      const raw = execFileSync('reg.exe', [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss',
        '/s',
      ], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
      })
      const distributionNames = Array.from(raw.matchAll(/DistributionName\s+REG_SZ\s+(.+)/gi))
        .map((match) => match[1]?.trim())
        .filter((name): name is string => Boolean(name))
      const distro = distributionNames.find((name) => /ubuntu/i.test(name)) || distributionNames[0]
      return {
        installed: distributionNames.length > 0,
        distro,
      }
    } catch {
      return { installed: false }
    }
  }
}

export const capabilityManager = new CapabilityManager()
