import { ipcRenderer } from 'electron'
import { IPC } from '../main/ipc'

export function createProcessPortsInvokeApi() {
  return {
    listProcessPorts: () => ipcRenderer.invoke(IPC.PROCESS_PORTS_LIST),
  }
}
