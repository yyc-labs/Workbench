import { Check, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Skill, SkillSummary } from '../../../shared/types'
import { ModalShell } from '../../components/ModalShell'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import { Input } from '../../components/ui/input'
import { useI18n } from '../../i18n'
import { CreateSkillDialog, type TemporarySkill } from './CreateSkillDialog'

type SkillPickerDialogProps = {
  open: boolean
  skills: SkillSummary[]
  defaultSkillIds: string[]
  selectedSkillIds: string[]
  temporarySkill: TemporarySkill | null
  onSelectedSkillIdsChange: (ids: string[]) => void
  onTemporarySkillChange: (skill: TemporarySkill | null) => void
  onClose: () => void
  onApply: () => void
}

export function SkillPickerDialog({ open, skills, defaultSkillIds, selectedSkillIds, temporarySkill, onSelectedSkillIdsChange, onTemporarySkillChange, onClose, onApply }: SkillPickerDialogProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [enabledOnly, setEnabledOnly] = useState(true)
  const [defaultsOnly, setDefaultsOnly] = useState(false)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [focusedSkill, setFocusedSkill] = useState<Skill | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setFocusedId(selectedSkillIds[0] ?? skills[0]?.id ?? null)
  }, [open, selectedSkillIds, skills])

  useEffect(() => {
    if (!focusedId) { setFocusedSkill(null); return }
    let active = true
    void window.electronAPI.getSkill(focusedId).then((skill) => { if (active) setFocusedSkill(skill) })
    return () => { active = false }
  }, [focusedId])

  const filteredSkills = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return skills.filter((skill) => (!enabledOnly || skill.enabled) && (!defaultsOnly || defaultSkillIds.includes(skill.id)) && (!normalized || [skill.title, skill.excerpt, ...skill.tags].some((value) => value.toLowerCase().includes(normalized))))
  }, [defaultSkillIds, defaultsOnly, enabledOnly, query, skills])

  const toggleSkill = (skill: SkillSummary) => {
    if (!skill.enabled) return
    onSelectedSkillIdsChange(selectedSkillIds.includes(skill.id) ? selectedSkillIds.filter((id) => id !== skill.id) : [...selectedSkillIds, skill.id])
  }

  const handleCreated = (skill: Skill | null, temporary: TemporarySkill | null) => {
    onTemporarySkillChange(temporary)
    if (skill) onSelectedSkillIdsChange([...selectedSkillIds.filter((id) => id !== skill.id), skill.id])
    setFocusedId(skill?.id ?? null)
  }

  return <>
    <ModalShell open={open} onClose={onClose} widthClassName="max-w-3xl" panelClassName="!p-0 flex max-h-[calc(100vh-3rem)] flex-col overflow-hidden" ariaLabel={t('learning.skills.pickerTitle')}>
      <div className="flex items-start justify-between gap-4 border-b p-5" style={{ borderColor: 'var(--color-border)' }}><div><p className="section-label mb-2">{t('learning.skills.title')}</p><h2 className="text-lg font-semibold text-[color:var(--color-foreground)]">{t('learning.skills.pickerTitle')}</h2><p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">{t('learning.skills.pickerDescription')}</p></div><Button variant="ghost" size="icon" onClick={onClose} title={t('common.close')}><X /></Button></div>
      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-5 md:grid-cols-[minmax(0,1fr)_220px]"><div className="flex min-h-0 flex-col gap-3"><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('learning.skills.pickerSearchPlaceholder')} /><div className="flex flex-wrap gap-3 text-xs text-[color:var(--color-muted-foreground)]"><label className="flex items-center gap-2"><Checkbox checked={enabledOnly} onChange={(event) => setEnabledOnly(event.target.checked)} />{t('learning.skills.pickerEnabledOnly')}</label><label className="flex items-center gap-2"><Checkbox checked={defaultsOnly} onChange={(event) => setDefaultsOnly(event.target.checked)} />{t('learning.skills.pickerDefaultsOnly')}</label></div><div className="min-h-0 flex-1 space-y-1 overflow-y-auto rounded-[14px] border p-1.5" style={{ borderColor: 'var(--color-border)' }}>{filteredSkills.map((skill) => { const selected = selectedSkillIds.includes(skill.id); return <button key={skill.id} type="button" className={`flex w-full items-start gap-2 rounded-[10px] px-2.5 py-2 text-left ${selected ? 'bg-[color:var(--color-primary)]/10' : 'hover:bg-[color:var(--color-accent)]'}`} onClick={() => { setFocusedId(skill.id); toggleSkill(skill) }}><span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected ? 'border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-white' : 'border-[color:var(--color-border)]'}`}>{selected ? <Check className="h-3 w-3" /> : null}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-[color:var(--color-foreground)]">{skill.title}</span><span className="mt-0.5 block line-clamp-2 text-[11px] text-[color:var(--color-muted-foreground)]">{skill.excerpt}</span></span>{defaultSkillIds.includes(skill.id) ? <span className="shrink-0 text-[10px] text-[color:var(--color-primary)]">{t('learning.skills.sourceDefault')}</span> : null}</button> })}{filteredSkills.length === 0 ? <p className="px-3 py-5 text-center text-xs text-[color:var(--color-muted-foreground)]">{t('learning.skills.empty')}</p> : null}</div><Button variant="outline" className="self-start" onClick={() => setCreateOpen(true)}><Plus />{t('learning.skills.pickerAdd')}</Button></div><div className="min-h-0 overflow-y-auto rounded-[14px] border p-3" style={{ borderColor: 'var(--color-border)' }}><div className="mb-2 text-xs font-semibold text-[color:var(--color-foreground)]">{t('learning.skills.pickerPreview')}</div>{temporarySkill ? <div className="space-y-2"><div className="text-sm font-medium text-[color:var(--color-foreground)]">{temporarySkill.title}</div><div className="text-[10px] text-[color:var(--color-primary)]">{t('learning.skills.sourceTemporary')}</div><pre className="whitespace-pre-wrap break-words text-[11px] leading-5 text-[color:var(--color-muted-foreground)]">{temporarySkill.contentMd}</pre></div> : focusedSkill ? <div className="space-y-2"><div className="text-sm font-medium text-[color:var(--color-foreground)]">{focusedSkill.title}</div><pre className="whitespace-pre-wrap break-words text-[11px] leading-5 text-[color:var(--color-muted-foreground)]">{focusedSkill.contentMd}</pre></div> : <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('learning.skills.noSelection')}</p>}</div></div>
      <div className="flex justify-end gap-2 border-t p-4" style={{ borderColor: 'var(--color-border)' }}><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button onClick={onApply}>{t('learning.skills.pickerApply')}</Button></div>
    </ModalShell>
    <CreateSkillDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={handleCreated} />
  </>
}
