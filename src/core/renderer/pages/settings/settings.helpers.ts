import type { BackendMode } from '../../../shared/types'

export function clampSplitMaxBatches(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 4
  return Math.max(1, Math.min(12, Math.trunc(value)))
}

export function clampMaxBullets(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 8
  return Math.max(1, Math.min(20, Math.trunc(value)))
}

export function backendLabel(backend: BackendMode): string {
  if (backend === 'tmux') return 'tmux'
  if (backend === 'wsl-pty') return 'wsl-pty'
  if (backend === 'direct-pty') return 'direct-pty'
  return 'spawn'
}

export function formatSince(ts: number): string {
  if (!ts) return '-'
  const diff = Date.now() - ts
  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  return `${Math.floor(diff / 3_600_000)}h`
}
