import { ipcMain } from 'electron'
import { IPC } from '../ipc'
import type { RegisterIpcHandlersDependencies } from './registerIpcHandlers.shared'

export function registerProcessPortsIpcHandlers(deps: RegisterIpcHandlersDependencies): void {
  ipcMain.handle(IPC.PROCESS_PORTS_LIST, () => {
    return deps.processPortService.listProcessPorts()
  })
}
