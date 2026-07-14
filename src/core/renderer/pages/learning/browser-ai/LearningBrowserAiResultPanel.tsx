import { Check, Copy, FilePlus2, Plus, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import type { LearningNote } from '../../../../shared/types'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { useI18n } from '../../../i18n'
import { useAppStore } from '../../../stores/appStore'

type LearningBrowserAiResultPanelProps = {
  answer: string
  currentNote: LearningNote | null
  recordId?: string
  onRetry: () => void
  onSaved: (note: LearningNote) => void
}

export function LearningBrowserAiResultPanel({ answer, currentNote, recordId, onRetry, onSaved }: LearningBrowserAiResultPanelProps) {
  const { t } = useI18n()
  const saveBrowserAiResult = useAppStore((state) => state.saveBrowserAiResult)
  const saveBrowserAiTaskRecord = useAppStore((state) => state.saveBrowserAiTaskRecord)
  const [mode, setMode] = useState<'new-note' | 'append-note'>('new-note')
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recordTitle, setRecordTitle] = useState('')
  const [savingRecord, setSavingRecord] = useState(false)
  const [recordSaved, setRecordSaved] = useState(false)

  const copyAnswer = async () => {
    await navigator.clipboard.writeText(answer)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_200)
  }

  const save = async () => {
    if (mode === 'append-note' && !currentNote) return
    setSaving(true)
    setError(null)
    try {
      const note = await saveBrowserAiResult({
        mode,
        noteId: mode === 'append-note' ? currentNote?.id : undefined,
        title: mode === 'new-note' ? title : undefined,
        answer,
      })
      onSaved(note)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('learning.browserAi.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const saveRecord = async () => {
    if (!recordId || !recordTitle.trim()) return
    setSavingRecord(true)
    setError(null)
    try {
      await saveBrowserAiTaskRecord({ recordId, title: recordTitle.trim() })
      setRecordSaved(true)
    } catch (recordError) {
      setError(recordError instanceof Error ? recordError.message : t('learning.browserAi.historyRenameFailed'))
    } finally {
      setSavingRecord(false)
    }
  }

  return (
    <section className="space-y-4 rounded-[18px] border p-4" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('learning.browserAi.result')}</div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void copyAnswer()}>
            {copied ? <Check /> : <Copy />}
            {copied ? t('learning.browserAi.copied') : t('learning.browserAi.copy')}
          </Button>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCcw />
            {t('learning.browserAi.retry')}
          </Button>
        </div>
      </div>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-[14px] bg-[color:var(--color-background)] p-4 text-sm leading-6 text-[color:var(--color-foreground)]">{answer}</pre>
      {recordId ? (
        <div className="space-y-2 rounded-[14px] bg-[color:var(--color-accent)]/45 p-3">
          <div className="text-xs font-medium text-[color:var(--color-foreground)]">{t('learning.browserAi.saveRecord')}</div>
          <div className="flex flex-wrap gap-2">
            <Input
              className="min-w-[220px] flex-1"
              value={recordTitle}
              onChange={(event) => {
                setRecordTitle(event.target.value)
                setRecordSaved(false)
              }}
              placeholder={t('learning.browserAi.recordTitlePlaceholder')}
            />
            <Button variant="outline" onClick={() => void saveRecord()} loading={savingRecord} disabled={!recordTitle.trim() || recordSaved}>
              <FilePlus2 />
              {recordSaved ? t('learning.browserAi.recordSaved') : t('learning.browserAi.saveRecordAction')}
            </Button>
          </div>
        </div>
      ) : null}
      <div className="space-y-3 rounded-[14px] bg-[color:var(--color-accent)]/45 p-3">
        <div className="text-xs font-medium text-[color:var(--color-foreground)]">{t('learning.browserAi.saveResult')}</div>
        <div className="quiet-control inline-flex rounded-full p-1">
          <Button type="button" variant="ghost" size="sm" className={mode === 'new-note' ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm' : 'text-[color:var(--color-muted-foreground)]'} onClick={() => setMode('new-note')} aria-pressed={mode === 'new-note'}>
            <FilePlus2 />
            {t('learning.browserAi.newNote')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={mode === 'append-note' ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm' : 'text-[color:var(--color-muted-foreground)]'}
            onClick={() => setMode('append-note')}
            disabled={!currentNote}
            aria-pressed={mode === 'append-note'}
          >
            <Plus />
            {t('learning.browserAi.appendNote')}
          </Button>
        </div>
        {mode === 'new-note' ? <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t('learning.browserAi.newNoteTitle')} /> : <p className="text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('learning.browserAi.appendPreview', { value: currentNote?.title ?? '' })}</p>}
        <Button onClick={() => void save()} loading={saving} disabled={mode === 'append-note' && !currentNote}>
          <FilePlus2 />
          {t('learning.browserAi.confirmSave')}
        </Button>
        {error ? <p className="text-xs text-[color:var(--color-destructive)]">{error}</p> : null}
      </div>
    </section>
  )
}
