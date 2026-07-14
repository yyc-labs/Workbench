import { ExternalLink, Send, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  BrowserAiContextPreview,
  BrowserAiContextSource,
  BrowserAiTaskRecord,
  BrowserAiTaskStatus,
  LearningCategory,
  LearningNote,
  LearningNoteSummary,
  SkillSummary,
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
import { LearningBrowserAiSourceSelector } from './LearningBrowserAiSourceSelector'
import { LearningBrowserAiStepTimeline } from './LearningBrowserAiStepTimeline'
import { SkillPickerDialog } from './SkillPickerDialog'
import type { TemporarySkill } from './CreateSkillDialog'
import { readLearningBrowserAiPreferences } from './learningBrowserAiPreferences'

type LearningBrowserAiDialogProps = {
  open: boolean
  notes: LearningNoteSummary[]
  skills: SkillSummary[]
  categories: LearningCategory[]
  currentNote: LearningNote | null
  initialRecord?: BrowserAiTaskRecord | null
  onClose: () => void
  onSaved: (note: LearningNote) => void
}

function progressKey(status: BrowserAiTaskStatus | undefined): string {
  return status ? `learning.browserAi.status.${status}` : 'learning.browserAi.status.idle'
}

export function LearningBrowserAiDialog({
  open,
  notes,
  categories,
  skills,
  currentNote,
  initialRecord,
  onClose,
  onSaved,
}: LearningBrowserAiDialogProps) {
  const { t } = useI18n()
  const snapshot = useAppStore((state) => state.browserAi)
  const progress = useAppStore((state) => state.browserAiProgress)
  const storedSteps = useAppStore((state) => state.browserAiSteps)
  const composePreview = useAppStore((state) => state.composeBrowserAiPreview)
  const runTask = useAppStore((state) => state.runBrowserAiTask)
  const cancelTask = useAppStore((state) => state.cancelBrowserAiTask)
  const openLogin = useAppStore((state) => state.openBrowserAiLogin)
  const loadBrowserAi = useAppStore((state) => state.loadBrowserAi)
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([])
  const [defaultSkillIds, setDefaultSkillIds] = useState<string[]>([])
  const [temporarySkill, setTemporarySkill] = useState<TemporarySkill | null>(null)
  const [skillPickerOpen, setSkillPickerOpen] = useState(false)
  const [personalContext, setPersonalContext] = useState('')
  const [includePersonalContext, setIncludePersonalContext] = useState(false)
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([])
  const [task, setTask] = useState('')
  const [responseFormat, setResponseFormat] = useState('')
  const [savePrompt, setSavePrompt] = useState(false)
  const [preview, setPreview] = useState<BrowserAiContextPreview | null>(null)
  const [answer, setAnswer] = useState<string | null>(null)
  const [recordId, setRecordId] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    void loadBrowserAi()
    const preferences = readLearningBrowserAiPreferences()
    const recordSources = initialRecord?.input.sources ?? []
    const savedSkills = recordSources.filter((source) => source.kind === 'skill')
    const savedPersonal = recordSources.find((source) => source.kind === 'personal-context')
    const savedNoteIds = recordSources
      .filter((source) => source.kind === 'learning-note' && source.referenceId)
      .map((source) => source.referenceId!)
    const savedSkillIds = savedSkills.map((source) => source.referenceId).filter((id): id is string => Boolean(id))
    setDefaultSkillIds(preferences.defaultSkillIds.filter((id) => skills.some((skill) => skill.id === id && skill.enabled)))
    setSelectedSkillIds(initialRecord ? savedSkillIds : preferences.defaultSkillIds.filter((id) => skills.some((skill) => skill.id === id && skill.enabled)))
    const savedTemporarySkill = savedSkills.find((source) => !source.referenceId && source.content)
    setTemporarySkill(savedTemporarySkill ? { id: `history-${Date.now().toString(36)}`, title: savedTemporarySkill.label, contentMd: savedTemporarySkill.content ?? '', tags: [] } : null)
    setPersonalContext(savedPersonal?.content ?? '')
    setIncludePersonalContext(Boolean(savedPersonal?.content))
    const defaultNoteIds = preferences.defaultNoteIds.filter((id) => notes.some((note) => note.id === id))
    setSelectedNoteIds(initialRecord
      ? savedNoteIds
      : defaultNoteIds.length > 0
        ? defaultNoteIds
        : currentNote ? [currentNote.id] : [])
    setTask(initialRecord?.input.task ?? '')
    setResponseFormat(initialRecord?.input.responseFormat ?? '')
    setSavePrompt(initialRecord?.input.promptSaved ?? preferences.savePromptByDefault)
    setPreview(null)
    setAnswer(null)
    setRecordId(undefined)
    setError(null)
  }, [currentNote, initialRecord, loadBrowserAi, open])

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
  const steps = progress?.steps?.length ? progress.steps : storedSteps
  const taskStatus = progress && progress.taskId === snapshot?.activeTaskId ? progress.status : snapshot?.taskStatus
  const isRunning = taskStatus === 'starting' || taskStatus === 'connecting' || taskStatus === 'opening-page' || taskStatus === 'sending' || taskStatus === 'waiting-response'
  const hasPotentialSource = Boolean(
    selectedSkillIds.length > 0
    || Boolean(temporarySkill?.contentMd.trim())
    || (includePersonalContext && personalContext.trim())
    || selectedNoteIds.length > 0,
  )
  const canPrepare = Boolean(task.trim() || hasPotentialSource)

  if (!open) return null

  const buildSources = async (): Promise<BrowserAiContextSource[]> => {
    const skillContents = await Promise.all(selectedSkillIds.map(async (skillId) => {
      const summary = skills.find((skill) => skill.id === skillId)
      if (!summary || !summary.enabled) return null
      const skill = await window.electronAPI.getSkill(skillId)
      return skill ? { kind: 'skill' as const, label: skill.title, referenceId: skill.id, content: skill.contentMd, included: true } : null
    }))
    const noteContents = await Promise.all(selectedNotes.map(async (note) => ({
      note,
      content: note.id === currentNote?.id && currentNote
        ? currentNote.contentMd
        : (await window.electronAPI.getLearningNote(note.id))?.contentMd ?? '',
    })))
    return [
      ...skillContents.filter((source): source is NonNullable<typeof source> => Boolean(source)),
      ...(temporarySkill?.contentMd.trim() ? [{ kind: 'skill' as const, label: temporarySkill.title, content: temporarySkill.contentMd, included: true }] : []),
      ...(includePersonalContext ? [{ kind: 'personal-context' as const, label: t('learning.browserAi.personalSource'), content: personalContext, included: true }] : []),
      ...noteContents.map(({ note, content }) => ({ kind: 'learning-note' as const, label: note.title, referenceId: note.id, content, included: true })),
    ]
  }

  const buildPayload = async () => ({
    site: snapshot?.config.site ?? 'generic-web' as const,
    task: task.trim() || undefined,
    responseFormat: responseFormat.trim() || undefined,
    savePrompt,
    sources: await buildSources(),
  })

  const preparePreview = async (): Promise<BrowserAiContextPreview | null> => {
    if (!canPrepare) {
      setPreview(null)
      setError(t('learning.browserAi.taskOrSourceRequired'))
      return null
    }
    setLoading(true)
    setError(null)
    try {
      const nextPreview = await composePreview(await buildPayload())
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
      const result = await runTask(await buildPayload())
      if (result.status === 'completed') {
        setAnswer(result.answer ?? '')
        setRecordId(result.recordId)
      } else {
        setError(result.errorMessage ?? t('learning.browserAi.runFailed'))
      }
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : t('learning.browserAi.runFailed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
    <ModalShell
      open={open}
      onClose={onClose}
      widthClassName="max-w-4xl"
      panelClassName="!p-0 flex max-h-[calc(100vh-3rem)] flex-col overflow-hidden"
      ariaLabel={t('learning.browserAi.dialogTitle')}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-4 border-b p-5" style={{ borderColor: 'var(--color-border)' }}>
          <div>
            <p className="section-label mb-2">{t('learning.browserAi.kicker')}</p>
            <h2 className="text-lg font-semibold text-[color:var(--color-foreground)]">{t('learning.browserAi.dialogTitle')}</h2>
            <p className="mt-1 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('learning.browserAi.dialogDescription')}</p>
          </div>
          <Button variant="ghost" size="icon" title={t('common.close')} onClick={onClose}><X /></Button>
        </div>
        <div className="min-h-0 space-y-4 overflow-y-auto p-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="space-y-3 rounded-[18px] border p-4" style={{ borderColor: 'var(--color-border)' }}>
              <div className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('learning.browserAi.sources')}</div>
              <div className="rounded-[14px] border p-3" style={{ borderColor: 'var(--color-border)' }}>
                <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-xs font-medium text-[color:var(--color-foreground)]">{t('learning.skills.selectSkill')}</div><div className="mt-1 text-[11px] text-[color:var(--color-muted-foreground)]">{t('learning.skills.selectedCount', { value: String(selectedSkillIds.length + (temporarySkill ? 1 : 0)) })}</div></div><Button type="button" variant="outline" size="sm" onClick={() => setSkillPickerOpen(true)}><ExternalLink />{t('learning.skills.pickerAdd')}</Button></div>
                <div className="mt-2 flex flex-wrap gap-1.5">{selectedSkillIds.map((id) => <span key={id} className="rounded-full bg-[color:var(--color-primary)]/10 px-2.5 py-1 text-[11px] text-[color:var(--color-foreground)]">{skills.find((skill) => skill.id === id)?.title ?? id}{defaultSkillIds.includes(id) ? ` · ${t('learning.skills.sourceDefault')}` : ` · ${t('learning.skills.sourceThisTask')}`}</span>)}{temporarySkill ? <span className="rounded-full bg-[color:var(--color-accent)] px-2.5 py-1 text-[11px] text-[color:var(--color-foreground)]">{temporarySkill.title} · {t('learning.skills.sourceTemporary')}</span> : null}</div>
              </div>
              <label className="flex items-start gap-2 text-sm text-[color:var(--color-foreground)]">
                <Checkbox checked={includePersonalContext} onChange={(event) => { setIncludePersonalContext(event.target.checked); setPreview(null) }} />
                <span>{t('learning.browserAi.includePersonal')}</span>
              </label>
              {includePersonalContext ? <Textarea className="text-xs leading-5" value={personalContext} onChange={(event) => { setPersonalContext(event.target.value); setPreview(null) }} placeholder={t('learning.browserAi.personalPlaceholder')} /> : null}
              <div className="border-t pt-3" style={{ borderColor: 'var(--color-border)' }}>
                <div className="mb-2 text-xs font-medium text-[color:var(--color-foreground)]">{t('learning.browserAi.learningNotes')}</div>
                <LearningBrowserAiSourceSelector
                  notes={notes}
                  categories={categories}
                  selectedNoteIds={selectedNoteIds}
                  onSelectedNoteIdsChange={(ids) => { setSelectedNoteIds(ids); setPreview(null) }}
                />
              </div>
            </section>
            <section className="space-y-3 rounded-[18px] border p-4" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('learning.browserAi.task')}</div>
                <span className="text-[11px] text-[color:var(--color-muted-foreground)]">{t('learning.browserAi.optional')}</span>
              </div>
              <Textarea className="min-h-32" value={task} onChange={(event) => { setTask(event.target.value); setPreview(null) }} placeholder={t('learning.browserAi.taskPlaceholder')} />
              <Input value={responseFormat} onChange={(event) => { setResponseFormat(event.target.value); setPreview(null) }} placeholder={t('learning.browserAi.responseFormatPlaceholder')} />
              <label className="flex items-start gap-2 text-xs leading-5 text-[color:var(--color-muted-foreground)]">
                <Checkbox checked={savePrompt} onChange={(event) => setSavePrompt(event.target.checked)} />
                <span>{t('learning.browserAi.savePrompt')}</span>
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={() => void preparePreview()} loading={loading && !isRunning} disabled={!canPrepare}>
                  <ExternalLink />{t('learning.browserAi.previewAction')}
                </Button>
                <span className="break-all text-xs text-[color:var(--color-muted-foreground)]">{t('learning.browserAi.targetSite', { value: targetSite })}</span>
              </div>
            </section>
          </div>

          <LearningBrowserAiContextPreview preview={preview} />

          {steps.length > 0 ? (
            <section className="space-y-3 rounded-[18px] border p-4" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-[color:var(--color-foreground)]">{t(progressKey(taskStatus))}</div>
                {isRunning ? <Button variant="outline" size="sm" onClick={() => void cancelTask()}>{t('learning.browserAi.cancel')}</Button> : null}
              </div>
              <LearningBrowserAiStepTimeline steps={steps} />
            </section>
          ) : null}
          {snapshot?.connection === 'needs-login' ? <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-[color:var(--color-accent)]/45 px-4 py-3 text-sm text-[color:var(--color-foreground)]">{t('learning.browserAi.loginRequired')}<Button variant="outline" size="sm" onClick={() => void openLogin()}>{t('learning.browserAi.openLogin')}</Button></div> : null}
          {error ? <p className="text-sm text-[color:var(--color-destructive)]">{error}</p> : null}

          {answer ? <LearningBrowserAiResultPanel answer={answer} currentNote={currentNote} recordId={recordId} onRetry={() => { setAnswer(null); void handleRun() }} onSaved={onSaved} /> : null}
        </div>
        <div className="flex justify-end gap-2 border-t p-4" style={{ borderColor: 'var(--color-border)' }}>
          <Button variant="ghost" onClick={onClose}>{t('common.close')}</Button>
          <Button onClick={() => void handleRun()} loading={loading} disabled={isRunning || !canPrepare}><Send />{t('learning.browserAi.send')}</Button>
        </div>
      </div>
    </ModalShell>
    <SkillPickerDialog
      open={skillPickerOpen}
      skills={skills}
      defaultSkillIds={defaultSkillIds}
      selectedSkillIds={selectedSkillIds}
      temporarySkill={temporarySkill}
      onSelectedSkillIdsChange={(ids) => { setSelectedSkillIds(ids); setPreview(null) }}
      onTemporarySkillChange={(skill) => { setTemporarySkill(skill); setPreview(null) }}
      onClose={() => setSkillPickerOpen(false)}
      onApply={() => setSkillPickerOpen(false)}
    />
    </>
  )
}
