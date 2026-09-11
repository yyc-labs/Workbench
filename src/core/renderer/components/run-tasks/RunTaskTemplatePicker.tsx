import { useEffect, useMemo, useRef, useState } from 'react'
import { useDeferredValue } from 'react'
import type { ProjectInfo } from '../../../shared/types'
import { useI18n } from '../../i18n'
import { detectProjectEnvironment } from '../../lib/projectEnvironment'
import { parsePackageScripts, scriptCommand } from '../../lib/packageScripts'
import { normalizePathForCompare } from '../../lib/projectPaths'

interface RunCommandTemplate {
  id: string
  label: string
  command: string
  workingDirectory: string
  hint: string
  source?: 'package-script' | 'template'
}

const PACKAGE_SCRIPT_ROW_HEIGHT = 62
const PACKAGE_SCRIPT_LIST_OVERSCAN = 6
const TEMPLATE_LIST_VIEWPORT_HEIGHT = 240

type RunTaskTemplatePickerProps = {
  project: ProjectInfo
  /** Applies the picked template to the edited task (command + cwd). */
  onApply: (template: { command: string; workingDirectory: string }) => void
  disabled?: boolean
}

/**
 * Template picker merged from the legacy run-command config popover: package.json
 * scripts plus built-in templates, searchable, virtualized two-column grid.
 * Fills the parent container's height; the parent dialog provides the fixed height.
 */
