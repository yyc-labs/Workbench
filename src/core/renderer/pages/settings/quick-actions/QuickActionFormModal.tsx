import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { RunTask } from '../../../../shared/runTasks'
import type { ProjectInfo, QuickActionResult, QuickActionSpec, QuickActionType, QuickActionView } from '../../../../shared/types'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { ModalShell } from '../../../components/ModalShell'
import { Button } from '../../../components/ui/button'
import { Combobox, type ComboboxOption } from '../../../components/ui/combobox'
import { Input } from '../../../components/ui/input'
import { Select, type SelectOption } from '../../../components/ui/select'
import { toast } from '../../../components/ui/toast'
import { useI18n } from '../../../i18n'
import { projectDisplayName } from '../../../lib/projectDisplay'
import { describeQuickActionResult } from '../../../lib/quickActionFeedback'

/** Sentinel for the "start all tasks" option in the task select. */
const ALL_TASKS_VALUE = '__all__'

/** 低于下拉层 z-[10010]，使 Combobox/Select 浮层能盖在弹窗之上。 */
const MODAL_Z_INDEX = 1140

type QuickActionFormModalProps = {
  open: boolean
  /** null = create mode; otherwise edit the given action. */
  action: QuickActionView | null
  projects: ProjectInfo[]
  onClose: () => void
  onSubmit: (input: { name: string; action: QuickActionSpec }) => Promise<void>
  onTestRun: (spec: QuickActionSpec) => Promise<QuickActionResult>
}

type FormState = {
  name: string
  type: QuickActionType
  projectPath: string
  taskId: string
  path: string
  url: string
}

const EMPTY_FORM: FormState = { name: '', type: 'open-project', projectPath: '', taskId: ALL_TASKS_VALUE, path: '', url: '' }

function formFromAction(action: QuickActionView | null): FormState {
  if (!action) return { ...EMPTY_FORM }
  const spec = action.action
  return {
    name: action.name,
    type: spec.type,
    projectPath: spec.type === 'open-project' || spec.type === 'run-task' ? spec.projectPath : '',
    taskId: spec.type === 'run-task' ? (spec.taskId ?? ALL_TASKS_VALUE) : ALL_TASKS_VALUE,
    path: spec.type === 'open-path' ? spec.path : '',
    url: spec.type === 'open-url' ? spec.url : '',
  }
}

function buildSpec(form: FormState): QuickActionSpec | null {
  switch (form.type) {
    case 'open-project':
      return form.projectPath ? { type: 'open-project', projectPath: form.projectPath } : null
    case 'run-task':
      if (!form.projectPath) return null
      return form.taskId === ALL_TASKS_VALUE ? { type: 'run-task', projectPath: form.projectPath } : { type: 'run-task', projectPath: form.projectPath, taskId: form.taskId }
    case 'open-path':
      return form.path.trim() ? { type: 'open-path', path: form.path.trim() } : null
    case 'open-url':
      return form.url.trim() ? { type: 'open-url', url: form.url.trim() } : null
  }
}

