import { ipcMain } from 'electron'
import { IPC } from '../ipc'
import type { AiConnectionTestRequest } from '../../../shared/types'
import type { RegisterIpcHandlersDependencies } from './registerIpcHandlers.shared'

export function registerAiConnectionIpcHandlers(deps: RegisterIpcHandlersDependencies): void {
  ipcMain.handle(IPC.AI_CONNECTION_TEST, (_event, input: AiConnectionTestRequest) => {
    return deps.aiConnectionService.testConnection(input)
  })
}
