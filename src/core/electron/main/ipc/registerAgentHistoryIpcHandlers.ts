/**
 * Agent history IPC (docs/todo/19 stage 1e). The renderer passes projectId /
 * sessionKey only — never disk paths. Scope checks happen here and inside the
 * scan service against trusted project config.
 */
import { ipcMain } from 'electron'
import { AGENT_HISTORY_AGENTS, AGENT_HISTORY_LIMITS, type AgentHistoryListArgs, type AgentHistorySearchArgs } from '../../../shared/types/agentHistory'
import type { AgentHistoryHandoffCreateArgs } from '../../../shared/types/agentHistoryHandoff'
import { IPC } from '../ipc'
import type { RegisterIpcHandlersDependencies } from './registerIpcHandlers.shared'

function parseListArgs(payload: unknown): AgentHistoryListArgs {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid agent history list payload.')
  const request = payload as { projectId?: unknown; agent?: unknown; limit?: unknown; cursor?: unknown }
  if (typeof request.projectId !== 'string' || !request.projectId) throw new Error('Invalid agent history projectId.')
  if (request.agent !== undefined && (typeof request.agent !== 'string' || !(AGENT_HISTORY_AGENTS as readonly string[]).includes(request.agent))) {
    throw new Error('Invalid agent history agent filter.')
  }
  if (request.limit !== undefined && (typeof request.limit !== 'number' || !Number.isInteger(request.limit) || request.limit < 1 || request.limit > AGENT_HISTORY_LIMITS.maxPageSize)) {
    throw new Error('Invalid agent history limit.')
  }
  if (request.cursor !== undefined && typeof request.cursor !== 'string') {
    throw new Error('Invalid agent history cursor.')
  }
  return {
    projectId: request.projectId,
    ...(request.agent !== undefined ? { agent: request.agent as AgentHistoryListArgs['agent'] } : {}),
    ...(request.limit !== undefined ? { limit: request.limit } : {}),
    ...(request.cursor !== undefined ? { cursor: request.cursor } : {}),
  }
}

function parseResolveArgs(payload: unknown): { projectId: string; sessionKey: string } {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid agent history resolve payload.')
  const request = payload as { projectId?: unknown; sessionKey?: unknown }
  if (typeof request.projectId !== 'string' || !request.projectId) throw new Error('Invalid agent history projectId.')
  if (typeof request.sessionKey !== 'string' || !request.sessionKey) throw new Error('Invalid agent history sessionKey.')
  return { projectId: request.projectId, sessionKey: request.sessionKey }
}

const watchSenders = new Map<string, Electron.WebContents>()

function parseProjectArgs(payload: unknown): { projectId: string } {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid agent history watch payload.')
  const request = payload as { projectId?: unknown }
  if (typeof request.projectId !== 'string' || !request.projectId) throw new Error('Invalid agent history projectId.')
  return { projectId: request.projectId }
}

function parseSearchArgs(payload: unknown): AgentHistorySearchArgs {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid agent history search payload.')
  const request = payload as { projectId?: unknown; query?: unknown; agent?: unknown; limit?: unknown; cursor?: unknown }
  if (typeof request.query !== 'string' || !request.query.trim()) throw new Error('Invalid agent history search query.')
  if (request.projectId !== undefined && (typeof request.projectId !== 'string' || !request.projectId)) throw new Error('Invalid agent history search projectId.')
  if (request.agent !== undefined && (typeof request.agent !== 'string' || !(AGENT_HISTORY_AGENTS as readonly string[]).includes(request.agent))) {
    throw new Error('Invalid agent history search agent filter.')
  }
  if (request.limit !== undefined && (typeof request.limit !== 'number' || !Number.isInteger(request.limit) || request.limit < 1)) {
    throw new Error('Invalid agent history search limit.')
  }
  if (request.cursor !== undefined && (typeof request.cursor !== 'number' || request.cursor < 0)) {
    throw new Error('Invalid agent history search cursor.')
  }
  return {
    query: request.query,
    ...(request.projectId !== undefined ? { projectId: request.projectId } : {}),
    ...(request.agent !== undefined ? { agent: request.agent as AgentHistorySearchArgs['agent'] } : {}),
    ...(request.limit !== undefined ? { limit: request.limit } : {}),
    ...(request.cursor !== undefined ? { cursor: request.cursor } : {}),
  }
}

