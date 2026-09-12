import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, CircleStop, ClipboardCopy, FilePlus2, HelpCircle, ListTree, Pencil, Play, Power, PowerOff, RefreshCw, Sparkles, SquareDashed, SquareTerminal, Trash2, TriangleAlert } from 'lucide-react'
import { ModalShell } from '../ModalShell'
import { useI18n, useLocale } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { useOpenStartupLogs } from '../../hooks/useOpenStartupLogs'
import { getEffectiveRunTasks, getRunTaskStateUrls } from '../../../shared/runTasks'
import { buildRunTaskSkillPrompt } from '../../../shared/runTaskSkill'
import type { ProjectInfo } from '../../../shared/types'
import type { RunTask, RunTaskProgressEvent } from '../../../shared/runTasks'
import { isRunTaskActive, runTaskDotClass, runTaskReadinessSummary, runTaskStateBadgeClass } from './runTasks.helpers'
import { RunTaskDetectDialog } from './RunTaskDetectDialog'
import { RunTaskEditDialog } from './RunTaskEditDialog'

type RunTasksDialogProps = {
  project: ProjectInfo
  open: boolean
  /** Modal 层级,在高层级容器(如最近项目抽屉)内打开时需要调高。 */
  baseZIndex?: number
  onClose: () => void
}

