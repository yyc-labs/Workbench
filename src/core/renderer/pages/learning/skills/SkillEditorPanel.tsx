import { Save, Trash2 } from 'lucide-react'
import type { Skill, SkillCategory } from '../../../../shared/types'
import { Button } from '../../../components/ui/button'
import { Card } from '../../../components/ui/card'
import { Checkbox } from '../../../components/ui/checkbox'
import { Input } from '../../../components/ui/input'
import { Select } from '../../../components/ui/select'
import { Textarea } from '../../../components/ui/textarea'
import { useI18n } from '../../../i18n'
import type { SkillEditorState } from './skillTypes'

type SkillEditorPanelProps = {
  skill: Skill | null
  categories: SkillCategory[]
  editor: SkillEditorState
  saving: boolean
  error: string | null
  onChange: (patch: Partial<SkillEditorState>) => void
  onSave: () => void
  onDelete: () => void
}

export function SkillEditorPanel({ skill, categories, editor, saving, error, onChange, onSave, onDelete }: SkillEditorPanelProps) {
  const { t } = useI18n()
  if (!skill)
    return (
      <Card className="flex h-full min-h-0 items-center justify-center border-[color:var(--color-border)]/80 bg-[color:var(--color-card)]/92 p-8 text-center">
        <div className="max-w-sm text-sm text-[color:var(--color-muted-foreground)]">{t('learning.skills.noSelection')}</div>
      </Card>
    )
  const categoryOptions = [{ value: '', label: t('learning.skills.uncategorized') }, ...categories.map((category) => ({ value: category.id, label: category.name }))]
  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden border-[color:var(--color-border)]/80 bg-[color:var(--color-card)]/92">
      <div className="flex items-start justify-between gap-3 border-b p-5" style={{ borderColor: 'var(--color-border)' }}>
        <div className="min-w-0">
          <div className="section-label mb-2">{t('learning.skills.title')}</div>
          <h2 className="truncate text-lg font-semibold text-[color:var(--color-foreground)]">{editor.title || t('learning.skills.titlePlaceholder')}</h2>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="destructive" size="icon" onClick={onDelete} title={t('learning.skills.delete')}>
            <Trash2 />
          </Button>
          <Button onClick={onSave} loading={saving} disabled={!editor.title.trim() || !editor.contentMd.trim()}>
            <Save />
            {t('learning.skills.save')}
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
          <span className="text-xs font-medium text-[color:var(--color-muted-foreground)]">{t('learning.skills.contentLabel')}</span>
          <Textarea className="min-h-[min(52vh,520px)] font-mono text-xs leading-6" value={editor.contentMd} onChange={(event) => onChange({ contentMd: event.target.value })} placeholder={t('learning.skills.contentPlaceholder')} />
        </label>
        {error ? <p className="text-sm text-[color:var(--color-destructive)]">{error}</p> : null}
      </div>
    </Card>
  )
}
