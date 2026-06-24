import { useEffect, useMemo, useState } from 'react'
import { Clock3, FileText, RefreshCw, Search, X } from 'lucide-react'
import type { ProjectInfo } from '../../../shared/types'
import { ModalShell } from '../../components/ModalShell'
import { Button } from '../../components/ui/button'
import { Combobox, type ComboboxOption } from '../../components/ui/combobox'
import { Input } from '../../components/ui/input'
import { useI18n } from '../../i18n'
import { middleTruncatePath, projectDisplayName } from '../../lib/projectDisplay'

type ManualTranscriptImportProject = Pick<ProjectInfo, 'id' | 'name' | 'customName' | 'path' | 'lastOpened'>
type ManualTranscriptImportWrapMode = 'none' | 'typescript' | 'tsx' | 'javascript' | 'json' | 'bash' | 'mermaid'

const MANUAL_TRANSCRIPT_IMPORT_WRAP_MODES: readonly ManualTranscriptImportWrapMode[] = [
  'none',
  'typescript',
  'tsx',
  'javascript',
  'json',
  'bash',
  'mermaid',
] as const

const SINGLE_FENCED_BLOCK_PATTERN = /^(`{3,})([^\n`]*)\r?\n[\s\S]*\r?\n\1$/

function createFenceMarker(text: string): string {
  const matches = text.match(/`{3,}/g)
  const longestFence = matches?.reduce((max, item) => Math.max(max, item.length), 2) ?? 2
  return '`'.repeat(Math.max(3, longestFence + 1))
}

function wrapManualImportContent(rawText: string, wrapMode: ManualTranscriptImportWrapMode): string {
  if (wrapMode === 'none') return rawText

  const normalized = rawText.replace(/\r\n/g, '\n')
  if (!normalized.trim()) return rawText
  if (SINGLE_FENCED_BLOCK_PATTERN.test(normalized.trim())) return rawText

  const fenceMarker = createFenceMarker(normalized)
  const body = normalized.endsWith('\n') ? normalized : `${normalized}\n`
  return `${fenceMarker}${wrapMode}\n${body}${fenceMarker}`
}

type ManualTranscriptImportModalProps = {
  open: boolean
  onClose: () => void
  onImport: (payload: { projectId: string; rawText: string; title?: string }) => Promise<boolean>
  projects?: ManualTranscriptImportProject[]
  project?: ManualTranscriptImportProject
  initialProjectId?: string
  requireProjectSelection?: boolean
  submitting?: boolean
  ariaLabel?: string
  title?: string
  description?: string
  submitLabel?: string
  onImported?: (projectId: string) => void | Promise<void>
}

export function ManualTranscriptImportModal({
  open,
  onClose,
  onImport,
  projects,
  project,
  initialProjectId,
  requireProjectSelection = false,
  submitting = false,
  ariaLabel,
  title,
  description,
  submitLabel,
  onImported,
}: ManualTranscriptImportModalProps) {
  const { t, formatDateTime } = useI18n()
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId ?? '')
  const [projectSearchQuery, setProjectSearchQuery] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [draftText, setDraftText] = useState('')
  const [wrapMode, setWrapMode] = useState<ManualTranscriptImportWrapMode>('none')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSelectedProjectId(initialProjectId ?? '')
    setProjectSearchQuery('')
    setDraftTitle('')
    setDraftText('')
    setWrapMode('none')
    setError(null)
  }, [initialProjectId, open])

  const availableProjects = useMemo(
    () => (projects ?? []).slice().sort((a, b) => {
      const openedDiff = (b.lastOpened ?? 0) - (a.lastOpened ?? 0)
      if (openedDiff !== 0) return openedDiff
      return projectDisplayName(a).localeCompare(projectDisplayName(b))
    }),
    [projects]
  )
  const lockedProject = useMemo(() => {
    if (!project) return undefined
    const trimmedId = project.id.trim()
    return trimmedId
      ? {
        ...project,
        id: trimmedId,
      }
      : undefined
  }, [project])
  const canChooseProject = availableProjects.length > 0
  const resolvedProjectId = (lockedProject?.id ?? selectedProjectId).trim()
  const textValue = draftText.trim()
  const selectedProject = lockedProject ?? availableProjects.find((item) => item.id === resolvedProjectId)
  const normalizedProjectSearchQuery = projectSearchQuery.trim().toLowerCase()
  const filteredProjects = useMemo(
    () => availableProjects.filter((project) => {
      if (!normalizedProjectSearchQuery) return true
      return [
        projectDisplayName(project),
        project.path,
        project.id,
      ].some((value) => value.toLowerCase().includes(normalizedProjectSearchQuery))
    }),
    [availableProjects, normalizedProjectSearchQuery]
  )
  const selectedProjectLabel = selectedProject
    ? projectDisplayName(selectedProject)
    : t('transcript.manualImportProjectPlaceholder')
  const projectOptions = useMemo<ComboboxOption[]>(
    () => availableProjects.map((item) => ({
      value: item.id,
      label: projectDisplayName(item),
      keywords: [item.path, item.id],
    })),
    [availableProjects]
  )

  const effectiveTitle = title ?? t('transcript.manualImportTitle')
  const effectiveDescription = description ?? t('transcript.manualImportDescription')
  const effectiveSubmitLabel = submitLabel ?? t('transcript.importPastedContent')
  const hasLockedProject = Boolean(lockedProject)
  const requiresProject = hasLockedProject || requireProjectSelection || availableProjects.length > 0

  const handleSubmit = async () => {
    const projectId = resolvedProjectId
    if (requiresProject && !projectId) {
      setError(t('transcript.manualImportProjectRequired'))
      return
    }
    if (!textValue) {
      setError(t('transcript.manualImportEmpty'))
      return
    }

    setError(null)
    const preparedText = wrapManualImportContent(draftText, wrapMode)
    const fallbackTitle = `${t('transcript.sourceTypes.manual-markdown')} · ${formatDateTime(Date.now(), {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })}`

    const ok = await onImport({
      projectId,
      rawText: preparedText,
      title: draftTitle.trim() || fallbackTitle,
    })

    if (!ok) {
      setError(t('transcript.manualImportFailed'))
      return
    }

    await onImported?.(projectId)
    onClose()
  }

  return (
    <ModalShell
      open={open}
      onClose={() => {
        if (submitting) return
        onClose()
      }}
      widthClassName="max-w-[720px]"
      baseZIndex={1140}
      ariaLabel={ariaLabel ?? effectiveTitle}
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="section-label mb-1">{t('transcript.listTitle')}</p>
            <p className="text-base font-semibold text-[color:var(--color-foreground)]">
              {effectiveTitle}
            </p>
            <p className="mt-1 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
              {effectiveDescription}
            </p>
          </div>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onClose}
            title={t('common.close')}
            disabled={submitting}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {requiresProject ? (
          <div className="space-y-2">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('transcript.manualImportProjectLabel')}</p>
            {hasLockedProject && selectedProject ? (
              <div className="rounded-[18px] border px-4 py-4" style={{ borderColor: 'var(--color-border)' }}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-[color:var(--color-foreground)]">
                    {projectDisplayName(selectedProject)}
                  </p>
                  <span className="inline-flex items-center rounded-full bg-[color:var(--color-accent)] px-2 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">
                    {t('common.currentProject')}
                  </span>
                </div>
                <p
                  className="mt-1 truncate text-xs text-[color:var(--color-muted-foreground)]"
                  title={selectedProject.path}
                >
                  {middleTruncatePath(selectedProject.path, 34, 28)}
                </p>
              </div>
            ) : canChooseProject ? (
              <Combobox
                ariaLabel={t('transcript.manualImportProjectLabel')}
                value={selectedProject?.id ?? ''}
                searchValue={projectSearchQuery}
                onSearchValueChange={setProjectSearchQuery}
                options={projectOptions}
                onChange={setSelectedProjectId}
                editable="open"
                clearSearchOnClose
                triggerPlaceholder={selectedProjectLabel}
                inputPlaceholder={t('transcript.manualImportProjectSearchPlaceholder')}
                disabled={submitting}
                emptyText={t('transcript.manualImportProjectSearchEmpty')}
                minDropdownWidth={360}
                matchTriggerWidth={true}
                inputClassName="h-11 rounded-full pr-10"
                inputLeading={<Search className="h-4 w-4" />}
                triggerClassName="h-11 gap-3 px-4 text-sm"
                contentClassName="rounded-[18px] p-1.5"
                optionClassName="items-start gap-3 rounded-[14px] px-3 py-3"
                renderDisplayValue={() => (
                  <span className={`min-w-0 truncate ${selectedProject ? 'text-[color:var(--color-foreground)]' : 'text-[color:var(--color-muted-foreground)]'}`}>
                    {selectedProjectLabel}
                  </span>
                )}
                renderOption={(option, state) => {
                  const project = availableProjects.find((item) => item.id === option.value)
                  if (!project) return null
                  const index = filteredProjects.findIndex((item) => item.id === project.id)
                  const isRecent = index >= 0 && index < 5 && typeof project.lastOpened === 'number'
                  return (
                    <>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium text-[color:var(--color-foreground)]">
                            {projectDisplayName(project)}
                          </p>
                          {isRecent ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-accent)] px-2 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">
                              <Clock3 className="h-3 w-3" />
                              {t('transcript.manualImportRecentProject')}
                            </span>
                          ) : null}
                        </div>
                        <p
                          className="mt-1 truncate text-xs text-[color:var(--color-muted-foreground)]"
                          title={project.path}
                        >
                          {middleTruncatePath(project.path, 30, 24)}
                        </p>
                      </div>
                      <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                        state.selected
                          ? 'border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-white'
                          : 'border-[color:var(--color-border)] text-transparent'
                      }`}>
                        <span className="h-3 w-3 rounded-full bg-current" />
                      </span>
                    </>
                  )
                }}
                filterOption={(option, nextQuery) => {
                  const normalizedQuery = nextQuery.trim().toLowerCase()
                  if (!normalizedQuery) return true
                  const project = availableProjects.find((item) => item.id === option.value)
                  if (!project) return false
                  return [
                    projectDisplayName(project),
                    project.path,
                    project.id,
                  ].some((field) => field.toLowerCase().includes(normalizedQuery))
                }}
                onOpenChange={(isOpen) => {
                  if (!isOpen) {
                    setProjectSearchQuery('')
                  }
                }}
              />
            ) : (
              <div
                className="rounded-[18px] border px-4 py-4 text-sm text-[color:var(--color-muted-foreground)]"
                style={{ borderColor: 'var(--color-border)' }}
              >
                {t('transcript.manualImportNoProjects')}
              </div>
            )}
            {selectedProject && !hasLockedProject ? (
              <div className="rounded-[16px] border px-4 py-3" style={{ borderColor: 'var(--color-border)' }}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-[color:var(--color-foreground)]">
                    {projectDisplayName(selectedProject)}
                  </p>
                  {typeof selectedProject.lastOpened === 'number' ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-accent)] px-2 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">
                      <Clock3 className="h-3 w-3" />
                      {t('common.recentlyOpened')}
                    </span>
                  ) : null}
                </div>
                <p
                  className="mt-1 truncate text-xs text-[color:var(--color-muted-foreground)]"
                  title={selectedProject.path}
                >
                  {middleTruncatePath(selectedProject.path, 34, 28)}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-1.5">
          <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('transcript.manualImportTitleLabel')}</p>
          <Input
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            className="h-11"
            placeholder={t('transcript.manualImportTitlePlaceholder')}
            disabled={submitting}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('transcript.manualImportWrapLabel')}</p>
            {wrapMode !== 'none' ? (
              <code className="quiet-control rounded-full px-3 py-1 font-mono text-[11px] text-[color:var(--color-foreground)]">
                {` \`\`\`${wrapMode} `}
              </code>
            ) : null}
          </div>
          <div className="quiet-control flex flex-wrap gap-1 rounded-[18px] p-1">
            {MANUAL_TRANSCRIPT_IMPORT_WRAP_MODES.map((option) => {
              const active = option === wrapMode
              return (
                <button
                  key={option}
                  type="button"
                  className={`inline-flex h-8 items-center rounded-full px-3 text-xs transition-colors ${
                    active
                      ? 'bg-[color:var(--color-primary)] text-white'
                      : 'text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
                  }`}
                  onClick={() => setWrapMode(option)}
                  aria-pressed={active}
                  disabled={submitting}
                >
                  {t(`transcript.manualImportWrapOptions.${option}`)}
                </button>
              )
            })}
          </div>
          <p className="text-xs leading-5 text-[color:var(--color-muted-foreground)]">
            {wrapMode === 'none'
              ? t('transcript.manualImportWrapHint')
              : t('transcript.manualImportWrapSelection', { value: wrapMode })}
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('transcript.manualImportContentLabel')}</p>
          <textarea
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            className="quiet-control min-h-[240px] w-full resize-y rounded-[18px] border-0 px-4 py-3 text-sm text-[color:var(--color-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder={t('transcript.manualImportContentPlaceholder')}
            spellCheck={false}
            disabled={submitting}
          />
        </div>

        {error ? (
          <div
            className="rounded-[16px] border px-4 py-3 text-sm"
            style={{
              borderColor: 'var(--color-destructive)',
              background: 'var(--color-destructive-background)',
              color: 'var(--color-destructive)',
            }}
          >
            {error}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-10 px-4"
            onClick={onClose}
            disabled={submitting}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            className="h-10 px-4"
            onClick={() => void handleSubmit()}
            disabled={submitting || !textValue || (requiresProject && !resolvedProjectId)}
          >
            {submitting ? <RefreshCw className="animate-spin" /> : <FileText className="h-4 w-4" />}
            {submitting ? t('transcript.importing') : effectiveSubmitLabel}
          </Button>
        </div>
      </div>
    </ModalShell>
  )
}
