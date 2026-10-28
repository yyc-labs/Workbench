import { ipcRenderer } from 'electron'
import type { AgentHistoryListArgs, AgentHistoryListResult, AgentHistoryMessagesArgs, AgentHistoryMessagesResult, AgentHistoryResolveSessionPathArgs, AgentHistoryResolveSessionPathResult, AgentHistoryResumeResult, AgentHistorySearchArgs, AgentHistorySearchResult } from '../../shared/types/agentHistory'
import type { AgentHistoryHandoffCreateArgs, AgentHistoryHandoffRecord } from '../../shared/types/agentHistoryHandoff'
import { IPC } from '../main/ipc'

export function createAgentHistoryInvokeApi() {
  return {
    listAgentHistorySessions: (args: AgentHistoryListArgs) => ipcRenderer.invoke(IPC.AGENT_HISTORY_LIST_SESSIONS, args) as Promise<AgentHistoryListResult>,
    readAgentHistoryMessages: (args: AgentHistoryMessagesArgs) => ipcRenderer.invoke(IPC.AGENT_HISTORY_READ_MESSAGES, args) as Promise<AgentHistoryMessagesResult>,

    resolveAgentHistorySessionPath: (args: AgentHistoryResolveSessionPathArgs) => ipcRenderer.invoke(IPC.AGENT_HISTORY_RESOLVE_SESSION_PATH, args) as Promise<AgentHistoryResolveSessionPathResult>,

    searchAgentHistory: (args: AgentHistorySearchArgs) => ipcRenderer.invoke(IPC.AGENT_HISTORY_SEARCH, args) as Promise<AgentHistorySearchResult>,

    resumeAgentHistory: (args: AgentHistoryResolveSessionPathArgs) => ipcRenderer.invoke(IPC.AGENT_HISTORY_RESUME, args) as Promise<AgentHistoryResumeResult>,

    createAgentHistoryHandoff: (args: AgentHistoryHandoffCreateArgs) => ipcRenderer.invoke(IPC.AGENT_HISTORY_HANDOFF_CREATE, args) as Promise<{ ok: true; record: AgentHistoryHandoffRecord } | { ok: false; reason: string }>,
    listAgentHistoryHandoffs: () => ipcRenderer.invoke(IPC.AGENT_HISTORY_HANDOFF_LIST) as Promise<AgentHistoryHandoffRecord[]>,
    confirmAgentHistoryHandoff: (args: { id: string; loaded: boolean }) => ipcRenderer.invoke(IPC.AGENT_HISTORY_HANDOFF_CONFIRM, args) as Promise<AgentHistoryHandoffRecord | null>,

    watchAgentHistory: (args: AgentHistoryResolveSessionPathArgs) => ipcRenderer.invoke(IPC.AGENT_HISTORY_WATCH, args) as Promise<{ ok: true }>,
    unwatchAgentHistory: (args: AgentHistoryResolveSessionPathArgs) => ipcRenderer.invoke(IPC.AGENT_HISTORY_UNWATCH, args) as Promise<{ ok: true }>,
  }
}
