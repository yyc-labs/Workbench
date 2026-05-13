import type { BackendMode, Capability } from '../shared/types'
import { wslBridge } from './wsl-bridge'

class CapabilityManager {
  private cache: Capability | null = null

  /** One-time boot probe. Must be called before get() / getBackend(). */
  async init(): Promise<void> {
    if (this.cache) return

    const hasPty = this.tryLoadNodePty()
    const hasWsl = process.platform === 'win32' && wslBridge.isAvailable()
    const hasTmux = hasWsl ? await wslBridge.hasTmux() : false

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

    this.cache = {
      backend,
      hasPty,
      hasWsl,
      hasTmux,
      wslDistro: hasWsl ? wslBridge.getDistro() : undefined,
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
}

export const capabilityManager = new CapabilityManager()
