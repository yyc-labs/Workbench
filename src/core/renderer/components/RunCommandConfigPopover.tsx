import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { FolderOpen, Play, RotateCcw, Save, Terminal, X } from 'lucide-react'
import type { ProjectInfo } from '../../shared/types'
import { detectProjectEnvironment } from '../lib/projectEnvironment'
import { useI18n } from '../i18n'
import { projectDisplayName } from '../lib/projectDisplay'
import { useAppStore } from '../stores/appStore'
import { ModalShell } from './ModalShell'

interface RunCommandConfigPopoverProps {
  project: ProjectInfo
  open: boolean
  onClose: () => void
}

type ConfigTab = 'command' | 'template'

interface RunCommandTemplate {
  id: string
  label: string
  command: string
  hint: string
  workingDirectory: string
  source?: 'package-script' | 'template'
}

const MAX_PACKAGE_SCRIPT_JSON_PARSE_FALLBACK_LENGTH = 64 * 1024
const PACKAGE_SCRIPT_ROW_HEIGHT = 62
const PACKAGE_SCRIPT_LIST_OVERSCAN = 6
const TEMPLATE_LIST_VIEWPORT_HEIGHT = 240

function normalizePathForCompare(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\/+$/, '')
}

function templateIdentityKey(template: Pick<RunCommandTemplate, 'command' | 'workingDirectory'>): string {
  const workingDirectory = normalizePathForCompare(template.workingDirectory || '.')
  return `${template.command.trim()}::${workingDirectory}`
}

function resolveWorkingDirectoryPreview(projectPath: string, workingDirectory: string): string {
  const raw = workingDirectory.trim()
  if (!raw) return projectPath
  if (/^[a-z]:[\\/]/i.test(raw) || raw.startsWith('/') || raw.startsWith('\\\\') || raw.startsWith('//')) {
    return raw
  }
  return `${normalizePathForCompare(projectPath)}/${raw.replace(/^[\\/]+/, '').replace(/[\\/]+/g, '/')}`
}

function toProjectRelativeDirectory(projectPath: string, selectedPath: string): string {
  const root = normalizePathForCompare(projectPath)
  const selected = normalizePathForCompare(selectedPath)
  if (!selected) return ''
  if (selected === root) return ''

  const rootPrefix = `${root}/`
  if (selected.startsWith(rootPrefix)) return selected.slice(rootPrefix.length)

  const rootLowerPrefix = `${root.toLowerCase()}/`
  if (selected.toLowerCase().startsWith(rootLowerPrefix)) return selected.slice(rootPrefix.length)

  return selectedPath
}

function scriptCommand(packageManager: ProjectInfo['packageManager'] | undefined, script: string): string {
  const pm = packageManager || 'npm'
  if (pm === 'yarn') return script === 'start' ? 'yarn start' : `yarn ${script}`
  if (script === 'start') return `${pm} start`
  return `${pm} run ${script}`
}

function sortPackageScriptNames(names: string[]): string[] {
  return names
    .filter((name) => name.trim().length > 0)
    .sort((left, right) => {
      const preferred = ['dev', 'start', 'build', 'preview', 'test', 'typecheck', 'lint']
      const leftIndex = preferred.indexOf(left)
      const rightIndex = preferred.indexOf(right)
      if (leftIndex >= 0 || rightIndex >= 0) {
        return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex)
      }
      return left.localeCompare(right)
    })
}

function isJsonWhitespace(char: string | undefined): boolean {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t'
}

function skipJsonWhitespace(content: string, startIndex: number): number {
  let index = startIndex
  while (index < content.length && isJsonWhitespace(content[index])) index += 1
  return index
}

function skipJsonString(content: string, startIndex: number): number | null {
  if (content[startIndex] !== '"') return null

  let index = startIndex + 1
  while (index < content.length) {
    const char = content[index]
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === '"') return index + 1
    index += 1
  }

  return null
}