export function QuickActionFormModal({ open, action, projects, onClose, onSubmit, onTestRun }: QuickActionFormModalProps) {
  const { t } = useI18n()
  const [form, setForm] = useState<FormState>(() => formFromAction(action))
  const [tasks, setTasks] = useState<RunTask[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  /** 待确认的切换目标类型；非空时展示 ConfirmDialog。 */
  const [pendingType, setPendingType] = useState<QuickActionType | null>(null)
  /** 项目下拉框的搜索词：打开时可搜索，关闭即清空（已选项目不受影响）。 */
  const [projectQuery, setProjectQuery] = useState('')

  // Reset the form whenever the modal opens for a different action.
  useEffect(() => {
    if (!open) return
    setForm(formFromAction(action))
    setError(null)
    setPendingType(null)
    setProjectQuery('')
  }, [action, open])

  // Load the project's run task config when the task select becomes relevant.
  useEffect(() => {
    if (!open || form.type !== 'run-task' || !form.projectPath) {
      setTasks([])
      return
    }
    let cancelled = false
    setTasksLoading(true)
    void (async () => {
      try {
        const result = await window.electronAPI.getRunTaskConfig(form.projectPath)
        if (!cancelled) setTasks(result.config?.tasks ?? [])
      } catch {
        if (!cancelled) setTasks([])
      } finally {
        if (!cancelled) setTasksLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [form.projectPath, form.type, open])

  const projectOptions = useMemo<ComboboxOption[]>(() => projects.map((project) => ({ value: project.path, label: projectDisplayName(project) })), [projects])

  const taskOptions = useMemo<SelectOption[]>(() => [{ value: ALL_TASKS_VALUE, label: t('quickActions.form.taskAll') }, ...tasks.map((task) => ({ value: task.id, label: task.name }))], [tasks, t])

  const typeOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'open-project', label: t('quickActions.form.type.openProject') },
      { value: 'run-task', label: t('quickActions.form.type.runTask') },
      { value: 'open-path', label: t('quickActions.form.type.openPath') },
      { value: 'open-url', label: t('quickActions.form.type.openUrl') },
    ],
    [t],
  )

  const patch = (partial: Partial<FormState>) => setForm((current) => ({ ...current, ...partial }))

  const handleTypeChange = (nextType: string) => {
    if (nextType === form.type) return
    // 切换会整体重置动作字段，先经确认弹窗（不用原生 window.confirm）。
    setPendingType(nextType as QuickActionType)
  }

  const handleConfirmTypeChange = () => {
    if (!pendingType) return
    setForm((current) => ({ ...EMPTY_FORM, name: current.name, type: pendingType }))
    setError(null)
    setPendingType(null)
  }

  const validate = (): string | null => {
    if (!form.name.trim()) return t('quickActions.form.nameRequired')
    switch (form.type) {
      case 'open-project':
      case 'run-task':
        return form.projectPath ? null : t('quickActions.form.projectRequired')
      case 'open-path':
        return form.path.trim() ? null : t('quickActions.form.pathRequired')
      case 'open-url': {
        if (!form.url.trim()) return t('quickActions.form.urlRequired')
        try {
          const protocol = new URL(form.url.trim()).protocol
          if (protocol !== 'http:' && protocol !== 'https:') return t('quickActions.form.urlInvalid')
        } catch {
          return t('quickActions.form.urlInvalid')
        }
        return null
      }
    }
  }

  const handleSubmit = async () => {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    const spec = buildSpec(form)
    if (!spec) {
      setError(t('quickActions.form.nameRequired'))
      return
    }
    setSaving(true)
    try {
      await onSubmit({ name: form.name.trim(), action: spec })
      onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
    } finally {
      setSaving(false)
    }
  }

  const handleTestRun = async () => {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    const spec = buildSpec(form)
    if (!spec) return
    setTesting(true)
    try {
      const result = await onTestRun(spec)
      const feedback = describeQuickActionResult(t, result)
      if (feedback.kind === 'success') toast.success(feedback.message)
      else toast.error(feedback.message, { description: feedback.description })
    } finally {
      setTesting(false)
    }
  }

  return (
    <ModalShell open={open} onClose={onClose} widthClassName="max-w-[520px]" baseZIndex={MODAL_Z_INDEX} ariaLabel={action ? t('quickActions.form.titleEdit') : t('quickActions.form.titleCreate')}>
      <div className="space-y-5">
        <div>
          <p className="section-label mb-1">{t('quickActions.panel.kicker')}</p>
          <h3 className="text-xl font-semibold tracking-[-0.03em] text-[color:var(--color-foreground)]">{action ? t('quickActions.form.titleEdit') : t('quickActions.form.titleCreate')}</h3>
        </div>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-[color:var(--color-foreground)]">{t('quickActions.form.actionType')}</span>
          <Select ariaLabel={t('quickActions.form.actionType')} value={form.type} options={typeOptions} onChange={handleTypeChange} contentZIndex={MODAL_Z_INDEX + 1} />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-[color:var(--color-foreground)]">{t('quickActions.form.name')}</span>
          <Input value={form.name} onChange={(event) => patch({ name: event.target.value })} placeholder={t('quickActions.form.namePlaceholder')} />
        </label>

        {form.type === 'open-project' || form.type === 'run-task' ? (
          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-[color:var(--color-foreground)]">{t('quickActions.form.project')}</span>
            <Combobox
              ariaLabel={t('quickActions.form.project')}
              value={form.projectPath}
              searchValue={projectQuery}
              onSearchValueChange={setProjectQuery}
              options={projectOptions}
              onChange={(value) => {
                patch({ projectPath: value, taskId: ALL_TASKS_VALUE })
                setProjectQuery('')
              }}
              editable="open"
              clearSearchOnClose
              triggerPlaceholder={t('quickActions.form.projectPlaceholder')}
              inputPlaceholder={t('quickActions.form.projectPlaceholder')}
              inputLeading={<Search className="h-4 w-4" />}
              matchTriggerWidth
            />
          </div>
        ) : null}

        {form.type === 'run-task' ? (
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-[color:var(--color-foreground)]">{t('quickActions.form.task')}</span>
            {tasksLoading ? (
              <p className="text-sm text-[color:var(--color-muted-foreground)]">{t('common.loading')}</p>
            ) : (
              <>
                <Select ariaLabel={t('quickActions.form.task')} value={form.taskId} options={taskOptions} onChange={(value) => patch({ taskId: value })} disabled={!form.projectPath} contentZIndex={MODAL_Z_INDEX + 1} />
                {form.projectPath && tasks.length === 0 ? <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('quickActions.form.taskNone')}</p> : null}
              </>
            )}
          </label>
        ) : null}

        {form.type === 'open-path' ? (
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-[color:var(--color-foreground)]">{t('quickActions.form.path')}</span>
            <Input value={form.path} onChange={(event) => patch({ path: event.target.value })} placeholder={t('quickActions.form.pathPlaceholder')} />
          </label>
        ) : null}

        {form.type === 'open-url' ? (
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-[color:var(--color-foreground)]">{t('quickActions.form.url')}</span>
            <Input value={form.url} onChange={(event) => patch({ url: event.target.value })} placeholder={t('quickActions.form.urlPlaceholder')} />
          </label>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={handleTestRun} loading={testing} disabled={saving}>
            {t('quickActions.form.testRun')}
          </Button>
          <div className="flex-1" />
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            {t('quickActions.form.cancel')}
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} loading={saving} disabled={testing}>
            {t('quickActions.form.save')}
          </Button>
        </div>
      </div>

      <ConfirmDialog open={Boolean(pendingType)} onClose={() => setPendingType(null)} onConfirm={handleConfirmTypeChange} ariaLabel={t('quickActions.form.switchTypeTitle')} title={t('quickActions.form.switchTypeTitle')} description={t('quickActions.form.switchTypeConfirm')} confirmLabel={t('common.confirm')} />
    </ModalShell>
  )
}
