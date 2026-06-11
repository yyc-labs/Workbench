class RuntimeManager {
  private pollTimer: ReturnType<typeof setInterval> | null = null

  /** Background start — spawns the AI Coding CLI init script via detached WSL process.
   *  Does NOT open a terminal window. Use `openTerminal()` for that.
   *  Session name is computed in main process to match the script's MD5 naming. */
  async startRuntime(
    projectId: string,
    projectPath: string,
    cli?: 'claude' | 'codex',
  ): Promise<boolean> {
    return window.electronAPI.startRuntime(projectId, projectPath, cli)
  }

  /** Open the singleton Windows Terminal and switch to the target tmux session.
   *   statusHint: when 'attached', main process skips WSL tmux checks and focuses directly. */
  async openTerminal(sessionName: string, statusHint?: string): Promise<boolean> {
    console.log('[RuntimeManager.openTerminal] sessionName=', sessionName, 'statusHint=', statusHint)
    const result = await window.electronAPI.openTerminal(sessionName, statusHint)
    console.log('[RuntimeManager.openTerminal] IPC returned', result)
    return result
  }

  /** Stop — kills the tmux session by name. */
  async stopRuntime(sessionName: string): Promise<void> {
    await window.electronAPI.killTmuxSession(sessionName)
  }

  /** Returns provider-backed runtime sessions. */
  async listRuntimeSessions() {
    return window.electronAPI.listRuntimeSessions()
  }

  /** Wait until a session no longer exists (for restart safety). */
  async waitForSessionGone(sessionName: string, timeoutMs = 10000): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const sessions = await window.electronAPI.listRuntimeSessions()
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
