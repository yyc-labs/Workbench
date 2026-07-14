import { Save, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Skill } from '../../../../shared/types'
import { ModalShell } from '../../../components/ModalShell'
import { Button } from '../../../components/ui/button'
import { Checkbox } from '../../../components/ui/checkbox'
import { Input } from '../../../components/ui/input'
import { Textarea } from '../../../components/ui/textarea'
import { useI18n } from '../../../i18n'
import { useAppStore } from '../../../stores/appStore'

export type TemporarySkill = {
  id: string
  title: string
  contentMd: string
  tags: string[]
}

type CreateSkillDialogProps = {
  open: boolean
  onClose: () => void
  onCreated: (skill: Skill | null, temporary: TemporarySkill | null) => void
}

function tags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ]
}

export function CreateSkillDialog({ open, onClose, onCreated }: CreateSkillDialogProps) {
  const { t } = useI18n()
  const createSkill = useAppStore((state) => state.createSkill)
  const [title, setTitle] = useState('')
  const [contentMd, setContentMd] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [saveToSkills, setSaveToSkills] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTitle('')
    setContentMd('')
    setTagInput('')
    setSaveToSkills(true)
    setError(null)
  }, [open])

  const handleCreate = async () => {
    if (!title.trim()) {
      setError(t('learning.skills.titleRequired'))
      return
    }
    if (!contentMd.trim()) {
      setError(t('learning.skills.contentRequired'))
      return
    }
    setSaving(true)
    setError(null)
    const nextTags = tags(tagInput)
    try {
      if (saveToSkills) {
        const skill = await createSkill({
          title,
          contentMd,
          tags: nextTags,
          enabled: true,
        })
        onCreated(skill, null)
      } else {
        onCreated(null, {
          id: `temporary-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          title: title.trim(),
          contentMd,
          tags: nextTags,
        })
      }
      onClose()
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t('learning.skills.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell open={open} onClose={onClose} widthClassName="max-w-xl" panelClassName="!p-0 flex max-h-[calc(100vh-3rem)] flex-col overflow-hidden" ariaLabel={t('learning.skills.createTitle')}>
      <div className="flex items-start justify-between gap-4 border-b p-5" style={{ borderColor: 'var(--color-border)' }}>
        <div>
          <p className="section-label mb-2">{t('learning.skills.title')}</p>
          <h2 className="text-lg font-semibold text-[color:var(--color-foreground)]">{t('learning.skills.createTitle')}</h2>
          <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">{t('learning.skills.createDescription')}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} title={t('common.close')}>
          <X />
        </Button>
      </div>
      <div className="min-h-0 space-y-4 overflow-y-auto p-5">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-[color:var(--color-muted-foreground)]">{t('learning.skills.titleLabel')}</span>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t('learning.skills.titlePlaceholder')} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-[color:var(--color-muted-foreground)]">{t('learning.skills.tagsLabel')}</span>
          <Input value={tagInput} onChange={(event) => setTagInput(event.target.value)} placeholder={t('learning.skills.tagsPlaceholder')} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-[color:var(--color-muted-foreground)]">{t('learning.skills.contentLabel')}</span>
          <Textarea className="min-h-48 font-mono text-xs leading-6" value={contentMd} onChange={(event) => setContentMd(event.target.value)} placeholder={t('learning.skills.contentPlaceholder')} />
        </label>
        <label className="flex items-start gap-2 text-sm text-[color:var(--color-foreground)]">
          <Checkbox checked={saveToSkills} onChange={(event) => setSaveToSkills(event.target.checked)} />
          <span>{saveToSkills ? t('learning.skills.saveToSkills') : t('learning.skills.useOnce')}</span>
        </label>
        {error ? <p className="text-sm text-[color:var(--color-destructive)]">{error}</p> : null}
      </div>
      <div className="flex justify-end gap-2 border-t p-4" style={{ borderColor: 'var(--color-border)' }}>
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button onClick={() => void handleCreate()} loading={saving}>
          <Save />
          {t('learning.skills.createAction')}
        </Button>
      </div>
    </ModalShell>
  )
}
