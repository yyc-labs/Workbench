import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { RunTask } from '../../../../shared/runTasks'
import type { ProjectInfo, QuickActionResult, QuickActionSchedule, QuickActionScheduleCalendarMode, QuickActionScheduleKind, QuickActionSpec, QuickActionType, QuickActionView } from '../../../../shared/types'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { ModalShell } from '../../../components/ModalShell'
import { Button } from '../../../components/ui/button'
import { Checkbox } from '../../../components/ui/checkbox'
import { Combobox, type ComboboxOption } from '../../../components/ui/combobox'
import { Input } from '../../../components/ui/input'
import { Select, type SelectOption } from '../../../components/ui/select'
import { toast } from '../../../components/ui/toast'
import { useI18n } from '../../../i18n'
import { projectDisplayName } from '../../../lib/projectDisplay'
import { describeQuickActionResult } from '../../../lib/quickActionFeedback'
import { QuickActionTimesField } from './QuickActionTimesField'
import { WEEKDAY_LABEL_KEYS } from './quickActions.schedule'

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
  /** schedule 为 null 表示清除定时（与 update 输入语义一致）。 */
  onSubmit: (input: { name: string; action: QuickActionSpec; schedule: QuickActionSchedule | null }) => Promise<void>
  onTestRun: (spec: QuickActionSpec) => Promise<QuickActionResult>
}

type ScheduleFormState = {
  enabled: boolean
  kind: QuickActionScheduleKind
  /** 'HH:mm' 列表，升序；至少一个（清空定时请关闭启用开关）。 */
  times: string[]
  weekdays: number[]
  date: string
  calendarMode: QuickActionScheduleCalendarMode
}

type FormState = {
  name: string
  type: QuickActionType
  projectPath: string
  taskId: string
  path: string
  url: string
  schedule: ScheduleFormState
}

const EMPTY_SCHEDULE: ScheduleFormState = { enabled: false, kind: 'daily', times: ['09:00'], weekdays: [1], date: '', calendarMode: 'every-day' }

const EMPTY_FORM: FormState = { name: '', type: 'open-project', projectPath: '', taskId: ALL_TASKS_VALUE, path: '', url: '', schedule: { ...EMPTY_SCHEDULE } }

/** weekly 勾选顺序：周一~周日。 */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

