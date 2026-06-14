import { arrayMove } from '@dnd-kit/sortable'
import type { StateCreator } from 'zustand'
import type { AppState } from './appStore.types'
import { applySavedProjectSnapshot, createEntityId, createFallbackProject, persistWorkspace, toRemovedProjectSnapshot } from './appStore.helpers'

export type WorkspaceActionsSlice = Pick<
  AppState,
  | 'addProject'
  | 'removeProject'
  | 'setProjectCli'
  | 'setProjectCustomName'
  | 'setProjectCustomType'
  | 'setProjectCustomCommand'
  | 'setProjectRunWorkingDirectory'
  | 'setProjectRunStartupMode'
  | 'setProjectDocLinks'
  | 'setProjectLastCodeFile'
  | 'setProjectCodeSession'
  | 'setProjectLastMarkdownPreviewMode'
  | 'setProjectCodeFileDrawerState'
  | 'clearAllProjectLastCodeFiles'
  | 'togglePin'
  | 'updateLastOpened'
  | 'clearProjectLastOpened'
  | 'createFolder'
  | 'renameFolder'
  | 'removeFolder'
  | 'reorderFolders'
  | 'assignProjectFolder'
  | 'createTag'
  | 'renameTag'
  | 'removeTag'
  | 'reorderTags'
  | 'setProjectTags'
>

