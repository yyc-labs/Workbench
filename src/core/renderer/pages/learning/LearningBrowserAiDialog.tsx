import { ExternalLink, Loader2, Send, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  BrowserAiContextPreview,
  BrowserAiContextSource,
  BrowserAiTaskStatus,
  LearningNote,
  LearningNoteSummary,
} from '../../../shared/types'
import { ModalShell } from '../../components/ModalShell'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import { Input } from '../../components/ui/input'
import { Textarea } from '../../components/ui/textarea'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { LearningBrowserAiContextPreview } from './LearningBrowserAiContextPreview'
import { LearningBrowserAiResultPanel } from './LearningBrowserAiResultPanel'

type LearningBrowserAiDialogProps = {
  open: boolean
  notes: LearningNoteSummary[]
  currentNote: LearningNote | null
  onClose: () => void
  onSaved: (note: LearningNote) => void
}

function progressKey(status: BrowserAiTaskStatus | undefined): string {
  return status ? `learning.browserAi.status.${status}` : 'learning.browserAi.status.idle'
}

export function LearningBrowserAiDialog({ open, notes, currentNote, onClose, onSaved }: LearningBrowserAiDialogProps) {
  const { t } = useI18n()
  const snapshot = useAppStore((state) => state.browserAi)
  const progress = useAppStore((state) => state.browserAiProgress)
  const composePreview = useAppStore((state) => state.composeBrowserAiPreview)
  const runTask = useAppStore((state) => state.runBrowserAiTask)
  const cancelTask = useAppStore((state) => state.cancelBrowserAiTask)
  const openLogin = useAppStore((state) => state.openBrowserAiLogin)
  const loadBrowserAi = useAppStore((state) => state.loadBrowserAi)
  const [skill, setSkill] = useState('')
  const [includeSkill, setIncludeSkill] = useState(false)
  const [personalContext, setPersonalContext] = useState('')
  const [includePersonalContext, setIncludePersonalContext] = useState(false)
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([])
  const [task, setTask] = useState('')
  const [responseFormat, setResponseFormat] = useState('')
  const [preview, setPreview] = useState<BrowserAiContextPreview | null>(null)
  const [answer, setAnswer] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    void loadBrowserAi()
    setSelectedNoteIds(currentNote ? [currentNote.id] : [])
    setTask('')
    setPreview(null)
    setAnswer(null)
    setError(null)
  }, [currentNote, loadBrowserAi, open])

  const selectedNotes = useMemo(
    () => notes.filter((note) => selectedNoteIds.includes(note.id)),
    [notes, selectedNoteIds],
  )
  const browserAiConfig = snapshot?.config
  const activeSite = browserAiConfig?.sites.find((site) => site.id === browserAiConfig.activeSiteId)
    ?? browserAiConfig?.sites[0]
  const targetSite = activeSite
    ? activeSite.url ? `${activeSite.name} - ${activeSite.url}` : activeSite.name
    : snapshot?.config.siteUrl ?? t('learning.browserAi.notConfigured')

  if (!open) return null

  const buildSources = async (): Promise<BrowserAiContextSource[]> => {
    const noteContents = await Promise.all(selectedNotes.map(async (note) => ({
      note,
      content: note.id === currentNote?.id && currentNote ? currentNote.contentMd : (await window.electronAPI.getLearningNote(note.id))?.contentMd ?? '',
    })))
    return [
      ...(includeSkill ? [{ kind: 'skill' as const, label: t('learning.browserAi.skillSource'), content: skill, included: true }] : []),
      ...(includePersonalContext ? [{ kind: 'personal-context' as const, label: t('learning.browserAi.personalSource'), content: personalContext, included: true }] : []),
      ...noteContents.map(({ note, content }) => ({ kind: 'learning-note' as const, label: note.title, content, included: true })),
    ]
  }

  const preparePreview = async (): Promise<BrowserAiContextPreview | null> => {
    if (!task.trim()) {
      setPreview(null)
      setError(t('learning.browserAi.taskRequired'))
      return null
    }
    setLoading(true)
    setError(null)
    try {
      const nextPreview = await composePreview({
        site: snapshot?.config.site ?? 'generic-web',
        task,
        responseFormat,
        sources: await buildSources(),
      })
      setPreview(nextPreview)
      return nextPreview
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : t('learning.browserAi.previewFailed'))
      return null
    } finally {
      setLoading(false)
    }
  }

  const handleRun = async () => {
    const nextPreview = preview ?? await preparePreview()
    if (!nextPreview) return
    setLoading(true)
    setError(null)
    try {
      const result = await runTask({
        site: snapshot?.config.site ?? 'generic-web',
        task,
        responseFormat,
        sources: await buildSources(),
      })
      if (result.status === 'completed') setAnswer(result.answer ?? '')
      else setError(result.errorMessage ?? t('learning.browserAi.runFailed'))
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : t('learning.browserAi.runFailed'))
    } finally {
      setLoading(false)
    }
  }

  const taskStatus = progress && progress.taskId === snapshot?.activeTaskId ? progress.status : snapshot?.taskStatus
  const isRunning = taskStatus === 'starting' || taskStatus === 'connecting' || taskStatus === 'opening-page' || taskStatus === 'sending' || taskStatus === 'waiting-response'

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      widthClassName="max-w-4xl"
      panelClassName="!p-0 flex max-h-[calc(100vh-3rem)] flex-col overflow-hidden"
      ariaLabel={t('learning.browserAi.dialogTitle')}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-4 border-b p-5" style={{ borderColor: 'var(--color-border)' }}>
          <div><p className="section-label mb-2">{t('learning.browserAi.kicker')}</p><h2 className="text-lg font-semibold text-[color:var(--color-foreground)]">{t('learning.browserAi.dialogTitle')}</h2><p className="mt-1 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('learning.browserAi.dialogDescription')}</p></div>
          <Button variant="ghost" size="icon" title={t('common.close')} onClick={onClose}><X /></Button>
        </div>
        <div className="min-h-0 space-y-4 overflow-y-auto p-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="space-y-3 rounded-[18px] border p-4" style={{ borderColor: 'var(--color-border)' }}>
              <div className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('learning.browserAi.sources')}</div>
              <label className="flex items-start gap-2 text-sm text-[color:var(--color-foreground)]"><Checkbox checked={includeSkill} onChange={(event) => setIncludeSkill(event.target.checked)} /><span>{t('learning.browserAi.includeSkill')}</span></label>
              {includeSkill ? <Textarea className="text-xs leading-5" value={skill} onChange={(event) => setSkill(event.target.value)} placeholder={t('learning.browserAi.skillPlaceholder')} /> : null}
              <label className="flex items-start gap-2 text-sm text-[color:var(--color-foreground)]"><Checkbox checked={includePersonalContext} onChange={(event) => setIncludePersonalContext(event.target.checked)} /><span>{t('learning.browserAi.includePersonal')}</span></label>
              {includePersonalContext ? <Textarea className="text-xs leading-5" value={personalContext} onChange={(event) => setPersonalContext(event.target.value)} placeholder={t('learning.browserAi.personalPlaceholder')} /> : null}
              <div className="border-t pt-3" style={{ borderColor: 'var(--color-border)' }}><div className="mb-2 text-xs font-medium text-[color:var(--color-foreground)]">{t('learning.browserAi.learningNotes')}</div><div className="max-h-36 space-y-2 overflow-y-auto">{notes.map((note) => <label key={note.id} className="flex items-start gap-2 text-xs text-[color:var(--color-foreground)]"><Checkbox checked={selectedNoteIds.includes(note.id)} onChange={(event) => setSelectedNoteIds((current) => event.target.checked ? [...current, note.id] : current.filter((id) => id !== note.id))} /><span className="min-w-0"><span className="block truncate">{note.title}</span><span className="block truncate text-[color:var(--color-muted-foreground)]">{note.excerpt || t('learning.browserAi.emptyExcerpt')}</span></span></label>)}</div></div>
            </section>
            <section className="space-y-3 rounded-[18px] border p-4" style={{ borderColor: 'var(--color-border)' }}>
              <div className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('learning.browserAi.task')}</div>
              <Textarea className="min-h-32" value={task} onChange={(event) => { setTask(event.target.value); setPreview(null) }} placeholder={t('learning.browserAi.taskPlaceholder')} />
              <Input value={responseFormat} onChange={(event) => { setResponseFormat(event.target.value); setPreview(null) }} placeholder={t('learning.browserAi.responseFormatPlaceholder')} />
              <div className="flex flex-wrap items-center gap-2"><Button variant="outline" onClick={() => void preparePreview()} loading={loading && !isRunning} disabled={!task.trim()}><ExternalLink />{t('learning.browserAi.previewAction')}</Button><span className="break-all text-xs text-[color:var(--color-muted-foreground)]">{t('learning.browserAi.targetSite', { value: targetSite })}</span></div>
            </section>
          </div>

          <LearningBrowserAiContextPreview preview={preview} />

          {isRunning ? <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-[color:var(--color-accent)]/45 px-4 py-3 text-sm text-[color:var(--color-foreground)]"><Loader2 className="h-4 w-4 animate-spin" />{t(progressKey(taskStatus))}<Button variant="outline" size="sm" onClick={() => void cancelTask()}>{t('learning.browserAi.cancel')}</Button></div> : null}
          {snapshot?.connection === 'needs-login' ? <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-[color:var(--color-accent)]/45 px-4 py-3 text-sm text-[color:var(--color-foreground)]">{t('learning.browserAi.loginRequired')}<Button variant="outline" size="sm" onClick={() => void openLogin()}>{t('learning.browserAi.openLogin')}</Button></div> : null}
          {error ? <p className="text-sm text-[color:var(--color-destructive)]">{error}</p> : null}

          {answer ? <LearningBrowserAiResultPanel answer={answer} currentNote={currentNote} onRetry={() => { setAnswer(null); void handleRun() }} onSaved={onSaved} /> : null}
        </div>
        <div className="flex justify-end gap-2 border-t p-4" style={{ borderColor: 'var(--color-border)' }}><Button variant="ghost" onClick={onClose}>{t('common.close')}</Button><Button onClick={() => void handleRun()} loading={loading} disabled={isRunning || !task.trim()}><Send />{t('learning.browserAi.send')}</Button></div>
      </div>
    </ModalShell>
  )
}