function readJsonStringValue(content: string, startIndex: number): { value: string; nextIndex: number } | null {
  if (content[startIndex] !== '"') return null

  let index = startIndex + 1
  let value = ''

  while (index < content.length) {
    const char = content[index]
    if (char === '"') {
      return { value, nextIndex: index + 1 }
    }
    if (char === '\\') {
      index += 1
      if (index >= content.length) return null
      const escaped = content[index]
      if (escaped === '"' || escaped === '\\' || escaped === '/') value += escaped
      else if (escaped === 'b') value += '\b'
      else if (escaped === 'f') value += '\f'
      else if (escaped === 'n') value += '\n'
      else if (escaped === 'r') value += '\r'
      else if (escaped === 't') value += '\t'
      else if (escaped === 'u') {
        const hex = content.slice(index + 1, index + 5)
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null
        value += String.fromCharCode(Number.parseInt(hex, 16))
        index += 4
      } else {
        return null
      }
      index += 1
      continue
    }

    value += char
    index += 1
  }

  return null
}

function findJsonPrimitiveEnd(content: string, startIndex: number): number {
  let index = startIndex
  while (index < content.length) {
    const char = content[index]
    if (char === ',' || char === '}' || char === ']' || isJsonWhitespace(char)) return index
    index += 1
  }
  return index
}

function findJsonStructureEnd(content: string, startIndex: number): number | null {
  const root = content[startIndex]
  if (root !== '{' && root !== '[') return null

  const stack: string[] = [root]
  let index = startIndex + 1
  while (index < content.length) {
    const char = content[index]
    if (char === '"') {
      const nextIndex = skipJsonString(content, index)
      if (nextIndex == null) return null
      index = nextIndex
      continue
    }
    if (char === '{' || char === '[') {
      stack.push(char)
      index += 1
      continue
    }
    if (char === '}' || char === ']') {
      const last = stack[stack.length - 1]
      if ((char === '}' && last !== '{') || (char === ']' && last !== '[')) return null
      stack.pop()
      index += 1
      if (stack.length === 0) return index
      continue
    }
    index += 1
  }

  return null
}

function findJsonValueEnd(content: string, startIndex: number): number | null {
  const char = content[startIndex]
  if (!char) return null
  if (char === '"') return skipJsonString(content, startIndex)
  if (char === '{' || char === '[') return findJsonStructureEnd(content, startIndex)
  return findJsonPrimitiveEnd(content, startIndex)
}

function extractTopLevelObjectKeys(content: string, objectStartIndex: number): string[] | null {
  if (content[objectStartIndex] !== '{') return null

  const keys: string[] = []
  let index = objectStartIndex + 1

  while (index < content.length) {
    index = skipJsonWhitespace(content, index)
    const current = content[index]
    if (current === '}') return keys
    if (current !== '"') return null

    const keyResult = readJsonStringValue(content, index)
    if (!keyResult) return null
    keys.push(keyResult.value)

    index = skipJsonWhitespace(content, keyResult.nextIndex)
    if (content[index] !== ':') return null

    index = skipJsonWhitespace(content, index + 1)
    const valueEndIndex = findJsonValueEnd(content, index)
    if (valueEndIndex == null) return null

    index = skipJsonWhitespace(content, valueEndIndex)
    if (content[index] === ',') {
      index += 1
      continue
    }
    if (content[index] === '}') return keys
    return null
  }

  return null
}

function extractPackageScriptsFromJsonText(content: string): string[] | null {
  let index = skipJsonWhitespace(content, 0)
  if (content[index] !== '{') return null
  index += 1

  while (index < content.length) {
    index = skipJsonWhitespace(content, index)
    const current = content[index]
    if (current === '}') return []
    if (current !== '"') return null

    const keyResult = readJsonStringValue(content, index)
    if (!keyResult) return null

    index = skipJsonWhitespace(content, keyResult.nextIndex)
    if (content[index] !== ':') return null

    index = skipJsonWhitespace(content, index + 1)
    if (keyResult.value === 'scripts') {
      if (content[index] !== '{') return []
      return extractTopLevelObjectKeys(content, index)
    }

    const valueEndIndex = findJsonValueEnd(content, index)
    if (valueEndIndex == null) return null

    index = skipJsonWhitespace(content, valueEndIndex)
    if (content[index] === ',') {
      index += 1
      continue
    }
    if (content[index] === '}') return []
    return null
  }

  return null
}

function parsePackageScriptsViaJson(content: string): string[] {
  try {
    const parsed = JSON.parse(content) as { scripts?: unknown }
    if (!parsed.scripts || typeof parsed.scripts !== 'object' || Array.isArray(parsed.scripts)) return []
    return sortPackageScriptNames(Object.keys(parsed.scripts as Record<string, unknown>))
  } catch {
    return []
  }
}

