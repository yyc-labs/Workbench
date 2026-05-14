import { create } from 'zustand'
import type { ProjectInfo, ProcessInfo, AppConfig, Capability, TmuxSessionInfo, RecoveredSession } from '../../shared/types'

declare global {
  interface Window {
    electronAPI: {
      detectProjects: (path: string) => Promise<ProjectInfo | null>
      startProcess: (id: string, cmd: string, cwd: string, useWsl?: boolean) => Promise<boolean>
      stopProcess: (id: string) => Promise<boolean>
      sendInput: (id: string, data: string) => Promise<boolean>
      getConfig: () => Promise<AppConfig>
      setConfig: (config: Record<string, unknown>) => Promise<AppConfig>
      selectDirectory: () => Promise<string | null>
      onProcessOutput: (
        cb: (d: { projectId: string; data: string }) => void
      ) => () => void
      onProcessStatus: (
        cb: (d: { projectId: string; status: string }) => void
      ) => () => void
      onProcessExit: (
        cb: (d: { projectId: string; code: number | null }) => void
      ) => () => void
      openExternal: (url: string) => Promise<void>
      resizeTerminal: (id: string, cols: number, rows: number) => Promise<boolean>
      getCapability: () => Promise<Capability>
      listTmuxSessions: () => Promise<TmuxSessionInfo[]>
      killTmuxSession: (id: string) => Promise<boolean>
      rehydrateTmuxSessions: () => Promise<RecoveredSession[]>
      startRuntime: (projectId: string, projectPath: string, sessionName: string) => Promise<boolean>
      openTerminal: (sessionName: string) => Promise<boolean>
    }
  }
}

interface AppState {
  projects: ProjectInfo[]
  processes: Record<string, ProcessInfo>
  terminalOutputs: Record<string, string>
  processUrls: Record<string, string>
  config: AppConfig
  searchQuery: string
  capability: Capability | null
  tmuxSessions: TmuxSessionInfo[]

  loadConfig: () => Promise<void>
  initApp: () => Promise<void>
  addProject: (dirPath: string) => Promise<void>
  removeProject: (projectId: string) => Promise<void>
  startProject: (projectId: string, commandOverride?: string, processId?: string, useWsl?: boolean) => Promise<void>
  stopProject: (projectId: string) => Promise<void>
  reattachProject: (projectId: string, processId?: string) => Promise<void>
  appendOutput: (projectId: string, data: string) => void
  clearOutput: (projectId: string) => void
  updateProcessStatus: (projectId: string, status: string) => void
  handleProcessExit: (projectId: string, code: number | null) => void
  sendInput: (projectId: string, data: string) => void
  setSearchQuery: (query: string) => void
  togglePin: (projectId: string) => void
  updateLastOpened: (projectId: string) => void
  clearProcessUrl: (projectId: string) => void
  loadTmuxSessions: () => Promise<void>
  markProjectDetached: (projectId: string) => void
}

async function persistProjects(projects: ProjectInfo[]): Promise<void> {
  await window.electronAPI.setConfig({
    projects: projects.map((p) => ({
      path: p.path,
      customCommand: p.customCommand,
      pinned: p.pinned,
      lastOpened: p.lastOpened,
    })),
  })
}

