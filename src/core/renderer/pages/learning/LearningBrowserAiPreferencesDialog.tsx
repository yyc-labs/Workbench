import { Save, Settings2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { LearningCategory, LearningNoteSummary, SkillSummary } from '../../../shared/types'
import { ModalShell } from '../../components/ModalShell'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import { Select } from '../../components/ui/select'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { LearningBrowserAiSourceSelector } from './LearningBrowserAiSourceSelector'
import {
  readLearningBrowserAiPreferences,
  saveLearningBrowserAiPreferences,
} from './learningBrowserAiPreferences'

type LearningBrowserAiPreferencesDialogProps = {
  open: boolean
  notes: LearningNoteSummary[]
  skills: SkillSummary[]
  categories: LearningCategory[]
  onClose: () => void
}

export function LearningBrowserAiPreferencesDialog({ open, notes, skills, categories, onClose }: LearningBrowserAiPreferencesDialogProps) {
  const { t } = useI18n()
  const snapshot = useAppStore((state) => state.browserAi)
  const loadBrowserAi = useAppStore((state) => state.loadBrowserAi)
  const saveBrowserAiConfig = useAppStore((state) => state.saveBrowserAiConfig)
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([])
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([])
  const [savePromptByDefault, setSavePromptByDefault] = useState(false)
  const [siteId, setSiteId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const preferences = readLearningBrowserAiPreferences()
    setSelectedSkillIds(preferences.defaultSkillIds.filter((id) => skills.some((skill) => skill.id === id && skill.enabled)))
    setSelectedNoteIds(preferences.defaultNoteIds.filter((id) => notes.some((note) => note.id === id)))
    setSavePromptByDefault(preferences.savePromptByDefault)
    setError(null)
    void loadBrowserAi()
  }, [loadBrowserAi, notes, open, skills])

  useEffect(() => {
    if (!open || !snapshot?.config) return
    setSiteId(snapshot.config.activeSiteId)
  }, [open, snapshot?.config])

  const siteOptions = useMemo(
    () => snapshot?.config.sites.map((site) => ({ value: site.id, label: `${site.name} · ${site.url}` })) ?? [],
    [snapshot?.config.sites],
  )

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      saveLearningBrowserAiPreferences({
        defaultSkillIds: selectedSkillIds,
        defaultNoteIds: selectedNoteIds,
        savePromptByDefault,
      })
      const selectedSite = snapshot?.config.sites.find((site) => site.id === siteId)
      if (snapshot?.config && selectedSite && selectedSite.id !== snapshot.config.activeSiteId) {
        await saveBrowserAiConfig({
          ...snapshot.config,
          activeSiteId: selectedSite.id,
          site: selectedSite.site,
          siteUrl: selectedSite.url,
        })
      }
      onClose()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('learning.browserAi.preferencesSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell open={open} onClose={onClose} widthClassName="max-w-2xl" panelClassName="!p-0 flex max-h-[calc(100vh-3rem)] flex-col overflow-hidden" ariaLabel={t('learning.browserAi.preferencesTitle')}>
      <div className="flex items-start justify-between gap-4 border-b p-5" style={{ borderColor: 'var(--color-border)' }}>
        <div>
          <p className="section-label mb-2"><Settings2 className="mr-1 inline-block h-3.5 w-3.5" />{t('learning.browserAi.preferencesKicker')}</p>
          <h2 className="text-lg font-semibold text-[color:var(--color-foreground)]">{t('learning.browserAi.preferencesTitle')}</h2>
          <p className="mt-1 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('learning.browserAi.preferencesDescription')}</p>
        </div>
        <Button variant="ghost" size="icon" title={t('common.close')} onClick={onClose}><X /></Button>
      </div>
      <div className="min-h-0 space-y-5 overflow-y-auto p-5">
        <section className="space-y-3">
          <div>
            <div className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('learning.browserAi.defaultNotes')}</div>
            <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">{t('learning.browserAi.defaultNotesDescription')}</p>
          </div>
          <LearningBrowserAiSourceSelector
            notes={notes}
            categories={categories}
            selectedNoteIds={selectedNoteIds}
            onSelectedNoteIdsChange={setSelectedNoteIds}
          />
        </section>
        <section className="space-y-3 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
          <div>
            <div className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('learning.skills.defaultSkills')}</div>
            <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">{t('learning.skills.defaultSkillsDescription')}</p>
          </div>
          <div className="space-y-1.5 rounded-[14px] border p-2" style={{ borderColor: 'var(--color-border)' }}>
            {skills.filter((skill) => skill.enabled).map((skill) => {
              const checked = selectedSkillIds.includes(skill.id)
              return <label key={skill.id} className="flex cursor-pointer items-start gap-2 rounded-[10px] px-2.5 py-2 text-xs hover:bg-[color:var(--color-accent)]"><Checkbox checked={checked} onChange={() => setSelectedSkillIds((current) => checked ? current.filter((id) => id !== skill.id) : [...current, skill.id])} /><span className="min-w-0 flex-1"><span className="block truncate text-[color:var(--color-foreground)]">{skill.title}</span><span className="mt-0.5 block truncate text-[color:var(--color-muted-foreground)]">{skill.tags.join(' · ') || skill.excerpt}</span></span></label>
            })}
            {skills.filter((skill) => skill.enabled).length === 0 ? <p className="px-2 py-3 text-xs text-[color:var(--color-muted-foreground)]">{t('learning.skills.empty')}</p> : null}
          </div>
          {selectedSkillIds.length > 1 ? <div className="flex flex-wrap gap-1.5">{selectedSkillIds.map((id, index) => <Button key={id} type="button" variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => { if (index === 0) return; setSelectedSkillIds((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next }) }}>{index + 1}. {skills.find((skill) => skill.id === id)?.title}</Button>)}</div> : null}
        </section>
        <section className="space-y-3 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
          <div>
            <div className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('learning.browserAi.defaultDispatchSettings')}</div>
            <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">{t('learning.browserAi.defaultDispatchSettingsDescription')}</p>
          </div>
          <Select
            ariaLabel={t('learning.browserAi.defaultSite')}
            value={siteId}
            options={siteOptions}
            onChange={setSiteId}
            emptyText={t('learning.browserAi.noConfiguredSites')}
          />
          <label className="flex items-start gap-2 text-sm text-[color:var(--color-foreground)]">
            <Checkbox checked={savePromptByDefault} onChange={(event) => setSavePromptByDefault(event.target.checked)} />
            <span>{t('learning.browserAi.savePromptByDefault')}</span>
          </label>
        </section>
        {error ? <p className="text-sm text-[color:var(--color-destructive)]">{error}</p> : null}
      </div>
      <div className="flex justify-end gap-2 border-t p-4" style={{ borderColor: 'var(--color-border)' }}>
        <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button onClick={() => void handleSave()} loading={saving}><Save />{t('common.save')}</Button>
      </div>
    </ModalShell>
  )
}
