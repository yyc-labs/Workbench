import type {
  Skill,
  SkillCategory,
  SkillCreateCategoryPayload,
  SkillCreatePayload,
  SkillSummary,
  SkillUpdateCategoryPayload,
  SkillUpdatePayload,
} from '../../../shared/types'
import type { SkillRepository } from './skillRepository'

type SkillServiceDependencies = { repository: SkillRepository }

export interface SkillService {
  listCategories: () => Promise<SkillCategory[]>
  createCategory: (payload: SkillCreateCategoryPayload) => Promise<SkillCategory[]>
  updateCategory: (payload: SkillUpdateCategoryPayload) => Promise<SkillCategory[]>
  deleteCategory: (categoryId: string) => Promise<SkillCategory[]>
  listSkills: () => Promise<SkillSummary[]>
  getSkill: (skillId: string) => Promise<Skill | null>
  createSkill: (payload?: SkillCreatePayload) => Promise<Skill>
  updateSkill: (payload: SkillUpdatePayload) => Promise<Skill>
  deleteSkill: (skillId: string) => Promise<boolean>
}

function id(prefix: 'sk' | 'sc'): string { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` }
function normalizeTags(value: string[] | undefined): string[] { return [...new Set((value ?? []).map((item) => item.trim()).filter(Boolean))] }
function excerpt(value: string): string { return value.replace(/[`#>*_\-\[\]()!]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) }
function categoryName(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }

function findCategory(categories: SkillCategory[], categoryId: string | undefined): string | undefined {
  const normalized = categoryId?.trim()
  if (!normalized) return undefined
  if (!categories.some((category) => category.id === normalized)) throw new Error('Skill category does not exist.')
  return normalized
}

export function createSkillService(deps: SkillServiceDependencies): SkillService {
  return {
    listCategories: () => deps.repository.listCategories(),
    createCategory: async (payload) => {
      const name = categoryName(payload.name)
      if (!name) throw new Error('Skill category name is required.')
      const categories = await deps.repository.listCategories()
      if (categories.some((item) => item.name.toLowerCase() === name.toLowerCase())) throw new Error('Skill category name already exists.')
      const now = Date.now()
      const next = [...categories, { id: id('sc'), name, parentId: payload.parentId?.trim() || undefined, sort: categories.length, createdAt: now, updatedAt: now }]
      await deps.repository.saveCategories(next)
      return next
    },
    updateCategory: async (payload) => {
      const categoryId = payload.categoryId?.trim()
      const name = categoryName(payload.name)
      if (!categoryId) throw new Error('Skill category id is required.')
      if (!name) throw new Error('Skill category name is required.')
      const categories = await deps.repository.listCategories()
      if (!categories.some((item) => item.id === categoryId)) throw new Error('Skill category does not exist.')
      if (categories.some((item) => item.id !== categoryId && item.name.toLowerCase() === name.toLowerCase())) throw new Error('Skill category name already exists.')
      const next = categories.map((item) => item.id === categoryId ? { ...item, name, updatedAt: Date.now() } : item)
      await deps.repository.saveCategories(next)
      return next
    },
    deleteCategory: async (categoryId) => {
      const normalized = categoryId?.trim()
      if (!normalized) throw new Error('Skill category id is required.')
      const categories = await deps.repository.listCategories()
      if (!categories.some((item) => item.id === normalized)) throw new Error('Skill category does not exist.')
      const next = categories.filter((item) => item.id !== normalized)
      await deps.repository.saveCategories(next)
      await deps.repository.clearCategoryReferences(normalized)
      return next
    },
    listSkills: () => deps.repository.listSkills(),
    getSkill: (skillId) => deps.repository.getSkill(skillId),
    createSkill: async (payload) => {
      const title = payload?.title?.trim() ?? ''
      const contentMd = payload?.contentMd ?? ''
      if (!title) throw new Error('Skill title is required.')
      if (!contentMd.trim()) throw new Error('Skill content cannot be empty.')
      const categories = await deps.repository.listCategories()
      const categoryId = findCategory(categories, payload?.categoryId)
      const existing = await deps.repository.listSkills()
      if (existing.some((item) => item.title.toLowerCase() === title.toLowerCase())) throw new Error('Skill title already exists.')
      const now = Date.now()
      const skill: Skill = { id: id('sk'), title, categoryId, tags: normalizeTags(payload?.tags), enabled: payload?.enabled !== false, createdAt: now, updatedAt: now, excerpt: excerpt(contentMd), contentMd }
      await deps.repository.saveSkill(skill)
      return skill
    },
    updateSkill: async (payload) => {
      const existing = await deps.repository.getSkill(payload.skillId)
      if (!existing) throw new Error(`Unknown skill id: ${payload.skillId}`)
      const title = payload.title.trim()
      if (!title) throw new Error('Skill title is required.')
      if (!payload.contentMd.trim()) throw new Error('Skill content cannot be empty.')
      const categories = await deps.repository.listCategories()
      const categoryId = findCategory(categories, payload.categoryId)
      const summaries = await deps.repository.listSkills()
      if (summaries.some((item) => item.id !== existing.id && item.title.toLowerCase() === title.toLowerCase())) throw new Error('Skill title already exists.')
      const updated: Skill = { ...existing, title, categoryId, tags: normalizeTags(payload.tags), enabled: payload.enabled !== false, updatedAt: Date.now(), excerpt: excerpt(payload.contentMd), contentMd: payload.contentMd }
      await deps.repository.saveSkill(updated)
      return updated
    },
    deleteSkill: (skillId) => deps.repository.deleteSkill(skillId),
  }
}
