import type { StateCreator } from 'zustand'
import type { BrowserAiConfig, BrowserAiContextPreview, BrowserAiRunTaskPayload, BrowserAiSaveTaskRecordPayload, BrowserAiSaveResultPayload, BrowserAiSnapshot, BrowserAiTaskRecord, BrowserAiTaskRecordSummary, BrowserAiTaskProgressEvent, BrowserAiTaskResult, LearningNote } from '../../shared/types'
import type { AppState } from './appStore.types'

export type BrowserAiActionsSlice = Pick<
  AppState,
  | 'loadBrowserAi'
  | 'saveBrowserAiConfig'
  | 'startBrowserAi'
  | 'stopBrowserAi'
  | 'testBrowserAiConnection'
  | 'openBrowserAiLogin'
  | 'composeBrowserAiPreview'
  | 'runBrowserAiTask'
  | 'cancelBrowserAiTask'
  | 'saveBrowserAiResult'
  | 'loadBrowserAiTaskRecords'
  | 'loadBrowserAiTaskRecord'
  | 'saveBrowserAiTaskRecord'
  | 'deleteBrowserAiTaskRecord'
>

function applyProgressSnapshot(snapshot: BrowserAiSnapshot | null, progress: BrowserAiTaskProgressEvent): BrowserAiSnapshot | null {
  if (!snapshot) return snapshot
  return {
    ...snapshot,
    taskStatus: progress.status,
    activeTaskId: progress.status === 'completed' || progress.status === 'failed' || progress.status === 'cancelled' ? undefined : progress.taskId,
    errorCode: progress.errorCode ?? snapshot.errorCode,
    errorMessage: progress.message ?? snapshot.errorMessage,
  }
}

export const createBrowserAiActionsSlice: StateCreator<AppState, [], [], BrowserAiActionsSlice> = (set) => ({
  loadBrowserAi: async () => {
    const snapshot = await window.electronAPI.getBrowserAiConfig()
    set({ browserAi: snapshot })
    return snapshot
  },

  saveBrowserAiConfig: async (config: BrowserAiConfig) => {
    const snapshot = await window.electronAPI.saveBrowserAiConfig(config)
    set({ browserAi: snapshot })
    return snapshot
  },

  startBrowserAi: async () => {
    const snapshot = await window.electronAPI.startBrowserAi()
    set({ browserAi: snapshot })
    return snapshot
  },

  stopBrowserAi: async () => {
    const snapshot = await window.electronAPI.stopBrowserAi()
    set({ browserAi: snapshot })
    return snapshot
  },

  testBrowserAiConnection: () => window.electronAPI.testBrowserAiConnection(),

  openBrowserAiLogin: async () => {
    const snapshot = await window.electronAPI.openBrowserAiLogin()
    set({ browserAi: snapshot })
    return snapshot
  },

  composeBrowserAiPreview: (payload: BrowserAiRunTaskPayload): Promise<BrowserAiContextPreview> => window.electronAPI.composeBrowserAiPreview(payload),

  runBrowserAiTask: async (payload: BrowserAiRunTaskPayload): Promise<BrowserAiTaskResult> => {
    set({ browserAiSteps: [], browserAiProgress: null })
    const result = await window.electronAPI.runBrowserAiTask(payload)
    set((state) => ({
      browserAiSteps: result.steps,
      browserAi: state.browserAi
        ? {
            ...state.browserAi,
            taskStatus: result.status,
            activeTaskId: undefined,
            lastResult: result,
            errorCode: result.errorCode,
            errorMessage: result.errorMessage,
          }
        : state.browserAi,
    }))
    return result
  },

  cancelBrowserAiTask: async () => {
    const snapshot = await window.electronAPI.cancelBrowserAiTask()
    set({ browserAi: snapshot })
    return snapshot
  },

  saveBrowserAiResult: (payload: BrowserAiSaveResultPayload): Promise<LearningNote> => window.electronAPI.saveBrowserAiResult(payload),

  loadBrowserAiTaskRecords: async (): Promise<BrowserAiTaskRecordSummary[]> => {
    const records = await window.electronAPI.listBrowserAiTaskRecords()
    set({ browserAiTaskRecords: records })
    return records
  },

  loadBrowserAiTaskRecord: async (recordId: string): Promise<BrowserAiTaskRecord | null> => {
    const record = await window.electronAPI.getBrowserAiTaskRecord(recordId)
    set({ browserAiTaskRecord: record })
    return record
  },

  saveBrowserAiTaskRecord: async (payload: BrowserAiSaveTaskRecordPayload): Promise<BrowserAiTaskRecord> => {
    const record = await window.electronAPI.saveBrowserAiTaskRecord(payload)
    set((state) => ({
      browserAiTaskRecord: record,
      browserAiTaskRecords: [
        {
          id: record.id,
          title: record.title,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          startedAt: record.startedAt,
          completedAt: record.completedAt,
          status: record.status,
          siteName: record.site.name,
          taskExcerpt: (record.input.task ?? '').replace(/\s+/g, ' ').trim().slice(0, 180),
          sourceLabels: record.sources.filter((source) => source.included).map((source) => source.label),
          answerExcerpt: (record.answer ?? record.errorMessage ?? '').replace(/\s+/g, ' ').trim().slice(0, 180),
          errorCode: record.errorCode,
        },
        ...state.browserAiTaskRecords.filter((item) => item.id !== record.id),
      ],
    }))
    return record
  },

  deleteBrowserAiTaskRecord: async (recordId: string): Promise<boolean> => {
    const deleted = await window.electronAPI.deleteBrowserAiTaskRecord(recordId)
    if (deleted) {
      set((state) => ({
        browserAiTaskRecords: state.browserAiTaskRecords.filter((item) => item.id !== recordId),
        browserAiTaskRecord: state.browserAiTaskRecord?.id === recordId ? null : state.browserAiTaskRecord,
      }))
    }
    return deleted
  },
})

export function applyBrowserAiProgress(set: (updater: (state: AppState) => Partial<AppState>) => void, progress: BrowserAiTaskProgressEvent): void {
  set((state) => ({
    ...(state.browserAiProgress && state.browserAiProgress.taskId !== progress.taskId
      ? {}
      : {
          browserAiProgress: progress,
          browserAiSteps: progress.steps ?? state.browserAiSteps,
          browserAi: applyProgressSnapshot(state.browserAi, progress),
        }),
  }))
}
