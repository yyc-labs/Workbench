import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Play, RotateCcw, Save, Terminal } from 'lucide-react'
import type { ProjectInfo } from '../../shared/types'
import { detectProjectEnvironment } from '../lib/projectEnvironment'
import { useI18n } from '../i18n'
import { projectDisplayName } from '../lib/projectDisplay'
import { useAppStore } from '../stores/appStore'

interface RunCommandConfigPopoverProps {
  project: ProjectInfo
  x: number
  y: number
  onClose: () => void
}

type ConfigTab = 'command' | 'template'

interface RunCommandTemplate {
  id: string
  label: string
  command: string
  hint: string
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

export function RunCommandConfigPopover({
  project,
  x,
  y,
  onClose,
}: RunCommandConfigPopoverProps) {
  const { t } = useI18n()
  const setProjectCustomCommand = useAppStore((s) => s.setProjectCustomCommand)
  const setProjectRunStartupMode = useAppStore((s) => s.setProjectRunStartupMode)
  const startProject = useAppStore((s) => s.startProject)
  const [draftCommand, setDraftCommand] = useState(project.customCommand ?? project.command)
  const [runStartupMode, setRunStartupMode] = useState<'silent' | 'terminal'>(project.runStartupMode || 'silent')
  const [activeTab, setActiveTab] = useState<ConfigTab>('command')
  const [saving, setSaving] = useState(false)
  const [position, setPosition] = useState({ left: x, top: y })
  const popoverRef = useRef<HTMLDivElement | null>(null)

  const environment = detectProjectEnvironment(project.path)
  const environmentHint =
    environment === 'windows'
      ? t('runCommand.environmentHintWindows')
      : environment === 'ubuntu'
        ? t('runCommand.environmentHintUbuntu')
        : t('runCommand.environmentHintOther')

  const isUsingDefault = !project.customCommand?.trim()

  const hasChanges = useMemo(() => {
    const original = (project.customCommand ?? project.command).trim()
    const originalMode = project.runStartupMode || 'silent'
    return draftCommand.trim() !== original || runStartupMode !== originalMode
  }, [draftCommand, project.command, project.customCommand, project.runStartupMode, runStartupMode])

  const templates = useMemo<RunCommandTemplate[]>(() => {
    const pm = project.packageManager || 'npm'
    const devCommand = pm === 'yarn' ? 'yarn dev' : `${pm} run dev`

    const list: RunCommandTemplate[] = [
      {
        id: 'pm-dev',
        label: t('runCommand.templatePackageDev'),
        command: devCommand,
        hint: t('runCommand.templatePackageDevHint'),
      },
      {
        id: 'cmd',
        label: t('runCommand.templateCmd'),
        command: '.\\start.cmd',
        hint: t('runCommand.templateCmdHint'),
      },
      {
        id: 'ps1',
        label: t('runCommand.templatePowerShell'),
        command: 'pwsh -File .\\start.ps1',
        hint: t('runCommand.templatePowerShellHint'),
      },
      {
        id: 'bat',
        label: t('runCommand.templateBatch'),
        command: '.\\start.bat',
        hint: t('runCommand.templateBatchHint'),
      },
      {
        id: 'bash',
        label: t('runCommand.templateBash'),
        command: 'bash ./start.sh',
        hint: t('runCommand.templateBashHint'),
      },
      {
        id: 'dual',
        label: t('runCommand.templateDual'),
        command: `${devCommand} && ${pm === 'yarn' ? 'yarn api' : `${pm} run api`}`,
        hint: t('runCommand.templateDualHint'),
      },
    ]

    if (environment === 'windows') {
      return [list[1], list[2], list[3], list[0], list[5], list[4]]
    }
    if (environment === 'ubuntu') {
      return [list[4], list[0], list[5], list[2], list[1], list[3]]
    }
    return list
  }, [environment, project.packageManager, t])

  useEffect(() => {
    setDraftCommand(project.customCommand ?? project.command)
    setRunStartupMode(project.runStartupMode || 'silent')
    setActiveTab('command')
  }, [project.command, project.customCommand, project.id, project.runStartupMode])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as globalThis.Node
      if (popoverRef.current?.contains(target)) return
      onClose()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [onClose])

  useLayoutEffect(() => {
    const element = popoverRef.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    const padding = 8
    const left = clamp(x, padding, window.innerWidth - rect.width - padding)
    const top = clamp(y, padding, window.innerHeight - rect.height - padding)
    setPosition({ left, top })
  }, [x, y, draftCommand, activeTab])