/** 本地时区 'YYYY-MM-DD'（用于 once 过去日期校验与 input min）。 */
function todayDateString(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function scheduleFromAction(action: QuickActionView | null): ScheduleFormState {
  const schedule = action?.schedule
  if (!schedule) return { ...EMPTY_SCHEDULE }
  return {
    enabled: schedule.enabled,
    kind: schedule.kind,
    times: schedule.times ? [...schedule.times] : [],
    weekdays: schedule.weekdays ? [...schedule.weekdays] : [],
    date: schedule.date ?? '',
    calendarMode: schedule.calendarMode,
  }
}

function buildSchedule(form: FormState): QuickActionSchedule | null {
  if (!form.schedule.enabled) return null
  const schedule: QuickActionSchedule = {
    kind: form.schedule.kind,
    times: [...form.schedule.times].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    calendarMode: form.schedule.calendarMode,
    enabled: true,
  }
  if (form.schedule.kind === 'weekly' && form.schedule.weekdays.length > 0) {
    schedule.weekdays = [...form.schedule.weekdays].sort((a, b) => a - b)
  }
  if (form.schedule.kind === 'once' && form.schedule.date) schedule.date = form.schedule.date
  return schedule
}

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
    schedule: scheduleFromAction(action),
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

  const scheduleKindOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'once', label: t('quickActions.schedule.kind.once') },
      { value: 'daily', label: t('quickActions.schedule.kind.daily') },
      { value: 'weekly', label: t('quickActions.schedule.kind.weekly') },
    ],
    [t],
  )

  const scheduleCalendarModeOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'every-day', label: t('quickActions.schedule.calendarModeEveryDay') },
      { value: 'workdays-only', label: t('quickActions.schedule.calendarModeWorkdaysOnly') },
    ],
    [t],
  )

  const patch = (partial: Partial<FormState>) => setForm((current) => ({ ...current, ...partial }))

  const patchSchedule = (partial: Partial<ScheduleFormState>) => setForm((current) => ({ ...current, schedule: { ...current.schedule, ...partial } }))

  const toggleWeekday = (day: number, checked: boolean) =>
    setForm((current) => ({
      ...current,
      schedule: {
        ...current.schedule,
        weekdays: checked ? [...current.schedule.weekdays, day].sort((a, b) => a - b) : current.schedule.weekdays.filter((item) => item !== day),
      },
    }))

  const handleTypeChange = (nextType: string) => {
    if (nextType === form.type) return
    // 切换会整体重置动作字段，先经确认弹窗（不用原生 window.confirm）。
    setPendingType(nextType as QuickActionType)
  }

  const handleConfirmTypeChange = () => {
    if (!pendingType) return
    setForm((current) => ({ ...EMPTY_FORM, schedule: { ...EMPTY_SCHEDULE }, name: current.name, type: pendingType }))
    setError(null)
    setPendingType(null)
  }

  const validate = (): string | null => {
    if (!form.name.trim()) return t('quickActions.form.nameRequired')
    if (form.schedule.enabled) {
      if (form.schedule.times.length === 0) return t('quickActions.form.scheduleTimeRequired')
      if (form.schedule.kind === 'weekly' && form.schedule.weekdays.length === 0) return t('quickActions.form.scheduleWeekdaysRequired')
      if (form.schedule.kind === 'once') {
        if (!form.schedule.date) return t('quickActions.form.scheduleDateRequired')
        if (form.schedule.date < todayDateString()) return t('quickActions.form.scheduleDatePast')
      }
    }
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
      await onSubmit({ name: form.name.trim(), action: spec, schedule: buildSchedule(form) })
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
    <ModalShell open={open} onClose={onClose} widthClassName="max-w-[880px]" baseZIndex={MODAL_Z_INDEX} panelClassName="h-[640px] max-h-[calc(100dvh-2rem)] flex flex-col" ariaLabel={action ? t('quickActions.form.titleEdit') : t('quickActions.form.titleCreate')}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto">
          <div>
            <p className="section-label mb-1">{t('quickActions.panel.kicker')}</p>
            <h3 className="text-xl font-semibold tracking-[-0.03em] text-[color:var(--color-foreground)]">{action ? t('quickActions.form.titleEdit') : t('quickActions.form.titleCreate')}</h3>
          </div>

          <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
            <div className="space-y-5">
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
            </div>

            <div className="space-y-3 rounded-[16px] border p-4" style={{ borderColor: 'var(--color-border)' }}>
              <label className="flex items-start gap-3 text-sm text-[color:var(--color-foreground)]">
                <Checkbox checked={form.schedule.enabled} onChange={(event) => patchSchedule({ enabled: event.target.checked })} />
                <span>
                  <span className="block font-medium">{t('quickActions.schedule.enable')}</span>
                  <span className="mt-1 block text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('quickActions.schedule.enableHint')}</span>
                </span>
              </label>

              {form.schedule.enabled ? (
                <div className="space-y-3">
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium text-[color:var(--color-foreground)]">{t('quickActions.schedule.frequency')}</span>
                    <Select ariaLabel={t('quickActions.schedule.frequency')} value={form.schedule.kind} options={scheduleKindOptions} onChange={(value) => patchSchedule({ kind: value as QuickActionScheduleKind })} contentZIndex={MODAL_Z_INDEX + 1} />
                  </label>

                  <div className="space-y-1.5">
                    <span className="block text-sm font-medium text-[color:var(--color-foreground)]">{t('quickActions.schedule.timesLabel')}</span>
                    <QuickActionTimesField value={form.schedule.times} onChange={(times) => patchSchedule({ times })} contentZIndex={MODAL_Z_INDEX + 1} />
                  </div>

                  {form.schedule.kind === 'weekly' ? (
                    <div className="space-y-1.5">
                      <span className="block text-sm font-medium text-[color:var(--color-foreground)]">{t('quickActions.schedule.weekdaysLabel')}</span>
                      <div className="flex flex-wrap gap-x-4 gap-y-2">
                        {WEEKDAY_ORDER.map((day) => (
                          <label key={day} className="flex items-center gap-1.5 text-sm text-[color:var(--color-foreground)]">
                            <Checkbox checked={form.schedule.weekdays.includes(day)} onChange={(event) => toggleWeekday(day, event.target.checked)} />
                            <span>{t(WEEKDAY_LABEL_KEYS[day])}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {form.schedule.kind === 'once' ? (
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium text-[color:var(--color-foreground)]">{t('quickActions.schedule.date')}</span>
                      <Input type="date" value={form.schedule.date} min={todayDateString()} onChange={(event) => patchSchedule({ date: event.target.value })} />
                    </label>
                  ) : null}

                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium text-[color:var(--color-foreground)]">{t('quickActions.schedule.calendarMode')}</span>
                    <Select ariaLabel={t('quickActions.schedule.calendarMode')} value={form.schedule.calendarMode} options={scheduleCalendarModeOptions} onChange={(value) => patchSchedule({ calendarMode: value as QuickActionScheduleCalendarMode })} contentZIndex={MODAL_Z_INDEX + 1} />
                    {form.schedule.calendarMode === 'workdays-only' ? <p className="text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('quickActions.schedule.calendarModeWorkdaysHint')}</p> : null}
                  </label>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="shrink-0 pt-4">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex items-center justify-end gap-2">
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
      </div>

      <ConfirmDialog open={Boolean(pendingType)} onClose={() => setPendingType(null)} onConfirm={handleConfirmTypeChange} ariaLabel={t('quickActions.form.switchTypeTitle')} title={t('quickActions.form.switchTypeTitle')} description={t('quickActions.form.switchTypeConfirm')} confirmLabel={t('common.confirm')} />
    </ModalShell>
  )
}
