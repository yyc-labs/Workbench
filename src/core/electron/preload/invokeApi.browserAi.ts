import { ipcRenderer } from 'electron'
import { IPC } from '../main/ipc'
import type {
  BrowserAiConfig,
  BrowserAiConnectionTestResult,
  BrowserAiContextPreview,
  BrowserAiRunTaskPayload,
  BrowserAiSaveTaskRecordPayload,
  BrowserAiSaveResultPayload,
  BrowserAiSnapshot,
  BrowserAiTaskResult,
  LearningNote,
} from '../../shared/types'

export function createBrowserAiInvokeApi() {
  return {
    getBrowserAiConfig: () => ipcRenderer.invoke(IPC.BROWSER_AI_GET_CONFIG) as Promise<BrowserAiSnapshot>,
    saveBrowserAiConfig: (config: BrowserAiConfig) =>
      ipcRenderer.invoke(IPC.BROWSER_AI_SAVE_CONFIG, config) as Promise<BrowserAiSnapshot>,
    startBrowserAi: () => ipcRenderer.invoke(IPC.BROWSER_AI_START) as Promise<BrowserAiSnapshot>,
    stopBrowserAi: () => ipcRenderer.invoke(IPC.BROWSER_AI_STOP) as Promise<BrowserAiSnapshot>,
    testBrowserAiConnection: () =>
      ipcRenderer.invoke(IPC.BROWSER_AI_TEST_CONNECTION) as Promise<BrowserAiConnectionTestResult>,
    openBrowserAiLogin: () => ipcRenderer.invoke(IPC.BROWSER_AI_OPEN_LOGIN) as Promise<BrowserAiSnapshot>,
    composeBrowserAiPreview: (payload: BrowserAiRunTaskPayload) =>
      ipcRenderer.invoke(IPC.BROWSER_AI_COMPOSE_PREVIEW, payload) as Promise<BrowserAiContextPreview>,
    runBrowserAiTask: (payload: BrowserAiRunTaskPayload) =>
      ipcRenderer.invoke(IPC.BROWSER_AI_RUN_TASK, payload) as Promise<BrowserAiTaskResult>,
    cancelBrowserAiTask: () => ipcRenderer.invoke(IPC.BROWSER_AI_CANCEL_TASK) as Promise<BrowserAiSnapshot>,
    saveBrowserAiResult: (payload: BrowserAiSaveResultPayload) =>
      ipcRenderer.invoke(IPC.BROWSER_AI_SAVE_RESULT, payload) as Promise<LearningNote>,
    listBrowserAiTaskRecords: () => ipcRenderer.invoke(IPC.BROWSER_AI_LIST_RECORDS),
    getBrowserAiTaskRecord: (recordId: string) =>
      ipcRenderer.invoke(IPC.BROWSER_AI_GET_RECORD, recordId) as Promise<import('../../shared/types').BrowserAiTaskRecord | null>,
    saveBrowserAiTaskRecord: (payload: BrowserAiSaveTaskRecordPayload) =>
      ipcRenderer.invoke(IPC.BROWSER_AI_SAVE_RECORD, payload) as Promise<import('../../shared/types').BrowserAiTaskRecord>,
    deleteBrowserAiTaskRecord: (recordId: string) =>
      ipcRenderer.invoke(IPC.BROWSER_AI_DELETE_RECORD, recordId) as Promise<boolean>,
  }
}
