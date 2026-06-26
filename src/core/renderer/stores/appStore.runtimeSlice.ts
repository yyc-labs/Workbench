import type { StateCreator } from 'zustand'
import type { AppState } from './appStore.types'
import { runtimeManager } from '../runtime/RuntimeManager'
import { translateCurrent } from '../i18n'

function waitForDelay(delayMs: number): Promise<void> {
  if (delayMs <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs)
  })
}

function sessionsEqual(
  prev: AppState['sessions'],
  next: AppState['sessions'],
): boolean {
  const prevKeys = Object.keys(prev)
  const nextKeys = Object.keys(next)
  if (prevKeys.length !== nextKeys.length) return false

  for (const key of nextKeys) {
    const prevSession = prev[key]
    const nextSession = next[key]
    if (!prevSession || !nextSession) return false
    if (
      prevSession.projectId !== nextSession.projectId
      || prevSession.sessionName !== nextSession.sessionName
      || prevSession.status !== nextSession.status
      || prevSession.createdAt !== nextSession.createdAt
    ) {
      return false
    }
  }

  return true
}

function runtimeEntriesEqual(
  prev: AppState['runtimeEntries'],
  next: AppState['runtimeEntries'],
): boolean {
  const prevKeys = Object.keys(prev)
  const nextKeys = Object.keys(next)
  if (prevKeys.length !== nextKeys.length) return false

  for (const key of nextKeys) {
    const prevEntry = prev[key]
    const nextEntry = next[key]
    if (!prevEntry || !nextEntry) return false
    if (
      prevEntry.projectId !== nextEntry.projectId
      || prevEntry.sessionName !== nextEntry.sessionName
      || prevEntry.createdAt !== nextEntry.createdAt
      || prevEntry.lastOpened !== nextEntry.lastOpened
      || (prevEntry.pid ?? null) !== (nextEntry.pid ?? null)
      || (prevEntry.pidStartedAt ?? null) !== (nextEntry.pidStartedAt ?? null)
      || (prevEntry.mode ?? null) !== (nextEntry.mode ?? null)
    ) {
      return false
    }
  }

  return true
}

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
  | 'refreshRuntimeState'
  | 'loadRuntimeEntries'
  | 'startRuntime'
  | 'stopRuntime'
  | 'openTerminal'
>

let runtimeRefreshInFlight: Promise<void> | null = null
let pendingRuntimeRefreshMode: 'sessions' | 'all' | null = null

function mergeRuntimeRefreshMode(
  current: 'sessions' | 'all',
  next: 'sessions' | 'all',
): 'sessions' | 'all' {
  return current === 'all' || next === 'all' ? 'all' : 'sessions'
}

