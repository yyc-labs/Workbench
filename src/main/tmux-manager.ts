import { wslBridge } from './wsl-bridge'
import type { TmuxSessionInfo, RecoveredSession } from '../shared/types'

/** djb2 hash, same algorithm as detector.ts generateId */
function simpleHash(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i)
    hash = hash | 0
  }
  return Math.abs(hash).toString(36)
}

/** P0 3: Safe tmux session name — hash-based, no special chars, max ~14 chars */
function safeSessionName(projectId: string): string {
  return `lx_${simpleHash(projectId)}`
}

class TmuxManager {
  createSession(sessionName: string, command: string, wslPath: string): Promise<boolean> {
    const escaped = command.replace(/'/g, "'\\''")
    const cmd = [
      `tmux new-session -d -s '${sessionName}' -c '${wslPath}' '${escaped}'`,
      `tmux set-option -t '${sessionName}' remain-on-exit on`,
    ].join(' && ')

    return wslBridge.exec(cmd).then(() => true).catch(() => false)
  }

  killSession(sessionName: string): Promise<boolean> {
    return wslBridge
      .exec(`tmux kill-session -t '${sessionName}'`)
      .then(() => true)
      .catch(() => false)
  }

  sessionExists(sessionName: string): Promise<boolean> {
    return wslBridge
      .exec(`tmux has-session -t '${sessionName}' && echo yes || echo no`)
      .then((out) => out.includes('yes'))
      .catch(() => false)
  }

  attachCommand(sessionName: string): string {
    return `exec tmux attach-session -t '${sessionName}'`
  }

  /** List sessions with lx_ prefix. Returns session metadata from tmux. */
  async listLauncherSessions(): Promise<TmuxSessionInfo[]> {
    try {
      const raw = await wslBridge.exec(
        `tmux list-sessions -F '#{session_name}|#{session_created}' 2>/dev/null || true`
      )
      if (!raw) return []

      return raw
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [name, createdUnix] = line.split('|')
          const projectId = name.startsWith('lx_') ? name.slice(3) : name
          return {
            sessionName: name,
            projectId,
            createdAt: parseInt(createdUnix, 10) * 1000 || 0,
            status: 'detached' as const,
          }
        })
        .filter((s) => s.sessionName.startsWith('lx_'))
    } catch {
      return []
    }
  }

  /** P0 2: Recover orphan sessions after Electron restart. */
  async rehydrate(): Promise<RecoveredSession[]> {
    const sessions = await this.listLauncherSessions()
    const recovered: RecoveredSession[] = []

    for (const s of sessions) {
      try {
        const cwd = await wslBridge.exec(
          `tmux display-message -p -t '${s.sessionName}' '#{pane_current_path}'`
        )
        recovered.push({
          sessionName: s.sessionName,
          projectId: s.projectId,
          cwd: cwd || '',
          status: 'detached',
          createdAt: s.createdAt,
        })
      } catch {
        recovered.push({
          sessionName: s.sessionName,
          projectId: s.projectId,
          cwd: '',
          status: 'detached',
          createdAt: s.createdAt,
        })
      }
    }

    return recovered
  }

  async killAllLauncherSessions(): Promise<void> {
    const sessions = await this.listLauncherSessions()
    for (const s of sessions) {
      try {
        await wslBridge.exec(`tmux kill-session -t '${s.sessionName}'`)
      } catch { /* already dead */ }
    }
  }

  async sendKeys(sessionName: string, keys: string): Promise<boolean> {
    const escaped = keys.replace(/'/g, "'\\''")
    return wslBridge
      .exec(`tmux send-keys -t '${sessionName}' '${escaped}'`)
      .then(() => true)
      .catch(() => false)
  }

  async resizeSession(sessionName: string, cols: number, rows: number): Promise<boolean> {
    return wslBridge
      .exec(`tmux resize-pane -t '${sessionName}' -x ${cols} -y ${rows}`)
      .then(() => true)
      .catch(() => false)
  }
}

/** Session name from projectId (P0 3). Export for use in runner. */
export function getSessionName(projectId: string): string {
  return safeSessionName(projectId)
}

export const tmuxManager = new TmuxManager()
