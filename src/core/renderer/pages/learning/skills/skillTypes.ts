import type { Skill, SkillCategory, SkillSummary } from '../../../../shared/types'

export type SkillEditorState = {
  title: string
  contentMd: string
  tags: string
  categoryId: string
  enabled: boolean
}

export type SkillListFilter = {
  searchQuery: string
  categoryId: string
}

export function skillEditorState(skill: Skill | null): SkillEditorState {
  return {
    title: skill?.title ?? '',
    contentMd: skill?.contentMd ?? '',
    tags: skill?.tags.join(', ') ?? '',
    categoryId: skill?.categoryId ?? '',
    enabled: skill?.enabled ?? true,
  }
}

export type SkillListSidebarProps = {
  categories: SkillCategory[]
  filteredSkills: SkillSummary[]
  selectedCategoryId: string
  selectedSkillId: string | null
  searchQuery: string
  categoryInput: string
  categoryManagerOpen: boolean
  selectedCategory: SkillCategory | null
  categoryEditInput: string
  onSearchQueryChange: (value: string) => void
  onCategoryChange: (value: string) => void
  onSelectSkill: (skillId: string) => void
  onCategoryInputChange: (value: string) => void
  onCreateCategory: () => void
  onCategoryEditInputChange: (value: string) => void
  onRenameCategory: () => void
  onDeleteCategory: () => void
  onToggleCategoryManager: () => void
}
