import type { StateCreator } from 'zustand'
import type { MarkdownDocumentDisplayMode, MarkdownDocumentHistoryEntry, MarkdownDocumentReadResult } from '../../shared/types'
import type { AppState } from './appStore.types'

export type MarkdownDocumentSlice = Pick<
  AppState,
  | 'markdownDocumentHistory'
  | 'markdownDocumentActive'
  | 'markdownDocumentValue'
  | 'markdownDocumentMode'
  | 'markdownDocumentLoading'
  | 'markdownDocumentSaving'
  | 'markdownDocumentError'
  | 'markdownDocumentConflict'
  | 'reloadMarkdownDocument'
  | 'loadMarkdownDocumentHistory'
  | 'openMarkdownDocument'
  | 'setMarkdownDocumentValue'
  | 'setMarkdownDocumentMode'
  | 'saveMarkdownDocument'
  | 'removeMarkdownDocumentHistory'
  | 'clearMarkdownDocumentHistory'
>

export const createMarkdownDocumentActionsSlice: StateCreator<AppState, [], [], MarkdownDocumentSlice> = (set, get) => ({
  markdownDocumentHistory: [],
  markdownDocumentActive: null,
  markdownDocumentValue: '',
  markdownDocumentMode: 'preview',
  markdownDocumentLoading: false,
  markdownDocumentSaving: false,
  markdownDocumentError: null,
  markdownDocumentConflict: false,
  loadMarkdownDocumentHistory: async () => {
    const history = await window.electronAPI.listMarkdownDocumentHistory()
    set({ markdownDocumentHistory: history })
  },
  openMarkdownDocument: async (filePath: string) => {
    set({ markdownDocumentLoading: true, markdownDocumentError: null, markdownDocumentConflict: false })
    try {
      const document = await window.electronAPI.readMarkdownDocument(filePath)
      set({ markdownDocumentActive: document, markdownDocumentValue: document.content, markdownDocumentLoading: false })
      await get().loadMarkdownDocumentHistory()
    } catch (error) {
      set({ markdownDocumentLoading: false, markdownDocumentError: error instanceof Error ? error.message : String(error) })
    }
  },
  reloadMarkdownDocument: async () => {
    const active = get().markdownDocumentActive
    if (!active) return
    set({ markdownDocumentLoading: true, markdownDocumentError: null, markdownDocumentConflict: false })
    try {
      const document = await window.electronAPI.readMarkdownDocument(active.path)
      set({ markdownDocumentActive: document, markdownDocumentValue: document.content, markdownDocumentLoading: false })
      await get().loadMarkdownDocumentHistory()
    } catch (error) {
      set({ markdownDocumentLoading: false, markdownDocumentError: error instanceof Error ? error.message : String(error) })
    }
  },
  setMarkdownDocumentValue: (value: string) => set({ markdownDocumentValue: value }),
  setMarkdownDocumentMode: (mode: MarkdownDocumentDisplayMode) => set({ markdownDocumentMode: mode }),
  saveMarkdownDocument: async () => {
    const active = get().markdownDocumentActive
    const content = get().markdownDocumentValue
    if (!active || get().markdownDocumentSaving || content === active.content) return
    set({ markdownDocumentSaving: true, markdownDocumentError: null })
    try {
      const saved = await window.electronAPI.writeMarkdownDocument(active.path, content, active.mtimeMs)
      set({ markdownDocumentActive: { ...active, ...saved, content }, markdownDocumentSaving: false, markdownDocumentConflict: false })
    } catch (error) {
      set({ markdownDocumentSaving: false, markdownDocumentConflict: (error as { code?: string }).code === 'conflict', markdownDocumentError: error instanceof Error ? error.message : String(error) })
    }
  },
  removeMarkdownDocumentHistory: async (filePath: string) => {
    const history = await window.electronAPI.removeMarkdownDocumentHistory(filePath)
    if (get().markdownDocumentActive?.path !== filePath) {
      set({ markdownDocumentHistory: history })
      return
    }

    set({
      markdownDocumentHistory: history,
      markdownDocumentActive: null,
      markdownDocumentValue: '',
      markdownDocumentLoading: false,
      markdownDocumentSaving: false,
      markdownDocumentError: null,
      markdownDocumentConflict: false,
    })
  },
  clearMarkdownDocumentHistory: async () => {
    await window.electronAPI.clearMarkdownDocumentHistory()
    set({
      markdownDocumentHistory: [],
      markdownDocumentActive: null,
      markdownDocumentValue: '',
      markdownDocumentLoading: false,
      markdownDocumentSaving: false,
      markdownDocumentError: null,
      markdownDocumentConflict: false,
    })
  },
})
