import { Check, Copy, Save, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { Skill, SkillCategory } from '../../../../shared/types'
import { Button } from '../../../components/ui/button'
import { Card } from '../../../components/ui/card'
import { Checkbox } from '../../../components/ui/checkbox'
import { Input } from '../../../components/ui/input'
import { Select } from '../../../components/ui/select'
import { Textarea } from '../../../components/ui/textarea'
import { useI18n } from '../../../i18n'
import { copyTextToClipboard } from '../../code/code.clipboard'
import type { SkillEditorState } from './skillTypes'

type SkillEditorPanelProps = {
  skill: Skill | null
  categories: SkillCategory[]
  editor: SkillEditorState
  hasUnsavedChanges: boolean
  saving: boolean
  error: string | null
  onChange: (patch: Partial<SkillEditorState>) => void
  onSave: () => void
  onDelete: () => void
  onCreate: () => void | Promise<void>
}

export function SkillEditorPanel({ skill, categories, editor, hasUnsavedChanges, saving, error, onChange, onSave, onDelete, onCreate }: SkillEditorPanelProps) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!editor.contentMd.trim()) return
    const didCopy = await copyTextToClipboard(editor.contentMd)
    if (!didCopy) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_200)
  }

  if (!skill)
    return (
      <Card className="surface-card flex h-full min-h-0 items-center justify-center rounded-[18px] border-[color:var(--color-border)]/80 bg-[color:var(--color-card)]/92 p-8 text-center shadow-none">
        <div className="flex max-w-sm flex-col items-center gap-4">
          <div className="text-sm text-[color:var(--color-muted-foreground)]">{t('learning.skills.noSelection')}</div>
          <Button type="button" onClick={() => void onCreate()}>
            <Save />
            {t('learning.skills.create')}
          </Button>
        </div>
      </Card>
    )
  const categoryOptions = [{ value: '', label: t('learning.skills.uncategorized') }, ...categories.map((category) => ({ value: category.id, label: category.name }))]
  return (
    <Card className="surface-card flex h-full min-h-0 flex-col overflow-hidden rounded-[18px] border-[color:var(--color-border)]/80 bg-[color:var(--color-card)]/92 shadow-none">
      <div className="flex items-start justify-between gap-3 border-b p-5" style={{ borderColor: 'var(--color-border)' }}>
        <div className="min-w-0">
          <div className="section-label mb-2">{t('learning.skills.title')}</div>
          <h2 className="truncate text-lg font-semibold text-[color:var(--color-foreground)]">{editor.title || t('learning.skills.titlePlaceholder')}</h2>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="icon" onClick={onDelete} title={t('learning.skills.delete')}>
            <Trash2 />
          </Button>
          <Button
            onClick={onSave}
            loading={saving}
            variant={hasUnsavedChanges ? 'default' : 'outline'}
            className={hasUnsavedChanges && !saving ? 'shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-primary)_14%,transparent)]' : undefined}
            disabled={saving || !hasUnsavedChanges || !editor.title.trim() || !editor.contentMd.trim()}
          >
            <Save />
            {saving ? t('common.saving') : hasUnsavedChanges ? t('learning.skills.saveChanges') : t('learning.skills.saved')}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-[color:var(--color-muted-foreground)]">{t('learning.skills.titleLabel')}</span>
          <Input value={editor.title} onChange={(event) => onChange({ title: event.target.value })} placeholder={t('learning.skills.titlePlaceholder')} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[color:var(--color-muted-foreground)]">{t('learning.skills.categoryLabel')}</span>
            <Select ariaLabel={t('learning.skills.categoryLabel')} value={editor.categoryId} options={categoryOptions} onChange={(value) => onChange({ categoryId: value })} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[color:var(--color-muted-foreground)]">{t('learning.skills.tagsLabel')}</span>
            <Input value={editor.tags} onChange={(event) => onChange({ tags: event.target.value })} placeholder={t('learning.skills.tagsPlaceholder')} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-[color:var(--color-foreground)]">
          <Checkbox checked={editor.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
          {t('learning.skills.enabled')}
        </label>
        <label className="block space-y-1.5">
          <span className="flex items-center justify-between gap-2 text-xs font-medium text-[color:var(--color-muted-foreground)]">
            <span>{t('learning.skills.contentLabel')}</span>
            <Button
              type="button"
              variant={copied ? 'default' : 'outline'}
              size="sm"
              className={`h-8 gap-1.5 px-3 transition-all duration-300 ${copied ? 'learning-skill-copy-success shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-primary)_14%,transparent)]' : ''}`}
              onClick={() => void handleCopy()}
              disabled={!editor.contentMd.trim()}
              title={copied ? t('learning.skills.contentCopied') : t('learning.skills.copyContent')}
              aria-label={copied ? t('learning.skills.contentCopied') : t('learning.skills.copyContent')}
            >
              {copied ? <Check className="animate-pulse" /> : <Copy />}
              {copied ? t('learning.skills.contentCopied') : t('learning.skills.copyContent')}
            </Button>
          </span>
          <Textarea className="min-h-[min(52vh,520px)] font-mono text-xs leading-6" value={editor.contentMd} onChange={(event) => onChange({ contentMd: event.target.value })} placeholder={t('learning.skills.contentPlaceholder')} />
        </label>
        {error ? <p className="text-sm text-[color:var(--color-destructive)]">{error}</p> : null}
      </div>
    </Card>
  )
}
