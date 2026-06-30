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

    getAgentLogDetail: (source: AgentLogSource, id: string) =>
      ipcRenderer.invoke(IPC.AGENT_LOGS_GET_DETAIL, { source, id }) as Promise<AgentLogDetail | null>,

    getAgentLogMarkdown: (source: AgentLogSource, id: string) =>
      ipcRenderer.invoke(IPC.AGENT_LOGS_GET_MARKDOWN, { source, id }) as Promise<string>,
  }
}
