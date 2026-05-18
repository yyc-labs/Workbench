import { create } from 'zustand'
import type {
  ProjectInfo,
  ProcessInfo,
  AppConfig,
  Capability,
  TmuxSessionInfo,
  RecoveredSession,
  SessionRuntime,
  RuntimeEntry,
  ProjectDocLink,
} from '../../shared/types'
import { runtimeManager } from '../runtime/RuntimeManager'

const initialThemeMode = (document.documentElement.getAttribute('data-theme-mode') as AppConfig['theme'] | null) ?? 'system'
let initAppPromise: Promise<void> | null = null

function normalizeComparablePath(input: string): string {
  const normalized = input.replace(/\\/g, '/').toLowerCase()
  const uncWsl = normalized.match(/^\/\/(?:wsl\.localhost|wsl\$)\/[^/]+\/?(.*)$/)
  if (uncWsl) {
    const rest = uncWsl[1] ?? ''
    return rest ? `/${rest.replace(/^\/+/, '')}` : '/'
  }
  const drive = normalized.match(/^([a-z]):\/(.*)$/)
  if (drive) {
    return `/mnt/${drive[1]}/${drive[2]}`
  }
  return normalized
}

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
      killTmuxSession: (sessionName: string) => Promise<boolean>
      rehydrateTmuxSessions: () => Promise<RecoveredSession[]>
      startRuntime: (projectId: string, projectPath: string, cli?: 'claude' | 'codex') => Promise<boolean>
      listRuntimeEntries: () => Promise<RuntimeEntry[]>
      openTerminal: (sessionName: string, statusHint?: string) => Promise<boolean>
      openFolder: (folderPath: string) => Promise<void>
      openInVsCode: (folderPath: string) => Promise<void>
    }
  }
}

interface AppState {
  isAppReady: boolean
  projects: ProjectInfo[]
  processes: Record<string, ProcessInfo>
  terminalOutputs: Record<string, string>
  processUrls: Record<string, string[]>
  config: AppConfig
  searchQuery: string
  capability: Capability | null
  tmuxSessions: TmuxSessionInfo[]
  sessions: Record<string, SessionRuntime>
  runtimeEntries: Record<string, RuntimeEntry>

  loadConfig: () => Promise<void>
  setTheme: (theme: AppConfig['theme']) => Promise<void>
  initApp: () => Promise<void>
  addProject: (dirPath: string) => Promise<void>
  removeProject: (projectId: string) => Promise<void>
  startProject: (projectId: string, commandOverride?: string, processId?: string, useWsl?: boolean) => Promise<void>
  stopProject: (projectId: string) => Promise<void>
  reattachProject: (projectId: string, processId?: string) => Promise<void>
  loadRuntimeEntries: () => Promise<void>
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
  refreshSessions: () => Promise<void>
  setProjectCli: (projectId: string, cli: 'claude' | 'codex') => Promise<void>
  setProjectDocLinks: (projectId: string, docLinks: ProjectDocLink[]) => Promise<void>
  startRuntime: (projectId: string) => Promise<void>
  stopRuntime: (projectId: string) => Promise<void>
  openTerminal: (projectId: string, statusHint?: string) => Promise<boolean>
}

async function persistProjects(projects: ProjectInfo[]): Promise<void> {
  await window.electronAPI.setConfig({
    projects: projects.map((p) => ({
      path: p.path,
      customCommand: p.customCommand,
      pinned: p.pinned,
      lastOpened: p.lastOpened,
      cli: p.cli,
      docLinks: p.docLinks ?? [],
    })),
  })
}

