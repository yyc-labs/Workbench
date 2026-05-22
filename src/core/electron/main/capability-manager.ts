import { execSync } from 'child_process'
import type { BackendMode, Capability } from '../../shared/types'
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

    const distro = hasWsl ? wslBridge.getDistro() : undefined
    const shell = hasWsl ? wslBridge.getShell() : 'bash'
    const wslEnv = hasWsl ? await this.captureWslEnv(distro!) : undefined

    this.cache = {
      backend,
      hasPty,
      hasWsl,
      hasTmux,
      wslDistro: distro,
      wslShell: shell,
      wslEnv,
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

  /** Capture full WSL environment via interactive login shell.
   *  bash -ilc ensures .bashrc is sourced (nvm, API keys, proxy, PATH). */
  private async captureWslEnv(distro: string): Promise<Record<string, string>> {
    try {
      const buf = execSync(`wsl.exe -d ${distro} -e bash -ilc env`, {
        timeout: 15000,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const env: Record<string, string> = {}
      for (const line of buf.toString().split('\n')) {
        const eq = line.indexOf('=')
        if (eq > 0) {
          env[line.slice(0, eq)] = line.slice(eq + 1)
        }
      }
      return env
    } catch {
      return {}
    }
  }
}

export const capabilityManager = new CapabilityManager()