export const createWorkspaceActionsSlice: StateCreator<AppState, [], [], WorkspaceActionsSlice> = (set, get) => ({
  addProject: async (dirPath) => {
    const existing = get().projects.find((p) => p.path === dirPath)
    if (existing) return

    let detected = null
    try {
      detected = await window.electronAPI.detectProjects(dirPath)
    } catch (err) {
      console.warn('[appStore.addProject] detectProjects failed, fallback to unknown:', dirPath, err)
    }
    const project = detected ?? createFallbackProject(dirPath)
    const removedProjects = get().config.removedProjects ?? []
    const reuseIndex = removedProjects.findIndex((item) => item.path === dirPath)
    const reusedSnapshot = reuseIndex >= 0 ? removedProjects[reuseIndex] : undefined
    if (reusedSnapshot) {
      applySavedProjectSnapshot(project, reusedSnapshot)
    }

    set((state) => {
      const nextRemovedProjects = reusedSnapshot
        ? state.config.removedProjects?.filter((item) => item.path !== dirPath) ?? []
        : state.config.removedProjects ?? []
      return {
        projects: [...state.projects, project],
        config: {
          ...state.config,
          removedProjects: nextRemovedProjects,
        },
      }
    })
    await persistWorkspace(get().projects, get().folders, get().tags, get().config.removedProjects)
  },

  removeProject: async (projectId) => {
    set((state) => {
      const nextProcessUrls = { ...state.processUrls }
      delete nextProcessUrls[projectId]
      const removedProject = state.projects.find((p) => p.id === projectId)
      const existingSnapshots = state.config.removedProjects ?? []
      const dedupedSnapshots = removedProject
        ? existingSnapshots.filter((item) => item.path !== removedProject.path)
        : existingSnapshots
      const nextRemovedProjects = removedProject
        ? [toRemovedProjectSnapshot(removedProject), ...dedupedSnapshots].slice(0, 200)
        : dedupedSnapshots
      return {
        projects: state.projects.filter((p) => p.id !== projectId),
        processUrls: nextProcessUrls,
        config: {
          ...state.config,
          removedProjects: nextRemovedProjects,
        },
      }
    })
    await persistWorkspace(get().projects, get().folders, get().tags, get().config.removedProjects)
  },

  setProjectCli: async (projectId, cli) => {
    set((state) => ({
      projects: state.projects.map((p) => (p.id === projectId ? { ...p, cli } : p)),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags, get().config.removedProjects)
  },

  setProjectCustomName: async (projectId, customName) => {
    const normalized = customName?.trim()
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId
          ? { ...project, customName: normalized || undefined }
          : project
      ),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags, get().config.removedProjects)
  },

  setProjectCustomType: async (projectId, customType) => {
    const normalized = customType?.trim()
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId
          ? { ...project, customType: normalized || undefined }
          : project
      ),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags, get().config.removedProjects)
  },

  setProjectCustomCommand: async (projectId, customCommand) => {
    set((state) => ({
      projects: state.projects.map((project) => {
        if (project.id !== projectId) return project
        const normalized = customCommand?.trim()
        const shouldClear = !normalized || normalized === project.command
        return {
          ...project,
          customCommand: shouldClear ? undefined : normalized,
        }
      }),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags, get().config.removedProjects)
  },

  setProjectRunWorkingDirectory: async (projectId, runWorkingDirectory) => {
    const normalized = runWorkingDirectory?.trim()
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId
          ? { ...project, runWorkingDirectory: normalized || undefined }
          : project
      ),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags, get().config.removedProjects)
  },

  setProjectRunStartupMode: async (projectId, mode) => {
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId
          ? { ...project, runStartupMode: mode === 'terminal' ? 'terminal' : 'silent' }
          : project
      ),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags, get().config.removedProjects)
  },

  setProjectDocLinks: async (projectId, docLinks) => {
    set((state) => ({
      projects: state.projects.map((p) => (p.id === projectId ? { ...p, docLinks } : p)),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags, get().config.removedProjects)
  },

  setProjectLastCodeFile: async (projectId, relativePath) => {
    const normalized = relativePath?.trim() || undefined
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId ? { ...project, lastCodeFile: normalized } : project
      ),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags, get().config.removedProjects)
  },

  setProjectCodeSession: async (projectId, session) => {
    const normalizePath = (value: unknown): string => (
      typeof value === 'string' ? value.trim() : ''
    )
    const normalizeContentSearchHistory = (value: unknown): string[] | undefined => {
      if (!Array.isArray(value)) return undefined
      const normalized = Array.from(new Set(
        value
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter((item) => item.length > 0)
      )).slice(0, 12)
      return normalized.length > 0 ? normalized : undefined
    }
    const normalizeContentSearchScope = (value: unknown): string | undefined => {
      if (typeof value !== 'string') return undefined
      const normalized = value.trim()
      return normalized || undefined
    }
    const normalizePosition = (position: unknown): { lineNumber: number; column: number } | null => {
      if (!position || typeof position !== 'object') return null
      const lineNumber = Math.max(1, Math.floor(Number((position as { lineNumber?: unknown }).lineNumber)))
      const column = Math.max(1, Math.floor(Number((position as { column?: unknown }).column)))
      if (!Number.isFinite(lineNumber) || !Number.isFinite(column)) return null
      return { lineNumber, column }
    }

    const normalizedTabs = Array.isArray(session?.tabs)
      ? Array.from(new Set(session.tabs.map((item) => normalizePath(item)).filter(Boolean))).slice(0, 5)
      : []
    const normalizedActivePathRaw = normalizePath(session?.activePath)
    const normalizedActivePath = normalizedActivePathRaw && normalizedTabs.includes(normalizedActivePathRaw)
      ? normalizedActivePathRaw
      : normalizedTabs[0]

    const cursorEntries: Array<[string, { lineNumber: number; column: number }]> = []
    const rawCursorPositions = session?.cursorPositions
    if (rawCursorPositions && typeof rawCursorPositions === 'object') {
      for (const [pathKey, value] of Object.entries(rawCursorPositions)) {
        const normalizedPath = normalizePath(pathKey)
        if (!normalizedPath) continue
        const normalizedPosition = normalizePosition(value)
        if (!normalizedPosition) continue
        cursorEntries.push([normalizedPath, normalizedPosition])
        if (cursorEntries.length >= 60) break
      }
    }
    const normalizedCursorPositions = cursorEntries.length > 0 ? Object.fromEntries(cursorEntries) : undefined
    const normalizedContentSearchHistory = normalizeContentSearchHistory(session?.contentSearchHistory)
    const normalizedContentSearchScope = normalizeContentSearchScope(session?.contentSearchScope)
    const normalizedSession = normalizedTabs.length > 0 || normalizedCursorPositions
      || normalizedContentSearchHistory || normalizedContentSearchScope
      ? {
        tabs: normalizedTabs,
        activePath: normalizedActivePath,
        cursorPositions: normalizedCursorPositions,
        contentSearchHistory: normalizedContentSearchHistory,
        contentSearchScope: normalizedContentSearchScope,
      }
      : undefined

    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId ? { ...project, codeSession: normalizedSession } : project
      ),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags, get().config.removedProjects)
  },

  setProjectLastMarkdownPreviewMode: async (projectId, mode) => {
    const normalized = mode === 'edit' || mode === 'preview' || mode === 'split' ? mode : undefined
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId ? { ...project, lastMarkdownPreviewMode: normalized } : project
      ),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags, get().config.removedProjects)
  },

  setProjectCodeFileDrawerState: async (projectId, drawerState) => {
    const normalizedFavorites = Array.from(new Set((drawerState.favorites ?? []).map((item) => item.trim()).filter(Boolean)))
    const normalizedRecents = Array.from(new Set((drawerState.recents ?? []).map((item) => item.trim()).filter(Boolean)))
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId
          ? {
            ...project,
            codeFileDrawerState: {
              favorites: normalizedFavorites,
              recents: normalizedRecents,
            },
          }
          : project
      ),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags, get().config.removedProjects)
  },

  clearAllProjectLastCodeFiles: async () => {
    const hasAnyLastCodeFile = get().projects.some((project) => Boolean(project.lastCodeFile))
    if (!hasAnyLastCodeFile) return

    set((state) => ({
      projects: state.projects.map((project) => (
        project.lastCodeFile ? { ...project, lastCodeFile: undefined } : project
      )),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags, get().config.removedProjects)
  },

  togglePin: async (projectId) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, pinned: !p.pinned } : p
      ),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags, get().config.removedProjects)
  },

  updateLastOpened: (projectId) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, lastOpened: Date.now() } : p
      ),
    }))
    void persistWorkspace(get().projects, get().folders, get().tags, get().config.removedProjects)
  },

  clearProjectLastOpened: async (projectId) => {
    const target = get().projects.find((project) => project.id === projectId)
    if (!target?.lastOpened) return
    set((state) => ({
      projects: state.projects.map((project) => (
        project.id === projectId
          ? { ...project, lastOpened: undefined }
          : project
      )),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags, get().config.removedProjects)
  },

  createFolder: async (name, color) => {
    const trimmed = name.trim()
    if (!trimmed) return

    const dup = get().folders.some((folder) => folder.name.toLowerCase() === trimmed.toLowerCase())
    if (dup) return

    const nextFolder = {
      id: createEntityId('folder'),
      name: trimmed,
      color: color?.trim() || undefined,
      sortOrder: get().folders.length,
    }
    set((state) => ({
      folders: [...state.folders, nextFolder],
    }))
    await persistWorkspace(get().projects, get().folders, get().tags, get().config.removedProjects)
  },

  renameFolder: async (folderId, name) => {
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
    await persistWorkspace(get().projects, get().folders, get().tags, get().config.removedProjects)
  },

  removeFolder: async (folderId) => {
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
    await persistWorkspace(get().projects, get().folders, get().tags, get().config.removedProjects)
  },

  reorderFolders: async (activeFolderId, overFolderId) => {
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
    await persistWorkspace(get().projects, get().folders, get().tags, get().config.removedProjects)
  },

  assignProjectFolder: async (projectId, folderId) => {
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId ? { ...project, folderId } : project
      ),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags, get().config.removedProjects)
  },

  createTag: async (name, color) => {
    const trimmed = name.trim()
    if (!trimmed) return

    const dup = get().tags.some((tag) => tag.name.toLowerCase() === trimmed.toLowerCase())
    if (dup) return

    const nextTag = {
      id: createEntityId('tag'),
      name: trimmed,
      color: color?.trim() || undefined,
      sortOrder: get().tags.length,
    }
    set((state) => ({
      tags: [...state.tags, nextTag],
    }))
    await persistWorkspace(get().projects, get().folders, get().tags, get().config.removedProjects)
  },

  renameTag: async (tagId, name) => {
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
    await persistWorkspace(get().projects, get().folders, get().tags, get().config.removedProjects)
  },

  removeTag: async (tagId) => {
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
    await persistWorkspace(get().projects, get().folders, get().tags, get().config.removedProjects)
  },

  reorderTags: async (activeTagId, overTagId) => {
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
    await persistWorkspace(get().projects, get().folders, get().tags, get().config.removedProjects)
  },

  setProjectTags: async (projectId, tagIds) => {
    const uniq = [...new Set(tagIds)]
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId ? { ...project, tagIds: uniq } : project
      ),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags, get().config.removedProjects)
  },
})
