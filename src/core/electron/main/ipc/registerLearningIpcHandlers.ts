import { ipcMain } from 'electron'
import { IPC } from '../ipc'
import type { LearningCreateCategoryPayload, LearningCreateNotePayload, LearningUpdateCategoryPayload, LearningUpdateNotePayload } from '../../../shared/types'
import type { RegisterIpcHandlersDependencies } from './registerIpcHandlers.shared'

export function registerLearningIpcHandlers(deps: RegisterIpcHandlersDependencies): void {
  ipcMain.handle(IPC.LEARNING_LIST_CATEGORIES, async () => {
    return deps.learningService.listCategories()
  })

  ipcMain.handle(IPC.LEARNING_CREATE_CATEGORY, async (_event, payload: LearningCreateCategoryPayload) => {
    return deps.learningService.createCategory(payload)
  })

  ipcMain.handle(IPC.LEARNING_UPDATE_CATEGORY, async (_event, payload: LearningUpdateCategoryPayload) => {
    return deps.learningService.updateCategory(payload)
  })

  ipcMain.handle(IPC.LEARNING_DELETE_CATEGORY, async (_event, categoryId: string) => {
    return deps.learningService.deleteCategory(categoryId)
  })

  ipcMain.handle(IPC.LEARNING_LIST_NOTES, async () => {
    return deps.learningService.listNotes()
  })

  ipcMain.handle(IPC.LEARNING_SEARCH_NOTES, async (_event, query: string) => {
    return deps.learningService.searchNotes(query)
  })

  ipcMain.handle(IPC.LEARNING_GET_NOTE, async (_event, noteId: string) => {
    return deps.learningService.getNote(noteId)
  })

  ipcMain.handle(IPC.LEARNING_CREATE_NOTE, async (_event, payload?: LearningCreateNotePayload) => {
    return deps.learningService.createNote(payload)
  })

  ipcMain.handle(IPC.LEARNING_UPDATE_NOTE, async (_event, payload: LearningUpdateNotePayload) => {
    return deps.learningService.updateNote(payload)
  })

  ipcMain.handle(IPC.LEARNING_DELETE_NOTE, async (_event, noteId: string) => {
    return deps.learningService.deleteNote(noteId)
  })
}