export const useAppStore = create<AppState>((set, get) => ({
  projects: [],
  processes: {},
  terminalOutputs: {},
  processUrls: {},
  config: { projects: [], theme: 'system' },
  searchQuery: '',
  capability: null,
  tmuxSessions: [],

  initApp: async () => {
    // Load persisted config + projects
    const config = await window.electronAPI.getConfig()
    const projects: ProjectInfo[] = []
    for (const saved of config.projects) {
      const project = await window.electronAPI.detectProjects(saved.path)
      if (project) {
        if (saved.customCommand) project.customCommand = saved.customCommand
        if (saved.pinned) project.pinned = saved.pinned
        if (saved.lastOpened) project.lastOpened = saved.lastOpened
        projects.push(project)
      }
    }

    // Get capability info
    const capability = await window.electronAPI.getCapability()

    // P0 2: Rehydrate tmux sessions if available
    let tmuxSessions: TmuxSessionInfo[] = []
    if (capability?.hasTmux) {
      const recovered = await window.electronAPI.rehydrateTmuxSessions()
      tmuxSessions = await window.electronAPI.listTmuxSessions()

      // Mark projects with existing tmux sessions as detached
      for (const rec of recovered) {
        const matched = projects.find((p) => {
          // Match via wsl path = project path converted
          const wslPath = rec.cwd.replace(/\\/g, '/').toLowerCase()
          const projPath = p.path.replace(/\\/g, '/').toLowerCase()
          return wslPath.includes(projPath) || projPath.includes(wslPath)
        })
        if (matched) {
          get().markProjectDetached(matched.id)
        }
      }
    }

    set({ config, projects, capability, tmuxSessions })
  },

  loadConfig: async () => {
    const config = await window.electronAPI.getConfig()
    const projects: ProjectInfo[] = []
    for (const saved of config.projects) {
      const project = await window.electronAPI.detectProjects(saved.path)
      if (project) {
        if (saved.customCommand) project.customCommand = saved.customCommand
        if (saved.pinned) project.pinned = saved.pinned
        if (saved.lastOpened) project.lastOpened = saved.lastOpened
        projects.push(project)
      }
    }
    set({ config, projects })
  },

  addProject: async (dirPath: string) => {
    const existing = get().projects.find((p) => p.path === dirPath)
    if (existing) return

    const project = await window.electronAPI.detectProjects(dirPath)
    if (!project) return

    set((state) => ({ projects: [...state.projects, project] }))
    await persistProjects(get().projects)
  },

  removeProject: async (projectId: string) => {
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== projectId),
    }))
    await persistProjects(get().projects)
  },

  startProject: async (projectId: string, commandOverride?: string, processId?: string, useWsl?: boolean) => {
    const project = get().projects.find((p) => p.id === projectId)
    if (!project) return

    const command = commandOverride || project.customCommand || project.command
    const pid = processId || projectId

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
        [pid]: '',
      },
    }))

    await window.electronAPI.startProcess(pid, command, project.path, useWsl)
  },

  stopProject: async (projectId: string) => {
    await window.electronAPI.stopProcess(projectId)
    set((state) => ({
      processes: {
        ...state.processes,
        [projectId]: { pid: null, status: 'stopped' },
      },
    }))
  },

  sendInput: (projectId: string, data: string) => {
    window.electronAPI.sendInput(projectId, data)
  },

  appendOutput: (projectId: string, data: string) => {
    set((state) => {
      const normalized = data.replace(/\r?\n/g, '\r\n')
      const nextOutput = (state.terminalOutputs[projectId] || '') + normalized

      // URL detection: search accumulated buffer (handles chunked stdout)
      // Strip ANSI before matching to avoid color codes splitting the URL
      const alreadyHasUrl = state.processUrls[projectId]
      const clean = alreadyHasUrl ? '' : nextOutput.replace(/\x1b\[[0-9;]*m/g, '')
      const urlMatch = clean ? clean.match(/https?:\/\/[\w.-]+:\d{2,5}/i) : null
      const processUrls = urlMatch
        ? { ...state.processUrls, [projectId]: urlMatch[0] }
        : state.processUrls

      return {
        terminalOutputs: { ...state.terminalOutputs, [projectId]: nextOutput },
        processUrls,
      }
    })
  },

  clearOutput: (projectId: string) => {
    set((state) => ({
      terminalOutputs: {
        ...state.terminalOutputs,
        [projectId]: '',
      },
    }))
  },

  updateProcessStatus: (projectId: string, status: string) => {
    set((state) => ({
      processes: {
        ...state.processes,
        [projectId]: {
          pid: null,
          status: status as ProcessInfo['status'],
          ...(status === 'error'
            ? { error: 'Process encountered an error' }
            : {}),
        },
      },
    }))
  },

  handleProcessExit: (projectId: string, code: number | null) => {
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

  setSearchQuery: (query: string) => {
    set({ searchQuery: query })
  },

  togglePin: async (projectId: string) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, pinned: !p.pinned } : p
      ),
    }))
    await persistProjects(get().projects)
  },

  updateLastOpened: (projectId: string) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, lastOpened: Date.now() } : p
      ),
    }))
    // Persisted on next explicit save (add/remove/togglePin) to avoid IPC spam per navigation
  },

  clearProcessUrl: (projectId: string) => {
    set((state) => ({
      processUrls: {
        ...state.processUrls,
        [projectId]: '',
      },
    }))
  },

  reattachProject: async (projectId: string, processId?: string) => {
    const project = get().projects.find((p) => p.id === projectId)
    if (!project) return

    const pid = processId || projectId

    set((state) => ({
      processes: {
        ...state.processes,
        [pid]: { pid: null, status: 'running', startTime: Date.now() },
      },
    }))

    // Pass empty command — runner will only attach to existing tmux session (no creation)
    await window.electronAPI.startProcess(pid, '', project.path)
  },

  loadTmuxSessions: async () => {
    try {
      const sessions = await window.electronAPI.listTmuxSessions()
      set({ tmuxSessions: sessions })
    } catch { /* tmux not available */ }
  },

  markProjectDetached: (projectId: string) => {
    set((state) => ({
      processes: {
        ...state.processes,
        [projectId]: { pid: null, status: 'detached', startTime: undefined },
      },
    }))
  },
}))
