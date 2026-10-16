import { FolderOpen, Globe, Play, Terminal } from 'lucide-react'
import type { ComponentType } from 'react'
import type { QuickActionIcon, QuickActionSpec, QuickActionView } from '../../../../shared/types'
import { projectDisplayName } from '../../../lib/projectDisplay'
import type { TranslateFn } from '../../../lib/quickActionFeedback'

export const QUICK_ACTION_ICON_COMPONENTS: Record<QuickActionIcon, ComponentType<{ className?: string; strokeWidth?: string | number }>> = {
  'folder-open': FolderOpen,
  play: Play,
  terminal: Terminal,
  globe: Globe,
}

/** Resolves the display name of the project an action points at (null when unknown). */
export function resolveQuickActionProjectName(spec: QuickActionSpec, projects: ReadonlyArray<{ path: string; name: string; customName?: string }>): string | null {
  if (spec.type !== 'open-project' && spec.type !== 'run-task') return null
  const project = projects.find((item) => item.path === spec.projectPath)
  return project ? projectDisplayName(project) : null
}

/** Resolves the run task display name (falls back to the raw task id). */
export function resolveQuickActionTaskName(spec: QuickActionSpec, taskNames: ReadonlyMap<string, string>): string | null {
  if (spec.type !== 'run-task' || !spec.taskId) return null
  return taskNames.get(spec.taskId) ?? spec.taskId
}

/** One-line summary of what the action does, e.g. "my-app · dev server". */
export function describeQuickActionSummary(t: TranslateFn, spec: QuickActionSpec, projectName: string | null, taskName: string | null): string {
  switch (spec.type) {
    case 'open-project':
      return t('quickActions.card.summaryProject', { project: projectName ?? spec.projectPath })
    case 'run-task': {
      const project = projectName ?? spec.projectPath
      return spec.taskId ? t('quickActions.card.summaryTaskOne', { project, task: taskName ?? spec.taskId }) : t('quickActions.card.summaryTaskAll', { project })
    }
    case 'open-path':
      return t('quickActions.card.summaryPath', { path: spec.path })
    case 'open-url':
      return t('quickActions.card.summaryUrl', { url: spec.url })
  }
}

/** Sorts views by group (project → task → other) then by stored order; matches the main-process order. */
export function sortQuickActionViews(actions: QuickActionView[]): QuickActionView[] {
  const groupRank: Record<QuickActionView['group'], number> = { project: 0, task: 1, other: 2 }
  return actions.slice().sort((a, b) => groupRank[a.group] - groupRank[b.group] || a.order - b.order)
}
