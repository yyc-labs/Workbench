import type { StateCreator } from 'zustand'
import { classifyMarkdownDocumentCompatibility, classifyMarkdownDocumentComplexity, inferMarkdownDocumentDisplayMode } from '../pages/markdown-document/markdownDocumentCapabilities'
import type { MarkdownDocumentHistoryEntry, MarkdownDocumentReadResult } from '../../shared/types'
import type { MarkdownDocumentDisplayMode } from '../pages/markdown-document/markdownDocumentTypes'
import type { AppState } from './appStore.types'

function getMarkdownDocumentDisplayName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath
}

function createMarkdownDocumentHistoryEntry(document: MarkdownDocumentReadResult): MarkdownDocumentHistoryEntry {
  return {
    path: document.path,
    normalizedPath: document.path,
    displayName: getMarkdownDocumentDisplayName(document.path),
    lastOpenedAt: Date.now(),
    lastKnownMtimeMs: document.mtimeMs,
  }
}

export type MarkdownDocumentSlice = Pick<
  AppState,
  | 'markdownDocumentHistory'
  | 'markdownDocumentActive'
  | 'markdownDocumentValue'
  | 'markdownDocumentMode'
  | 'markdownDocumentDirty'
  | 'markdownDocumentCompatibility'
  | 'markdownDocumentComplexity'
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
  markdownDocumentDirty: false,
  markdownDocumentCompatibility: null,
  markdownDocumentComplexity: null,
  markdownDocumentLoading: false,
  markdownDocumentSaving: false,
  markdownDocumentError: null,
  markdownDocumentConflict: false,
  loadMarkdownDocumentHistory: async () => {
    const history = await window.electronAPI.listMarkdownDocumentHistory()
    set({ markdownDocumentHistory: history })
  },
  openMarkdownDocument: async (filePath: string, options?: { refreshHistory?: boolean }) => {
    set({ markdownDocumentLoading: true, markdownDocumentError: null, markdownDocumentConflict: false })
    try {
      const document = await window.electronAPI.readMarkdownDocument(filePath)
      const compatibility = classifyMarkdownDocumentCompatibility(document.content)
      const complexity = classifyMarkdownDocumentComplexity(document.content)
      set({
        markdownDocumentActive: document,
        markdownDocumentValue: document.content,
        markdownDocumentMode: inferMarkdownDocumentDisplayMode(document.content),
        markdownDocumentDirty: false,
        markdownDocumentCompatibility: compatibility,
        markdownDocumentComplexity: complexity,
        markdownDocumentLoading: false,
      })
      if (options?.refreshHistory) await get().loadMarkdownDocumentHistory()
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
      const compatibility = classifyMarkdownDocumentCompatibility(document.content)
      const complexity = classifyMarkdownDocumentComplexity(document.content)
      set({
        markdownDocumentActive: document,
        markdownDocumentValue: document.content,
        markdownDocumentMode: inferMarkdownDocumentDisplayMode(document.content),
        markdownDocumentDirty: false,
        markdownDocumentCompatibility: compatibility,
        markdownDocumentComplexity: complexity,
        markdownDocumentLoading: false,
      })
      await get().loadMarkdownDocumentHistory()
    } catch (error) {
      set({ markdownDocumentLoading: false, markdownDocumentError: error instanceof Error ? error.message : String(error) })
    }
  },
  setMarkdownDocumentValue: (value: string) => set({ markdownDocumentValue: value, markdownDocumentDirty: value !== get().markdownDocumentActive?.content }),
  setMarkdownDocumentMode: (mode: MarkdownDocumentDisplayMode) => set({ markdownDocumentMode: mode }),
  saveMarkdownDocument: async () => {
    const active = get().markdownDocumentActive
    const content = get().markdownDocumentValue
    if (!active || get().markdownDocumentSaving || (!get().markdownDocumentDirty && content === active.content)) return
    set({ markdownDocumentSaving: true, markdownDocumentError: null })
    try {
      const saved = await window.electronAPI.writeMarkdownDocument(active.path, content, active.mtimeMs)
      set({
        markdownDocumentActive: { ...active, ...saved, content },
        markdownDocumentSaving: false,
        markdownDocumentConflict: false,
        markdownDocumentDirty: false,
      })
    } catch (error) {
      set({ markdownDocumentSaving: false, markdownDocumentConflict: (error as { code?: string }).code === 'conflict', markdownDocumentError: error instanceof Error ? error.message : String(error) })
    }
  },
  removeMarkdownDocumentHistory: async (filePath: string) => {
    if (get().markdownDocumentActive?.path === filePath) return
    const history = await window.electronAPI.removeMarkdownDocumentHistory(filePath)
    set({ markdownDocumentHistory: history })
  },
  clearMarkdownDocumentHistory: async () => {
    const active = get().markdownDocumentActive
    const activeHistoryEntry = active ? get().markdownDocumentHistory.find((entry) => entry.path === active.path) : null
    await window.electronAPI.clearMarkdownDocumentHistory()
    set({ markdownDocumentHistory: active ? [activeHistoryEntry ?? createMarkdownDocumentHistoryEntry(active)] : [] })
  },
})
