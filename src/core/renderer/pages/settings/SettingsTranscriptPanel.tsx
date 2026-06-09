import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import type { RemovedProjectSnapshot, TranscriptSessionSummary } from '../../../shared/types'
import { ModalShell } from '../../components/ModalShell'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { middleTruncatePath, projectDisplayName } from '../../lib/projectDisplay'
import { projectIdFromPath } from '../../../shared/rules'
import { useAppStore } from '../../stores/appStore'

type ProjectListItem = {
  id: string
  name: string
  customName?: string
  path: string
}

type TranscriptGroupRecord = {
  projectId: string
  summaries: TranscriptSessionSummary[]
}

type TranscriptProjectGroup = {
  projectId: string
  projectName: string
  projectPath: string
  isArchivedProject: boolean
  summaries: TranscriptSessionSummary[]
}

type TranscriptSelectionItem = {
  projectId: string
  transcriptId: string
  title: string
  projectName: string
}

type TranscriptPanelProps = {
  projects: ProjectListItem[]
  removedProjects?: RemovedProjectSnapshot[]
}

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function formatTimestamp(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return 'Unknown time'
  const date = new Date(Math.trunc(value))
  if (Number.isNaN(date.getTime())) return 'Unknown time'
  return DATE_TIME_FORMATTER.format(date)
}

function formatSourceTypeLabel(value: string): string {
  switch (value) {
    case 'process-output':
      return 'Process Output'
    case 'tmux-capture':
      return 'Tmux Capture'
    case 'agent-hook':
      return 'Agent Hook'
    case 'manual-markdown':
      return 'Manual Markdown'
    case 'imported-file':
      return 'Imported File'
    default:
      return 'Transcript'
  }
}

function buildProjectMeta(projects: ProjectListItem[], removedProjects?: RemovedProjectSnapshot[]) {
  const map = new Map<string, { projectName: string; projectPath: string; isArchivedProject: boolean }>()

  for (const project of projects) {
    map.set(project.id, {
      projectName: projectDisplayName(project),
      projectPath: project.path,
      isArchivedProject: false,
    })
  }

  for (const project of removedProjects ?? []) {
    const projectId = projectIdFromPath(project.path)
    if (map.has(projectId)) continue
    map.set(projectId, {
      projectName: project.customName?.trim() || project.path.split(/[\\/]/).filter(Boolean).pop() || project.path,
      projectPath: project.path,
      isArchivedProject: true,
    })
  }

  return map
}

function sortSummaries(items: TranscriptSessionSummary[]): TranscriptSessionSummary[] {
  return items.slice().sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)
}

function makeSelectionKey(projectId: string, transcriptId: string): string {
  return `${projectId}::${transcriptId}`
}

