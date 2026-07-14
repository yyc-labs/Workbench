import { FolderPlus, Pencil, Search, Sparkles, Trash2, X } from 'lucide-react'
import type { SkillCategory, SkillSummary } from '../../../../shared/types'
import { Button } from '../../../components/ui/button'
import { Card } from '../../../components/ui/card'
import { Input } from '../../../components/ui/input'
import { ScrollArea } from '../../../components/ui/scroll-area'
import { Select } from '../../../components/ui/select'
import { useI18n } from '../../../i18n'
import type { SkillListSidebarProps } from './skillTypes'

export function SkillListSidebar({
  categories,
  filteredSkills,
  selectedCategoryId,
  selectedSkillId,
  searchQuery,
  categoryInput,
  selectedCategory,
  categoryEditInput,
  onSearchQueryChange,
  onCategoryChange,
  onSelectSkill,
  onCategoryInputChange,
  onCreateCategory,
  onCategoryEditInputChange,
  onRenameCategory,
  onDeleteCategory,
}: SkillListSidebarProps) {
  const { t, formatDateTime } = useI18n()
  const categoryOptions = [{ value: 'all', label: t('learning.skills.allCategories') }, ...categories.map((category: SkillCategory) => ({ value: category.id, label: category.name }))]

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden border-[color:var(--color-border)]/80 bg-[color:var(--color-card)]/92">
      <div className="space-y-3 border-b p-4" style={{ borderColor: 'var(--color-border)' }}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--color-muted-foreground)]" />
          <Input value={searchQuery} onChange={(event) => onSearchQueryChange(event.target.value)} placeholder={t('learning.skills.searchPlaceholder')} className="h-10 rounded-full pl-11 pr-10" />
          {searchQuery ? (
            <button type="button" className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)]" onClick={() => onSearchQueryChange('')} aria-label={t('common.clearSearch')}>
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <Select ariaLabel={t('learning.skills.categories')} value={selectedCategoryId} options={categoryOptions} onChange={onCategoryChange} emptyText={t('learning.skills.allCategories')} />
        <div className="flex gap-2">
          <Input
            value={categoryInput}
            onChange={(event) => onCategoryInputChange(event.target.value)}
            placeholder={t('learning.skills.newCategoryPlaceholder')}
            className="h-9"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onCreateCategory()
              }
            }}
          />
          <Button type="button" size="icon" variant="outline" className="h-9 w-9" onClick={onCreateCategory} title={t('learning.skills.addCategory')}>
            <FolderPlus />
          </Button>
        </div>
        {selectedCategory ? (
          <div className="space-y-2 rounded-[14px] border p-2" style={{ borderColor: 'var(--color-border)' }}>
            <div className="text-[11px] text-[color:var(--color-muted-foreground)]">{t('learning.skills.manageCategory')}</div>
            <div className="flex gap-2">
              <Input value={categoryEditInput} onChange={(event) => onCategoryEditInputChange(event.target.value)} className="h-8" />
              <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={onRenameCategory} title={t('learning.skills.manageCategory')}>
                <Pencil />
              </Button>
              <Button type="button" size="icon" variant="destructive" className="h-8 w-8" onClick={onDeleteCategory} title={t('learning.skills.delete')}>
                <Trash2 />
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-2 px-4 pb-2 pt-4 text-xs font-medium text-[color:var(--color-muted-foreground)]">
        <Sparkles className="h-3.5 w-3.5" />
        {t('learning.skills.title')}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-2 p-3">
          {filteredSkills.length > 0 ? (
            filteredSkills.map((skill) => (
              <button
                key={skill.id}
                type="button"
                onClick={() => onSelectSkill(skill.id)}
                className={`flex w-full flex-col gap-1 rounded-[16px] border px-3 py-3 text-left transition-colors ${selectedSkillId === skill.id ? 'border-[color:var(--color-primary)]/50 bg-[color:var(--color-primary)]/8' : 'border-transparent bg-[color:var(--color-accent)]/55 hover:border-[color:var(--color-border)]'}`}
              >
                <div className="flex items-center gap-2">
                  <span className="line-clamp-1 min-w-0 flex-1 text-sm font-medium text-[color:var(--color-foreground)]">{skill.title}</span>
                  <span className={`text-[10px] ${skill.enabled ? 'text-[color:var(--color-success)]' : 'text-[color:var(--color-muted-foreground)]'}`}>{skill.enabled ? t('learning.skills.enabled') : t('learning.skills.disabled')}</span>
                </div>
                <div className="line-clamp-2 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{skill.excerpt || t('learning.skills.noSelection')}</div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-[color:var(--color-muted-foreground)]">
                  <span>{skill.tags.slice(0, 2).join(' · ')}</span>
                  <span>{formatDateTime(skill.updatedAt)}</span>
                </div>
              </button>
            ))
          ) : (
            <div className="px-3 py-5 text-center text-xs text-[color:var(--color-muted-foreground)]">{t('learning.skills.empty')}</div>
          )}
        </div>
      </ScrollArea>
    </Card>
  )
}