export function registerAgentHistoryIpcHandlers(deps: RegisterIpcHandlersDependencies): void {
  ipcMain.handle(IPC.AGENT_HISTORY_LIST_SESSIONS, (_event, payload: unknown) => {
    return deps.agentHistoryService.listSessions(parseListArgs(payload))
  })

  ipcMain.handle(IPC.AGENT_HISTORY_READ_MESSAGES, (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid agent history messages payload.')
    const value = payload as { projectId?: unknown; sessionKey?: unknown; agent?: unknown; before?: unknown; limit?: unknown }
    if (typeof value.projectId !== 'string' || !value.projectId || typeof value.sessionKey !== 'string' || !value.sessionKey || typeof value.agent !== 'string' || !(AGENT_HISTORY_AGENTS as readonly string[]).includes(value.agent)) throw new Error('Invalid agent history messages identity.')
    if (typeof value.before !== 'number' || !Number.isInteger(value.before) || value.before < 0 || (value.limit !== undefined && (typeof value.limit !== 'number' || !Number.isInteger(value.limit) || value.limit < 1 || value.limit > 100))) throw new Error('Invalid agent history message page.')
    return deps.agentHistoryService.readMessages({ projectId: value.projectId, sessionKey: value.sessionKey, agent: value.agent as AgentHistoryListArgs['agent'] & string, before: value.before, limit: value.limit as number | undefined })
  })

  ipcMain.handle(IPC.AGENT_HISTORY_RESUME, (_event, payload: unknown) => {
    const args = parseResolveArgs(payload)
    return deps.agentHistoryResume.resume(args)
  })

  ipcMain.handle(IPC.AGENT_HISTORY_HANDOFF_CREATE, (_event, payload: unknown) => {
    const args = payload as AgentHistoryHandoffCreateArgs
    return deps.agentHistoryHandoff.create(args)
  })

  ipcMain.handle(IPC.AGENT_HISTORY_HANDOFF_LIST, () => {
    return deps.agentHistoryHandoff.list()
  })

  ipcMain.handle(IPC.AGENT_HISTORY_HANDOFF_CONFIRM, (_event, payload: unknown) => {
    const args = payload as { id: string; loaded: boolean }
    return deps.agentHistoryHandoff.confirm(args.id, args.loaded)
  })

  ipcMain.handle(IPC.AGENT_HISTORY_SEARCH, (_event, payload: unknown) => {
    return deps.agentHistoryFulltext.search(parseSearchArgs(payload))
  })

  ipcMain.handle(IPC.AGENT_HISTORY_RESOLVE_SESSION_PATH, (_event, payload: unknown) => {
    const args = parseResolveArgs(payload)
    return deps.agentHistoryService.resolveSessionPath(args.projectId, args.sessionKey)
  })

  // Stage 4: watch lifecycle. The webContents sender is captured so the
  // change event goes back to the page that asked (multi-window safe).
  ipcMain.handle(IPC.AGENT_HISTORY_WATCH, (event, payload: unknown) => {
    const args = parseProjectArgs(payload)
    deps.agentHistoryWatch.watch(args.projectId)
    watchSenders.set(args.projectId, event.sender)
    return { ok: true }
  })

  ipcMain.handle(IPC.AGENT_HISTORY_UNWATCH, (_event, payload: unknown) => {
    const args = parseProjectArgs(payload)
    watchSenders.delete(args.projectId)
    deps.agentHistoryWatch.unwatch(args.projectId)
    return { ok: true }
  })
}