export const useAppStore = create<AppState>((set, get) => ({
  isAppReady: false,
  projects: [],
  processes: {},
  terminalOutputs: {},
  processUrls: {},
  config: { projects: [], theme: initialThemeMode },
  searchQuery: '',
  capability: null,
  tmuxSessions: [],
  sessions: {},
  runtimeEntries: {},

  initApp: async () => {
    if (get().isAppReady) return
    if (initAppPromise) return initAppPromise

    initAppPromise = (async () => {
    // Load persisted config + projects
    const config = await window.electronAPI.getConfig()
    const projects: ProjectInfo[] = []
    for (const saved of config.projects) {
      const project = await window.electronAPI.detectProjects(saved.path)
      if (project) {
        if (saved.customCommand) project.customCommand = saved.customCommand
        if (saved.pinned) project.pinned = saved.pinned
        if (saved.lastOpened) project.lastOpened = saved.lastOpened
        if (saved.cli) project.cli = saved.cli
        project.docLinks = saved.docLinks ?? []
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
          const wslPath = normalizeComparablePath(rec.cwd)
          const projPath = normalizeComparablePath(p.path)
          return wslPath.includes(projPath) || projPath.includes(wslPath)
        })
        if (matched) {
          get().markProjectDetached(matched.id)
        }
      }
    }

    set({ config, projects, capability, tmuxSessions })

    // Load runtime entries (session names computed by main process via MD5)
    await get().loadRuntimeEntries()

    // Initial session refresh (after state is set so projects are available)
    await get().refreshSessions()
    set({ isAppReady: true })
    })()

    try {
      await initAppPromise
    } finally {
      initAppPromise = null
    }
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
        if (saved.cli) project.cli = saved.cli
        project.docLinks = saved.docLinks ?? []
        projects.push(project)
      }
    }
    set({ config, projects })
  },

  setTheme: async (theme: AppConfig['theme']) => {
    const updated = await window.electronAPI.setConfig({ theme })
    set((state) => ({
      config: {
        ...state.config,
        theme: updated.theme,
      },
    }))
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

  setProjectCli: async (projectId: string, cli: 'claude' | 'codex') => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, cli } : p
      ),
    }))
    await persistProjects(get().projects)
  },

  setProjectDocLinks: async (projectId: string, docLinks: ProjectDocLink[]) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, docLinks } : p
      ),
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
        [pid]: [],
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

      // URL detection: find ALL URLs in accumulated buffer
      const clean = nextOutput.replace(/\x1b\[[0-9;]*m/g, '')
      const urlMatches = clean.match(/https?:\/\/[\w.-]+:\d{2,5}/gi)
      const uniqueUrls: string[] = urlMatches ? [...new Set(urlMatches)] : []
      const processUrls = uniqueUrls.length > 0
        ? { ...state.processUrls, [projectId]: uniqueUrls }
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
        [projectId]: [],
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

  refreshSessions: async () => {
    try {
      const { projects, runtimeEntries } = get()
      const rawSessions = await runtimeManager.listTmuxSessions()
      const result: Record<string, SessionRuntime> = {}

      for (const project of projects) {
        // Use session name from runtime entry (computed by main process via MD5).
        // Falls back to old lx_ format for projects with no runtime entry.
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
      const map: Record<string, RuntimeEntry> = {}
      for (const e of entries) {
        map[e.projectId] = e
      }
      set({ runtimeEntries: map })
    } catch {
      // registry not available
    }
  },

  startRuntime: async (projectId: string) => {
    const project = get().projects.find((p) => p.id === projectId)
    if (!project) return
    await runtimeManager.startRuntime(projectId, project.path, project.cli)
    // Reload runtime entries so we pick up the newly computed session name
    await get().loadRuntimeEntries()
    await get().refreshSessions()
  },

  stopRuntime: async (projectId: string) => {
    const session = get().sessions[projectId]
    if (!session || session.status === 'stopped') return
    await runtimeManager.stopRuntime(session.sessionName)
    await get().refreshSessions()
  },

  openTerminal: async (projectId: string, statusHint?: string) => {
    const session = get().sessions[projectId]
    console.log('[store.openTerminal]', { projectId, hasSession: !!session, sessionName: session?.sessionName })
    if (!session) { console.log('[store.openTerminal] BAIL — no session'); return false }
    console.log('[store.openTerminal] calling runtimeManager.openTerminal...')
    const ok = await runtimeManager.openTerminal(session.sessionName, statusHint)
    console.log('[store.openTerminal] runtimeManager returned', ok)
    return ok
  },
}))
