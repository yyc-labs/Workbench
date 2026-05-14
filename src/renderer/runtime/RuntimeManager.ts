// Duplicated from tmux-manager.ts safeSessionName — renderer cannot import main.
function deriveSessionName(projectId: string, projectName?: string): string {
  const hashPart = projectId.startsWith('p')
    ? projectId.slice(1, 7)
    : simpleHash(projectId).slice(0, 6)
  if (projectName) {
    const safe = projectName.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24)
    if (safe) return `lx_${safe}_${hashPart}`
  }
  return `lx_${hashPart}`
}

function simpleHash(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i)
    hash = hash | 0
  }
  return Math.abs(hash).toString(36)
}

class RuntimeManager {
  private pollTimer: ReturnType<typeof setInterval> | null = null

  /** Derive session name from project metadata (pure, no IPC). */
  getSessionName(projectId: string, projectName?: string): string {
    return deriveSessionName(projectId, projectName)
  }

  /** Background start — spawns the Claude init script via detached WSL process.
   *  Does NOT open a terminal window. Use `openTerminal()` for that.
   *  Session name is computed in main process to match the script's MD5 naming. */
  async startRuntime(
    projectId: string,
    projectPath: string,
  ): Promise<boolean> {
    return window.electronAPI.startRuntime(projectId, projectPath)
  }

  /** Open the singleton Windows Terminal and switch to the target tmux session. */
  async openTerminal(sessionName: string): Promise<boolean> {
    console.log('[RuntimeManager.openTerminal] sessionName=', sessionName)
    const result = await window.electronAPI.openTerminal(sessionName)
    console.log('[RuntimeManager.openTerminal] IPC returned', result)
    return result
  }

  /** Stop — kills the tmux session by name. */
  async stopRuntime(sessionName: string): Promise<void> {
    await window.electronAPI.killTmuxSession(sessionName)
  }

  /** Returns raw tmux session list. Caller (store) constructs SessionRuntime[]. */
  async listTmuxSessions() {
    return window.electronAPI.listTmuxSessions()
  }

  /** Wait until a session no longer exists (for restart safety). */
  async waitForSessionGone(sessionName: string, timeoutMs = 10000): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const sessions = await window.electronAPI.listTmuxSessions()
      if (!sessions.find((s) => s.sessionName === sessionName)) return
      await new Promise((r) => setTimeout(r, 300))
    }
  }

  /** Start centralized polling. onRefresh is called on each tick. */
  startPolling(onRefresh: () => void, intervalMs = 10000): void {
    this.stopPolling()
    onRefresh() // immediate first call
    this.pollTimer = setInterval(onRefresh, intervalMs)
  }

  stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }
}

export const runtimeManager = new RuntimeManager()
