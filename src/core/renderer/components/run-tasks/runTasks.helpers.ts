import type { RunTask, RunTaskCandidate, RunTaskState, RunTaskCandidateSource } from '../../../shared/runTasks'

/** Tailwind classes for a run task state badge, using theme tokens valid in both themes. */
export function runTaskStateBadgeClass(state: RunTaskState | undefined): string {
  switch (state) {
    case 'ready':
    case 'running':
      return 'bg-[color:var(--color-success-background)] text-[color:var(--color-success)]'
    case 'starting':
    case 'waiting':
    case 'stopping':
      return 'bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)]'
    case 'failed':
      return 'bg-[color:var(--color-destructive-background)] text-[color:var(--color-destructive)]'
    default:
      return 'bg-[color:var(--color-accent)] text-[color:var(--color-muted-foreground)]'
  }
}

export function runTaskDotClass(state: RunTaskState | undefined): string {
  switch (state) {
    case 'ready':
    case 'running':
      return 'bg-[color:var(--color-success)]'
    case 'starting':
    case 'waiting':
      return 'bg-[color:var(--color-warning)]'
    case 'stopping':
      return 'bg-[color:var(--color-warning)] animate-pulse'
    case 'failed':
      return 'bg-[color:var(--color-destructive)]'
    default:
      return 'bg-[color:var(--color-muted-foreground)]/40'
  }
}

export function isRunTaskActive(state: RunTaskState | undefined): boolean {
  return state === 'starting' || state === 'ready' || state === 'running' || state === 'stopping'
}

/** Aggregate badge state across a project's tasks (used by ProjectCard). */
export function aggregateRunTaskState(states: Record<string, { state: RunTaskState }>): RunTaskState | null {
  const values = Object.values(states)
  if (values.length === 0) return null
  if (values.some((item) => item.state === 'failed')) return 'failed'
  if (values.some((item) => item.state === 'stopping')) return 'stopping'
  if (values.every((item) => item.state === 'ready' || item.state === 'running')) return 'ready'
  if (values.some((item) => isRunTaskActive(item.state))) return 'starting'
  return 'stopped'
}

export function runTaskReadinessSummary(task: RunTask): string | null {
  const readiness = task.readiness
  if (!readiness) return null
  switch (readiness.strategy) {
    case 'url':
      return readiness.urlPattern ? `url:/${readiness.urlPattern}/` : 'url'
    case 'http':
      return `http:${readiness.httpUrl ?? ''}`
    case 'port':
      return `port:${readiness.port ?? ''}`
    case 'delay':
      return `delay:${readiness.delayMs ?? 0}ms`
    case 'exit':
      return 'exit:0'
    default:
      return null
  }
}

export const RUN_TASK_SOURCE_ORDER: RunTaskCandidateSource[] = ['package-script', 'docker-compose', 'workspace', 'common-dir']

export function groupCandidatesBySource(candidates: RunTaskCandidate[]): Array<{ source: RunTaskCandidateSource; items: RunTaskCandidate[] }> {
  const grouped = new Map<RunTaskCandidateSource, RunTaskCandidate[]>()
  for (const candidate of candidates) {
    const list = grouped.get(candidate.source)
    if (list) list.push(candidate)
    else grouped.set(candidate.source, [candidate])
  }
  return RUN_TASK_SOURCE_ORDER.filter((source) => grouped.has(source)).map((source) => ({
    source,
    items: grouped.get(source) as RunTaskCandidate[],
  }))
}
