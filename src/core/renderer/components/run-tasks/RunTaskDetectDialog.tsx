import { useEffect, useMemo, useState } from 'react'
import { FolderOpen, Loader2, Save, X } from 'lucide-react'
import { ModalShell } from '../ModalShell'
import { useI18n } from '../../i18n'
import { toProjectRelativeDirectory } from '../../lib/projectPaths'
import { useAppStore } from '../../stores/appStore'
import type { ProjectInfo } from '../../../shared/types'
import type { RunTask, RunTaskCandidate, RunTaskCandidateSource } from '../../../shared/runTasks'
import { groupCandidatesBySource } from './runTasks.helpers'

type RunTaskDetectDialogProps = {
  project: ProjectInfo
  open: boolean
  existingTasks: RunTask[]
  /** Persisted scan directories from the config file. */
  initialScanDirectories?: string[]
  baseZIndex?: number
  onClose: () => void
  /** Saves selected tasks together with the current scan directories. */
  onSave: (tasks: RunTask[], scanDirectories?: string[]) => Promise<void>
}

const SOURCE_LABEL_KEYS: Record<RunTaskCandidateSource, string> = {
  'package-script': 'runTasks.source.packageScript',
  'docker-compose': 'runTasks.source.dockerCompose',
  workspace: 'runTasks.source.workspace',
  'common-dir': 'runTasks.source.commonDir',
}

