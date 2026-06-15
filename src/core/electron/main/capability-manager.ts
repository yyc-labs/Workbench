import { execSync } from 'child_process'
import type { BackendMode, Capability } from '../../shared/types'
import { wslBridge } from './wsl-bridge'

class CapabilityManager {
  private cache: Capability | null = null

  /** One-time boot probe. Must be called before get() / getBackend(). */
  async init(): Promise<void> {
    if (this.cache) return

    const hasPty = this.tryLoadNodePty()
    const hostPlatform = this.resolveHostPlatform()
    const hasWsl = process.platform === 'win32' && wslBridge.isAvailable()
    const hasTmux = await this.detectTmuxAvailability(hasWsl)

    let backend: BackendMode
    if (hasTmux) {
      backend = 'tmux'
    } else if (hasWsl && hasPty) {
      backend = 'wsl-pty'
    } else if (hasPty) {
      backend = 'direct-pty'
    } else {
      backend = 'spawn'
    }

    const distro = hasWsl ? wslBridge.getDistro() : undefined
    const shell = hasWsl ? wslBridge.getShell() : 'bash'

    this.cache = {
      hostPlatform,
      backend,
      hasPty,
      hasWsl,
      hasTmux,
      wslDistro: distro,
      wslShell: shell,
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

  private async detectTmuxAvailability(hasWsl: boolean): Promise<boolean> {
    if (hasWsl) {
      return wslBridge.hasTmux()
    }
    try {
      execSync('tmux -V', { stdio: 'pipe', timeout: 5000 })
      return true
    } catch {
      return false
    }
  }
}

export const capabilityManager = new CapabilityManager()
