import { Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { QuickActionResult, QuickActionSpec, QuickActionView } from '../../../shared/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { useI18n } from '../../i18n'
import { describeQuickActionResult } from '../../lib/quickActionFeedback'
import { useAppStore } from '../../stores/appStore'
import { QuickActionCard } from './quick-actions/QuickActionCard'
import { type QuickActionFilter, QuickActionFilters } from './quick-actions/QuickActionFilters'
import { QuickActionFormModal } from './quick-actions/QuickActionFormModal'
import { resolveQuickActionProjectName, resolveQuickActionTaskName, sortQuickActionViews } from './quick-actions/quickActions.helpers'

export function SettingsQuickActionsPanel() {
  const { t } = useI18n()
  const quickActions = useAppStore((s) => s.quickActions)
  const quickActionsLoading = useAppStore((s) => s.quickActionsLoading)
  const loadQuickActions = useAppStore((s) => s.loadQuickActions)
  const createQuickAction = useAppStore((s) => s.createQuickAction)
  const updateQuickAction = useAppStore((s) => s.updateQuickAction)
  const deleteQuickAction = useAppStore((s) => s.deleteQuickAction)
  const executeQuickAction = useAppStore((s) => s.executeQuickAction)
  const reorderQuickAction = useAppStore((s) => s.reorderQuickAction)
  const createQuickActionDesktopShortcut = useAppStore((s) => s.createQuickActionDesktopShortcut)
  const removeQuickActionDesktopShortcut = useAppStore((s) => s.removeQuickActionDesktopShortcut)
  const projects = useAppStore((s) => s.projects)
  const runTaskConfigs = useAppStore((s) => s.runTaskConfigs)
  const loadRunTaskConfig = useAppStore((s) => s.loadRunTaskConfig)

  const [filter, setFilter] = useState<QuickActionFilter>('all')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<QuickActionView | null>(null)
  const [pendingDelete, setPendingDelete] = useState<QuickActionView | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    // 面板挂载即刷新；initApp 的后台 hydration 也可能已加载过（幂等）。
    void loadQuickActions()
  }, [loadQuickActions])

  // Run-task summaries need task names; load configs for the referenced projects.
  useEffect(() => {
    const needed = new Set(quickActions.filter((item) => item.action.type === 'run-task' && item.action.projectPath).map((item) => (item.action as { projectPath: string }).projectPath))
    for (const projectPath of needed) {
      const project = projects.find((item) => item.path === projectPath)
      if (!project) continue
      const projectId = project.id
      if (runTaskConfigs[projectId] !== undefined) continue
      void loadRunTaskConfig(projectId, projectPath)
    }
  }, [loadRunTaskConfig, projects, quickActions, runTaskConfigs])

  const sorted = useMemo(() => sortQuickActionViews(quickActions), [quickActions])

  const counts = useMemo<Record<QuickActionFilter, number>>(
    () => ({
      all: sorted.length,
      project: sorted.filter((item) => item.group === 'project').length,
      task: sorted.filter((item) => item.group === 'task').length,
      other: sorted.filter((item) => item.group === 'other').length,
    }),
    [sorted],
  )

  const visible = useMemo(() => (filter === 'all' ? sorted : sorted.filter((item) => item.group === filter)), [filter, sorted])

  /** taskId → task name across the loaded run-task configs, keyed by project path. */
  const taskNamesByPath = useMemo(() => {
    const map = new Map<string, Map<string, string>>()
    for (const [projectId, config] of Object.entries(runTaskConfigs)) {
      const project = projects.find((item) => item.id === projectId)
      if (!project || !config) continue
      const names = new Map(config.tasks.map((task) => [task.id, task.name]))
      map.set(project.path, names)
    }
    return map
  }, [projects, runTaskConfigs])

  const notifyResult = useCallback(
    (result: QuickActionResult) => {
      const feedback = describeQuickActionResult(t, result)
      if (feedback.kind === 'success') toast.success(feedback.message)
      else toast.error(feedback.message, { description: feedback.description })
    },
    [t],
  )

  const handleExecute = useCallback(
    async (action: QuickActionView) => {
      try {
        notifyResult(await executeQuickAction({ id: action.id }))
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
      }
    },
    [executeQuickAction, notifyResult],
  )

  const handleTestRun = useCallback(
    async (spec: QuickActionSpec) => {
      return executeQuickAction({ spec })
    },
    [executeQuickAction],
  )

  const handleSubmit = useCallback(
    async (input: { name: string; action: QuickActionSpec }) => {
      if (editing) {
        await updateQuickAction(editing.id, { name: input.name, action: input.action })
        return
      }
      await createQuickAction({ name: input.name, action: input.action })
    },
    [createQuickAction, editing, updateQuickAction],
  )

  const handleDuplicate = useCallback(
    async (action: QuickActionView) => {
      try {
        await createQuickAction({ name: `${action.name} - ${t('common.copy')}`, action: action.action })
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
      }
    },
    [createQuickAction, t],
  )

  const handleToggleEnabled = useCallback(
    async (action: QuickActionView) => {
      try {
        await updateQuickAction(action.id, { enabled: !action.enabled })
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
      }
    },
    [updateQuickAction],
  )

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await deleteQuickAction(pendingDelete.id)
      setPendingDelete(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setDeleting(false)
    }
  }, [deleteQuickAction, pendingDelete])

  const handleCreateShortcut = useCallback(
    async (action: QuickActionView) => {
      try {
        await createQuickActionDesktopShortcut(action.id)
        toast.success(t('quickActions.shortcut.create'))
      } catch (error) {
        toast.error(t('quickActions.shortcut.createFailed'), { description: error instanceof Error ? error.message : String(error) })
      }
    },
    [createQuickActionDesktopShortcut, t],
  )

  const handleRemoveShortcut = useCallback(
    async (action: QuickActionView) => {
      try {
        await removeQuickActionDesktopShortcut(action.id)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
      }
    },
    [removeQuickActionDesktopShortcut],
  )

  return (
    <div className="space-y-6 lg:space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="section-label mb-3">{t('quickActions.panel.kicker')}</p>
          <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">{t('quickActions.panel.title')}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--color-muted-foreground)]">{t('quickActions.panel.description')}</p>
        </div>
        <Button
          type="button"
          onClick={() => {
            setEditing(null)
            setFormOpen(true)
          }}
        >
          <Plus className="h-4 w-4" />
          {t('quickActions.panel.create')}
        </Button>
      </div>

      {sorted.length > 0 ? <QuickActionFilters value={filter} onChange={setFilter} counts={counts} /> : null}

      {sorted.length === 0 ? (
        <div className="surface-card flex flex-col items-center gap-3 px-6 py-12 text-center">
          <p className="text-sm font-medium text-[color:var(--color-foreground)]">{t('quickActions.panel.emptyTitle')}</p>
          <p className="max-w-md text-sm text-[color:var(--color-muted-foreground)]">{t('quickActions.panel.emptyDescription')}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
          >
            <Plus className="h-4 w-4" />
            {t('quickActions.panel.create')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((action) => {
            const groupItems = sorted.filter((item) => item.group === action.group)
            const groupIndex = groupItems.findIndex((item) => item.id === action.id)
            return (
              <QuickActionCard
                key={action.id}
                action={action}
                projectName={resolveQuickActionProjectName(action.action, projects)}
                taskName={resolveQuickActionTaskName(action.action, taskNamesByPath.get(action.action.type === 'run-task' ? action.action.projectPath : '') ?? new Map())}
                canMoveUp={groupIndex > 0}
                canMoveDown={groupIndex >= 0 && groupIndex < groupItems.length - 1}
                onExecute={() => void handleExecute(action)}
                onEdit={() => {
                  setEditing(action)
                  setFormOpen(true)
                }}
                onToggleEnabled={() => void handleToggleEnabled(action)}
                onMove={(direction) => void reorderQuickAction(action.id, direction)}
                onDuplicate={() => void handleDuplicate(action)}
                onDelete={() => setPendingDelete(action)}
                onCreateShortcut={() => void handleCreateShortcut(action)}
                onRemoveShortcut={() => void handleRemoveShortcut(action)}
              />
            )
          })}
          {visible.length === 0 ? <p className="px-1 py-6 text-center text-sm text-[color:var(--color-muted-foreground)]">{t('quickActions.filter.empty')}</p> : null}
        </div>
      )}

      <QuickActionFormModal open={formOpen} action={editing} projects={projects} onClose={() => setFormOpen(false)} onSubmit={handleSubmit} onTestRun={handleTestRun} />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleConfirmDelete}
        ariaLabel={t('quickActions.card.deleteConfirmTitle')}
        title={t('quickActions.card.deleteConfirmTitle')}
        description={t('quickActions.card.deleteConfirmDescription', { name: pendingDelete?.name ?? '' })}
        confirmLabel={t('quickActions.card.deleteConfirmAction')}
        confirmVariant="destructive"
        busy={deleting}
      />

      {quickActionsLoading && sorted.length === 0 ? <p className="text-sm text-[color:var(--color-muted-foreground)]">{t('common.loading')}</p> : null}
    </div>
  )
}