function parsePackageScripts(content: string): string[] {
  const extracted = extractPackageScriptsFromJsonText(content)
  if (extracted) return sortPackageScriptNames(extracted)
  if (content.length <= MAX_PACKAGE_SCRIPT_JSON_PARSE_FALLBACK_LENGTH) {
    return parsePackageScriptsViaJson(content)
  }
  return []
}

export function RunCommandConfigPopover({
  project,
  open,
  onClose,
}: RunCommandConfigPopoverProps) {
  const { t } = useI18n()
  const setProjectCustomCommand = useAppStore((s) => s.setProjectCustomCommand)
  const setProjectRunWorkingDirectory = useAppStore((s) => s.setProjectRunWorkingDirectory)
  const setProjectRunStartupMode = useAppStore((s) => s.setProjectRunStartupMode)
  const startProject = useAppStore((s) => s.startProject)
  const [draftCommand, setDraftCommand] = useState(project.customCommand ?? project.command)
  const [draftWorkingDirectory, setDraftWorkingDirectory] = useState(project.runWorkingDirectory ?? '')
  const [runStartupMode, setRunStartupMode] = useState<'silent' | 'terminal'>(project.runStartupMode || 'silent')
  const [activeTab, setActiveTab] = useState<ConfigTab>('command')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [packageScripts, setPackageScripts] = useState<string[]>([])
  const [packageScriptQuery, setPackageScriptQuery] = useState('')
  const [packageScriptViewportHeight, setPackageScriptViewportHeight] = useState(TEMPLATE_LIST_VIEWPORT_HEIGHT)
  const [packageScriptScrollTop, setPackageScriptScrollTop] = useState(0)
  const packageScriptInputRef = useRef<HTMLInputElement | null>(null)
  const packageScriptListRef = useRef<HTMLDivElement | null>(null)

  const environment = detectProjectEnvironment(resolveWorkingDirectoryPreview(project.path, draftWorkingDirectory))
  const environmentHint =
    environment === 'windows'
      ? t('runCommand.environmentHintWindows')
      : environment === 'ubuntu'
        ? t('runCommand.environmentHintUbuntu')
        : t('runCommand.environmentHintOther')

  const isUsingDefault = !project.customCommand?.trim() && !project.runWorkingDirectory?.trim()
  const resolvedWorkingDirectory = resolveWorkingDirectoryPreview(project.path, draftWorkingDirectory)

  const hasChanges = useMemo(() => {
    const original = (project.customCommand ?? project.command).trim()
    const originalWorkingDirectory = project.runWorkingDirectory?.trim() || ''
    const originalMode = project.runStartupMode || 'silent'
    return (
      draftCommand.trim() !== original
      || draftWorkingDirectory.trim() !== originalWorkingDirectory
      || runStartupMode !== originalMode
    )
  }, [draftCommand, draftWorkingDirectory, project.command, project.customCommand, project.runStartupMode, project.runWorkingDirectory, runStartupMode])

  const deferredPackageScriptQuery = useDeferredValue(packageScriptQuery.trim().toLowerCase())

  const filteredPackageScripts = useMemo(() => {
    const normalizedQuery = deferredPackageScriptQuery
    if (!normalizedQuery) return packageScripts
    return packageScripts.filter((script) => script.toLowerCase().includes(normalizedQuery))
  }, [deferredPackageScriptQuery, packageScripts])

  const filteredPackageScriptTemplates = useMemo<RunCommandTemplate[]>(() => (
    filteredPackageScripts.map((script) => ({
      id: `package-script:${script}`,
      label: script,
      command: scriptCommand(project.packageManager, script),
      workingDirectory: '',
      hint: t('runCommand.packageScriptHint'),
      source: 'package-script',
    }))
  ), [filteredPackageScripts, project.packageManager, t])

  const templates = useMemo<RunCommandTemplate[]>(() => {
    const devCommand = scriptCommand(project.packageManager, 'dev')
    const apiCommand = scriptCommand(project.packageManager, 'api')
    const startCommand = scriptCommand(project.packageManager, 'start')
    const buildCommand = scriptCommand(project.packageManager, 'build')
    const previewCommand = scriptCommand(project.packageManager, 'preview')

    const packageTemplates: RunCommandTemplate[] = [
      {
        id: 'pm-dev',
        label: t('runCommand.templatePackageDev'),
        command: devCommand,
        workingDirectory: '',
        hint: t('runCommand.templatePackageDevHint'),
      },
      {
        id: 'pm-start',
        label: t('runCommand.templatePackageStart'),
        command: startCommand,
        workingDirectory: '',
        hint: t('runCommand.templatePackageStartHint'),
      },
      {
        id: 'pm-build',
        label: t('runCommand.templatePackageBuild'),
        command: buildCommand,
        workingDirectory: '',
        hint: t('runCommand.templatePackageBuildHint'),
      },
      {
        id: 'pm-preview',
        label: t('runCommand.templatePackagePreview'),
        command: previewCommand,
        workingDirectory: '',
        hint: t('runCommand.templatePackagePreviewHint'),
      },
      {
        id: 'dual',
        label: t('runCommand.templateDual'),
        command: `${devCommand} && ${apiCommand}`,
        workingDirectory: '',
        hint: t('runCommand.templateDualHint'),
      },
    ]

    const directoryTemplates: RunCommandTemplate[] = [
      {
        id: 'frontend-dev',
        label: t('runCommand.templateFrontendDev'),
        command: devCommand,
        workingDirectory: 'frontend',
        hint: t('runCommand.templateFrontendDevHint'),
      },
      {
        id: 'client-dev',
        label: t('runCommand.templateClientDev'),
        command: devCommand,
        workingDirectory: 'client',
        hint: t('runCommand.templateClientDevHint'),
      },
      {
        id: 'backend-dev',
        label: t('runCommand.templateBackendDev'),
        command: devCommand,
        workingDirectory: 'backend',
        hint: t('runCommand.templateBackendDevHint'),
      },
      {
        id: 'server-dev',
        label: t('runCommand.templateServerDev'),
        command: devCommand,
        workingDirectory: 'server',
        hint: t('runCommand.templateServerDevHint'),
      },
    ]

    const pythonTemplates: RunCommandTemplate[] = [
      {
        id: 'django',
        label: t('runCommand.templateDjango'),
        command: 'python manage.py runserver',
        workingDirectory: '',
        hint: t('runCommand.templateDjangoHint'),
      },
      {
        id: 'flask',
        label: t('runCommand.templateFlask'),
        command: 'python -m flask run',
        workingDirectory: '',
        hint: t('runCommand.templateFlaskHint'),
      },
      {
        id: 'fastapi',
        label: t('runCommand.templateFastApi'),
        command: 'uvicorn main:app --reload',
        workingDirectory: '',
        hint: t('runCommand.templateFastApiHint'),
      },
      {
        id: 'python-main',
        label: t('runCommand.templatePythonMain'),
        command: 'python main.py',
        workingDirectory: '',
        hint: t('runCommand.templatePythonMainHint'),
      },
    ]

    const scriptTemplates: RunCommandTemplate[] = [
      {
        id: 'bash',
        label: t('runCommand.templateBash'),
        command: 'bash ./start.sh',
        workingDirectory: '',
        hint: t('runCommand.templateBashHint'),
      },
      {
        id: 'ps1',
        label: t('runCommand.templatePowerShell'),
        command: 'pwsh -File .\\start.ps1',
        workingDirectory: '',
        hint: t('runCommand.templatePowerShellHint'),
      },
      {
        id: 'cmd',
        label: t('runCommand.templateCmd'),
        command: '.\\start.cmd',
        workingDirectory: '',
        hint: t('runCommand.templateCmdHint'),
      },
      {
        id: 'bat',
        label: t('runCommand.templateBatch'),
        command: '.\\start.bat',
        workingDirectory: '',
        hint: t('runCommand.templateBatchHint'),
      },
    ]

    const platformTemplates: RunCommandTemplate[] = [
      {
        id: 'docker-compose',
        label: t('runCommand.templateDockerCompose'),
        command: 'docker compose up',
        workingDirectory: '',
        hint: t('runCommand.templateDockerComposeHint'),
      },
      {
        id: 'gradle-android',
        label: t('runCommand.templateGradleAndroid'),
        command: './gradlew installDebug',
        workingDirectory: '',
        hint: t('runCommand.templateGradleAndroidHint'),
      },
    ]

    const prioritized = project.type === 'android'
      ? [...platformTemplates.slice(1), ...packageTemplates, ...directoryTemplates, ...scriptTemplates, platformTemplates[0], ...pythonTemplates]
      : project.type === 'python' || project.type === 'django' || project.type === 'flask' || project.type === 'fastapi'
        ? [...pythonTemplates, ...packageTemplates, ...directoryTemplates, ...scriptTemplates, ...platformTemplates]
        : environment === 'windows'
          ? [...scriptTemplates.slice(1), ...packageTemplates, ...directoryTemplates, ...platformTemplates, scriptTemplates[0], ...pythonTemplates]
          : environment === 'ubuntu'
            ? [scriptTemplates[0], ...packageTemplates, ...directoryTemplates, ...pythonTemplates, ...platformTemplates, ...scriptTemplates.slice(1)]
            : [...packageTemplates, ...directoryTemplates, ...scriptTemplates, ...pythonTemplates, ...platformTemplates]

    return prioritized.filter(Boolean)
  }, [environment, project.packageManager, project.type, t])

  const packageScriptTemplateIdentitySet = useMemo(() => {
    const set = new Set<string>()
    for (const script of packageScripts) {
      set.add(templateIdentityKey({
        command: scriptCommand(project.packageManager, script),
        workingDirectory: '',
      }))
    }
    return set
  }, [packageScripts, project.packageManager])

  const builtInTemplates = useMemo(() => (
    templates.filter((item) => !packageScriptTemplateIdentitySet.has(templateIdentityKey(item)))
  ), [packageScriptTemplateIdentitySet, templates])

  const filteredBuiltInTemplates = useMemo(() => {
    const normalizedQuery = deferredPackageScriptQuery
    if (!normalizedQuery) return builtInTemplates
    return builtInTemplates.filter((item) => (
      item.label.toLowerCase().includes(normalizedQuery)
      || item.command.toLowerCase().includes(normalizedQuery)
      || item.hint.toLowerCase().includes(normalizedQuery)
      || item.workingDirectory.toLowerCase().includes(normalizedQuery)
    ))
  }, [builtInTemplates, deferredPackageScriptQuery])

  const allTemplates = useMemo(() => (
    [...filteredPackageScriptTemplates, ...filteredBuiltInTemplates]
  ), [filteredBuiltInTemplates, filteredPackageScriptTemplates])

  const totalTemplateRows = Math.ceil(allTemplates.length / 2)
  const templateVisibleRowCount = Math.max(
    1,
    Math.ceil(packageScriptViewportHeight / PACKAGE_SCRIPT_ROW_HEIGHT) + (PACKAGE_SCRIPT_LIST_OVERSCAN * 2)
  )
  const templateStartRowIndex = Math.max(
    0,
    Math.floor(packageScriptScrollTop / PACKAGE_SCRIPT_ROW_HEIGHT) - PACKAGE_SCRIPT_LIST_OVERSCAN
  )
  const templateEndRowIndex = Math.min(
    totalTemplateRows,
    templateStartRowIndex + templateVisibleRowCount
  )
  const virtualTemplateRows = useMemo(() => {
    const rows: RunCommandTemplate[][] = []
    for (let rowIndex = templateStartRowIndex; rowIndex < templateEndRowIndex; rowIndex += 1) {
      const startIndex = rowIndex * 2
      rows.push(allTemplates.slice(startIndex, startIndex + 2))
    }
    return rows
  }, [allTemplates, templateEndRowIndex, templateStartRowIndex])
  const totalTemplateHeight = totalTemplateRows * PACKAGE_SCRIPT_ROW_HEIGHT

  useEffect(() => {
    if (!open) return
    setDraftCommand(project.customCommand ?? project.command)
    setDraftWorkingDirectory(project.runWorkingDirectory ?? '')
    setRunStartupMode(project.runStartupMode || 'silent')
    setActiveTab('command')
    setError(null)
  }, [open, project.command, project.customCommand, project.id, project.runStartupMode, project.runWorkingDirectory])

  useEffect(() => {
    if (!open) {
      setPackageScripts([])
      setPackageScriptQuery('')
      return
    }
    let cancelled = false
    setPackageScripts([])
    setPackageScriptQuery('')

    void window.electronAPI.readProjectFile(project.path, 'package.json')
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
  }, [open, project.path])

  useEffect(() => {
    if (!open || activeTab !== 'template') return
    const frame = window.requestAnimationFrame(() => {
      packageScriptInputRef.current?.focus()
      packageScriptInputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeTab, open])

  useEffect(() => {
    if (!open || activeTab !== 'template') return
    const element = packageScriptListRef.current
    if (!element) return

    const updateSize = () => {
      setPackageScriptViewportHeight(element.clientHeight || TEMPLATE_LIST_VIEWPORT_HEIGHT)
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [activeTab, open, packageScripts.length])

  useEffect(() => {
    if (!open || activeTab !== 'template') return
    setPackageScriptScrollTop(0)
    packageScriptListRef.current?.scrollTo({ top: 0 })
  }, [activeTab, deferredPackageScriptQuery, open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  const applyTemplate = (template: RunCommandTemplate) => {
    setDraftCommand(template.command)
    setDraftWorkingDirectory(template.workingDirectory)
    setActiveTab('command')
  }

  const persistRunConfig = async () => {
    await setProjectCustomCommand(project.id, draftCommand.trim() || undefined)
    await setProjectRunWorkingDirectory(project.id, draftWorkingDirectory)
    await setProjectRunStartupMode(project.id, runStartupMode)
  }

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await persistRunConfig()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleRunOnce = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await startProject(project.id, draftCommand.trim() || project.command, undefined, undefined, draftWorkingDirectory, runStartupMode)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAndRun = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await persistRunConfig()
      await startProject(project.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await setProjectCustomCommand(project.id, undefined)
      await setProjectRunWorkingDirectory(project.id, undefined)
      await setProjectRunStartupMode(project.id, 'silent')
      setDraftCommand(project.command)
      setDraftWorkingDirectory('')
      setRunStartupMode('silent')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleBrowseWorkingDirectory = async () => {
    if (saving) return
    setError(null)
    try {
      const selectedPath = await window.electronAPI.selectDirectory(project.path)
      if (!selectedPath) return
      setDraftWorkingDirectory(toProjectRelativeDirectory(project.path, selectedPath))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      widthClassName="max-w-[760px]"
      baseZIndex={1100}
      ariaLabel={t('runCommand.title')}
      panelClassName="max-h-[calc(100vh-116px)] overflow-hidden p-0"
    >
      <div className="flex max-h-[calc(100vh-116px)] min-h-0 flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-[color:var(--color-border)] px-5 py-3.5">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <p className="text-base font-semibold text-[color:var(--color-foreground)]">{t('runCommand.title')}</p>
              <span className="rounded-full px-2 py-0.5 text-[10px] quiet-control">
                {isUsingDefault ? t('runCommand.defaultState') : t('runCommand.customState')}
              </span>
            </div>
            <p className="mt-1 truncate text-[12px] text-[color:var(--color-muted-foreground)]" title={project.path}>
              {projectDisplayName(project)}
            </p>
          </div>
          <button
            className="quiet-control inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:text-[color:var(--color-foreground)]"
            onClick={onClose}
            disabled={saving}
            aria-label={t('runCommand.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex h-[380px] min-h-0 flex-col overflow-hidden px-5 py-3.5">
          {error && (
            <div className="mb-3 shrink-0 rounded-[12px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-background)] px-3 py-2 text-xs text-[color:var(--color-destructive)]">
              {error}
            </div>
          )}

          <div className="mb-3 inline-flex w-fit shrink-0 self-start rounded-full p-1 quiet-control">
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

          <div className="min-h-0 flex-1">
            {activeTab === 'command' ? (
              <div className="h-full space-y-4 overflow-y-auto pr-1">
                <div>
                  <p className="mb-1.5 text-[11px] text-[color:var(--color-muted-foreground)]">
                    {t('runCommand.detectedDefaultCommand')} <span className="font-mono text-[color:var(--color-foreground)]">{project.command}</span>
                  </p>
                  <textarea
                    value={draftCommand}
                    onChange={(e) => setDraftCommand(e.target.value)}
                    className="quiet-control h-[65px] w-full resize-y rounded-[12px] border-0 px-3 py-2 font-mono text-[12px] text-[color:var(--color-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    placeholder={t('runCommand.commandPlaceholder')}
                    spellCheck={false}
                    disabled={saving}
                  />
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <p className="text-[11px] text-[color:var(--color-muted-foreground)]">{t('runCommand.workingDirectory')}</p>
                    <button
                      className="inline-flex h-7 items-center gap-1 rounded-full border border-[color:var(--color-border)] px-2.5 text-[11px] text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                      onClick={() => setDraftWorkingDirectory('')}
                      disabled={saving}
                    >
                      {t('runCommand.projectRoot')}
                    </button>
                  </div>
                  <div className="flex min-w-0 gap-2">
                    <input
                      value={draftWorkingDirectory}
                      onChange={(e) => setDraftWorkingDirectory(e.target.value)}
                      className="quiet-control h-9 min-w-0 flex-1 rounded-[12px] border-0 px-3 font-mono text-[12px] text-[color:var(--color-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      placeholder={t('runCommand.workingDirectoryPlaceholder')}
                      spellCheck={false}
                      disabled={saving}
                    />
                    <button
                      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-3 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                      onClick={() => void handleBrowseWorkingDirectory()}
                      disabled={saving}
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      {t('runCommand.browseDirectory')}
                    </button>
                  </div>
                  <p className="mt-1.5 truncate text-[11px] text-[color:var(--color-muted-foreground)]" title={resolvedWorkingDirectory}>
                    {t('runCommand.effectiveDirectory')}: <span className="font-mono">{resolvedWorkingDirectory}</span>
                  </p>
                </div>

                <div>
                  <p className="mb-1.5 text-[11px] text-[color:var(--color-muted-foreground)]">{t('runCommand.startupMode')}</p>
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
                  <p className="mt-2 text-[11px] text-[color:var(--color-muted-foreground)]">{environmentHint}</p>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-0 flex-col space-y-1.5">
                <p className="shrink-0 text-[11px] text-[color:var(--color-muted-foreground)]">
                  {t('runCommand.templateHint')}
                </p>
                <input
                  ref={packageScriptInputRef}
                  value={packageScriptQuery}
                  onChange={(event) => setPackageScriptQuery(event.target.value)}
                  className="quiet-control h-9 shrink-0 w-full rounded-[12px] border-0 px-3 font-mono text-[12px] text-[color:var(--color-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder={t('runCommand.templateSearchPlaceholder')}
                  spellCheck={false}
                  disabled={saving}
                />
                <p className="shrink-0 text-[11px] text-[color:var(--color-muted-foreground)]">
                  {allTemplates.length > 0
                    ? t('runCommand.templateMatchCount', { count: allTemplates.length })
                    : t('runCommand.templateNoMatches')}
                </p>
                <div
                  ref={packageScriptListRef}
                  className="min-h-0 flex-1 overflow-y-auto pr-1"
                  onScroll={(event) => setPackageScriptScrollTop(event.currentTarget.scrollTop)}
                >
                  {allTemplates.length <= 0 ? (
                    <div className="code-panel-empty text-[11px] text-[color:var(--color-muted-foreground)]">
                      {t('runCommand.templateNoMatches')}
                    </div>
                  ) : (
                    <div style={{ height: `${totalTemplateHeight}px`, position: 'relative' }}>
                      <div
                        className="space-y-1.5"
                        style={{ transform: `translateY(${templateStartRowIndex * PACKAGE_SCRIPT_ROW_HEIGHT}px)` }}
                      >
                        {virtualTemplateRows.map((row, rowIndex) => (
                          <div
                            key={`row-${templateStartRowIndex + rowIndex}`}
                            className="grid grid-cols-2 gap-1.5"
                          >
                            {row.map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                className="flex h-[56px] w-full items-start justify-between gap-2 rounded-[12px] border px-3 py-2 text-left transition-colors hover:bg-[color:var(--color-accent)]"
                                style={{ borderColor: 'var(--color-border)' }}
                                onClick={() => applyTemplate(item)}
                                disabled={saving}
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-[12px] font-medium text-[color:var(--color-foreground)]">{item.label}</span>
                                  <span className="mt-0.5 block truncate font-mono text-[11px] text-[color:var(--color-muted-foreground)]">
                                    {item.command}
                                  </span>
                                </span>
                                <span className="max-w-[40%] shrink-0 text-right">
                                  <span className={`block truncate text-[10px] ${
                                    item.source === 'package-script'
                                      ? 'text-[color:var(--color-primary)]'
                                      : 'text-[color:var(--color-muted-foreground)]'
                                  }`}>{item.hint}</span>
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
            )}
          </div>
        </div>

        <div className="border-t border-[color:var(--color-border)] px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
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
              onClick={() => void handleRunOnce()}
              disabled={saving}
            >
              <Play className="h-3.5 w-3.5" />
              {t('runCommand.runOnce')}
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

          <div className="mt-1.5 flex min-w-0 items-center gap-1 text-[10px] text-[color:var(--color-muted-foreground)]">
            <Terminal className="h-3 w-3 shrink-0" />
            <span className="truncate">{t('runCommand.persistedHint')}</span>
          </div>
        </div>
      </div>
    </ModalShell>
  )
}
