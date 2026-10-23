// Git 性能埋点的 renderer 侧计时（仅 WORKBENCH_GIT_TRACE=1 时输出，见 docs/todo/04-ai-commit-与-git-plan-detail.md §2）。
// 只输出动作名与耗时，不输出仓库路径与文件内容。

export function isGitTraceEnabled(): boolean {
  return window.electronAPI?.gitTraceEnabled === true
}

export function beginGitTraceTiming(): number {
  return isGitTraceEnabled() ? performance.now() : 0
}

export function endGitTraceTiming(action: string, startedAtMs: number): void {
  if (!startedAtMs || !isGitTraceEnabled()) return
  console.debug(`[git-trace] ${JSON.stringify({ scope: 'renderer', action, durationMs: Math.round(performance.now() - startedAtMs) })}`)
}