export function RunTaskDetectDialog({ project, open, existingTasks, initialScanDirectories, baseZIndex, onClose, onSave }: RunTaskDetectDialogProps) {
  const { t } = useI18n()
  const detectRunTaskCandidates = useAppStore((s) => s.detectRunTaskCandidates)
  const [scanDirectories, setScanDirectories] = useState<string[]>([])
  const [candidates, setCandidates] = useState<RunTaskCandidate[] | null>(null)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setScanDirectories(initialScanDirectories ? [...initialScanDirectories] : [])
    setSelectedKeys(new Set())
  }, [open, initialScanDirectories])

  useEffect(() => {
    if (!open) return
    setCandidates(null)
    let cancelled = false
    void detectRunTaskCandidates(project.path, scanDirectories)
      .then((found) => {
        if (cancelled) return
        setCandidates(found)
        // Preselect nothing by default — the user confirms explicitly.
      })
      .catch(() => {
        if (!cancelled) setCandidates([])
      })
    return () => {
      cancelled = true
    }
  }, [open, project.path, scanDirectories, detectRunTaskCandidates])

  const grouped = useMemo(() => groupCandidatesBySource(candidates ?? []), [candidates])
  const existingKeys = useMemo(() => new Set(existingTasks.map((task) => `${task.cwd ?? ''}::${task.command}`)), [existingTasks])

  const selectedCandidates = useMemo(() => (candidates ?? []).filter((candidate) => selectedKeys.has(candidate.key)), [candidates, selectedKeys])

  const toggleCandidate = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleAddScanDirectory = async () => {
    setError(null)
    try {
      const selectedPath = await window.electronAPI.selectDirectory(project.path)
      if (!selectedPath) return
      const relative = toProjectRelativeDirectory(project.path, selectedPath)
      if (!relative) return
      setScanDirectories((prev) => (prev.includes(relative) ? prev : [...prev, relative]))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const usedIds = new Set(existingTasks.map((task) => task.id))
      const newTasks: RunTask[] = selectedCandidates.map((candidate, index) => {
        const baseId = slugify(candidate.name) || `task-${index + 1}`
        let id = baseId
        let suffix = 2
        while (usedIds.has(id)) {
          id = `${baseId}-${suffix}`
          suffix += 1
        }
        usedIds.add(id)
        return {
          id,
          name: candidate.name,
          command: candidate.command,
          cwd: candidate.cwd,
          readiness: candidate.suggestedReadiness,
        }
      })
      await onSave([...existingTasks, ...newTasks], scanDirectories)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell open={open} onClose={onClose} widthClassName="max-w-[640px]" baseZIndex={baseZIndex} ariaLabel={t('runTasks.detectDialog.title')} panelClassName="h-[min(640px,calc(100vh-140px))] overflow-hidden p-0">
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b border-[color:var(--color-border)] px-5 py-4">
          <h2 className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('runTasks.detectDialog.title')}</h2>
          <p className="mt-0.5 text-[11px] text-[color:var(--color-muted-foreground)]">{t('runTasks.detectDialog.hint')}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="text-[11px] font-medium text-[color:var(--color-muted-foreground)]">{t('runTasks.scanDirectories.title')}</p>
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1 rounded-full border border-[color:var(--color-border)] px-2.5 text-[11px] text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                onClick={() => void handleAddScanDirectory()}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                {t('runTasks.scanDirectories.add')}
              </button>
            </div>
            {scanDirectories.length === 0 ? (
              <p className="text-[11px] text-[color:var(--color-muted-foreground)]/80">{t('runTasks.scanDirectories.empty')}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {scanDirectories.map((dir) => (
                  <span key={dir} className="inline-flex max-w-full items-center gap-1 rounded-full border border-[color:var(--color-border)] px-2.5 py-1 font-mono text-[11px] text-[color:var(--color-foreground)]">
                    <span className="truncate" title={dir}>
                      {dir}
                    </span>
                    <button type="button" className="shrink-0 text-[color:var(--color-muted-foreground)] transition-colors hover:text-[color:var(--color-destructive)]" onClick={() => setScanDirectories((prev) => prev.filter((item) => item !== dir))} aria-label={t('runTasks.scanDirectories.remove')}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <p className="mt-1.5 text-[11px] text-[color:var(--color-muted-foreground)]/80">{t('runTasks.scanDirectories.hint')}</p>
          </div>

          {candidates === null ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-[color:var(--color-muted-foreground)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('runTasks.detectDialog.scanning')}
            </div>
          ) : grouped.length === 0 ? (
            <p className="py-10 text-center text-xs text-[color:var(--color-muted-foreground)]">{t('runTasks.detectDialog.noCandidates')}</p>
          ) : (
            <div className="flex flex-col gap-4">
              {grouped.map(({ source, items }) => (
                <div key={source}>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[color:var(--color-muted-foreground)]">{t(SOURCE_LABEL_KEYS[source])}</p>
                  <ul className="flex flex-col gap-1.5">
                    {items.map((candidate) => {
                      const alreadyConfigured = existingKeys.has(`${candidate.cwd ?? ''}::${candidate.command}`)
                      return (
                        <li key={candidate.key}>
                          <label className="surface-card-hover flex cursor-pointer items-start gap-2.5 rounded-xl px-3 py-2.5">
                            <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-[color:var(--color-primary)]" checked={selectedKeys.has(candidate.key)} onChange={() => toggleCandidate(candidate.key)} />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2">
                                <span className="truncate text-xs font-medium text-[color:var(--color-foreground)]">{candidate.name}</span>
                                {alreadyConfigured && <span className="shrink-0 rounded-full bg-[color:var(--color-accent)] px-2 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">{t('runTasks.detectDialog.configured')}</span>}
                              </span>
                              <span className="mt-0.5 block truncate font-mono text-[11px] text-[color:var(--color-muted-foreground)]" title={candidate.command}>
                                {candidate.command}
                              </span>
                              {candidate.sourceLabel && (
                                <span className="mt-0.5 block truncate text-[10px] text-[color:var(--color-muted-foreground)]/80" title={candidate.sourceLabel}>
                                  {candidate.sourceLabel}
                                </span>
                              )}
                            </span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {error && <p className="mt-3 rounded-xl border border-[color:var(--color-destructive)]/25 bg-[color:var(--color-destructive-background)] px-3 py-2 text-xs text-[color:var(--color-destructive)]">{error}</p>}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[color:var(--color-border)] px-5 py-3">
          <button type="button" className="quiet-control rounded-full px-3 py-1.5 text-xs text-[color:var(--color-foreground)]" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-primary-hover disabled:opacity-50" onClick={() => void handleSave()} disabled={saving || selectedCandidates.length === 0}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {t('runTasks.detectDialog.saveSelected', { count: selectedCandidates.length })}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}
