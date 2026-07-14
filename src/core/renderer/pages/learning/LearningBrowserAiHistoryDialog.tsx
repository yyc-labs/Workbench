import { Check, Clipboard, FilePlus2, History, Pencil, Play, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { BrowserAiTaskRecord, BrowserAiTaskRecordStatus, LearningNote } from '../../../shared/types'
import { ModalShell } from '../../components/ModalShell'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Select } from '../../components/ui/select'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { LearningBrowserAiStepTimeline } from './LearningBrowserAiStepTimeline'

type LearningBrowserAiHistoryDialogProps = {
  open: boolean
  currentNote: LearningNote | null
  onClose: () => void
  onReload: (record: BrowserAiTaskRecord) => void
  onSaved: (note: LearningNote) => void
}

const statusOptions: Array<{ value: 'all' | BrowserAiTaskRecordStatus; labelKey: string }> = [
  { value: 'all', labelKey: 'learning.browserAi.historyAllStatuses' },
  { value: 'completed', labelKey: 'learning.browserAi.historyCompleted' },
  { value: 'failed', labelKey: 'learning.browserAi.historyFailed' },
  { value: 'cancelled', labelKey: 'learning.browserAi.historyCancelled' },
]

export function LearningBrowserAiHistoryDialog({ open, currentNote, onClose, onReload, onSaved }: LearningBrowserAiHistoryDialogProps) {
  const { t, formatDateTime } = useI18n()
  const records = useAppStore((state) => state.browserAiTaskRecords)
  const selectedRecord = useAppStore((state) => state.browserAiTaskRecord)
  const loadRecords = useAppStore((state) => state.loadBrowserAiTaskRecords)
  const loadRecord = useAppStore((state) => state.loadBrowserAiTaskRecord)
  const saveRecord = useAppStore((state) => state.saveBrowserAiTaskRecord)
  const deleteRecord = useAppStore((state) => state.deleteBrowserAiTaskRecord)
  const saveResult = useAppStore((state) => state.saveBrowserAiResult)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | BrowserAiTaskRecordStatus>('all')
  const [sort, setSort] = useState<'updated' | 'created'>('updated')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [savingTitle, setSavingTitle] = useState(false)
  const [copied, setCopied] = useState(false)
  const [savingNote, setSavingNote] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return records
      .filter((record) => status === 'all' || record.status === status)
      .filter((record) => !normalizedQuery || [record.title, record.siteName, record.sourceLabels.join(' '), record.answerExcerpt].join(' ').toLowerCase().includes(normalizedQuery))
      .slice()
      .sort((left, right) => (sort === 'created' ? right.createdAt - left.createdAt : right.updatedAt - left.updatedAt))
  }, [query, records, sort, status])

  useEffect(() => {
    if (!open) return
    setError(null)
    void loadRecords().then((nextRecords) => {
      const nextId = selectedId && nextRecords.some((record) => record.id === selectedId)
        ? selectedId
        : nextRecords[0]?.id ?? null
      setSelectedId(nextId)
      if (nextId) void loadRecord(nextId)
    })
  }, [loadRecord, loadRecords, open])

  useEffect(() => {
    if (!selectedRecord || selectedRecord.id !== selectedId) return
    setTitle(selectedRecord.title)
  }, [selectedId, selectedRecord])

  const selectRecord = (recordId: string) => {
    setSelectedId(recordId)
    setError(null)
    void loadRecord(recordId)
  }

  const handleRename = async () => {
    if (!selectedRecord || !title.trim()) return
    setSavingTitle(true)
    setError(null)
    try {
      await saveRecord({ recordId: selectedRecord.id, title: title.trim() })
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : t('learning.browserAi.historyRenameFailed'))
    } finally {
      setSavingTitle(false)
    }
  }

  const handleDelete = () => {
    if (!selectedRecord) return
    setDeleteConfirmOpen(true)
  }

  const confirmDelete = async () => {
    if (!selectedRecord) return
    setDeleting(true)
    setError(null)
    try {
      const deleted = await deleteRecord(selectedRecord.id)
      if (!deleted) {
        setError(t('learning.browserAi.historyDeleteFailed'))
        return
      }
      const next = filteredRecords.find((record) => record.id !== selectedRecord.id)
      setDeleteConfirmOpen(false)
      setSelectedId(next?.id ?? null)
      if (next) void loadRecord(next.id)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t('learning.browserAi.historyDeleteFailed'))
    } finally {
      setDeleting(false)
    }
  }

  const handleCopy = async () => {
    if (!selectedRecord?.answer) return
    await navigator.clipboard.writeText(selectedRecord.answer)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_200)
  }

  const handleSaveNote = async (mode: 'new-note' | 'append-note') => {
    if (!selectedRecord?.answer || (mode === 'append-note' && !currentNote)) return
    setSavingNote(true)
    setError(null)
    try {
      const note = await saveResult({
        mode,
        noteId: mode === 'append-note' ? currentNote?.id : undefined,
        title: mode === 'new-note' ? selectedRecord.title : undefined,
        answer: selectedRecord.answer,
      })
      onSaved(note)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('learning.browserAi.saveFailed'))
    } finally {
      setSavingNote(false)
    }
  }

  return (
    <>
      <ModalShell open={open} onClose={onClose} widthClassName="max-w-5xl" panelClassName="!p-0 flex max-h-[calc(100vh-3rem)] flex-col overflow-hidden" ariaLabel={t('learning.browserAi.historyTitle')}>
      <div className="flex items-start justify-between gap-4 border-b p-5" style={{ borderColor: 'var(--color-border)' }}>
        <div>
          <p className="section-label mb-2">{t('learning.browserAi.kicker')}</p>
          <h2 className="text-lg font-semibold text-[color:var(--color-foreground)]">{t('learning.browserAi.historyTitle')}</h2>
          <p className="mt-1 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('learning.browserAi.historyDescription')}</p>
        </div>
        <Button variant="ghost" size="icon" title={t('common.close')} onClick={onClose}><X /></Button>
      </div>
      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-5 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.6fr)]">
        <section className="flex min-h-0 flex-col gap-3 rounded-[16px] border p-3" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex flex-wrap gap-2">
            <Input className="h-9 min-w-0 flex-1 text-xs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('learning.browserAi.historySearchPlaceholder')} />
            <Select
              ariaLabel={t('learning.browserAi.historyStatusFilter')}
              className="min-w-[140px] flex-1"
              value={status}
              options={statusOptions.map((option) => ({ value: option.value, label: t(option.labelKey as never) }))}
              onChange={(value) => setStatus(value as 'all' | BrowserAiTaskRecordStatus)}
            />
          </div>
          <Select
            ariaLabel={t('learning.browserAi.historySort')}
            value={sort}
            options={[
              { value: 'updated', label: t('learning.browserAi.historySortUpdated') },
              { value: 'created', label: t('learning.browserAi.historySortCreated') },
            ]}
            onChange={(value) => setSort(value as 'updated' | 'created')}
          />
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {filteredRecords.length > 0 ? filteredRecords.map((record) => (
              <button key={record.id} type="button" className={`w-full rounded-[11px] px-3 py-2.5 text-left transition-colors ${selectedId === record.id ? 'bg-[color:var(--color-primary)]/10' : 'hover:bg-[color:var(--color-accent)]'}`} onClick={() => selectRecord(record.id)}>
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate text-xs font-medium text-[color:var(--color-foreground)]">{record.title}</span>
                  <span className="shrink-0 text-[10px] text-[color:var(--color-muted-foreground)]">{formatDateTime(record.updatedAt)}</span>
                </div>
                <div className="mt-1 truncate text-[11px] text-[color:var(--color-muted-foreground)]">{record.answerExcerpt || t(`learning.browserAi.historyStatus.${record.status}` as never)}</div>
              </button>
            )) : <p className="px-2 py-8 text-center text-xs text-[color:var(--color-muted-foreground)]">{t('learning.browserAi.historyEmpty')}</p>}
          </div>
        </section>

        <section className="min-h-0 overflow-y-auto rounded-[16px] border p-4" style={{ borderColor: 'var(--color-border)' }}>
          {selectedRecord ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input className="h-9 min-w-[220px] flex-1 text-sm font-semibold" value={title} onChange={(event) => setTitle(event.target.value)} />
                    <Button variant="outline" size="sm" onClick={() => void handleRename()} loading={savingTitle} disabled={!title.trim() || title.trim() === selectedRecord.title}><Pencil />{t('learning.browserAi.historyRename')}</Button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[color:var(--color-muted-foreground)]">
                    <span>{selectedRecord.site.name}</span><span>{selectedRecord.site.url}</span><span>{formatDateTime(selectedRecord.startedAt)}</span>
                  </div>
                </div>
                <Button variant="ghost" size="icon" title={t('learning.browserAi.historyDelete')} onClick={() => void handleDelete()}><Trash2 /></Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selectedRecord.sources.filter((source) => source.included).map((source) => <span key={`${source.kind}-${source.label}`} className="rounded-full bg-[color:var(--color-accent)] px-2.5 py-1 text-[11px] text-[color:var(--color-foreground)]">{source.label} · {source.characterCount}</span>)}
              </div>
              <div className="rounded-[12px] bg-[color:var(--color-accent)]/45 px-3 py-2 text-xs text-[color:var(--color-foreground)]">
                {t(`learning.browserAi.historyStatus.${selectedRecord.status}` as never)}{selectedRecord.errorMessage ? ` · ${selectedRecord.errorMessage}` : ''}
              </div>
              <LearningBrowserAiStepTimeline steps={selectedRecord.steps} />
              {selectedRecord.answer ? <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-[12px] bg-[color:var(--color-background)] p-4 text-sm leading-6 text-[color:var(--color-foreground)]">{selectedRecord.answer}</pre> : null}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => onReload(selectedRecord)}><Play />{t('learning.browserAi.historyReload')}</Button>
                {selectedRecord.answer ? <Button variant="outline" size="sm" onClick={() => void handleCopy()}>{copied ? <Check /> : <Clipboard />}{copied ? t('learning.browserAi.copied') : t('learning.browserAi.copy')}</Button> : null}
                {selectedRecord.answer ? <Button variant="outline" size="sm" loading={savingNote} onClick={() => void handleSaveNote('new-note')}><FilePlus2 />{t('learning.browserAi.historySaveNewNote')}</Button> : null}
                {selectedRecord.answer && currentNote ? <Button variant="outline" size="sm" loading={savingNote} onClick={() => void handleSaveNote('append-note')}><FilePlus2 />{t('learning.browserAi.historyAppendNote')}</Button> : null}
              </div>
              {error ? <p className="text-xs text-[color:var(--color-destructive)]">{error}</p> : null}
            </div>
          ) : <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 text-center text-sm text-[color:var(--color-muted-foreground)]"><History className="h-6 w-6" />{t('learning.browserAi.historySelectRecord')}</div>}
        </section>
      </div>
      </ModalShell>
      <ModalShell
        open={deleteConfirmOpen}
        onClose={() => { if (!deleting) setDeleteConfirmOpen(false) }}
        widthClassName="max-w-md"
        baseZIndex={1100}
        ariaLabel={t('learning.browserAi.historyDeleteTitle')}
      >
        <div className="space-y-4">
          <div>
            <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">{t('learning.browserAi.historyDeleteTitle')}</h3>
            <p className="mt-2 text-sm leading-5 text-[color:var(--color-muted-foreground)]">
              {t('learning.browserAi.historyDeleteDescription', { value: selectedRecord?.title ?? '' })}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteConfirmOpen(false)} disabled={deleting}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} loading={deleting}><Trash2 />{t('learning.browserAi.historyDeleteAction')}</Button>
          </div>
        </div>
      </ModalShell>
    </>
  )
}
