import type { StateCreator } from 'zustand'
import type { AppState } from './appStore.types'
import type {
  Skill,
  SkillCategory,
  SkillCreateCategoryPayload,
  SkillCreatePayload,
  SkillSummary,
  SkillUpdateCategoryPayload,
  SkillUpdatePayload,
} from '../../shared/types'

export type SkillActionsSlice = Pick<AppState,
  | 'loadSkills'
  | 'loadSkillCategories'
  | 'loadSkill'
  | 'createSkill'
  | 'updateSkill'
  | 'deleteSkill'
  | 'createSkillCategory'
  | 'updateSkillCategory'
  | 'deleteSkillCategory'
>

export const createSkillActionsSlice: StateCreator<AppState, [], [], SkillActionsSlice> = (set) => ({
  loadSkills: async (): Promise<SkillSummary[]> => {
    const skills = await window.electronAPI.listSkills()
    set({ skills })
    return skills
  },
  loadSkillCategories: async (): Promise<SkillCategory[]> => {
    const skillCategories = await window.electronAPI.listSkillCategories()
    set({ skillCategories })
    return skillCategories
  },
  loadSkill: async (skillId: string): Promise<Skill | null> => {
    const selectedSkill = await window.electronAPI.getSkill(skillId)
    set({ selectedSkill })
    return selectedSkill
  },
  createSkill: async (payload: SkillCreatePayload): Promise<Skill> => {
    const created = await window.electronAPI.createSkill(payload)
    set((state) => ({ skills: [created, ...state.skills.filter((item) => item.id !== created.id)], selectedSkill: created }))
    return created
  },
  updateSkill: async (payload: SkillUpdatePayload): Promise<Skill> => {
    const updated = await window.electronAPI.updateSkill(payload)
    set((state) => ({ skills: [updated, ...state.skills.filter((item) => item.id !== updated.id)], selectedSkill: updated }))
    return updated
  },
  deleteSkill: async (skillId: string): Promise<boolean> => {
    const deleted = await window.electronAPI.deleteSkill(skillId)
    if (deleted) set((state) => ({ skills: state.skills.filter((item) => item.id !== skillId), selectedSkill: state.selectedSkill?.id === skillId ? null : state.selectedSkill }))
    return deleted
  },
  createSkillCategory: async (payload: SkillCreateCategoryPayload): Promise<SkillCategory[]> => {
    const skillCategories = await window.electronAPI.createSkillCategory(payload)
    set({ skillCategories })
    return skillCategories
  },
  updateSkillCategory: async (payload: SkillUpdateCategoryPayload): Promise<SkillCategory[]> => {
    const skillCategories = await window.electronAPI.updateSkillCategory(payload)
    set({ skillCategories })
    return skillCategories
  },
  deleteSkillCategory: async (categoryId: string): Promise<SkillCategory[]> => {
    const skillCategories = await window.electronAPI.deleteSkillCategory(categoryId)
    set((state) => ({ skillCategories, skills: state.skills.map((item) => item.categoryId === categoryId ? { ...item, categoryId: undefined } : item), selectedSkill: state.selectedSkill?.categoryId === categoryId ? { ...state.selectedSkill, categoryId: undefined } : state.selectedSkill }))
    return skillCategories
  },
})
