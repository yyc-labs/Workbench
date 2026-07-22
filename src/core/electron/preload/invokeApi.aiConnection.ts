import { ipcRenderer } from 'electron'
import { IPC } from '../main/ipc'
import type { AiConnectionTestRequest, AiConnectionTestResult } from '../../shared/types'

export function createAiConnectionInvokeApi() {
  return {
    testAiConnection: (input: AiConnectionTestRequest) => ipcRenderer.invoke(IPC.AI_CONNECTION_TEST, input) as Promise<AiConnectionTestResult>,
  }
}