export const createRuntimeActionsSlice: StateCreator<AppState, [], [], RuntimeActionsSlice> = (set, get) => {
  const refreshRuntimeStateInternal = async (mode: 'sessions' | 'all' = 'sessions') => {
    if (runtimeRefreshInFlight) {
      pendingRuntimeRefreshMode = pendingRuntimeRefreshMode
        ? mergeRuntimeRefreshMode(pendingRuntimeRefreshMode, mode)
        : mode
      await runtimeRefreshInFlight
      return
    }

    const run = async (refreshMode: 'sessions' | 'all') => {
      if (refreshMode === 'all') {
        await get().loadRuntimeEntries()
      }
      await get().refreshSessions()
    }

    runtimeRefreshInFlight = (async () => {
      let currentMode: 'sessions' | 'all' = mode
      for (;;) {
        await run(currentMode)
        const nextMode = pendingRuntimeRefreshMode
        pendingRuntimeRefreshMode = null
        if (!nextMode) break
        currentMode = mergeRuntimeRefreshMode(currentMode, nextMode)
      }
    })()

    try {
      await runtimeRefreshInFlight
    } finally {
      runtimeRefreshInFlight = null
    }
  }

  return {
    loadTmuxSessions: async () => {
      try {
        const sessions = await window.electronAPI.listTmuxSessions()
        set((state) => {
          if (state.tmuxSessions.length === sessions.length) {
            let unchanged = true
            for (let i = 0; i < sessions.length; i++) {
              const prev = state.tmuxSessions[i]
              const next = sessions[i]
              if (
                prev?.sessionName !== next.sessionName
                || prev?.projectId !== next.projectId
                || prev?.createdAt !== next.createdAt
                || prev?.status !== next.status
              ) {
                unchanged = false
                break
              }
            }
            if (unchanged) return state
          }
          return { tmuxSessions: sessions }
        })
      } catch {
        // tmux not available
      }
    },

    refreshSessions: async () => {
      try {
        const { projects, runtimeEntries } = get()
        const rawSessions = await runtimeManager.listRuntimeSessions()
        const rawSessionNames = rawSessions.map((item) => item.sessionName)
        const rawSessionNameSet = new Set(rawSessionNames)
        const createdAtByName = new Map(rawSessions.map((item) => [item.sessionName, item.createdAt] as const))
        const result: AppState['sessions'] = {}

        for (const project of projects) {
          const entry = runtimeEntries[project.id]
          const inferredSessionName = inferRuntimeSessionName(project, rawSessionNames, createdAtByName)
          const sessionName = pickBestSessionName(
            [entry?.sessionName || '', inferredSessionName || ''],
            rawSessionNameSet
          )

          const runtimeSession = rawSessions.find((s) => s.sessionName === sessionName)

          result[project.id] = {
            projectId: project.id,
            sessionName,
            status: runtimeSession
              ? (runtimeSession.status === 'attached' ? 'attached' : 'detached')
              : 'stopped',
            createdAt: runtimeSession?.createdAt ?? 0,
          }
        }

        set((state) => (sessionsEqual(state.sessions, result) ? state : { sessions: result }))
      } catch {
        // tmux may not be available or WSL bridge timed out — sessions stay as-is
      }
    },

    refreshRuntimeState: async (mode = 'sessions') => {
      await refreshRuntimeStateInternal(mode)
    },

    loadRuntimeEntries: async () => {
      try {
        const entries = await window.electronAPI.listRuntimeEntries()
        const map: AppState['runtimeEntries'] = {}
        for (const e of entries) {
          map[e.projectId] = e
        }
        set((state) => (runtimeEntriesEqual(state.runtimeEntries, map) ? state : { runtimeEntries: map }))
      } catch {
        // registry not available
      }
    },

    startRuntime: async (projectId) => {
      const state = get()
      const project = state.projects.find((p) => p.id === projectId)
      if (!project) return
      const cooldownRemainingMs = Math.max(0, state.runtimeModeSwitchCooldownUntil - Date.now())
      if (cooldownRemainingMs > 0) {
        await waitForDelay(cooldownRemainingMs)
      }
      const diagnostics = await window.electronAPI.getRuntimeDiagnostics()
      if (diagnostics.issues.length > 0) {
        const message = diagnostics.issues.map((issue) => `- ${issue}`).join('\n')
        throw new Error(translateCurrent('settingsRuntime.preflightFailed', { message }))
      }
      const ok = await runtimeManager.startRuntime(projectId, project.path, project.cli)
      if (!ok) {
        throw new Error(
          translateCurrent('settingsRuntime.startFailed', {
            diagnostics: translateCurrent('settingsRuntime.diagnostics'),
            settings: translateCurrent('common.settings'),
          })
        )
      }
      await refreshRuntimeStateInternal('all')
      // Launcher script may create/attach tmux slightly after IPC returns.
      setTimeout(() => {
        void refreshRuntimeStateInternal('all')
      }, 1200)
    },

    stopRuntime: async (projectId) => {
      const session = get().sessions[projectId]
      if (!session || session.status === 'stopped') return
      await runtimeManager.stopRuntime(session.sessionName)
      await refreshRuntimeStateInternal('all')
    },

    openTerminal: async (projectId, statusHint) => {
      const session = get().sessions[projectId]
      if (!session) {
        return false
      }
      return runtimeManager.openTerminal(session.sessionName, statusHint)
    },
  }
}
