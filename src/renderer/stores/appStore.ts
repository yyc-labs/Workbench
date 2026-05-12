import { create } from 'zustand'
import type { ProjectInfo, ProcessInfo, AppConfig } from '../../shared/types'

declare global {
  interface Window {
    electronAPI: {
      detectProjects: (path: string) => Promise<ProjectInfo | null>
      startProcess: (id: string, cmd: string, cwd: string) => Promise<boolean>
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

  loadConfig: () => Promise<void>
  addProject: (dirPath: string) => Promise<void>
  removeProject: (projectId: string) => Promise<void>
  startProject: (projectId: string) => Promise<void>
  stopProject: (projectId: string) => Promise<void>
  appendOutput: (projectId: string, data: string) => void
  clearOutput: (projectId: string) => void
  updateProcessStatus: (projectId: string, status: string) => void
  handleProcessExit: (projectId: string, code: number | null) => void
  sendInput: (projectId: string, data: string) => void
  setSearchQuery: (query: string) => void
  togglePin: (projectId: string) => void
  updateLastOpened: (projectId: string) => void
  clearProcessUrl: (projectId: string) => void
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

  startProject: async (projectId: string) => {
    const project = get().projects.find((p) => p.id === projectId)
    if (!project) return

    const command = project.customCommand || project.command

    set((state) => ({
      processes: {
        ...state.processes,
        [projectId]: { pid: null, status: 'running', startTime: Date.now() },
      },
      terminalOutputs: {
        ...state.terminalOutputs,
        [projectId]: '',
      },
      processUrls: {
        ...state.processUrls,
        [projectId]: '',
      },
    }))

    await window.electronAPI.startProcess(projectId, command, project.path)
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
      // Detect localhost URL from stdout (only first match per session)
      const alreadyHasUrl = state.processUrls[projectId]
      const urlMatch = alreadyHasUrl
        ? null
        : data.match(/(https?:\/\/[\w.-]+:\d{2,5})/i)
      const processUrls = urlMatch
        ? { ...state.processUrls, [projectId]: urlMatch[1] }
        : state.processUrls

      return {
        terminalOutputs: {
          ...state.terminalOutputs,
          [projectId]: (state.terminalOutputs[projectId] || '') + data,
        },
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
}))
