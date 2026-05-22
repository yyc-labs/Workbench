import { arrayMove } from '@dnd-kit/sortable'
import type { StateCreator } from 'zustand'
import type { AppState } from './appStore.types'
import { createEntityId, createFallbackProject, persistWorkspace } from './appStore.helpers'

export type WorkspaceActionsSlice = Pick<
  AppState,
  | 'addProject'
  | 'removeProject'
  | 'setProjectCli'
  | 'setProjectCustomName'
  | 'setProjectCustomType'
  | 'setProjectCustomCommand'
  | 'setProjectDocLinks'
  | 'togglePin'
  | 'updateLastOpened'
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

    set((state) => ({ projects: [...state.projects, project] }))
    await persistWorkspace(get().projects, get().folders, get().tags)
  },

  removeProject: async (projectId) => {
    set((state) => {
      const nextProcessUrls = { ...state.processUrls }
      delete nextProcessUrls[projectId]
      return {
        projects: state.projects.filter((p) => p.id !== projectId),
        processUrls: nextProcessUrls,
      }
    })
    await persistWorkspace(get().projects, get().folders, get().tags)
  },

  setProjectCli: async (projectId, cli) => {
    set((state) => ({
      projects: state.projects.map((p) => (p.id === projectId ? { ...p, cli } : p)),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags)
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
    await persistWorkspace(get().projects, get().folders, get().tags)
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
    await persistWorkspace(get().projects, get().folders, get().tags)
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
    await persistWorkspace(get().projects, get().folders, get().tags)
  },

  setProjectDocLinks: async (projectId, docLinks) => {
    set((state) => ({
      projects: state.projects.map((p) => (p.id === projectId ? { ...p, docLinks } : p)),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags)
  },

  togglePin: async (projectId) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, pinned: !p.pinned } : p
      ),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags)
  },

  updateLastOpened: (projectId) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, lastOpened: Date.now() } : p
      ),
    }))
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
    await persistWorkspace(get().projects, get().folders, get().tags)
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
    await persistWorkspace(get().projects, get().folders, get().tags)
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
    await persistWorkspace(get().projects, get().folders, get().tags)
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
    await persistWorkspace(get().projects, get().folders, get().tags)
  },

  assignProjectFolder: async (projectId, folderId) => {
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId ? { ...project, folderId } : project
      ),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags)
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
    await persistWorkspace(get().projects, get().folders, get().tags)
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
    await persistWorkspace(get().projects, get().folders, get().tags)
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
    await persistWorkspace(get().projects, get().folders, get().tags)
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
    await persistWorkspace(get().projects, get().folders, get().tags)
  },

  setProjectTags: async (projectId, tagIds) => {
    const uniq = [...new Set(tagIds)]
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId ? { ...project, tagIds: uniq } : project
      ),
    }))
    await persistWorkspace(get().projects, get().folders, get().tags)
  },
})

