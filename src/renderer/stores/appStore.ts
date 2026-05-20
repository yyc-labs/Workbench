import { create } from 'zustand'
import { arrayMove } from '@dnd-kit/sortable'
import type {
  ProjectInfo,
  ProcessInfo,
  AppConfig,
  Capability,
  TmuxSessionInfo,
  SessionRuntime,
  RuntimeEntry,
  ProjectDocLink,
  RuntimeDiagnostics,
  ProjectFolder,
  ProjectTag,
  StartupDefaultFilter,
} from '../../shared/types'
import { runtimeManager } from '../runtime/RuntimeManager'
import { detectProjectEnvironment } from '../lib/projectEnvironment'

const initialThemeMode = (document.documentElement.getAttribute('data-theme-mode') as AppConfig['theme'] | null) ?? 'system'
let initAppPromise: Promise<void> | null = null
const MAX_TERMINAL_OUTPUT_CHARS = 1_000_000
const URL_PATTERN = /https?:\/\/[\w.-]+:\d{2,5}/gi

function trimTerminalBuffer(text: string): string {
  if (text.length <= MAX_TERMINAL_OUTPUT_CHARS) return text
  return text.slice(text.length - MAX_TERMINAL_OUTPUT_CHARS)
}

function collectUrlsFromText(text: string): string[] {
  const clean = text.replace(/\x1b\[[0-9;]*m/g, '')
  const matches = clean.match(URL_PATTERN)
  return matches ? [...new Set(matches)] : []
}

function fallbackProjectName(dirPath: string): string {
  const normalized = dirPath.replace(/[\\/]+$/, '')
  const parts = normalized.split(/[\\/]/)
  return parts[parts.length - 1] || dirPath
}

function fallbackProjectId(filePath: string): string {
  let hash = 0
  for (let i = 0; i < filePath.length; i++) {
    const char = filePath.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return `p${Math.abs(hash).toString(36)}`
}

function createEntityId(prefix: 'folder' | 'tag'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createFallbackProject(dirPath: string): ProjectInfo {
  return {
    id: fallbackProjectId(dirPath),
    path: dirPath,
    name: fallbackProjectName(dirPath),
    type: 'unknown',
    command: 'echo Please set project command first',
    docLinks: [],
  }
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
      getPathForFile: (file: File) => string
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
      startRuntime: (projectId: string, projectPath: string, cli?: 'claude' | 'codex') => Promise<boolean>
      getRuntimeDiagnostics: () => Promise<RuntimeDiagnostics>
      listRuntimeEntries: () => Promise<RuntimeEntry[]>
      openTerminal: (sessionName: string, statusHint?: string) => Promise<boolean>
      openFolder: (folderPath: string) => Promise<void>
      openInVsCode: (folderPath: string) => Promise<void>
      runAiCommit: (
        projectId: string,
        projectPath: string,
        override?: { split?: boolean; splitMaxBatches?: number }
      ) => Promise<boolean>
      onAiCommitOutput: (
        cb: (d: { projectId: string; data: string }) => void
      ) => () => void
      onAiCommitStatus: (
        cb: (d: { projectId: string; status: 'running' | 'success' | 'error' }) => void
      ) => () => void
    }
  }
}

interface AppState {
  isAppReady: boolean
  projects: ProjectInfo[]
  folders: ProjectFolder[]
  tags: ProjectTag[]
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
  setRuntimeLauncherScript: (scriptPath: string) => Promise<void>
  setRuntimeKeepAliveOnQuit: (enabled: boolean) => Promise<void>
  setAiCommitConfig: (aiCommit: NonNullable<AppConfig['aiCommit']>) => Promise<void>
  initApp: () => Promise<void>
  addProject: (dirPath: string) => Promise<void>
  removeProject: (projectId: string) => Promise<void>
  startProject: (projectId: string, commandOverride?: string, processId?: string, useWsl?: boolean) => Promise<void>
  stopProject: (projectId: string) => Promise<void>
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
  refreshSessions: () => Promise<void>
  setProjectCli: (projectId: string, cli: 'claude' | 'codex') => Promise<void>
  setProjectDocLinks: (projectId: string, docLinks: ProjectDocLink[]) => Promise<void>
  setStartupDefaultFilter: (filter?: StartupDefaultFilter) => Promise<void>
  createFolder: (name: string, color?: string) => Promise<void>
  renameFolder: (folderId: string, name: string) => Promise<void>
  removeFolder: (folderId: string) => Promise<void>
  reorderFolders: (activeFolderId: string, overFolderId: string) => Promise<void>
  assignProjectFolder: (projectId: string, folderId?: string) => Promise<void>
  createTag: (name: string, color?: string) => Promise<void>
  renameTag: (tagId: string, name: string) => Promise<void>
  removeTag: (tagId: string) => Promise<void>
  reorderTags: (activeTagId: string, overTagId: string) => Promise<void>
  setProjectTags: (projectId: string, tagIds: string[]) => Promise<void>
  startRuntime: (projectId: string) => Promise<void>
  stopRuntime: (projectId: string) => Promise<void>
  openTerminal: (projectId: string, statusHint?: string) => Promise<boolean>
}

function toSavedProjects(projects: ProjectInfo[]): AppConfig['projects'] {
  return projects.map((p) => ({
    path: p.path,
    customCommand: p.customCommand,
    pinned: p.pinned,
    lastOpened: p.lastOpened,
    cli: p.cli,
    docLinks: p.docLinks ?? [],
    folderId: p.folderId,
    tagIds: p.tagIds ?? [],
  }))
}

async function persistWorkspace(
  projects: ProjectInfo[],
  folders: ProjectFolder[],
  tags: ProjectTag[],
): Promise<void> {
  await window.electronAPI.setConfig({
    projects: toSavedProjects(projects),
    folders,
    tags,
  })
}

export const useAppStore = create<AppState>((set, get) => ({
  isAppReady: false,
  projects: [],
  folders: [],
  tags: [],
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
      let project: ProjectInfo | null = null
      try {
        project = await window.electronAPI.detectProjects(saved.path)
      } catch (err) {
        console.warn('[appStore.initApp] detectProjects failed, fallback to unknown:', saved.path, err)
      }
      const ensured = project ?? createFallbackProject(saved.path)
      if (saved.customCommand) ensured.customCommand = saved.customCommand
      if (saved.pinned) ensured.pinned = saved.pinned
      if (saved.lastOpened) ensured.lastOpened = saved.lastOpened
      if (saved.cli) ensured.cli = saved.cli
      ensured.docLinks = saved.docLinks ?? []
      ensured.folderId = saved.folderId
      ensured.tagIds = saved.tagIds ?? []
      projects.push(ensured)
    }

    // Get capability info
    const capability = await window.electronAPI.getCapability()

    let tmuxSessions: TmuxSessionInfo[] = []
    if (capability?.hasTmux) {
      tmuxSessions = await window.electronAPI.listTmuxSessions()
    }

    set({
      config,
      projects,
      folders: (config.folders ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder),
      tags: (config.tags ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder),
      capability,
      tmuxSessions,
    })

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
      let project: ProjectInfo | null = null
      try {
        project = await window.electronAPI.detectProjects(saved.path)
      } catch (err) {
        console.warn('[appStore.loadConfig] detectProjects failed, fallback to unknown:', saved.path, err)
      }
      const ensured = project ?? createFallbackProject(saved.path)
      if (saved.customCommand) ensured.customCommand = saved.customCommand
      if (saved.pinned) ensured.pinned = saved.pinned
      if (saved.lastOpened) ensured.lastOpened = saved.lastOpened
      if (saved.cli) ensured.cli = saved.cli
      ensured.docLinks = saved.docLinks ?? []
      ensured.folderId = saved.folderId
      ensured.tagIds = saved.tagIds ?? []
      projects.push(ensured)
    }
    set({
      config,
      projects,
      folders: (config.folders ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder),
      tags: (config.tags ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder),
    })
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

  setRuntimeLauncherScript: async (scriptPath: string) => {
    const updated = await window.electronAPI.setConfig({ runtimeLauncherScript: scriptPath })
    set((state) => ({
      config: {
        ...state.config,
        runtimeLauncherScript: updated.runtimeLauncherScript,
      },
    }))
  },

  setRuntimeKeepAliveOnQuit: async (enabled: boolean) => {
    const updated = await window.electronAPI.setConfig({ runtimeKeepAliveOnQuit: enabled })
    set((state) => ({
      config: {
        ...state.config,
        runtimeKeepAliveOnQuit: updated.runtimeKeepAliveOnQuit ?? false,
      },
    }))
  },

  setAiCommitConfig: async (aiCommit: NonNullable<AppConfig['aiCommit']>) => {
    const updated = await window.electronAPI.setConfig({ aiCommit })
    set((state) => ({
      config: {
        ...state.config,
        aiCommit: updated.aiCommit,
      },
    }))
  },

  addProject: async (dirPath: string) => {
    const existing = get().projects.find((p) => p.path === dirPath)
    if (existing) return

    let detected: ProjectInfo | null = null
    try {
      detected = await window.electronAPI.detectProjects(dirPath)
    } catch (err) {
      console.warn('[appStore.addProject] detectProjects failed, fallback to unknown:', dirPath, err)
    }
    const project = detected ?? createFallbackProject(dirPath)

    set((state) => ({ projects: [...state.projects, project] }))
    await persistWorkspace(get().projects, get().folders, get().tags)
  },

  removeProject: async (projectId: string) => {
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== projectId),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags)
  },

  setProjectCli: async (projectId: string, cli: 'claude' | 'codex') => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, cli } : p
      ),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags)
  },

  setProjectDocLinks: async (projectId: string, docLinks: ProjectDocLink[]) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, docLinks } : p
      ),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags)
  },

  setStartupDefaultFilter: async (filter?: StartupDefaultFilter) => {
    const updated = await window.electronAPI.setConfig({ startupDefaultFilter: filter })
    set((state) => ({
      config: {
        ...state.config,
        startupDefaultFilter: updated.startupDefaultFilter,
      },
    }))
  },

  createFolder: async (name: string, color?: string) => {
    const trimmed = name.trim()
    if (!trimmed) return

    const dup = get().folders.some((folder) => folder.name.toLowerCase() === trimmed.toLowerCase())
    if (dup) return

    const nextFolder: ProjectFolder = {
      id: createEntityId('folder'),
      name: trimmed,
      color: color?.trim() || undefined,
      sortOrder: get().folders.length,
    }
    set((state) => ({
      folders: [...state.folders, nextFolder],
    }))
    await persistWorkspace(get().projects, get().folders, get().tags)
  },

  renameFolder: async (folderId: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return

    const dup = get().folders.some(
      (folder) => folder.id !== folderId && folder.name.toLowerCase() === trimmed.toLowerCase()
    )
    if (dup) return

    set((state) => ({
      folders: state.folders.map((folder) =>
        folder.id === folderId ? { ...folder, name: trimmed } : folder
      ),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags)
  },

  removeFolder: async (folderId: string) => {
    const startupDefaultFilter = get().config.startupDefaultFilter
    if (startupDefaultFilter?.type === 'folder' && startupDefaultFilter.folderId === folderId) {
      const updated = await window.electronAPI.setConfig({ startupDefaultFilter: undefined })
      set((state) => ({
        config: {
          ...state.config,
          startupDefaultFilter: updated.startupDefaultFilter,
        },
      }))
    }

    set((state) => ({
      folders: state.folders.filter((folder) => folder.id !== folderId),
      projects: state.projects.map((project) =>
        project.folderId === folderId ? { ...project, folderId: undefined } : project
      ),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags)
  },

  reorderFolders: async (activeFolderId: string, overFolderId: string) => {
    if (activeFolderId === overFolderId) return
    const current = get().folders
    const oldIndex = current.findIndex((folder) => folder.id === activeFolderId)
    const newIndex = current.findIndex((folder) => folder.id === overFolderId)
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return

    const reordered = arrayMove(current, oldIndex, newIndex).map((folder, index) => ({
      ...folder,
      sortOrder: index,
    }))
    set({ folders: reordered })
    await persistWorkspace(get().projects, get().folders, get().tags)
  },

  assignProjectFolder: async (projectId: string, folderId?: string) => {
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId ? { ...project, folderId } : project
      ),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags)
  },

  createTag: async (name: string, color?: string) => {
    const trimmed = name.trim()
    if (!trimmed) return

    const dup = get().tags.some((tag) => tag.name.toLowerCase() === trimmed.toLowerCase())
    if (dup) return

    const nextTag: ProjectTag = {
      id: createEntityId('tag'),
      name: trimmed,
      color: color?.trim() || undefined,
      sortOrder: get().tags.length,
    }
    set((state) => ({
      tags: [...state.tags, nextTag],
    }))
    await persistWorkspace(get().projects, get().folders, get().tags)
  },

  renameTag: async (tagId: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return

    const dup = get().tags.some(
      (tag) => tag.id !== tagId && tag.name.toLowerCase() === trimmed.toLowerCase()
    )
    if (dup) return

    set((state) => ({
      tags: state.tags.map((tag) =>
        tag.id === tagId ? { ...tag, name: trimmed } : tag
      ),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags)
  },

  removeTag: async (tagId: string) => {
    const startupDefaultFilter = get().config.startupDefaultFilter
    if (startupDefaultFilter?.type === 'tag' && startupDefaultFilter.tagId === tagId) {
      const updated = await window.electronAPI.setConfig({ startupDefaultFilter: undefined })
      set((state) => ({
        config: {
          ...state.config,
          startupDefaultFilter: updated.startupDefaultFilter,
        },
      }))
    }

    set((state) => ({
      tags: state.tags.filter((tag) => tag.id !== tagId),
      projects: state.projects.map((project) => ({
        ...project,
        tagIds: (project.tagIds ?? []).filter((id) => id !== tagId),
      })),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags)
  },

  reorderTags: async (activeTagId: string, overTagId: string) => {
    if (activeTagId === overTagId) return
    const current = get().tags
    const oldIndex = current.findIndex((tag) => tag.id === activeTagId)
    const newIndex = current.findIndex((tag) => tag.id === overTagId)
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return

    const reordered = arrayMove(current, oldIndex, newIndex).map((tag, index) => ({
      ...tag,
      sortOrder: index,
    }))
    set({ tags: reordered })
    await persistWorkspace(get().projects, get().folders, get().tags)
  },

  setProjectTags: async (projectId: string, tagIds: string[]) => {
    const uniq = [...new Set(tagIds)]
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId ? { ...project, tagIds: uniq } : project
      ),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags)
  },

  startProject: async (projectId: string, commandOverride?: string, processId?: string, useWsl?: boolean) => {
    const project = get().projects.find((p) => p.id === projectId)
    if (!project) return

    const command = commandOverride || project.customCommand || project.command
    const pid = processId || projectId
    const projectEnv = detectProjectEnvironment(project.path)
    const resolvedUseWsl =
      useWsl ?? (projectEnv === 'ubuntu' ? true : projectEnv === 'windows' ? false : undefined)

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

    await window.electronAPI.startProcess(pid, command, project.path, resolvedUseWsl)
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
      const prevOutput = state.terminalOutputs[projectId] || ''
      const nextOutput = trimTerminalBuffer(prevOutput + normalized)

      // Incremental URL detection from new chunk, with fallback re-sync for safety.
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
    await persistWorkspace(get().projects, get().folders, get().tags)
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

  loadTmuxSessions: async () => {
    try {
      const sessions = await window.electronAPI.listTmuxSessions()
      set({ tmuxSessions: sessions })
    } catch { /* tmux not available */ }
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
    const diagnostics = await window.electronAPI.getRuntimeDiagnostics()
    if (diagnostics.issues.length > 0) {
      const message = diagnostics.issues.map((issue) => `- ${issue}`).join('\n')
      throw new Error(`Runtime preflight checks failed:\n${message}`)
    }
    const ok = await runtimeManager.startRuntime(projectId, project.path, project.cli)
    if (!ok) {
      throw new Error('Runtime failed to start. Please run Runtime diagnostics in Settings.')
    }
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
