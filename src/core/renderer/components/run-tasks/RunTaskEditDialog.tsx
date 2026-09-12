import { memo, useEffect, useMemo, useState } from 'react'
import { FolderOpen, Loader2, Play, Save, Sparkles } from 'lucide-react'
import { ModalShell } from '../ModalShell'
import { Select, type SelectOption } from '../ui/select'
import { useI18n } from '../../i18n'
import { toProjectRelativeDirectory } from '../../lib/projectPaths'
import type { ProjectInfo } from '../../../shared/types'
import type { RunTask, RunTaskReadinessStrategy } from '../../../shared/runTasks'
import { RunTaskTemplatePicker } from './RunTaskTemplatePicker'

type RunTaskEditDialogProps = {
  project: ProjectInfo
  open: boolean
  tasks: RunTask[]
  /** Existing task to edit; null creates a new one. */
  task: RunTask | null
  baseZIndex?: number
  onClose: () => void
  onSave: (task: RunTask) => Promise<void>
  /** Starts the saved task right away ("save and start"). */
  onStartTask?: (task: RunTask) => Promise<void>
}

const READINESS_STRATEGIES: RunTaskReadinessStrategy[] = ['url', 'http', 'port', 'delay', 'exit']

type UseWslChoice = 'auto' | 'true' | 'false'