  const applyTemplate = (template: RunCommandTemplate) => {
    setDraftCommand(template.command)
    setActiveTab('command')
  }

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    try {
      await setProjectCustomCommand(project.id, draftCommand)
      await setProjectRunStartupMode(project.id, runStartupMode)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAndRun = async () => {
    if (saving) return
    setSaving(true)
    try {
      await setProjectCustomCommand(project.id, draftCommand)
      await setProjectRunStartupMode(project.id, runStartupMode)
      await startProject(project.id)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    if (saving) return
    setSaving(true)
    try {
      await setProjectCustomCommand(project.id, undefined)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed z-[1100] w-[420px] max-w-[calc(100vw-16px)] rounded-[18px] border p-3 surface-card"
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`,
        borderColor: 'var(--color-border)',
        boxShadow: 'var(--shadow-popover)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="section-label">{t('runCommand.title')}</p>
          <p className="truncate text-[12px] text-[color:var(--color-muted-foreground)]" title={project.path}>
            {projectDisplayName(project)}
          </p>
        </div>
        <span className="rounded-full px-2 py-0.5 text-[10px] quiet-control">
          {isUsingDefault ? t('runCommand.defaultState') : t('runCommand.customState')}
        </span>
      </div>

      <div className="mb-2 inline-flex rounded-full p-1 quiet-control">
        <button
          className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
            activeTab === 'command'
              ? 'bg-primary text-white'
              : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
          }`}
          onClick={() => setActiveTab('command')}
          disabled={saving}
        >
          {t('runCommand.commandTab')}
        </button>
        <button
          className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
            activeTab === 'template'
              ? 'bg-primary text-white'
              : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
          }`}
          onClick={() => setActiveTab('template')}
          disabled={saving}
        >
          {t('runCommand.templateTab')}
        </button>
      </div>

      {activeTab === 'command' ? (
        <div className="space-y-2">
          <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
            {t('runCommand.detectedDefaultCommand')} <span className="font-mono text-[color:var(--color-foreground)]">{project.command}</span>
          </p>
          <textarea
            value={draftCommand}
            onChange={(e) => setDraftCommand(e.target.value)}
            className="quiet-control h-[96px] w-full resize-y rounded-[12px] border-0 px-3 py-2 font-mono text-[12px] text-[color:var(--color-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder={t('runCommand.commandPlaceholder')}
            spellCheck={false}
            disabled={saving}
          />
          <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
            {environmentHint}
          </p>
          <div className="pt-1">
            <p className="mb-1 text-[11px] text-[color:var(--color-muted-foreground)]">{t('runCommand.startupMode')}</p>
            <div className="inline-flex rounded-full p-1 quiet-control">
              <button
                className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                  runStartupMode === 'silent'
                    ? 'bg-primary text-white'
                    : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
                }`}
                onClick={() => setRunStartupMode('silent')}
                disabled={saving}
              >
                {t('runCommand.startupModeSilent')}
              </button>
              <button
                className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                  runStartupMode === 'terminal'
                    ? 'bg-primary text-white'
                    : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
                }`}
                onClick={() => setRunStartupMode('terminal')}
                disabled={saving}
              >
                {t('runCommand.startupModeTerminal')}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
            {t('runCommand.templateHint')}
          </p>
          <div className="max-h-[220px] space-y-1.5 overflow-auto pr-0.5">
            {templates.map((item) => (
              <button
                key={item.id}
                className="w-full rounded-[12px] border px-3 py-2 text-left transition-colors hover:bg-[color:var(--color-accent)]"
                style={{ borderColor: 'var(--color-border)' }}
                onClick={() => applyTemplate(item)}
                disabled={saving}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-medium text-[color:var(--color-foreground)]">{item.label}</span>
                  <span className="text-[10px] text-[color:var(--color-muted-foreground)]">{item.hint}</span>
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-[color:var(--color-muted-foreground)]">
                  {item.command}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className="inline-flex h-8 items-center gap-1 rounded-full border border-[color:var(--color-border)] px-3 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:opacity-60"
          onClick={() => void handleReset()}
          disabled={saving}
          title={t('runCommand.restoreDefaultTitle')}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t('runCommand.restoreDefault')}
        </button>
        <button
          className="inline-flex h-8 items-center gap-1 rounded-full border border-[color:var(--color-border)] px-3 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:opacity-60"
          onClick={() => onClose()}
          disabled={saving}
        >
          {t('runCommand.close')}
        </button>
        <button
          className="ml-auto inline-flex h-8 items-center gap-1 rounded-full border border-[color:var(--color-border)] px-3 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:opacity-60"
          onClick={() => void handleSave()}
          disabled={saving || !hasChanges}
        >
          <Save className="h-3.5 w-3.5" />
          {t('common.save')}
        </button>
        <button
          className="inline-flex h-8 items-center gap-1 rounded-full bg-primary px-3 text-xs font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
          onClick={() => void handleSaveAndRun()}
          disabled={saving}
        >
          <Play className="h-3.5 w-3.5" />
          {t('runCommand.saveAndRun')}
        </button>
      </div>

      <div className="mt-2 inline-flex items-center gap-1 text-[10px] text-[color:var(--color-muted-foreground)]">
        <Terminal className="h-3 w-3" />
        {t('runCommand.persistedHint')}
      </div>
    </div>,
    document.body
  )
}
