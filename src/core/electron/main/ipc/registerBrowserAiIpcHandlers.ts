import { ipcMain } from 'electron'
import { IPC } from '../ipc'
import type {
  BrowserAiConfig,
  BrowserAiRunTaskPayload,
  BrowserAiSaveResultPayload,
} from '../../../shared/types'
import type { RegisterIpcHandlersDependencies } from './registerIpcHandlers.shared'

export function registerBrowserAiIpcHandlers(deps: RegisterIpcHandlersDependencies): void {
  ipcMain.handle(IPC.BROWSER_AI_GET_CONFIG, () => deps.browserAiService.getSnapshot())

  ipcMain.handle(
    IPC.BROWSER_AI_SAVE_CONFIG,
    (_event, config: BrowserAiConfig) => deps.browserAiService.saveConfig(config),
  )

  ipcMain.handle(IPC.BROWSER_AI_START, () => deps.browserAiService.start())
  ipcMain.handle(IPC.BROWSER_AI_STOP, () => deps.browserAiService.stop())
  ipcMain.handle(IPC.BROWSER_AI_TEST_CONNECTION, () => deps.browserAiService.testConnection())
  ipcMain.handle(IPC.BROWSER_AI_OPEN_LOGIN, () => deps.browserAiService.openLogin())
  ipcMain.handle(
    IPC.BROWSER_AI_COMPOSE_PREVIEW,
    (_event, payload: BrowserAiRunTaskPayload) => deps.browserAiService.composePreview(payload),
  )
  ipcMain.handle(
    IPC.BROWSER_AI_RUN_TASK,
    (_event, payload: BrowserAiRunTaskPayload) => deps.browserAiService.runTask(payload),
  )
  ipcMain.handle(IPC.BROWSER_AI_CANCEL_TASK, () => deps.browserAiService.cancelTask())
  ipcMain.handle(
    IPC.BROWSER_AI_SAVE_RESULT,
    (_event, payload: BrowserAiSaveResultPayload) => deps.browserAiService.saveResult(payload),
  )
}

