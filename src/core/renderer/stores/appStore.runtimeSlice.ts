import type { StateCreator } from 'zustand'
import type { AppState } from './appStore.types'
import { runtimeManager } from '../runtime/RuntimeManager'

export type RuntimeActionsSlice = Pick<
  AppState,
  | 'loadTmuxSessions'
  | 'refreshSessions'
  | 'loadRuntimeEntries'
  | 'startRuntime'
  | 'stopRuntime'
  | 'openTerminal'
>

export const createRuntimeActionsSlice: StateCreator<AppState, [], [], RuntimeActionsSlice> = (set, get) => ({
  loadTmuxSessions: async () => {
    try {
      const sessions = await window.electronAPI.listTmuxSessions()
      set({ tmuxSessions: sessions })
    } catch {
      // tmux not available
    }
  },

  refreshSessions: async () => {
    try {
      const { projects, runtimeEntries } = get()
      const rawSessions = await runtimeManager.listTmuxSessions()
      const result: AppState['sessions'] = {}

      for (const project of projects) {
        const entry = runtimeEntries[project.id]
        const sessionName = entry?.sessionName
          || runtimeManager.getSessionName(project.id, project.name)

        const tmux = rawSessions.find((s) => s.sessionName === sessionName)

        result[project.id] = {
          projectId: project.id,
          sessionName,
          status: tmux
            ? (tmux.status === 'attached' ? 'attached' : 'detached')
            : 'stopped',
          createdAt: tmux?.createdAt ?? 0,
        }
      }

      set({ sessions: result })
    } catch {
      // tmux may not be available or WSL bridge timed out — sessions stay as-is
    }
  },

  loadRuntimeEntries: async () => {
    try {
      const entries = await window.electronAPI.listRuntimeEntries()
      const map: AppState['runtimeEntries'] = {}
      for (const e of entries) {
        map[e.projectId] = e
      }
      set({ runtimeEntries: map })
    } catch {
      // registry not available
    }
  },

  startRuntime: async (projectId) => {
    const project = get().projects.find((p) => p.id === projectId)
    if (!project) return
    const diagnostics = await window.electronAPI.getRuntimeDiagnostics()
    if (diagnostics.issues.length > 0) {
      const message = diagnostics.issues.map((issue) => `- ${issue}`).join('\n')
      throw new Error(`Runtime preflight checks failed:\n${message}`)
    }
    const ok = await runtimeManager.startRuntime(projectId, project.path, project.cli)
    if (!ok) {
      throw new Error('Runtime failed to start. Please run Runtime diagnostics in Settings.')
    }
    await get().loadRuntimeEntries()
    await get().refreshSessions()
  },

  stopRuntime: async (projectId) => {
    const session = get().sessions[projectId]
    if (!session || session.status === 'stopped') return
    await runtimeManager.stopRuntime(session.sessionName)
    await get().refreshSessions()
  },

  openTerminal: async (projectId, statusHint) => {
    const session = get().sessions[projectId]
    console.log('[store.openTerminal]', { projectId, hasSession: !!session, sessionName: session?.sessionName })
    if (!session) {
      console.log('[store.openTerminal] BAIL — no session')
      return false
    }
    console.log('[store.openTerminal] calling runtimeManager.openTerminal...')
    const ok = await runtimeManager.openTerminal(session.sessionName, statusHint)
    console.log('[store.openTerminal] runtimeManager returned', ok)
    return ok
  },
})