// Memoized: hosts re-render on terminal output / runtime polling churn while
// this dialog is open; stable host callbacks + memo keep the dialog (and the
// edit dialog stacked on top of it) from re-rendering with them.
export const RunTasksDialog = memo(function RunTasksDialog({ project, open, baseZIndex, onClose }: RunTasksDialogProps) {
  const { t } = useI18n()
  const locale = useLocale()
  const skillPrompt = useMemo(() => buildRunTaskSkillPrompt(locale), [locale])
  const config = useAppStore((s) => s.runTaskConfigs[project.id])
  const taskStates = useAppStore((s) => s.runTaskStates[project.id])
  const loadRunTaskConfig = useAppStore((s) => s.loadRunTaskConfig)
  const startAllRunTasks = useAppStore((s) => s.startAllRunTasks)
  const stopAllRunTasks = useAppStore((s) => s.stopAllRunTasks)
  const startRunTask = useAppStore((s) => s.startRunTask)
  const stopRunTask = useAppStore((s) => s.stopRunTask)
  const saveRunTaskConfig = useAppStore((s) => s.saveRunTaskConfig)
  const openStartupLogs = useOpenStartupLogs()

  const [configError, setConfigError] = useState<string | null>(null)
  const [detectOpen, setDetectOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<RunTask | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [skillOpen, setSkillOpen] = useState(false)
  const [skillCopied, setSkillCopied] = useState(false)
  const [pathWarningOpen, setPathWarningOpen] = useState(false)
  const [deletingTask, setDeletingTask] = useState<RunTask | null>(null)
  const [busy, setBusy] = useState(false)
  const skillCopiedTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!open) return
    setConfigError(null)
    void loadRunTaskConfig(project.id, project.path).then((result) => {
      if (result.error === 'invalid-json') setConfigError(t('runTasks.error.invalidJson'))
      if (result.error === 'invalid-structure') setConfigError(t('runTasks.error.invalidStructure'))
    })
  }, [open, project.id, project.path, loadRunTaskConfig, t])

  // Config-file tasks win; legacy single-command projects get a synthesized
  // default task so the old run behavior keeps working through this dialog.
  const fromLegacy = !config || config.tasks.length === 0
  const tasks = useMemo(() => {
    if (!fromLegacy) return config.tasks
    return getEffectiveRunTasks(project, null).tasks.map((item) => item.task)
  }, [config, fromLegacy, project])

  const anyActive = tasks.some((task) => isRunTaskActive(taskStates?.[task.id]?.state))

  // Non-ASCII (e.g. Chinese) project paths break Java tooling on Windows —
  // most notably spring-boot:run's UTF-8 argfile read back as GBK, which kills
  // main-class loading with a misleading error. Warn up front.
  const hasNonAsciiPath = /[^\x00-\x7F]/.test(project.path) && navigator.userAgent.includes('Windows')

  const handleStartAll = async () => {
    if (busy) return
    setBusy(true)
    try {
      await startAllRunTasks(project.id, project.path)
    } finally {
      setBusy(false)
    }
  }

  const handleStopAll = async () => {
    if (busy) return
    setBusy(true)
    try {
      await stopAllRunTasks(project.id)
    } finally {
      setBusy(false)
    }
  }

  // Stable callbacks for the stacked dialogs: with memo'd children these keep
  // re-renders confined to the part of the tree that actually changed.
  const handleSaveTasks = useCallback(
    async (nextTasks: RunTask[], scanDirectories?: string[]) => {
      const result = await saveRunTaskConfig(project.id, project.path, nextTasks, scanDirectories)
      if (result.error === 'invalid-json') setConfigError(t('runTasks.error.invalidJson'))
      return result
    },
    [project.id, project.path, saveRunTaskConfig, t],
  )

  const closeDetect = useCallback(() => setDetectOpen(false), [])
  const handleDetectSave = useCallback(
    async (nextTasks: RunTask[], scanDirectories?: string[]) => {
      await handleSaveTasks(nextTasks, scanDirectories)
      setDetectOpen(false)
    },
    [handleSaveTasks],
  )

  const closeEdit = useCallback(() => setEditOpen(false), [])
  const handleEditStartTask = useCallback(
    async (task: RunTask) => {
      await startRunTask(project.id, project.path, task)
    },
    [project.id, project.path, startRunTask],
  )
  const handleEditSave = useCallback(
    async (task: RunTask) => {
      const nextTasks = editingTask ? tasks.map((item) => (item.id === editingTask.id ? task : item)) : [...tasks, task]
      await handleSaveTasks(nextTasks)
      setEditOpen(false)
    },
    [editingTask, tasks, handleSaveTasks],
  )

  const handleCopySkillPrompt = async () => {
    try {
      await navigator.clipboard.writeText(skillPrompt)
      setSkillCopied(true)
      if (skillCopiedTimerRef.current !== null) window.clearTimeout(skillCopiedTimerRef.current)
      skillCopiedTimerRef.current = window.setTimeout(() => {
        setSkillCopied(false)
        skillCopiedTimerRef.current = null
      }, 1500)
    } catch {
      // clipboard unavailable — nothing to surface
    }
  }

  const handleDeleteTask = async () => {
    if (!deletingTask) return
    const nextTasks = tasks.filter((item) => item.id !== deletingTask.id)
    if (nextTasks.length > 0) await handleSaveTasks(nextTasks)
    setDeletingTask(null)
  }

  const handleToggleEnabled = useCallback(
    (task: RunTask) => {
      const nextTasks = tasks.map((item) => {
        if (item.id !== task.id) return item
        if (item.enabled === false) {
          const { enabled: _removed, ...rest } = item
          return rest as RunTask
        }
        return { ...item, enabled: false }
      })
      void handleSaveTasks(nextTasks)
    },
    [tasks, handleSaveTasks],
  )

  const handleEditRequest = useCallback((task: RunTask) => {
    setEditingTask(task)
    setEditOpen(true)
  }, [])

  const handleDeleteRequest = useCallback((task: RunTask) => {
    setDeletingTask(task)
  }, [])

  return (
    <ModalShell open={open} onClose={onClose} widthClassName="max-w-[720px]" baseZIndex={baseZIndex} ariaLabel={t('runTasks.title')} panelClassName="h-[min(640px,calc(100vh-116px))] overflow-hidden p-0">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between border-b border-[color:var(--color-border)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[color:var(--color-foreground)]">
              <ListTree className="h-4 w-4 text-[color:var(--color-muted-foreground)]" />
              {t('runTasks.title')}
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-[color:var(--color-muted-foreground)]">{fromLegacy ? t('runTasks.legacyHint') : t('runTasks.configHint')}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" className="quiet-control inline-flex h-[30px] w-[30px] items-center justify-center rounded-full text-[color:var(--color-foreground)]" onClick={() => setSkillOpen(true)} title={t('runTasks.skillDialog.title')} aria-label={t('runTasks.skillDialog.title')}>
              <HelpCircle className="h-3.5 w-3.5" />
            </button>
            <button type="button" className="quiet-control inline-flex h-[30px] w-[30px] items-center justify-center rounded-full text-[color:var(--color-foreground)]" onClick={() => void handleCopySkillPrompt()} title={t('runTasks.copySkillPrompt')} aria-label={t('runTasks.copySkillPrompt')}>
              {skillCopied ? <Check className="h-3.5 w-3.5 text-[color:var(--color-success)]" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
            </button>
            <button type="button" className="quiet-control inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-[color:var(--color-foreground)]" onClick={() => setDetectOpen(true)}>
              <Sparkles className="h-3.5 w-3.5" />
              {t('runTasks.autoDetect')}
            </button>
            <button
              type="button"
              className="quiet-control inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-[color:var(--color-foreground)]"
              onClick={() => {
                setEditingTask(null)
                setEditOpen(true)
              }}
            >
              <FilePlus2 className="h-3.5 w-3.5" />
              {t('runTasks.addTask')}
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {configError && <p className="mb-3 rounded-xl border border-[color:var(--color-destructive)]/25 bg-[color:var(--color-destructive-background)] px-3 py-2 text-xs text-[color:var(--color-destructive)]">{configError}</p>}

          {tasks.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[color:var(--color-border)] px-6 py-10 text-center">
              <SquareDashed className="h-6 w-6 text-[color:var(--color-muted-foreground)]" />
              <p className="max-w-[420px] text-xs leading-relaxed text-[color:var(--color-muted-foreground)]">{t('runTasks.noTasksHint')}</p>
              <button type="button" className="quiet-control inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-[color:var(--color-foreground)]" onClick={() => setDetectOpen(true)}>
                <Sparkles className="h-3.5 w-3.5" />
                {t('runTasks.autoDetect')}
              </button>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {tasks.map((task) => (
                <RunTaskListItem key={task.id} task={task} taskState={taskStates?.[task.id]} projectId={project.id} projectPath={project.path} canDelete={tasks.length > 1} onToggleEnabled={handleToggleEnabled} onEdit={handleEditRequest} onDelete={handleDeleteRequest} />
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[color:var(--color-border)] px-5 py-3">
          <p className="truncate text-[11px] text-[color:var(--color-muted-foreground)]">.yworkbench/run-tasks.json</p>
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" className="quiet-control inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-[color:var(--color-success)] disabled:opacity-50" onClick={() => void handleStartAll()} disabled={busy || tasks.length === 0 || anyActive}>
              <Play className="h-3.5 w-3.5" />
              {t('runTasks.startAll')}
            </button>
            <button type="button" className="quiet-control inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-[color:var(--color-destructive)] disabled:opacity-50" onClick={() => void handleStopAll()} disabled={busy || tasks.length === 0 || !anyActive}>
              <CircleStop className="h-3.5 w-3.5" />
              {t('runTasks.stopAll')}
            </button>
          </div>
        </div>
      </div>

      {/* 条件挂载：关闭时不执行任何子弹窗的 hooks/JSX 构建。 */}
      {detectOpen && <RunTaskDetectDialog project={project} open existingTasks={tasks} initialScanDirectories={config?.scanDirectories} baseZIndex={baseZIndex} onClose={closeDetect} onSave={handleDetectSave} />}

      {editOpen && <RunTaskEditDialog project={project} open tasks={tasks} task={editingTask} baseZIndex={baseZIndex} onClose={closeEdit} onStartTask={handleEditStartTask} onSave={handleEditSave} />}

      {skillOpen && (
        <ModalShell open onClose={() => setSkillOpen(false)} widthClassName="max-w-[760px]" baseZIndex={baseZIndex} ariaLabel={t('runTasks.skillDialog.title')} panelClassName="h-[min(640px,calc(100vh-116px))] overflow-hidden p-0">
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-start justify-between gap-4 border-b border-[color:var(--color-border)] px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('runTasks.skillDialog.title')}</h2>
                <p className="mt-0.5 text-[11px] leading-relaxed text-[color:var(--color-muted-foreground)]">{t('runTasks.skillDialog.hint')}</p>
              </div>
              <button type="button" className="quiet-control inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-[color:var(--color-foreground)]" onClick={() => void handleCopySkillPrompt()}>
                {skillCopied ? <Check className="h-3.5 w-3.5 text-[color:var(--color-success)]" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
                {skillCopied ? t('common.copied') : t('common.copy')}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {hasNonAsciiPath && (
                <div className="mb-3">
                  <button type="button" className="quiet-control inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-[color:var(--color-warning)]" onClick={() => setPathWarningOpen((value) => !value)}>
                    <TriangleAlert className="h-3.5 w-3.5" />
                    {t('runTasks.nonAsciiPathWarningTitle')}
                    <ChevronDown className={`h-3 w-3 transition-transform ${pathWarningOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {pathWarningOpen && <p className="mt-2 rounded-xl border border-[color:var(--color-warning)]/25 bg-[color:var(--color-warning-background)] px-3 py-2 text-xs leading-relaxed text-[color:var(--color-warning)]">{t('runTasks.nonAsciiPathWarning')}</p>}
                </div>
              )}
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[color:var(--color-foreground)]">{skillPrompt}</pre>
            </div>
          </div>
        </ModalShell>
      )}

      {deletingTask && (
        <ModalShell open onClose={() => setDeletingTask(null)} widthClassName="max-w-[420px]" baseZIndex={baseZIndex} ariaLabel={t('runTasks.deleteTask')}>
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('runTasks.deleteTask')}</h2>
              <p className="mt-1.5 text-xs leading-relaxed text-[color:var(--color-muted-foreground)]">{t('runTasks.deleteConfirm', { name: deletingTask.name })}</p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button type="button" className="quiet-control rounded-full px-3 py-1.5 text-xs text-[color:var(--color-foreground)]" onClick={() => setDeletingTask(null)}>
                {t('common.cancel')}
              </button>
              <button type="button" className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--color-destructive)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90" onClick={() => void handleDeleteTask()}>
                <Trash2 className="h-3.5 w-3.5" />
                {t('runTasks.deleteConfirmAction')}
              </button>
            </div>
          </div>
        </ModalShell>
      )}
    </ModalShell>
  )
})

type RunTaskListItemProps = {
  task: RunTask
  taskState: RunTaskProgressEvent['tasks'][string] | undefined
  projectId: string
  projectPath: string
  canDelete: boolean
  onToggleEnabled: (task: RunTask) => void
  onEdit: (task: RunTask) => void
  onDelete: (task: RunTask) => void
}

// Memoized per row: run-task state churn (progress events, reconcile) then
// re-renders only the row whose state actually changed instead of the whole
// dialog and any dialog stacked on top of it.
const RunTaskListItem = memo(function RunTaskListItem({ task, taskState, projectId, projectPath, canDelete, onToggleEnabled, onEdit, onDelete }: RunTaskListItemProps) {
  const { t } = useI18n()
  const startRunTask = useAppStore((s) => s.startRunTask)
  const stopRunTask = useAppStore((s) => s.stopRunTask)
  const openStartupLogs = useOpenStartupLogs()

  const state = taskState?.state
  const urls = getRunTaskStateUrls(taskState)
  const primaryUrl = taskState?.url
  const error = taskState?.error
  const warning = taskState?.warning
  const readiness = runTaskReadinessSummary(task)
  const active = isRunTaskActive(state)
  const disabled = task.enabled === false

  return (
    <li className="surface-card rounded-2xl px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${runTaskDotClass(state)}`} />
            <span className="truncate text-sm font-medium text-[color:var(--color-foreground)]">{task.name}</span>
            {task.isDefault && <span className="shrink-0 rounded-full bg-[color:var(--color-accent)] px-2 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">{t('runTasks.defaultBadge')}</span>}
            {disabled && <span className="shrink-0 rounded-full border border-[color:var(--color-border)] px-2 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">{t('runTasks.disabledBadge')}</span>}
            {state && state !== 'idle' && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${runTaskStateBadgeClass(state)}`}>{t(`runTasks.taskState.${state}`)}</span>}
          </div>
          <p className="mt-1 truncate font-mono text-[11px] text-[color:var(--color-muted-foreground)]" title={task.command}>
            {task.command}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[color:var(--color-muted-foreground)]">
            {task.cwd && <span className="truncate">{task.cwd}</span>}
            {task.dependsOn && task.dependsOn.length > 0 && (
              <span className="truncate">
                {t('runTasks.dependsOn')}: {task.dependsOn.join(', ')}
              </span>
            )}
            {readiness && <span className="truncate font-mono">{readiness}</span>}
            {urls.map((url) => (
              <a key={url} href={url} target="_blank" rel="noreferrer" className={`truncate hover:underline ${url === primaryUrl ? 'text-primary' : 'text-[color:var(--color-muted-foreground)]'}`} title={url === primaryUrl ? undefined : t('runTasks.secondaryUrl')}>
                {url}
              </a>
            ))}
          </div>
          {error && (
            <p className="mt-1 truncate text-[11px] text-[color:var(--color-destructive)]" title={error}>
              {error}
            </p>
          )}
          {!error && warning && (state === 'starting' || state === 'waiting' || state === 'running') && (
            <p className="mt-1 flex min-w-0 items-center gap-1 text-[11px] text-[color:var(--color-warning)]" title={warning}>
              <TriangleAlert className="h-3 w-3 shrink-0" />
              <span className="truncate font-mono">{warning}</span>
              <span className="shrink-0">· {t('runTasks.outputErrorHint')}</span>
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" className={`quiet-control rounded-full p-1.5 ${disabled ? 'text-[color:var(--color-muted-foreground)]' : 'text-[color:var(--color-success)]'}`} onClick={() => onToggleEnabled(task)} disabled={active} title={disabled ? t('runTasks.enableTask') : t('runTasks.disableTask')}>
            {disabled ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
          </button>
          {active ? (
            <button type="button" className="quiet-control rounded-full p-1.5 text-[color:var(--color-destructive)] disabled:opacity-50" onClick={() => void stopRunTask(projectId, task.id)} disabled={state === 'stopping'} title={t('common.stop')}>
              <CircleStop className="h-3.5 w-3.5" />
            </button>
          ) : (
            <>
              <button type="button" className="quiet-control rounded-full p-1.5 text-[color:var(--color-success)]" onClick={() => void startRunTask(projectId, projectPath, task)} title={t('common.run')}>
                <Play className="h-3.5 w-3.5" />
              </button>
              <button type="button" className="quiet-control rounded-full p-1.5 text-[color:var(--color-muted-foreground)]" onClick={() => void startRunTask(projectId, projectPath, { ...task, startupMode: 'terminal' })} title={t('runTasks.startInTerminal')}>
                <SquareTerminal className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          <button type="button" className="quiet-control rounded-full p-1.5 text-[color:var(--color-muted-foreground)]" onClick={() => openStartupLogs(projectId)} title={t('runTasks.openLogs')}>
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="quiet-control rounded-full p-1.5 text-[color:var(--color-muted-foreground)]" onClick={() => onEdit(task)} title={t('runTasks.editTask')}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="quiet-control rounded-full p-1.5 text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-destructive)]" onClick={() => onDelete(task)} disabled={!canDelete} title={t('runTasks.deleteTask')}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </li>
  )
})
