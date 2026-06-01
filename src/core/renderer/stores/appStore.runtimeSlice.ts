import type { StateCreator } from 'zustand'
import type { AppState } from './appStore.types'
import { runtimeManager } from '../runtime/RuntimeManager'

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function pickLatestSessionName(names: string[], createdAtByName: Map<string, number>): string | null {
  if (names.length === 0) return null
  let latestName = names[0]
  let latestCreatedAt = createdAtByName.get(latestName) ?? 0
  for (let i = 1; i < names.length; i++) {
    const name = names[i]
    const createdAt = createdAtByName.get(name) ?? 0
    if (createdAt >= latestCreatedAt) {
      latestName = name
      latestCreatedAt = createdAt
    }
  }
  return latestName
}

function inferRuntimeSessionName(
  project: AppState['projects'][number],
  sessionNames: string[],
  createdAtByName: Map<string, number>,
): string | null {
  const baseName = project.name?.trim()
  if (!baseName) return null

  const escaped = escapeRegExp(baseName)
  const normalizedCli = project.cli === 'codex' ? 'codex' : 'claude'
  const md5Suffix = '[a-f0-9]{6}'
  const cliPattern = normalizedCli === 'claude'
    ? new RegExp(`^${escaped}-claude-${md5Suffix}$`)
    : new RegExp(`^${escaped}-(?:codex-)?${md5Suffix}$`)
  const genericPattern = new RegExp(`^${escaped}-(?:claude-|codex-)?${md5Suffix}$`)

  const cliMatches = sessionNames.filter((name) => cliPattern.test(name))
  const cliLatest = pickLatestSessionName(cliMatches, createdAtByName)
  if (cliLatest) return cliLatest

  const genericMatches = sessionNames.filter((name) => genericPattern.test(name))
  if (genericMatches.length === 1) return genericMatches[0]
  return pickLatestSessionName(genericMatches, createdAtByName)
}

function pickBestSessionName(
  candidates: string[],
  rawSessionNameSet: Set<string>,
): string {
  for (const name of candidates) {
    if (name && rawSessionNameSet.has(name)) return name
  }
  return candidates.find(Boolean) || ''
}

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
      const rawSessionNames = rawSessions.map((item) => item.sessionName)
      const rawSessionNameSet = new Set(rawSessionNames)
      const createdAtByName = new Map(rawSessions.map((item) => [item.sessionName, item.createdAt] as const))
      const result: AppState['sessions'] = {}

      for (const project of projects) {
        const entry = runtimeEntries[project.id]
        const inferredSessionName = inferRuntimeSessionName(project, rawSessionNames, createdAtByName)
        const fallbackSessionName = runtimeManager.getSessionName(project.id, project.name)
        const sessionName = pickBestSessionName(
          [entry?.sessionName || '', inferredSessionName || '', fallbackSessionName],
          rawSessionNameSet
        )

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
    // Launcher script may create/attach tmux slightly after IPC returns.
    setTimeout(() => {
      void get().refreshSessions()
    }, 1200)
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