function SettingsTranscriptPanel({ projects, removedProjects }: TranscriptPanelProps) {
  const navigate = useNavigate()
  const loadProjectTranscripts = useAppStore((s) => s.loadProjectTranscripts)
  const openTranscript = useAppStore((s) => s.openTranscript)
  const removeTranscriptSession = useAppStore((s) => s.removeTranscriptSession)
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [records, setRecords] = useState<TranscriptGroupRecord[]>([])
  const [expandedProjectIds, setExpandedProjectIds] = useState<Record<string, boolean>>({})
  const [selectedItems, setSelectedItems] = useState<Record<string, TranscriptSelectionItem>>({})
  const [isDeletingSelection, setIsDeletingSelection] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  const refresh = async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const nextRecords = await window.electronAPI.listAllTranscripts()
      setRecords(nextRecords)
      setSelectedItems((current) => {
        const validKeys = new Set(
          nextRecords.flatMap((record) => record.summaries.map((item) => makeSelectionKey(record.projectId, item.id)))
        )
        return Object.fromEntries(
          Object.entries(current).filter(([key]) => validKeys.has(key))
        )
      })
      await Promise.all(nextRecords.map((item) => loadProjectTranscripts(item.projectId)))
    } catch (error) {
      console.error('[SettingsTranscriptPanel] failed to load transcripts:', error)
      setLoadError(error instanceof Error ? error.message : 'Failed to load transcripts')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const filteredQuery = searchQuery.trim().toLowerCase()

  const groups = useMemo<TranscriptProjectGroup[]>(() => {
    const projectMeta = buildProjectMeta(projects, removedProjects)
    return records
      .map((record) => {
        const meta = projectMeta.get(record.projectId)
        return {
          projectId: record.projectId,
          projectName: meta?.projectName || `Project ${record.projectId}`,
          projectPath: meta?.projectPath || '',
          isArchivedProject: meta?.isArchivedProject ?? true,
          summaries: sortSummaries(record.summaries),
        }
      })
      .map((group) => {
        if (!filteredQuery) return group
        const projectMatches = [
          group.projectName,
          group.projectPath,
          group.projectId,
        ].some((value) => value.toLowerCase().includes(filteredQuery))
        return {
          ...group,
          summaries: projectMatches
            ? group.summaries
            : group.summaries.filter((item) => (
              item.title.toLowerCase().includes(filteredQuery)
              || item.id.toLowerCase().includes(filteredQuery)
              || formatSourceTypeLabel(item.sourceType).toLowerCase().includes(filteredQuery)
            )),
        }
      })
      .filter((group) => group.summaries.length > 0)
      .sort((a, b) => {
        const aUpdatedAt = a.summaries[0]?.updatedAt ?? 0
        const bUpdatedAt = b.summaries[0]?.updatedAt ?? 0
        return bUpdatedAt - aUpdatedAt
      })
  }, [filteredQuery, projects, records, removedProjects])

  const totalCount = useMemo(
    () => groups.reduce((sum, group) => sum + group.summaries.length, 0),
    [groups]
  )

  const visibleSelectionKeys = useMemo(
    () => groups.flatMap((group) => group.summaries.map((item) => makeSelectionKey(group.projectId, item.id))),
    [groups]
  )

  const selectedCount = Object.keys(selectedItems).length

  const allVisibleSelected = visibleSelectionKeys.length > 0 && visibleSelectionKeys.every((key) => Boolean(selectedItems[key]))
  const someVisibleSelected = visibleSelectionKeys.some((key) => Boolean(selectedItems[key]))

  const selectionSummary = useMemo(
    () => Object.values(selectedItems),
    [selectedItems]
  )

  const isProjectExpanded = (projectId: string): boolean => {
    if (filteredQuery) return true
    return expandedProjectIds[projectId] ?? false
  }

  const toggleProjectExpanded = (projectId: string) => {
    setExpandedProjectIds((current) => ({
      ...current,
      [projectId]: !(current[projectId] ?? false),
    }))
  }

  const handleToggleSelect = (
    projectId: string,
    transcriptId: string,
    title: string,
    projectName: string
  ) => {
    const key = makeSelectionKey(projectId, transcriptId)
    setSelectedItems((current) => {
      if (current[key]) {
        const next = { ...current }
        delete next[key]
        return next
      }
      return {
        ...current,
        [key]: { projectId, transcriptId, title, projectName },
      }
    })
  }

  const handleToggleProjectSelect = (group: TranscriptProjectGroup) => {
    const keys = group.summaries.map((item) => makeSelectionKey(group.projectId, item.id))
    const allSelected = keys.every((key) => Boolean(selectedItems[key]))
    setSelectedItems((current) => {
      const next = { ...current }
      if (allSelected) {
        for (const key of keys) delete next[key]
        return next
      }
      for (const item of group.summaries) {
        const key = makeSelectionKey(group.projectId, item.id)
        next[key] = {
          projectId: group.projectId,
          transcriptId: item.id,
          title: item.title,
          projectName: group.projectName,
        }
      }
      return next
    })
  }

  const handleToggleSelectAllVisible = () => {
    setSelectedItems((current) => {
      const next = { ...current }
      if (allVisibleSelected) {
        for (const key of visibleSelectionKeys) {
          delete next[key]
        }
        return next
      }
      for (const group of groups) {
        for (const item of group.summaries) {
          const key = makeSelectionKey(group.projectId, item.id)
          next[key] = {
            projectId: group.projectId,
            transcriptId: item.id,
            title: item.title,
            projectName: group.projectName,
          }
        }
      }
      return next
    })
  }

  const handleOpenTranscript = async (projectId: string, transcriptId: string) => {
    await openTranscript({ projectId, transcriptId, initialMode: 'preview' })
    navigate(`/project/${projectId}/transcript`)
  }

  const handleDeleteSelection = async () => {
    if (selectionSummary.length === 0 || isDeletingSelection) return
    setIsDeletingSelection(true)
    try {
      await Promise.all(
        selectionSummary.map((item) => removeTranscriptSession(item.projectId, item.transcriptId))
      )
      const selectedKeys = new Set(selectionSummary.map((item) => makeSelectionKey(item.projectId, item.transcriptId)))
      setRecords((current) => current
        .map((record) => ({
          ...record,
          summaries: record.summaries.filter((item) => !selectedKeys.has(makeSelectionKey(record.projectId, item.id))),
        }))
        .filter((record) => record.summaries.length > 0))
      setSelectedItems({})
      setConfirmDeleteOpen(false)
    } finally {
      setIsDeletingSelection(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="section-label mb-3">Transcript Library</p>
        <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">Manage All Transcripts</h2>
        <p className="mt-2 mb-6 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
          Projects are collapsed by default. Expand what you need, then select multiple transcript records to delete together.
        </p>
      </div>

      <section
        className="surface-card rounded-[24px] border px-5 py-5"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[color:var(--color-foreground)]">Transcript records</p>
            <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
              {totalCount} saved transcript{totalCount === 1 ? '' : 's'}
              {selectedCount > 0 ? ` · ${selectedCount} selected` : ''}
            </p>
          </div>
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative min-w-0 md:w-[360px]">
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search by title, source, project, or transcript id"
                className="h-11 min-w-0 pr-10"
              />
              <button
                type="button"
                className={`absolute right-3 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-opacity ${
                  searchQuery
                    ? 'hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
                    : 'pointer-events-none opacity-0'
                }`}
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                title="Clear search"
                tabIndex={searchQuery ? 0 : -1}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-11 px-4"
              onClick={() => void refresh()}
              disabled={isLoading}
            >
              <RefreshCw className={isLoading ? 'animate-spin' : ''} />
              {isLoading ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
        </div>

        {loadError ? (
          <div
            className="mt-5 rounded-[20px] border px-4 py-4 text-sm"
            style={{
              borderColor: 'var(--color-destructive)',
              background: 'var(--color-destructive-background)',
              color: 'var(--color-destructive)',
            }}
          >
            {loadError}
          </div>
        ) : null}

        {!loadError && totalCount > 0 ? (
          <div
            className="mt-5 flex flex-col gap-3 rounded-[20px] border px-4 py-4 md:flex-row md:items-center md:justify-between"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <label className="flex items-center gap-3 text-sm text-[color:var(--color-foreground)]">
              <input
                type="checkbox"
                className="checkbox"
                checked={allVisibleSelected}
                ref={(node) => {
                  if (node) node.indeterminate = !allVisibleSelected && someVisibleSelected
                }}
                onChange={handleToggleSelectAllVisible}
              />
              Select all visible transcripts
            </label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-9 px-3.5"
                onClick={() => setSelectedItems({})}
                disabled={selectedCount === 0}
              >
                Clear
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="h-9 px-3.5"
                onClick={() => setConfirmDeleteOpen(true)}
                disabled={selectedCount === 0}
              >
                <Trash2 className="h-4 w-4" />
                Delete Selected
              </Button>
            </div>
          </div>
        ) : null}

        {!loadError && totalCount === 0 && !isLoading ? (
          <div
            className="mt-5 rounded-[20px] border px-5 py-10 text-center"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--color-accent)] text-[color:var(--color-muted-foreground)]">
              <FileText className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <p className="mt-4 text-sm font-medium text-[color:var(--color-foreground)]">No transcripts yet</p>
            <p className="mt-2 text-sm text-[color:var(--color-muted-foreground)]">
              Imported transcript records will appear here after they are saved.
            </p>
          </div>
        ) : null}

        {totalCount > 0 ? (
          <div className="mt-5 space-y-4">
            {groups.map((group) => {
              const expanded = isProjectExpanded(group.projectId)
              const groupKeys = group.summaries.map((item) => makeSelectionKey(group.projectId, item.id))
              const allGroupSelected = groupKeys.length > 0 && groupKeys.every((key) => Boolean(selectedItems[key]))
              const someGroupSelected = groupKeys.some((key) => Boolean(selectedItems[key]))
              return (
                <section
                  key={group.projectId}
                  className="rounded-[22px] border"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  <div className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-start md:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <input
                        type="checkbox"
                        className="checkbox mt-0.5"
                        checked={allGroupSelected}
                        ref={(node) => {
                          if (node) node.indeterminate = !allGroupSelected && someGroupSelected
                        }}
                        onChange={() => handleToggleProjectSelect(group)}
                      />
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-start gap-3 text-left"
                        onClick={() => toggleProjectExpanded(group.projectId)}
                      >
                        <span className="mt-0.5 text-[color:var(--color-muted-foreground)]">
                          {expanded ? <ChevronDown className="h-4 w-4" strokeWidth={1.8} /> : <ChevronRight className="h-4 w-4" strokeWidth={1.8} />}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-medium text-[color:var(--color-foreground)]">
                              {group.projectName}
                            </h3>
                            {group.isArchivedProject ? (
                              <span
                                className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px]"
                                style={{
                                  background: 'var(--color-warning-background)',
                                  color: 'var(--color-warning)',
                                }}
                              >
                                Archived project
                              </span>
                            ) : null}
                          </div>
                          <p
                            className="mt-1 truncate text-xs text-[color:var(--color-muted-foreground)]"
                            title={group.projectPath || group.projectId}
                          >
                            {group.projectPath ? middleTruncatePath(group.projectPath, 34, 28) : group.projectId}
                          </p>
                        </div>
                      </button>
                    </div>
                    <p className="shrink-0 text-xs text-[color:var(--color-muted-foreground)]">
                      {group.summaries.length} record{group.summaries.length === 1 ? '' : 's'}
                    </p>
                  </div>

                  {expanded ? (
                    <div className="space-y-3 border-t px-4 py-4" style={{ borderColor: 'var(--color-border)' }}>
                      {group.summaries.map((item) => {
                        const selectionKey = makeSelectionKey(group.projectId, item.id)
                        const isSelected = Boolean(selectedItems[selectionKey])
                        return (
                          <article
                            key={item.id}
                            className="rounded-[18px] border px-4 py-4"
                            style={{ borderColor: 'var(--color-border)' }}
                          >
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                              <div className="flex min-w-0 flex-1 items-start gap-3">
                                <input
                                  type="checkbox"
                                  className="checkbox mt-0.5"
                                  checked={isSelected}
                                  onChange={() => handleToggleSelect(group.projectId, item.id, item.title, group.projectName)}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-medium text-[color:var(--color-foreground)]">
                                      {item.title}
                                    </p>
                                    <span className="rounded-full bg-[color:var(--color-accent)] px-2.5 py-1 text-[11px] text-[color:var(--color-muted-foreground)]">
                                      {formatSourceTypeLabel(item.sourceType)}
                                    </span>
                                    <span className="rounded-full bg-[color:var(--color-accent)] px-2.5 py-1 text-[11px] text-[color:var(--color-muted-foreground)]">
                                      {item.referenceCount} refs
                                    </span>
                                  </div>
                                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[color:var(--color-muted-foreground)]">
                                    <span>Updated {formatTimestamp(item.updatedAt)}</span>
                                    <span>Created {formatTimestamp(item.createdAt)}</span>
                                    <span title={item.id}>ID {item.id}</span>
                                  </div>
                                </div>
                              </div>

                              <div className="flex shrink-0 flex-wrap items-center gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-9 px-3.5"
                                  onClick={() => void handleOpenTranscript(group.projectId, item.id)}
                                  disabled={group.isArchivedProject}
                                >
                                  <ExternalLink className="h-4 w-4" />
                                  Open
                                </Button>
                              </div>
                            </div>
                            {group.isArchivedProject ? (
                              <p className="mt-3 text-xs text-[color:var(--color-muted-foreground)]">
                                This project is no longer in the workspace. Re-add it before opening this transcript.
                              </p>
                            ) : null}
                          </article>
                        )
                      })}
                    </div>
                  ) : null}
                </section>
              )
            })}
          </div>
        ) : null}
      </section>

      <ModalShell
        open={confirmDeleteOpen}
        onClose={() => {
          if (isDeletingSelection) return
          setConfirmDeleteOpen(false)
        }}
        widthClassName="max-w-[560px]"
        ariaLabel="Delete selected transcripts confirmation"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div
              className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
              style={{
                background: 'var(--color-destructive-background)',
                color: 'var(--color-destructive)',
              }}
            >
              <AlertTriangle className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">
                Delete selected transcripts
              </h3>
              <p className="mt-1 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
                This will permanently remove {selectedCount} transcript record{selectedCount === 1 ? '' : 's'}.
              </p>
            </div>
          </div>

          <div
            className="max-h-64 overflow-y-auto rounded-[18px] border px-4 py-3"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <div className="space-y-2">
              {selectionSummary.map((item) => (
                <div key={makeSelectionKey(item.projectId, item.transcriptId)} className="text-sm">
                  <p className="text-[color:var(--color-foreground)]">{item.title}</p>
                  <p className="text-xs text-[color:var(--color-muted-foreground)]">{item.projectName}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-10 px-4"
              onClick={() => setConfirmDeleteOpen(false)}
              disabled={isDeletingSelection}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-10 px-4"
              onClick={() => void handleDeleteSelection()}
              disabled={isDeletingSelection || selectedCount === 0}
            >
              {isDeletingSelection ? 'Deleting...' : 'Delete'}
            </Button>
          </div>
        </div>
      </ModalShell>
    </div>
  )
}

export { SettingsTranscriptPanel }
