import type { StateCreator } from 'zustand'
import type { AppState } from './appStore.types'
import { createFallbackProject } from './appStore.helpers'
import type { TmuxSessionInfo } from '../../shared/types'

let initAppPromise: Promise<void> | null = null

export type InitActionsSlice = Pick<
  AppState,
  'initApp' | 'loadConfig'
>

export const createInitActionsSlice: StateCreator<AppState, [], [], InitActionsSlice> = (set, get) => ({
  initApp: async () => {
    if (get().isAppReady) return
    if (initAppPromise) return initAppPromise

    initAppPromise = (async () => {
      const config = await window.electronAPI.getConfig()
      const projects = []
      for (const saved of config.projects) {
        let project = null
        try {
          project = await window.electronAPI.detectProjects(saved.path)
        } catch (err) {
          console.warn('[appStore.initApp] detectProjects failed, fallback to unknown:', saved.path, err)
        }
        const ensured = project ?? createFallbackProject(saved.path)
        if (saved.customCommand) ensured.customCommand = saved.customCommand
        if (saved.customName?.trim()) ensured.customName = saved.customName.trim()
        if (saved.customType?.trim()) ensured.customType = saved.customType.trim()
        if (saved.pinned) ensured.pinned = saved.pinned
        if (saved.lastOpened) ensured.lastOpened = saved.lastOpened
        if (saved.cli) ensured.cli = saved.cli
        ensured.docLinks = saved.docLinks ?? []
        ensured.folderId = saved.folderId
        ensured.tagIds = saved.tagIds ?? []
        ensured.lastCodeFile = saved.lastCodeFile
        projects.push(ensured)
      }

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

      await get().loadRuntimeEntries()
      await get().refreshSessions()
      await get().syncManagedProcesses()
      get().rehydrateProcessUrlsFromStorage()
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
    const projects = []
    for (const saved of config.projects) {
      let project = null
      try {
        project = await window.electronAPI.detectProjects(saved.path)
      } catch (err) {
        console.warn('[appStore.loadConfig] detectProjects failed, fallback to unknown:', saved.path, err)
      }
      const ensured = project ?? createFallbackProject(saved.path)
      if (saved.customCommand) ensured.customCommand = saved.customCommand
      if (saved.customName?.trim()) ensured.customName = saved.customName.trim()
      if (saved.customType?.trim()) ensured.customType = saved.customType.trim()
      if (saved.pinned) ensured.pinned = saved.pinned
      if (saved.lastOpened) ensured.lastOpened = saved.lastOpened
      if (saved.cli) ensured.cli = saved.cli
      ensured.docLinks = saved.docLinks ?? []
      ensured.folderId = saved.folderId
      ensured.tagIds = saved.tagIds ?? []
      ensured.lastCodeFile = saved.lastCodeFile
      projects.push(ensured)
    }
    set({
      config,
      projects,
      folders: (config.folders ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder),
      tags: (config.tags ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder),
    })
  },
})
