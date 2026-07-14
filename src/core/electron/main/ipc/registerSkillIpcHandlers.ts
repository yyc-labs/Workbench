import { ipcMain } from 'electron'
import { IPC } from '../ipc'
import type { SkillCreateCategoryPayload, SkillCreatePayload, SkillUpdateCategoryPayload, SkillUpdatePayload } from '../../../shared/types'
import type { RegisterIpcHandlersDependencies } from './registerIpcHandlers.shared'

export function registerSkillIpcHandlers(deps: RegisterIpcHandlersDependencies): void {
  ipcMain.handle(IPC.SKILL_LIST_CATEGORIES, () => deps.skillService.listCategories())
  ipcMain.handle(IPC.SKILL_CREATE_CATEGORY, (_event, payload: SkillCreateCategoryPayload) => deps.skillService.createCategory(payload))
  ipcMain.handle(IPC.SKILL_UPDATE_CATEGORY, (_event, payload: SkillUpdateCategoryPayload) => deps.skillService.updateCategory(payload))
  ipcMain.handle(IPC.SKILL_DELETE_CATEGORY, (_event, categoryId: string) => deps.skillService.deleteCategory(categoryId))
  ipcMain.handle(IPC.SKILL_LIST, () => deps.skillService.listSkills())
  ipcMain.handle(IPC.SKILL_GET, (_event, skillId: string) => deps.skillService.getSkill(skillId))
  ipcMain.handle(IPC.SKILL_CREATE, (_event, payload?: SkillCreatePayload) => deps.skillService.createSkill(payload))
  ipcMain.handle(IPC.SKILL_UPDATE, (_event, payload: SkillUpdatePayload) => deps.skillService.updateSkill(payload))
  ipcMain.handle(IPC.SKILL_DELETE, (_event, skillId: string) => deps.skillService.deleteSkill(skillId))
}