// Memoized: the edit dialog holds 30+ controlled inputs with local state only.
// Keeping it memo'd (with stable callbacks from the parent) stops parent
// re-renders — driven by run-task progress or terminal output churn — from
// re-diffing the whole form while the user is typing.
export const RunTaskEditDialog = memo(function RunTaskEditDialog({ project, open, tasks, task, baseZIndex, onClose, onSave, onStartTask }: RunTaskEditDialogProps) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [stopCommand, setStopCommand] = useState('')
  const [cwd, setCwd] = useState('')
  const [dependsOn, setDependsOn] = useState<string[]>([])
  const [strategy, setStrategy] = useState<RunTaskReadinessStrategy | 'none'>('none')
  const [urlPattern, setUrlPattern] = useState('')
  const [primaryUrlPattern, setPrimaryUrlPattern] = useState('')
  const [httpUrl, setHttpUrl] = useState('')
  const [port, setPort] = useState('')
  const [delayMs, setDelayMs] = useState('')
  const [timeoutMs, setTimeoutMs] = useState('')
  const [useWsl, setUseWsl] = useState<UseWslChoice>('auto')
  const [isDefault, setIsDefault] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [primaryUrl, setPrimaryUrl] = useState(false)
  const [startupMode, setStartupMode] = useState<'silent' | 'terminal'>('silent')
  const [templateOpen, setTemplateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setTemplateOpen(false)
    const source = task
    setName(source?.name ?? '')
    setCommand(source?.command ?? '')
    setStopCommand(source?.stopCommand ?? '')
    setCwd(source?.cwd ?? '')
    setDependsOn(source?.dependsOn ?? [])
    const readiness = source?.readiness
    setStrategy(readiness?.strategy ?? 'none')
    setUrlPattern(readiness?.urlPattern ?? '')
    setPrimaryUrlPattern(readiness?.primaryUrlPattern ?? '')
    setHttpUrl(readiness?.httpUrl ?? '')
    setPort(readiness?.port != null ? String(readiness.port) : '')
    setDelayMs(readiness?.delayMs != null ? String(readiness.delayMs) : '')
    setTimeoutMs(readiness?.timeoutMs != null ? String(readiness.timeoutMs) : '')
    setUseWsl(source?.useWsl === true ? 'true' : source?.useWsl === false ? 'false' : 'auto')
    setIsDefault(source?.isDefault ?? false)
    setEnabled(source?.enabled !== false)
    setPrimaryUrl(source?.primaryUrl ?? false)
    setStartupMode(source?.startupMode === 'terminal' ? 'terminal' : 'silent')
  }, [open, task])

  const candidateDependencies = tasks.filter((item) => item.id !== task?.id)

  // 与 ModalShell 默认 baseZIndex 保持一致;Select 下拉层需高于面板(base + 1)。
  const resolvedBaseZIndex = baseZIndex ?? 10040
  const selectContentZIndex = resolvedBaseZIndex + 2

  const readinessOptions = useMemo<SelectOption[]>(() => [{ value: 'none', label: t('runTasks.readiness.none') }, ...READINESS_STRATEGIES.map((item) => ({ value: item, label: t(`runTasks.readiness.${item}`) }))], [t])
  const useWslOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'auto', label: t('runTasks.useWsl.auto') },
      { value: 'true', label: t('runTasks.useWsl.true') },
      { value: 'false', label: t('runTasks.useWsl.false') },
    ],
    [t],
  )
  const startupModeOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'silent', label: t('runTasks.startupMode.silent') },
      { value: 'terminal', label: t('runTasks.startupMode.terminal') },
    ],
    [t],
  )

  const buildTask = (): RunTask | null => {
    const trimmedName = name.trim()
    const trimmedCommand = command.trim()
    if (!trimmedCommand) {
      setError(t('runTasks.error.commandRequired'))
      return null
    }
    const id = task?.id || slugify(trimmedName) || `task-${Date.now().toString(36)}`
    const next: RunTask = {
      id,
      name: trimmedName || id,
      command: trimmedCommand,
    }
    if (cwd.trim()) next.cwd = cwd.trim()
    if (stopCommand.trim()) next.stopCommand = stopCommand.trim()
    if (dependsOn.length > 0) next.dependsOn = dependsOn
    if (strategy !== 'none') {
      const readiness: RunTask['readiness'] = { strategy }
      if (strategy === 'url' && urlPattern.trim()) readiness.urlPattern = urlPattern.trim()
      if (strategy === 'url' && primaryUrlPattern.trim()) readiness.primaryUrlPattern = primaryUrlPattern.trim()
      if (strategy === 'http' && httpUrl.trim()) readiness.httpUrl = httpUrl.trim()
      if (strategy === 'port' && port.trim()) readiness.port = Number(port)
      if (strategy === 'delay' && delayMs.trim()) readiness.delayMs = Number(delayMs)
      if (timeoutMs.trim()) readiness.timeoutMs = Number(timeoutMs)
      const invalid = (strategy === 'http' && !readiness.httpUrl) || (strategy === 'port' && !readiness.port) || (strategy === 'delay' && readiness.delayMs === undefined)
      if (invalid) {
        setError(t('runTasks.error.readinessParams'))
        return null
      }
      next.readiness = readiness
    }
    if (useWsl === 'true') next.useWsl = true
    if (useWsl === 'false') next.useWsl = false
    if (isDefault) next.isDefault = true
    if (!enabled) next.enabled = false
    if (primaryUrl) next.primaryUrl = true
    if (startupMode === 'terminal') next.startupMode = 'terminal'
    return next
  }

  const persist = async (): Promise<RunTask | null> => {
    const next = buildTask()
    if (!next) return null
    setSaving(true)
    setError(null)
    try {
      await onSave(next)
      return next
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return null
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async () => {
    if (saving) return
    const next = await persist()
    if (!next) return
    onClose()
  }

  const handleSaveAndStart = async () => {
    if (saving) return
    const next = await persist()
    if (!next) return
    try {
      await onStartTask?.(next)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleBrowseWorkingDirectory = async () => {
    setError(null)
    try {
      const selectedPath = await window.electronAPI.selectDirectory(project.path)
      if (!selectedPath) return
      setCwd(toProjectRelativeDirectory(project.path, selectedPath))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <ModalShell open={open} onClose={onClose} widthClassName="max-w-[600px]" baseZIndex={baseZIndex} ariaLabel={task ? t('runTasks.editTask') : t('runTasks.addTask')} panelClassName="h-[min(680px,calc(100vh-140px))] overflow-hidden p-0">
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b border-[color:var(--color-border)] px-5 py-4">
          <h2 className="text-sm font-semibold text-[color:var(--color-foreground)]">{task ? t('runTasks.editTask') : t('runTasks.addTask')}</h2>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <Field label={t('runTasks.field.name')}>
            <input type="text" className="w-full rounded-xl border border-[color:var(--color-border)] bg-transparent px-3 py-1.5 text-xs text-[color:var(--color-foreground)] outline-none focus:border-[color:var(--color-primary)]" value={name} onChange={(event) => setName(event.target.value)} placeholder="backend" />
          </Field>

          <Field label={t('runTasks.field.command')}>
            <textarea
              className="min-h-[64px] w-full resize-y rounded-xl border border-[color:var(--color-border)] bg-transparent px-3 py-2 font-mono text-xs text-[color:var(--color-foreground)] outline-none focus:border-[color:var(--color-primary)]"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder="npm run dev"
            />
            <button type="button" className="quiet-control mt-1.5 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] text-[color:var(--color-foreground)]" onClick={() => setTemplateOpen(true)}>
              <Sparkles className="h-3.5 w-3.5" />
              {t('runTasks.templates.pick')}
            </button>
          </Field>

          <Field label={t('runTasks.field.cwd')} hint={t('runTasks.field.cwdHint')}>
            <div className="flex min-w-0 gap-2">
              <input
                type="text"
                className="min-w-0 flex-1 rounded-xl border border-[color:var(--color-border)] bg-transparent px-3 py-1.5 font-mono text-xs text-[color:var(--color-foreground)] outline-none focus:border-[color:var(--color-primary)]"
                value={cwd}
                onChange={(event) => setCwd(event.target.value)}
                placeholder={t('runTasks.field.projectRoot')}
              />
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-3 text-[11px] text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                onClick={() => void handleBrowseWorkingDirectory()}
                disabled={saving}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                {t('runTasks.field.browse')}
              </button>
            </div>
          </Field>

          <Field label={t('runTasks.field.stopCommand')} hint={t('runTasks.field.stopCommandHint')}>
            <input
              type="text"
              className="w-full rounded-xl border border-[color:var(--color-border)] bg-transparent px-3 py-1.5 font-mono text-xs text-[color:var(--color-foreground)] outline-none focus:border-[color:var(--color-primary)]"
              value={stopCommand}
              onChange={(event) => setStopCommand(event.target.value)}
              placeholder="docker compose down"
            />
          </Field>

          {candidateDependencies.length > 0 && (
            <Field label={t('runTasks.field.dependsOn')}>
              <div className="flex flex-wrap gap-1.5">
                {candidateDependencies.map((item) => {
                  const checked = dependsOn.includes(item.id)
                  return (
                    <label
                      key={item.id}
                      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                        checked ? 'border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary)]/10 text-[color:var(--color-foreground)]' : 'border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)]'
                      }`}
                    >
                      <input type="checkbox" className="h-3 w-3 accent-[color:var(--color-primary)]" checked={checked} onChange={() => setDependsOn((prev) => (checked ? prev.filter((dep) => dep !== item.id) : [...prev, item.id]))} />
                      {item.name}
                    </label>
                  )
                })}
              </div>
            </Field>
          )}

          <Field label={t('runTasks.field.readiness')} hint={t('runTasks.field.readinessHint')}>
            <Select ariaLabel={t('runTasks.field.readiness')} value={strategy} onChange={(value) => setStrategy(value as RunTaskReadinessStrategy | 'none')} options={readinessOptions} className="w-full" triggerClassName="h-8 rounded-xl px-3 text-xs" contentZIndex={selectContentZIndex} />
          </Field>

          {strategy === 'url' && (
            <Field label={t('runTasks.field.urlPattern')}>
              <input
                type="text"
                className="w-full rounded-xl border border-[color:var(--color-border)] bg-transparent px-3 py-1.5 font-mono text-xs text-[color:var(--color-foreground)] outline-none focus:border-[color:var(--color-primary)]"
                value={urlPattern}
                onChange={(event) => setUrlPattern(event.target.value)}
                placeholder="http://localhost:3000"
              />
            </Field>
          )}
          {strategy === 'url' && (
            <Field label={t('runTasks.field.primaryUrlPattern')} hint={t('runTasks.field.primaryUrlPatternHint')}>
              <input
                type="text"
                className="w-full rounded-xl border border-[color:var(--color-border)] bg-transparent px-3 py-1.5 font-mono text-xs text-[color:var(--color-foreground)] outline-none focus:border-[color:var(--color-primary)]"
                value={primaryUrlPattern}
                onChange={(event) => setPrimaryUrlPattern(event.target.value)}
                placeholder=":3000"
              />
            </Field>
          )}
          {strategy === 'http' && (
            <Field label={t('runTasks.field.httpUrl')}>
              <input
                type="text"
                className="w-full rounded-xl border border-[color:var(--color-border)] bg-transparent px-3 py-1.5 font-mono text-xs text-[color:var(--color-foreground)] outline-none focus:border-[color:var(--color-primary)]"
                value={httpUrl}
                onChange={(event) => setHttpUrl(event.target.value)}
                placeholder="http://localhost:8080/health"
              />
            </Field>
          )}
          {strategy === 'port' && (
            <Field label={t('runTasks.field.port')}>
              <input type="number" className="w-full rounded-xl border border-[color:var(--color-border)] bg-transparent px-3 py-1.5 text-xs text-[color:var(--color-foreground)] outline-none focus:border-[color:var(--color-primary)]" value={port} onChange={(event) => setPort(event.target.value)} placeholder="8080" />
            </Field>
          )}
          {strategy === 'delay' && (
            <Field label={t('runTasks.field.delayMs')}>
              <input
                type="number"
                className="w-full rounded-xl border border-[color:var(--color-border)] bg-transparent px-3 py-1.5 text-xs text-[color:var(--color-foreground)] outline-none focus:border-[color:var(--color-primary)]"
                value={delayMs}
                onChange={(event) => setDelayMs(event.target.value)}
                placeholder="3000"
              />
            </Field>
          )}
          {strategy !== 'none' && (
            <Field label={t('runTasks.field.timeoutMs')}>
              <input
                type="number"
                className="w-full rounded-xl border border-[color:var(--color-border)] bg-transparent px-3 py-1.5 text-xs text-[color:var(--color-foreground)] outline-none focus:border-[color:var(--color-primary)]"
                value={timeoutMs}
                onChange={(event) => setTimeoutMs(event.target.value)}
                placeholder="60000"
              />
            </Field>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Field label={t('runTasks.field.useWsl')}>
              <Select ariaLabel={t('runTasks.field.useWsl')} value={useWsl} onChange={(value) => setUseWsl(value as UseWslChoice)} options={useWslOptions} className="w-[150px]" triggerClassName="h-8 rounded-xl px-3 text-xs" contentZIndex={selectContentZIndex} />
            </Field>
            <Field label={t('runTasks.field.startupMode')}>
              <Select ariaLabel={t('runTasks.field.startupMode')} value={startupMode} onChange={(value) => setStartupMode(value as 'silent' | 'terminal')} options={startupModeOptions} className="w-[170px]" triggerClassName="h-8 rounded-xl px-3 text-xs" contentZIndex={selectContentZIndex} />
            </Field>
            <label className="mt-4 inline-flex cursor-pointer items-center gap-2 text-xs text-[color:var(--color-foreground)]">
              <input type="checkbox" className="h-3.5 w-3.5 accent-[color:var(--color-primary)]" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} />
              {t('runTasks.field.isDefault')}
            </label>
            <label className="mt-4 inline-flex cursor-pointer items-center gap-2 text-xs text-[color:var(--color-foreground)]">
              <input type="checkbox" className="h-3.5 w-3.5 accent-[color:var(--color-primary)]" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
              {t('runTasks.field.enabled')}
            </label>
            <label className="mt-4 inline-flex cursor-pointer items-center gap-2 text-xs text-[color:var(--color-foreground)]" title={t('runTasks.field.primaryUrlHint')}>
              <input type="checkbox" className="h-3.5 w-3.5 accent-[color:var(--color-primary)]" checked={primaryUrl} onChange={(event) => setPrimaryUrl(event.target.checked)} />
              {t('runTasks.field.primaryUrl')}
            </label>
          </div>

          {error && <p className="rounded-xl border border-[color:var(--color-destructive)]/25 bg-[color:var(--color-destructive-background)] px-3 py-2 text-xs text-[color:var(--color-destructive)]">{error}</p>}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[color:var(--color-border)] px-5 py-3">
          <button type="button" className="quiet-control rounded-full px-3 py-1.5 text-xs text-[color:var(--color-foreground)]" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-3 py-1.5 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:opacity-50" onClick={() => void handleSave()} disabled={saving}>
            <Save className="h-3.5 w-3.5" />
            {t('common.save')}
          </button>
          {onStartTask && (
            <button type="button" className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-primary-hover disabled:opacity-50" onClick={() => void handleSaveAndStart()} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {t('runTasks.saveAndStart')}
            </button>
          )}
        </div>
      </div>

      {/* 条件挂载：关闭时不执行模板弹窗与模板列表的任何渲染。 */}
      {templateOpen && (
        <ModalShell open onClose={() => setTemplateOpen(false)} widthClassName="max-w-[680px]" baseZIndex={baseZIndex} ariaLabel={t('runTasks.templates.pick')} panelClassName="h-[min(560px,calc(100vh-140px))] overflow-hidden p-0">
          <div className="flex h-full min-h-0 flex-col">
            <div className="border-b border-[color:var(--color-border)] px-5 py-4">
              <h2 className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('runTasks.templates.pick')}</h2>
              <p className="mt-0.5 text-[11px] text-[color:var(--color-muted-foreground)]">{t('runTasks.templates.hint')}</p>
            </div>
            <div className="flex min-h-0 flex-1 flex-col px-5 py-4">
              <RunTaskTemplatePicker
                project={project}
                disabled={saving}
                onApply={(template) => {
                  setCommand(template.command)
                  setCwd(template.workingDirectory)
                  setTemplateOpen(false)
                }}
              />
            </div>
          </div>
        </ModalShell>
      )}
    </ModalShell>
  )
})

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-[color:var(--color-muted-foreground)]">
        {label}
        {hint && <span className="ml-1.5 font-normal opacity-80">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}
