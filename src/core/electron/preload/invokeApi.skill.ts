import { ipcRenderer } from 'electron'
import { IPC } from '../main/ipc'
import type {
  Skill,
  SkillCategory,
  SkillCreateCategoryPayload,
  SkillCreatePayload,
  SkillSummary,
  SkillUpdateCategoryPayload,
  SkillUpdatePayload,
} from '../../shared/types'

export function createSkillInvokeApi() {
  return {
    listSkillCategories: () => ipcRenderer.invoke(IPC.SKILL_LIST_CATEGORIES) as Promise<SkillCategory[]>,
    createSkillCategory: (payload: SkillCreateCategoryPayload) => ipcRenderer.invoke(IPC.SKILL_CREATE_CATEGORY, payload) as Promise<SkillCategory[]>,
    updateSkillCategory: (payload: SkillUpdateCategoryPayload) => ipcRenderer.invoke(IPC.SKILL_UPDATE_CATEGORY, payload) as Promise<SkillCategory[]>,
    deleteSkillCategory: (categoryId: string) => ipcRenderer.invoke(IPC.SKILL_DELETE_CATEGORY, categoryId) as Promise<SkillCategory[]>,
    listSkills: () => ipcRenderer.invoke(IPC.SKILL_LIST) as Promise<SkillSummary[]>,
    getSkill: (skillId: string) => ipcRenderer.invoke(IPC.SKILL_GET, skillId) as Promise<Skill | null>,
    createSkill: (payload?: SkillCreatePayload) => ipcRenderer.invoke(IPC.SKILL_CREATE, payload) as Promise<Skill>,
    updateSkill: (payload: SkillUpdatePayload) => ipcRenderer.invoke(IPC.SKILL_UPDATE, payload) as Promise<Skill>,
    deleteSkill: (skillId: string) => ipcRenderer.invoke(IPC.SKILL_DELETE, skillId) as Promise<boolean>,
  }
}
