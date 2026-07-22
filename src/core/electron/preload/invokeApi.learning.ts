import { ipcRenderer } from 'electron'
import { IPC } from '../main/ipc'
import type { LearningCategory, LearningCreateCategoryPayload, LearningCreateNotePayload, LearningNote, LearningNoteSummary, LearningSearchResult, LearningUpdateCategoryPayload, LearningUpdateNotePayload } from '../../shared/types'

export function createLearningInvokeApi() {
  return {
    listLearningCategories: () => ipcRenderer.invoke(IPC.LEARNING_LIST_CATEGORIES) as Promise<LearningCategory[]>,

    createLearningCategory: (payload: LearningCreateCategoryPayload) => ipcRenderer.invoke(IPC.LEARNING_CREATE_CATEGORY, payload) as Promise<LearningCategory[]>,

    updateLearningCategory: (payload: LearningUpdateCategoryPayload) => ipcRenderer.invoke(IPC.LEARNING_UPDATE_CATEGORY, payload) as Promise<LearningCategory[]>,

    deleteLearningCategory: (categoryId: string) => ipcRenderer.invoke(IPC.LEARNING_DELETE_CATEGORY, categoryId) as Promise<LearningCategory[]>,

    listLearningNotes: () => ipcRenderer.invoke(IPC.LEARNING_LIST_NOTES) as Promise<LearningNoteSummary[]>,

    searchLearningNotes: (query: string) => ipcRenderer.invoke(IPC.LEARNING_SEARCH_NOTES, query) as Promise<LearningSearchResult[]>,

    getLearningNote: (noteId: string) => ipcRenderer.invoke(IPC.LEARNING_GET_NOTE, noteId) as Promise<LearningNote | null>,

    createLearningNote: (payload?: LearningCreateNotePayload) => ipcRenderer.invoke(IPC.LEARNING_CREATE_NOTE, payload) as Promise<LearningNote>,

    updateLearningNote: (payload: LearningUpdateNotePayload) => ipcRenderer.invoke(IPC.LEARNING_UPDATE_NOTE, payload) as Promise<LearningNote>,

    deleteLearningNote: (noteId: string) => ipcRenderer.invoke(IPC.LEARNING_DELETE_NOTE, noteId) as Promise<boolean>,
  }
}
