import { ipcRenderer } from 'electron'
import { IPC } from '../main/ipc'
import type {
  AgentLogDetail,
  AgentLogSource,
  AgentLogSummary,
} from '../../shared/types'

export function createAgentLogsInvokeApi() {
  return {
    getAgentLogSummaries: () =>
      ipcRenderer.invoke(IPC.AGENT_LOGS_LIST) as Promise<AgentLogSummary[]>,

    clearAgentLogs: () =>
      ipcRenderer.invoke(IPC.AGENT_LOGS_CLEAR) as Promise<boolean>,

    getAgentLogDetail: (source: AgentLogSource, id: string) =>
      ipcRenderer.invoke(IPC.AGENT_LOGS_GET_DETAIL, { source, id }) as Promise<AgentLogDetail | null>,
  }
}
