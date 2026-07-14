import type { StateCreator } from 'zustand'
import type {
  BrowserAiConfig,
  BrowserAiContextPreview,
  BrowserAiRunTaskPayload,
  BrowserAiSaveResultPayload,
  BrowserAiSnapshot,
  BrowserAiTaskProgressEvent,
  BrowserAiTaskResult,
  LearningNote,
} from '../../shared/types'
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
>

function applyProgressSnapshot(
  snapshot: BrowserAiSnapshot | null,
  progress: BrowserAiTaskProgressEvent,
): BrowserAiSnapshot | null {
  if (!snapshot) return snapshot
  return {
    ...snapshot,
    taskStatus: progress.status,
    activeTaskId: progress.status === 'completed' || progress.status === 'failed' || progress.status === 'cancelled'
      ? undefined
      : progress.taskId,
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

  composeBrowserAiPreview: (payload: BrowserAiRunTaskPayload): Promise<BrowserAiContextPreview> =>
    window.electronAPI.composeBrowserAiPreview(payload),

  runBrowserAiTask: async (payload: BrowserAiRunTaskPayload): Promise<BrowserAiTaskResult> => {
    const result = await window.electronAPI.runBrowserAiTask(payload)
    set((state) => ({
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

  saveBrowserAiResult: (payload: BrowserAiSaveResultPayload): Promise<LearningNote> =>
    window.electronAPI.saveBrowserAiResult(payload),
})

export function applyBrowserAiProgress(
  set: (updater: (state: AppState) => Partial<AppState>) => void,
  progress: BrowserAiTaskProgressEvent,
): void {
  set((state) => ({
    browserAiProgress: progress,
    browserAi: applyProgressSnapshot(state.browserAi, progress),
  }))
}

