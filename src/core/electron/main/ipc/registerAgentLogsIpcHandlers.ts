import { ipcMain } from 'electron'
import { IPC } from '../ipc'
import type { AgentLogSource } from '../../../shared/types'
import type { RegisterIpcHandlersDependencies } from './registerIpcHandlers.shared'

function normalizeSource(value: unknown): AgentLogSource {
  return value === 'agent-hooks' ? 'agent-hooks' : 'ai-gateway'
}

export function registerAgentLogsIpcHandlers(
  deps: RegisterIpcHandlersDependencies,
): void {
  ipcMain.handle(IPC.AGENT_LOGS_LIST, () => {
    return deps.agentLogService.listSummaries()
  })

  ipcMain.handle(IPC.AGENT_LOGS_CLEAR, () => {
    deps.agentLogService.clearAll()
    return true
  })

  ipcMain.handle(IPC.AGENT_LOGS_GET_DETAIL, (_event, payload: unknown) => {
    const request = payload && typeof payload === 'object'
      ? payload as { source?: unknown; id?: unknown }
      : {}
    const id = typeof request.id === 'string' ? request.id : ''
    return deps.agentLogService.getDetail(normalizeSource(request.source), id)
  })
}
