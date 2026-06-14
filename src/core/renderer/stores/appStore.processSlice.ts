import type { StateCreator } from 'zustand'
import type { AppState } from './appStore.types'
import { detectProjectEnvironment } from '../lib/projectEnvironment'
import {
  collectUrlsFromText,
  loadPersistedProcessUrls,
  persistProcessUrls,
  trimTerminalBuffer,
} from './appStore.helpers'

function normalizePathForJoin(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

function resolveRunWorkingDirectory(projectPath: string, runWorkingDirectory?: string): string {
  const raw = runWorkingDirectory?.trim()
  if (!raw) return projectPath
  if (/^[a-z]:[\\/]/i.test(raw) || raw.startsWith('/') || raw.startsWith('\\\\') || raw.startsWith('//')) {
    return raw
  }

  const normalizedProjectPath = normalizePathForJoin(projectPath)
  const normalizedRelativePath = raw.replace(/^[\\/]+/, '').replace(/[\\/]+/g, '/')
  if (!normalizedRelativePath || normalizedRelativePath === '.') return projectPath
  return `${normalizedProjectPath}/${normalizedRelativePath}`
}

export type ProcessActionsSlice = Pick<
  AppState,
  | 'startProject'
  | 'stopProject'
  | 'sendInput'
  | 'appendOutput'
  | 'clearOutput'
  | 'updateProcessStatus'
  | 'handleProcessExit'
  | 'clearProcessUrl'
  | 'syncManagedProcesses'
  | 'rehydrateProcessUrlsFromStorage'
>

export const createProcessActionsSlice: StateCreator<AppState, [], [], ProcessActionsSlice> = (set, get) => ({
  startProject: async (projectId, commandOverride, processId, useWsl, cwdOverride, runStartupModeOverride) => {
    const project = get().projects.find((p) => p.id === projectId)
    if (!project) return

    const command = commandOverride || project.customCommand || project.command
    const pid = processId || projectId
    const isPrimaryProjectRun = pid === projectId
    const runStartupMode = runStartupModeOverride ?? project.runStartupMode ?? 'silent'
    const cwd = resolveRunWorkingDirectory(project.path, cwdOverride ?? project.runWorkingDirectory)
    const projectEnv = detectProjectEnvironment(cwd)
    const resolvedUseWsl =
      useWsl ?? (projectEnv === 'ubuntu' ? true : projectEnv === 'windows' ? false : undefined)

    if (isPrimaryProjectRun && runStartupMode === 'terminal') {
      const opened = await window.electronAPI.openPathTerminal(cwd, command)
      if (opened) {
        return
      }
      // Fall back to managed/background mode if external terminal launch fails.
    }

    set((state) => ({
      processes: {
        ...state.processes,
        [pid]: { pid: null, status: 'running', startTime: Date.now() },
      },
      terminalOutputs: {
        ...state.terminalOutputs,
        [pid]: '',
      },
      processUrls: {
        ...state.processUrls,
        [pid]: [],
      },
    }))

    const started = await window.electronAPI.startProcess(pid, command, cwd, resolvedUseWsl)
    if (!started) {
      await get().syncManagedProcesses()
      return
    }
  },

  stopProject: async (projectId) => {
    set((state) => {
      const existing = state.processes[projectId]
      if (!existing) return state
      return {
        processes: {
          ...state.processes,
          [projectId]: { ...existing, status: 'stopping' },
        },
      }
    })

    await window.electronAPI.stopProcess(projectId)
  },

  sendInput: (projectId, data) => {
    window.electronAPI.sendInput(projectId, data)
  },

  appendOutput: (projectId, data) => {
    set((state) => {
      const normalized = data.replace(/\r?\n/g, '\r\n')
      const prevOutput = state.terminalOutputs[projectId] || ''
      const nextOutput = trimTerminalBuffer(prevOutput + normalized)

      const prevUrls = state.processUrls[projectId] || []
      const chunkUrls = collectUrlsFromText(normalized)
      let uniqueUrls = prevUrls
      if (chunkUrls.length > 0) {
        const merged = [...prevUrls, ...chunkUrls]
        uniqueUrls = [...new Set(merged)]
      }
      if (uniqueUrls.length === 0 && nextOutput.length > 0) {
        uniqueUrls = collectUrlsFromText(nextOutput)
      }

      return {
        terminalOutputs: { ...state.terminalOutputs, [projectId]: nextOutput },
        processUrls: { ...state.processUrls, [projectId]: uniqueUrls },
      }
    })
    persistProcessUrls(get().processUrls)
  },

  clearOutput: (projectId) => {
    set((state) => ({
      terminalOutputs: {
        ...state.terminalOutputs,
        [projectId]: '',
      },
    }))
  },

  updateProcessStatus: (projectId, status) => {
    set((state) => ({
      processes: {
        ...state.processes,
        [projectId]: {
          pid: null,
          status: status as AppState['processes'][string]['status'],
          ...(status === 'error' ? { error: 'Process encountered an error' } : {}),
        },
      },
    }))
  },

  handleProcessExit: (projectId, code) => {
    set((state) => ({
      processes: {
        ...state.processes,
        [projectId]: {
          pid: null,
          status: 'stopped',
          error: code !== 0 ? `Exited with code ${code}` : undefined,
        },
      },
    }))
  },

  clearProcessUrl: (projectId) => {
    set((state) => ({
      processUrls: {
        ...state.processUrls,
        [projectId]: [],
      },
    }))
    persistProcessUrls(get().processUrls)
  },

  rehydrateProcessUrlsFromStorage: () => {
    const validProjectIds = new Set(get().projects.map((p) => p.id))
    const persisted = loadPersistedProcessUrls()
    const filtered: Record<string, string[]> = {}
    for (const [id, urls] of Object.entries(persisted)) {
      if (!validProjectIds.has(id)) continue
      if (urls.length === 0) continue
      filtered[id] = urls
    }
    persistProcessUrls(filtered)
    set((state) => ({
      processUrls: {
        ...filtered,
        ...state.processUrls,
      },
    }))
  },

  syncManagedProcesses: async () => {
    try {
      const inventory = await window.electronAPI.listTerminalProcesses()
      const projects = get().projects
      if (projects.length === 0) return

      const projectIdSet = new Set(projects.map((p) => p.id))
      const runningByProject: Record<string, AppState['processes'][string]> = {}

      for (const item of inventory.managedProcesses) {
        if (item.processId.includes('::toolbox')) continue
        const resolvedProjectId = projectIdSet.has(item.processId)
          ? item.processId
          : (projectIdSet.has(item.projectId) ? item.projectId : null)
        if (!resolvedProjectId) continue
        if (item.backend === 'tmux') continue
        runningByProject[resolvedProjectId] = {
          pid: item.pid ?? null,
          status: 'running',
          startTime: item.startTime,
          backend: item.backend,
        }
      }

      if (Object.keys(runningByProject).length === 0) return
      set((state) => ({
        processes: {
          ...state.processes,
          ...runningByProject,
        },
      }))

      set((state) => {
        let changed = false
        const nextUrls = { ...state.processUrls }
        for (const projectId of Object.keys(runningByProject)) {
          const existing = nextUrls[projectId] || []
          if (existing.length > 0) continue
          const output = state.terminalOutputs[projectId] || ''
          if (!output) continue
          const inferred = collectUrlsFromText(output)
          if (inferred.length === 0) continue
          nextUrls[projectId] = inferred
          changed = true
        }
        if (!changed) return state
        persistProcessUrls(nextUrls)
        return { ...state, processUrls: nextUrls }
      })
    } catch {
      // inventory unavailable; keep current local process state
    }
  },
})
