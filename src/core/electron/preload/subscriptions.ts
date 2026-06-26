import { ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '../main/ipc'
import type { AgentHookEnvelope, TranscriptImportedEvent } from '../../shared/types'

type AiCommitOutputData = { projectId: string; data: string }
type AiCommitStatusData = { projectId: string; status: 'running' | 'success' | 'error' }

function subscribeIpcEvent<T>(channel: string, cb: (data: T) => void) {
  const handler = (_event: IpcRendererEvent, data: T) => cb(data)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

function subscribeIpcSignal(channel: string, cb: () => void) {
  const handler = () => cb()
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

function createFanoutSubscription<T>(channel: string) {
  const subscribers = new Set<(data: T) => void>()
  const handler = (_event: IpcRendererEvent, data: T) => {
    for (const callback of subscribers) {
      callback(data)
    }
  }

  return (cb: (data: T) => void) => {
    subscribers.add(cb)
    if (subscribers.size === 1) {
      ipcRenderer.on(channel, handler)
    }
    return () => {
      subscribers.delete(cb)
      if (subscribers.size === 0) {
        ipcRenderer.removeListener(channel, handler)
      }
    }
  }
}

const subscribeAiCommitOutput = createFanoutSubscription<AiCommitOutputData>(IPC.AI_COMMIT_OUTPUT)
const subscribeAiCommitStatus = createFanoutSubscription<AiCommitStatusData>(IPC.AI_COMMIT_STATUS)

export function createSubscriptionApi() {
  return {
    onProcessOutput: (cb: (data: { projectId: string; data: string }) => void) =>
      subscribeIpcEvent(IPC.PROCESS_OUTPUT, cb),

    onProcessStatus: (cb: (data: { projectId: string; status: string }) => void) =>
      subscribeIpcEvent(IPC.PROCESS_STATUS, cb),

    onProcessExit: (cb: (data: { projectId: string; code: number | null }) => void) =>
      subscribeIpcEvent(IPC.PROCESS_EXIT, cb),

    onRuntimeStateChanged: (
      cb: (data: { reason: string; projectId?: string; sessionName?: string }) => void
    ) => subscribeIpcEvent(IPC.RUNTIME_STATE_CHANGED, cb),

    onAiCommitOutput: (cb: (data: AiCommitOutputData) => void) => subscribeAiCommitOutput(cb),

    onAiCommitStatus: (cb: (data: AiCommitStatusData) => void) => subscribeAiCommitStatus(cb),

    onAgentHookEvent: (cb: (data: AgentHookEnvelope) => void) =>
      subscribeIpcEvent(IPC.AGENT_HOOK_EVENT, cb),

    onTranscriptImported: (cb: (data: TranscriptImportedEvent) => void) =>
      subscribeIpcEvent(IPC.TRANSCRIPT_IMPORTED, cb),

    onWindowState: (cb: (data: { isMaximized: boolean }) => void) =>
      subscribeIpcEvent(IPC.WINDOW_STATE, cb),

    onCodeFocusSearch: (cb: () => void) => subscribeIpcSignal(IPC.CODE_FOCUS_SEARCH, cb),

    onCodeToggleViewMode: (cb: () => void) => subscribeIpcSignal(IPC.CODE_TOGGLE_VIEW_MODE, cb),

    onGlobalHomeShortcut: (cb: () => void) =>
      subscribeIpcSignal(IPC.GLOBAL_HOME_SHORTCUT, cb),

    onGlobalThemeShortcut: (cb: () => void) =>
      subscribeIpcSignal(IPC.GLOBAL_THEME_SHORTCUT, cb),
  }
}
