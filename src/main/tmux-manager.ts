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

/** Sanitize project name for use in tmux session name */
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24)
}

/** P0 3: Safe tmux session name — human-readable with hash for uniqueness */
function safeSessionName(projectId: string, projectName?: string): string {
  const hash = projectId.startsWith('p') ? projectId.slice(1, 7) : simpleHash(projectId).slice(0, 6)
  if (projectName) {
    const safe = sanitizeName(projectName)
    if (safe) return `lx_${safe}_${hash}`
  }
  return `lx_${hash}`
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

  countClients(sessionName: string): Promise<number> {
    return wslBridge
      .exec(`tmux list-clients -t '${sessionName}' -F '#{client_name}' 2>/dev/null`)
      .then((out) => out.trim().split('\n').filter(Boolean).length)
      .catch(() => 0)
  }

  /** Build tmux attach-or-create command for use in pty shell.
   *  When command+wslPath are provided: creates new session if needed, then attaches.
   *  When command is empty: only attaches to existing session (no creation). */
  attachOrCreateCommand(sessionName: string, command?: string, wslPath?: string): string {
    if (command && wslPath) {
      const escaped = command.replace(/'/g, "'\\''")
      return `exec tmux new-session -A -s '${sessionName}' -c '${wslPath}' '${escaped}'`
    }
    return `exec tmux new-session -A -s '${sessionName}'`
  }

  attachCommand(sessionName: string): string {
    return `exec tmux attach-session -t '${sessionName}'`
  }

  /** List all tmux sessions. Returns raw session metadata. */
  async listLauncherSessions(): Promise<TmuxSessionInfo[]> {
    try {
      const raw = await wslBridge.exec(
        `tmux list-sessions -F '#{session_name}|#{session_created}|#{session_attached}' 2>/dev/null || true`
      )
      if (!raw) return []

      return raw
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [name, createdUnix, attached] = line.split('|')
          return {
            sessionName: name,
            projectId: '',
            createdAt: parseInt(createdUnix, 10) * 1000 || 0,
            status: (attached !== '0' ? 'attached' : 'detached') as 'attached' | 'detached',
          }
        })
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

  /** Kill a session by projectId — looks up the actual session name first. */
  async killSessionByProjectId(projectId: string): Promise<boolean> {
    const sessions = await this.listLauncherSessions()
    const match = sessions.find((s) => s.projectId === projectId)
    if (!match) return false
    return this.killSession(match.sessionName)
  }

  async killAllLauncherSessions(): Promise<void> {
    const sessions = await this.listLauncherSessions()
    for (const s of sessions) {
      try {
        await wslBridge.exec(`tmux kill-session -t '${s.sessionName}'`)
      } catch { /* already dead */ }
    }
  }

  /** Kill provided session names only; ignores missing sessions. */
  async killSessions(sessionNames: string[]): Promise<void> {
    for (const name of sessionNames) {
      if (!name) continue
      const escaped = name.replace(/'/g, "'\\''")
      try {
        await wslBridge.exec(`tmux kill-session -t '${escaped}'`)
      } catch {
        // Ignore already-gone sessions
      }
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
export function getSessionName(projectId: string, projectName?: string): string {
  return safeSessionName(projectId, projectName)
}

export const tmuxManager = new TmuxManager()