export function RunTaskTemplatePicker({ project, onApply, disabled }: RunTaskTemplatePickerProps) {
  const { t } = useI18n()
  const [packageScripts, setPackageScripts] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [viewportHeight, setViewportHeight] = useState(TEMPLATE_LIST_VIEWPORT_HEIGHT)
  const [scrollTop, setScrollTop] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    setPackageScripts([])
    setQuery('')
    void window.electronAPI
      .readProjectFile(project.path, 'package.json')
      .then((result) => {
        if (cancelled) return
        setPackageScripts(parsePackageScripts(result.content))
      })
      .catch(() => {
        if (!cancelled) setPackageScripts([])
      })
    return () => {
      cancelled = true
    }
  }, [project.path])

  // The picker mounts fresh each time its dialog opens — focus the filter box.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  const deferredQuery = useDeferredValue(query.trim().toLowerCase())

  const filteredPackageScripts = useMemo(() => {
    if (!deferredQuery) return packageScripts
    return packageScripts.filter((script) => script.toLowerCase().includes(deferredQuery))
  }, [deferredQuery, packageScripts])

  const filteredPackageScriptTemplates = useMemo<RunCommandTemplate[]>(
    () =>
      filteredPackageScripts.map((script) => ({
        id: `package-script:${script}`,
        label: script,
        command: scriptCommand(project.packageManager, script),
        workingDirectory: '',
        hint: t('runCommand.packageScriptHint'),
        source: 'package-script',
      })),
    [filteredPackageScripts, project.packageManager, t],
  )

  const templates = useMemo<RunCommandTemplate[]>(() => {
    const devCommand = scriptCommand(project.packageManager, 'dev')
    const apiCommand = scriptCommand(project.packageManager, 'api')
    const startCommand = scriptCommand(project.packageManager, 'start')
    const buildCommand = scriptCommand(project.packageManager, 'build')
    const previewCommand = scriptCommand(project.packageManager, 'preview')

    const packageTemplates: RunCommandTemplate[] = [
      { id: 'pm-dev', label: t('runCommand.templatePackageDev'), command: devCommand, workingDirectory: '', hint: t('runCommand.templatePackageDevHint') },
      { id: 'pm-start', label: t('runCommand.templatePackageStart'), command: startCommand, workingDirectory: '', hint: t('runCommand.templatePackageStartHint') },
      { id: 'pm-build', label: t('runCommand.templatePackageBuild'), command: buildCommand, workingDirectory: '', hint: t('runCommand.templatePackageBuildHint') },
      { id: 'pm-preview', label: t('runCommand.templatePackagePreview'), command: previewCommand, workingDirectory: '', hint: t('runCommand.templatePackagePreviewHint') },
      { id: 'dual', label: t('runCommand.templateDual'), command: `${devCommand} && ${apiCommand}`, workingDirectory: '', hint: t('runCommand.templateDualHint') },
    ]

    const directoryTemplates: RunCommandTemplate[] = [
      { id: 'frontend-dev', label: t('runCommand.templateFrontendDev'), command: devCommand, workingDirectory: 'frontend', hint: t('runCommand.templateFrontendDevHint') },
      { id: 'client-dev', label: t('runCommand.templateClientDev'), command: devCommand, workingDirectory: 'client', hint: t('runCommand.templateClientDevHint') },
      { id: 'backend-dev', label: t('runCommand.templateBackendDev'), command: devCommand, workingDirectory: 'backend', hint: t('runCommand.templateBackendDevHint') },
      { id: 'server-dev', label: t('runCommand.templateServerDev'), command: devCommand, workingDirectory: 'server', hint: t('runCommand.templateServerDevHint') },
    ]

    const pythonTemplates: RunCommandTemplate[] = [
      { id: 'django', label: t('runCommand.templateDjango'), command: 'python manage.py runserver', workingDirectory: '', hint: t('runCommand.templateDjangoHint') },
      { id: 'flask', label: t('runCommand.templateFlask'), command: 'python -m flask run', workingDirectory: '', hint: t('runCommand.templateFlaskHint') },
      { id: 'fastapi', label: t('runCommand.templateFastApi'), command: 'uvicorn main:app --reload', workingDirectory: '', hint: t('runCommand.templateFastApiHint') },
      { id: 'python-main', label: t('runCommand.templatePythonMain'), command: 'python main.py', workingDirectory: '', hint: t('runCommand.templatePythonMainHint') },
    ]

    const scriptTemplates: RunCommandTemplate[] = [
      { id: 'bash', label: t('runCommand.templateBash'), command: 'bash ./start.sh', workingDirectory: '', hint: t('runCommand.templateBashHint') },
      { id: 'ps1', label: t('runCommand.templatePowerShell'), command: 'pwsh -File .\\start.ps1', workingDirectory: '', hint: t('runCommand.templatePowerShellHint') },
      { id: 'cmd', label: t('runCommand.templateCmd'), command: '.\\start.cmd', workingDirectory: '', hint: t('runCommand.templateCmdHint') },
      { id: 'bat', label: t('runCommand.templateBatch'), command: '.\\start.bat', workingDirectory: '', hint: t('runCommand.templateBatchHint') },
    ]

    const platformTemplates: RunCommandTemplate[] = [
      { id: 'docker-compose', label: t('runCommand.templateDockerCompose'), command: 'docker compose up', workingDirectory: '', hint: t('runCommand.templateDockerComposeHint') },
      { id: 'gradle-android', label: t('runCommand.templateGradleAndroid'), command: './gradlew installDebug', workingDirectory: '', hint: t('runCommand.templateGradleAndroidHint') },
    ]

    const environment = detectProjectEnvironment(project.path)
    const prioritized =
      project.type === 'android'
        ? [...platformTemplates.slice(1), ...packageTemplates, ...directoryTemplates, ...scriptTemplates, platformTemplates[0], ...pythonTemplates]
        : project.type === 'python' || project.type === 'django' || project.type === 'flask' || project.type === 'fastapi'
          ? [...pythonTemplates, ...packageTemplates, ...directoryTemplates, ...scriptTemplates, ...platformTemplates]
          : environment === 'windows'
            ? [...scriptTemplates.slice(1), ...packageTemplates, ...directoryTemplates, ...platformTemplates, scriptTemplates[0], ...pythonTemplates]
            : environment === 'ubuntu'
              ? [scriptTemplates[0], ...packageTemplates, ...directoryTemplates, ...pythonTemplates, ...platformTemplates, ...scriptTemplates.slice(1)]
              : [...packageTemplates, ...directoryTemplates, ...scriptTemplates, ...pythonTemplates, ...platformTemplates]

    return prioritized.filter(Boolean)
  }, [project.packageManager, project.path, project.type, t])

  const packageScriptIdentitySet = useMemo(() => {
    const set = new Set<string>()
    for (const script of packageScripts) {
      set.add(`${scriptCommand(project.packageManager, script).trim()}::${normalizePathForCompare('.')}`)
    }
    return set
  }, [packageScripts, project.packageManager])

  const builtInTemplates = useMemo(
    () =>
      templates.filter((item) => {
        const identity = `${item.command.trim()}::${normalizePathForCompare(item.workingDirectory || '.')}`
        return !packageScriptIdentitySet.has(identity)
      }),
    [packageScriptIdentitySet, templates],
  )

  const filteredBuiltInTemplates = useMemo(() => {
    if (!deferredQuery) return builtInTemplates
    return builtInTemplates.filter((item) => item.label.toLowerCase().includes(deferredQuery) || item.command.toLowerCase().includes(deferredQuery) || item.hint.toLowerCase().includes(deferredQuery) || item.workingDirectory.toLowerCase().includes(deferredQuery))
  }, [builtInTemplates, deferredQuery])

  const allTemplates = useMemo(() => [...filteredPackageScriptTemplates, ...filteredBuiltInTemplates], [filteredBuiltInTemplates, filteredPackageScriptTemplates])

  const totalTemplateRows = Math.ceil(allTemplates.length / 2)
  const visibleRowCount = Math.max(1, Math.ceil(viewportHeight / PACKAGE_SCRIPT_ROW_HEIGHT) + PACKAGE_SCRIPT_LIST_OVERSCAN * 2)
  const startRowIndex = Math.max(0, Math.floor(scrollTop / PACKAGE_SCRIPT_ROW_HEIGHT) - PACKAGE_SCRIPT_LIST_OVERSCAN)
  const endRowIndex = Math.min(totalTemplateRows, startRowIndex + visibleRowCount)
  const virtualRows = useMemo(() => {
    const rows: RunCommandTemplate[][] = []
    for (let rowIndex = startRowIndex; rowIndex < endRowIndex; rowIndex += 1) {
      const startIndex = rowIndex * 2
      rows.push(allTemplates.slice(startIndex, startIndex + 2))
    }
    return rows
  }, [allTemplates, endRowIndex, startRowIndex])
  const totalTemplateHeight = totalTemplateRows * PACKAGE_SCRIPT_ROW_HEIGHT

  useEffect(() => {
    const element = listRef.current
    if (!element) return
    const updateSize = () => setViewportHeight(element.clientHeight || TEMPLATE_LIST_VIEWPORT_HEIGHT)
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setScrollTop(0)
    listRef.current?.scrollTo({ top: 0 })
  }, [deferredQuery])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="quiet-control h-9 shrink-0 w-full rounded-[12px] border-0 px-3 font-mono text-[12px] text-[color:var(--color-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        placeholder={t('runCommand.templateSearchPlaceholder')}
        spellCheck={false}
        disabled={disabled}
      />
      <p className="shrink-0 text-[11px] text-[color:var(--color-muted-foreground)]">{allTemplates.length > 0 ? t('runCommand.templateMatchCount', { count: allTemplates.length }) : t('runCommand.templateNoMatches')}</p>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto pr-1" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
        {allTemplates.length <= 0 ? (
          <div className="code-panel-empty text-[11px] text-[color:var(--color-muted-foreground)]">{t('runCommand.templateNoMatches')}</div>
        ) : (
          <div style={{ height: `${totalTemplateHeight}px`, position: 'relative' }}>
            <div className="space-y-1.5" style={{ transform: `translateY(${startRowIndex * PACKAGE_SCRIPT_ROW_HEIGHT}px)` }}>
              {virtualRows.map((row, rowIndex) => (
                <div key={`row-${startRowIndex + rowIndex}`} className="grid grid-cols-2 gap-1.5">
                  {row.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="flex h-[56px] w-full items-start justify-between gap-2 rounded-[12px] border px-3 py-2 text-left transition-colors hover:bg-[color:var(--color-accent)]"
                      style={{ borderColor: 'var(--color-border)' }}
                      onClick={() => onApply({ command: item.command, workingDirectory: item.workingDirectory })}
                      disabled={disabled}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[12px] font-medium text-[color:var(--color-foreground)]">{item.label}</span>
                        <span className="mt-0.5 block truncate font-mono text-[11px] text-[color:var(--color-muted-foreground)]">{item.command}</span>
                      </span>
                      <span className="max-w-[40%] shrink-0 text-right">
                        <span className={`block truncate text-[10px] ${item.source === 'package-script' ? 'text-[color:var(--color-primary)]' : 'text-[color:var(--color-muted-foreground)]'}`}>{item.hint}</span>
                        <span className="mt-0.5 block truncate text-[10px] text-[color:var(--color-muted-foreground)]">
                          {t('runCommand.cwdShort')}: {item.workingDirectory || t('runCommand.projectRoot')}
                        </span>
                      </span>
                    </button>
                  ))}
                  {row.length === 1 && <div aria-hidden="true" />}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
